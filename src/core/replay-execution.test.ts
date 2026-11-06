import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ControlledBudget } from "./controlled-budget.ts";
import { emptyMetrics } from "./pi.ts";
import { recomputeSummary, runEvaluation, type RunnerOptions } from "./runner.ts";

globalThis.fetch = async () => { throw new Error("REAL_PROVIDER_FORBIDDEN_IN_OFFLINE_TEST"); };

async function fixture(t: { after(fn: () => void): void }, invalidJudge = false) {
  const root = mkdtempSync(join(tmpdir(), "eval-controlled-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const candidate = join(root, "candidate", "SKILL.md");
  mkdirSync(join(root, "candidate"));
  writeFileSync(candidate, "---\nname: local-fixture\ndescription: Offline replay fixture.\n---\nFixture package.\n");
  const budget = new ControlledBudget();
  const calls: string[] = [];
  const options: RunnerOptions = {
    runRoot: root, runId: "offline-replay", model: "minimax-cn/MiniMax-M3.1-Flash", judgeModel: "xiaomi-token-plan-cn/mimo-v2.6-flash",
    repeat: 1, judgeRepeat: 2,
    variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Skill", skillPaths: [candidate] }],
    tasks: [{ id: "task", prompt: "Offline task", assertions: [{ kind: "mustContain", value: "ok" }] }],
    execution: {
      mode: "simulated", snapshot: () => budget.snapshot(), isStopped: () => false,
      async run(role) {
        calls.push(role);
        return { exitCode: 0, stderr: "", timedOut: false, events: [{ type: "offline-fixture" }], isolation: { verified: true, issues: [] },
          metrics: { ...emptyMetrics(), totalTokens: 10, totalCost: 0.001,
            output: role === "subject" ? "ok" : invalidJudge ? "invalid-json" : JSON.stringify({ verdict: "tie", scoreA: 70, scoreB: 70, confidence: 0.8, reason: "same" }) },
        };
      },
    },
  };
  const summary = await runEvaluation(options);
  writeFileSync(join(root, "summary.json"), JSON.stringify(summary));
  return { root, options, summary, calls, statusPath: join(root, "execution-status.json") };
}

function artifactHashes(root: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else hashes[path] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  visit(root);
  return hashes;
}

test("完整受控运行的离线回放保留矩阵、执行计数和成对结论，不改写任何产物", async t => {
  const f = await fixture(t);
  const before = artifactHashes(f.root);
  const replay = await recomputeSummary(f.root, f.options);
  assert.equal(replay.status, "success");
  assert.deepEqual(replay.execution, f.summary.execution);
  assert.equal(replay.pairwise[0]?.verdict, f.summary.pairwise[0]?.verdict);
  assert.equal(replay.pairwise[0]?.judgeRuns.length, 2);
  assert.equal(replay.results.length, 2);
  assert.equal(replay.totalTokens, f.summary.totalTokens);
  assert.equal(replay.totalCost, f.summary.totalCost);
  assert.equal(replay.evidenceLevel, "replay");
  assert.deepEqual(artifactHashes(f.root), before);
  assert.deepEqual(f.calls, ["subject", "subject", "judge", "judge"]);
});

test("subject 全成功但首位 judge 解析失败的回放仍是 partial，保留首因和 NOT_RUN", async t => {
  const f = await fixture(t, true);
  const before = artifactHashes(f.root);
  const replay = await recomputeSummary(f.root, f.options);
  assert.equal(f.summary.status, "partial");
  assert.equal(replay.status, "partial");
  assert.deepEqual(replay.execution, f.summary.execution);
  assert.equal(replay.execution?.attemptedSessions, 3);
  assert.equal(replay.execution?.notRunSessions, 1);
  assert.equal(replay.execution?.stopped, true);
  assert.equal(replay.execution?.reason, f.summary.execution?.reason);
  assert.equal(replay.pairwise[0]?.verdict, "not_judged");
  assert.equal(replay.pairwise[0]?.judgeRuns.length, 1, "缺失票保留在聚合分母，但不伪装为实际执行的 judgeRuns");
  assert.equal(replay.results.length, 2);
  assert.equal(replay.totalTokens, 20);
  assert.equal(existsSync(join(f.root, "pairwise", "skill-task-1", "round-002")), false);
  assert.deepEqual(artifactHashes(f.root), before);
  assert.deepEqual(f.calls, ["subject", "subject", "judge"]);
});

test("受控状态侧车缺失、损坏或矩阵被缩减时不能把原成功记录升级为已验证 success", async t => {
  const f = await fixture(t);
  const original = readFileSync(f.statusPath);
  const valid = JSON.parse(original.toString());
  const mutations = [
    () => unlinkSync(f.statusPath),
    () => writeFileSync(f.statusPath, "not-json"),
    () => writeFileSync(f.statusPath, JSON.stringify({ ...valid, sessions: valid.sessions.slice(0, 3) })),
    () => writeFileSync(f.statusPath, JSON.stringify({ ...valid, sessions: valid.sessions.map((row: object, index: number) => index === 0 ? { ...row, taskId: "other" } : row) })),
    () => writeFileSync(f.statusPath, JSON.stringify({ ...valid, stopped: true, reason: null })),
    () => writeFileSync(f.statusPath, JSON.stringify({ ...valid, sessions: valid.sessions.map((row: object, index: number) => index === 0 ? { ...row, usage: 0 } : row) })),
  ];
  for (const mutate of mutations) {
    writeFileSync(f.statusPath, original);
    mutate();
    const replay = await recomputeSummary(f.root, f.options);
    assert.equal(replay.status, "partial");
    assert.equal(replay.integrity?.verified, false);
    assert.ok(replay.integrity?.issues.some(issue => issue.includes("受控执行状态未验证")));
    assert.equal(replay.results.length, 2);
    assert.equal(replay.totalTokens, 20);
    assert.equal(f.calls.length, 4, "回放不得启动任何额外执行");
  }
});

test("NOT_RUN 与已保存的真实评委产物冲突时标记状态未验证，不信任伪造的零执行结论", async t => {
  const f = await fixture(t, true);
  const state = JSON.parse(readFileSync(f.statusPath, "utf8"));
  state.sessions[2].status = "NOT_RUN";
  delete state.sessions[2].reason;
  writeFileSync(f.statusPath, JSON.stringify(state));
  const replay = await recomputeSummary(f.root, f.options);
  assert.equal(replay.status, "partial");
  assert.equal(replay.integrity?.verified, false);
  assert.ok(replay.integrity?.issues.some(issue => issue.includes("judge 执行状态与原始产物不一致")));
  assert.equal(replay.totalTokens, 20);
});

test("历史非受控记录不被强加新侧车要求；只有受控 metadata 的记录仍须校验侧车", async t => {
  const f = await fixture(t);
  const legacy = { ...f.summary, execution: undefined };
  writeFileSync(join(f.root, "summary.json"), JSON.stringify(legacy));
  unlinkSync(f.statusPath);
  const replay = await recomputeSummary(f.root, f.options);
  assert.equal(replay.status, "success");
  assert.equal(replay.execution, undefined);
  assert.ok(!replay.integrity?.issues.some(issue => issue.includes("受控执行状态未验证")));
  writeFileSync(join(f.root, "controlled-execution.json"), JSON.stringify({ schemaVersion: 1, mode: "simulated", plannedSessions: 4 }));
  const controlled = await recomputeSummary(f.root, f.options);
  assert.equal(controlled.status, "partial");
  assert.equal(controlled.integrity?.verified, false);
  assert.ok(controlled.integrity?.issues.some(issue => issue.includes("执行状态侧车缺失")));
});
