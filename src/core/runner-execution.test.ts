import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recomputeSummary, runEvaluation, type RunnerOptions } from "./runner.ts";
import { emptyMetrics, type PiRunOptions, type PiRunResult } from "./pi.ts";
import { ControlledBudget } from "./controlled-budget.ts";
import { renderReport } from "../report/markdown.ts";
import { identifySkill } from "./provenance.ts";
import { EVALUATION_POLICY_VERSION, saveRunManifest } from "./run-manifest.ts";
import { prepareDeliverableRead, validDeliverablePath } from "./deliverable.ts";

function fixture(t: { after(fn: () => void): void }, answer?: (role: string, index: number, input: PiRunOptions) => string | Error) {
  const root = mkdtempSync(join(tmpdir(), "eval-one-runner-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const calls: Array<{ role: string; options: PiRunOptions }> = [];
  const budget = new ControlledBudget();
  const options: RunnerOptions = {
    runRoot: root, runId: "offline", model: "minimax-cn/MiniMax-M3.1-Flash",
    judgeModel: "xiaomi-token-plan-cn/mimo-v2.6-flash", repeat: 1, judgeRepeat: 2,
    variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Skill", skillPaths: ["/candidate/SKILL.md"] }],
    tasks: [{ id: "t1", prompt: "task", assertions: [{ kind: "mustContain", value: "ok" }] }],
    contextPrefix: "Shared environment.",
    execution: {
      mode: "simulated", isStopped: () => false, snapshot: () => budget.snapshot(),
      async run(role, input): Promise<PiRunResult> {
        const state = JSON.parse(readFileSync(join(root, "execution-status.json"), "utf8"));
        assert.equal(state.sessions.filter((row: { status: string }) => row.status === "RUNNING").length, 1);
        assert.equal(state.sessions.length, options.tasks.length * (2 + options.judgeRepeat!));
        calls.push({ role, options: input });
        const response = answer?.(role, calls.length, input);
        if (response instanceof Error) throw response;
        const failed = response === "FAIL";
        return {
          exitCode: failed ? 1 : 0, stderr: failed ? "offline failure" : "", timedOut: false,
          metrics: { ...emptyMetrics(), totalTokens: 10, totalCost: 0.001,
            output: failed ? "" : response ?? (role === "judge" ? JSON.stringify({ verdict: "tie", scoreA: 70, scoreB: 70, confidence: 0.8, reason: "same" }) : "ok") },
          events: [{ type: "offline-test-event" }], isolation: { verified: true, issues: [] },
        };
      },
    },
  };
  return { root, calls, options, state: () => JSON.parse(readFileSync(join(root, "execution-status.json"), "utf8")) };
}

test("原 eval 通过同一个执行器调用 subject 和 judge，保留原计分及匿名协议", async (t) => {
  const f = fixture(t);
  const summary = await runEvaluation(f.options);
  assert.deepEqual(f.calls.map((call) => call.role), ["subject", "subject", "judge", "judge"]);
  assert.equal(f.calls[0]!.options.prompt, f.calls[1]!.options.prompt);
  assert.deepEqual(f.calls[0]!.options.skillPaths, []);
  assert.deepEqual(f.calls[1]!.options.skillPaths, ["/candidate/SKILL.md"]);
  for (const call of f.calls) assert.equal(call.options.workspaceRoot.split("/").at(-1), "workspace");
  for (const call of f.calls.filter((call) => call.role === "judge")) {
    assert.deepEqual(call.options.skillPaths, []);
    assert.doesNotMatch(call.options.prompt, /\/candidate|SKILL\.md/);
  }
  assert.equal(summary.status, "success");
  assert.equal(summary.evidenceLevel, "offline-fixture");
  assert.equal(summary.results.length, 2);
  assert.equal(summary.results[0]!.assertions?.allPassed, true);
  assert.equal(summary.pairwise[0]!.verdict, "tie");
  assert.equal(summary.pairwise[0]!.judgeRuns.length, 2);
  assert.deepEqual(f.state().sessions.map((row: { status: string }) => row.status), ["SUCCESS", "SUCCESS", "SUCCESS", "SUCCESS"]);
});

test("subject 失败仍完成其余独立样本；不合格配对的评委保持 NOT_RUN", async (t) => {
  const f = fixture(t, () => "FAIL");
  const summary = await runEvaluation(f.options);
  assert.equal(f.calls.length, 2);
  assert.equal(summary.results.length, 2);
  assert.equal(summary.results[0]!.assertions, null);
  assert.equal(summary.status, "failed");
  assert.equal(summary.pairwise[0]!.verdict, "not_judged");
  assert.equal(summary.variantSummaries.find((row) => row.variantId === "skill")!.totalScoredPairs, 1);
  const skipped = f.state().sessions.filter((row: { status: string }) => row.status === "NOT_RUN");
  assert.equal(skipped.length, 2);
  assert.equal(f.state().stopped, false);
  assert.ok(skipped.every((row: object) => !("usage" in row) && !("cost" in row)));
  const report = renderReport({ summary, tasks: f.options.tasks, variants: f.options.variants,
    verdict: "inconclusive", verdictReason: "样本失败", meta: { skillPath: "/candidate/SKILL.md",
      skillHash: "fixture", skillVersion: "1", suiteId: "fixture", suiteVersion: "1",
      runRoot: f.root, piHome: null, generatedAt: "offline" } });
  assert.match(report, /failed.*NOT_RUN 2/);
  assert.match(report, /budget-ledger\.json.*subject \+ judge/);
  assert.match(report, /被评会话 SDK 估计成本/);
});

test("评委解析失败继续全部冻结轮次，subject 成功不能使整批冒充 success", async (t) => {
  const f = fixture(t, (role) => role === "judge" ? "invalid-json" : "ok");
  f.options.tasks.push({ id: "t2", prompt: "second task" });
  const summary = await runEvaluation(f.options);
  assert.equal(f.calls.length, 8);
  assert.equal(summary.status, "partial");
  assert.equal(summary.results.length, 4);
  assert.equal(summary.pairwise[0]!.judgeRuns.length, 2);
  assert.ok(summary.pairwise.every((row) => row.verdict === "not_judged"));
  assert.equal(f.state().sessions.filter((row: { status: string }) => row.status === "NOT_RUN").length, 0);
  assert.equal(f.state().stopped, false);
});

test("评委中途失败保留已执行票，按完整冻结轮数聚合，不缩为一票通过", async (t) => {
  const f = fixture(t, (role, index) => role === "judge" ? index === 3
    ? JSON.stringify({ verdict: "win", scoreA: 60, scoreB: 90, confidence: 0.9, reason: "better" }) : "FAIL" : "ok");
  f.options.judgeRepeat = 3;
  const summary = await runEvaluation(f.options);
  assert.equal(f.calls.length, 5);
  assert.equal(summary.pairwise[0]!.verdict, "not_judged");
  assert.equal(summary.pairwise[0]!.judgeRuns.length, 3, "全部冻结轮次实际执行且失败票不剔除");
  assert.equal(summary.pairwise[0]!.judgeRuns.filter(run => run.verdict === "not_judged").length, 2);
  assert.equal(f.state().sessions.filter((row: { status: string }) => row.status === "NOT_RUN").length, 0);
});

test("执行入口抛错也会持久化首次失败并停批，不生成虚构 RunResult", async (t) => {
  const f = fixture(t, () => new Error("offline startup rejected"));
  const summary = await runEvaluation(f.options);
  assert.equal(f.calls.length, 1);
  assert.equal(summary.results.length, 0);
  assert.equal(summary.status, "failed");
  assert.match(f.state().reason, /offline startup rejected/);
  assert.equal(f.state().sessions[0].status, "FAILED");
  assert.equal(f.state().sessions.filter((row: { status: string }) => row.status === "NOT_RUN").length, 3);
});

test("任务规则断言不通过仍是计分数据，不触发基础设施停批", async (t) => {
  const f = fixture(t, (role) => role === "subject" ? "wrong answer" : undefined!);
  const summary = await runEvaluation(f.options);
  assert.equal(f.calls.length, 4);
  assert.equal(summary.results[0]!.assertions?.allPassed, false);
  assert.equal(summary.status, "success");
});

const briefPath = "060_reports/decision-brief.md";

test("同一冻结交付文件进入断言与匿名盲评，复核读快照并校验身份", async (t) => {
  const f = fixture(t, (role, index, input) => {
    if (role !== "subject") return JSON.stringify({ verdict: "tie", scoreA: 70, scoreB: 70, confidence: 0.8, reason: "same" });
    const folder = join(input.workspaceRoot, "060_reports");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(input.workspaceRoot, briefPath), index === 1 ? "状态：draft\n基线文档" : "状态：draft\n候选文档");
    return "CHAT RECEIPT";
  });
  const task = f.options.tasks[0]!;
  task.deliverablePath = briefPath;
  task.assertions = [{ kind: "mustMatch", pattern: "^状态：draft\\n" }];
  const snapshot = join(f.root, ".frozen/skill");
  mkdirSync(snapshot, { recursive: true });
  const skillPath = join(snapshot, "SKILL.md");
  writeFileSync(skillPath, "# Frozen fixture");
  const manifest: NonNullable<RunnerOptions["manifest"]> = {
    schemaVersion: 1, policyVersion: EVALUATION_POLICY_VERSION, runId: f.options.runId,
    model: f.options.model, judgeModel: f.options.judgeModel!, repeat: 1, judgeRepeat: 2,
    judgeSeed: f.options.runId, tasks: f.options.tasks, variants: f.options.variants,
    candidate: { snapshotDir: ".frozen/skill", originalSkillPath: skillPath, identity: identifySkill(skillPath) },
    suiteMeta: { suiteId: "fixture", suiteVersion: "1", suiteHash: "fixture", skillVersion: "1", skillPath },
  };
  saveRunManifest(f.root, manifest);
  f.options.manifest = manifest;
  const summary = await runEvaluation(f.options);
  assert.equal(summary.status, "success");
  assert.equal(summary.integrity?.verified, true);
  assert.equal(f.calls[0]!.options.prompt, f.calls[1]!.options.prompt);
  for (const { options } of f.calls.filter((call) => call.role === "judge")) {
    assert.match(options.prompt, /基线文档/);
    assert.match(options.prompt, /候选文档/);
    assert.doesNotMatch(options.prompt, /CHAT RECEIPT/);
  }
  for (const row of summary.results) {
    const caseDir = join(f.root, row.evidenceDir);
    assert.equal(readFileSync(join(caseDir, "output.md"), "utf8"), "CHAT RECEIPT");
    assert.equal(row.assertions?.allPassed, true);
    assert.deepEqual(row.deliverable, { path: briefPath, status: "present" });
    assert.match(row.evidenceHashes!["deliverable.md"]!, /^[a-f0-9]{64}$/);
    writeFileSync(join(caseDir, "workspace", briefPath), "workspace changed");
  }
  writeFileSync(join(f.root, "summary.json"), JSON.stringify(summary));
  const replay = await recomputeSummary(f.root, f.options);
  assert.equal(replay.integrity?.verified, true);
  assert.ok(replay.results.every((row) => row.assertions?.allPassed));
  await assert.rejects(recomputeSummary(f.root, {
    ...f.options, tasks: [{ id: task.id, prompt: task.prompt }],
  }), /不能更换原运行冻结的判分载体/);
  writeFileSync(join(f.root, summary.results[0]!.evidenceDir, "deliverable.md"), "snapshot changed");
  const tampered = await recomputeSummary(f.root, f.options);
  assert.equal(tampered.integrity?.verified, false);
  assert.equal(tampered.results[0]!.assertions, null);
  assert.equal(tampered.status, "partial");
  assert.match(tampered.integrity!.issues.join("\n"), /交付物快照.*哈希变化/);
});

test("交付文件缺失、为空或经链接不可采集，聊天不能替代判分", async (t) => {
  for (const invalid of ["missing", "empty", "symlink", "dir-symlink", "hardlink", "invalid-utf8", "oversize"] as const) {
    await t.test(invalid, async (child) => {
      const f = fixture(child, (role, index, input) => {
        assert.equal(role, "subject");
        if (index === 1) {
          const external = join(f.root, "external");
          mkdirSync(external);
          const externalFile = join(external, "decision-brief.md");
          writeFileSync(externalFile, "external content");
          mkdirSync(input.workspaceRoot, { recursive: true });
          const parent = join(input.workspaceRoot, "060_reports");
          if (invalid === "dir-symlink") symlinkSync(external, parent);
          else {
            mkdirSync(parent);
            const file = join(input.workspaceRoot, briefPath);
            if (invalid === "empty") writeFileSync(file, " \n");
            if (invalid === "symlink") symlinkSync(externalFile, file);
            if (invalid === "hardlink") linkSync(externalFile, file);
            if (invalid === "invalid-utf8") writeFileSync(file, Buffer.from([0xff]));
            if (invalid === "oversize") {
              writeFileSync(file, "");
              truncateSync(file, 8 * 1024 * 1024 + 1);
            }
          }
        }
        return "看起来合格的聊天答复";
      });
      f.options.tasks[0]!.deliverablePath = briefPath;
      f.options.tasks[0]!.assertions = [{ kind: "mustNotContain", value: "禁止词" }];
      const summary = await runEvaluation(f.options);
      const baseline = summary.results[0]!;
      assert.equal(baseline.deliverable?.status, invalid === "missing" ? "missing" : "invalid");
      assert.equal(baseline.assertions, null);
      assert.equal(baseline.status, "failed");
      assert.equal(existsSync(join(f.root, baseline.evidenceDir, "deliverable.md")), false);
      assert.deepEqual(f.state().sessions.map((row: { status: string }) => row.status), ["FAILED", "FAILED", "NOT_RUN", "NOT_RUN"]);
      assert.equal(f.state().stopped, false);
    });
  }
});

test("原生交付采集复用离线沙箱，只读取指定工作区文件", { skip: process.platform !== "darwin" }, (t) => {
  const f = fixture(t);
  const workspace = join(f.root, "workspace");
  mkdirSync(join(workspace, "060_reports"), { recursive: true });
  const collect = prepareDeliverableRead(workspace, briefPath);
  assert.equal(collect().evidence.status, "missing");
  const text = "状态：draft\n# 合规交付物\n";
  writeFileSync(join(workspace, briefPath), text);
  assert.equal(collect().text, text);
  const external = join(f.root, "private.md");
  writeFileSync(external, "private marker");
  rmSync(join(workspace, briefPath));
  symlinkSync(external, join(workspace, briefPath));
  assert.equal(collect().evidence.status, "invalid");
  assert.equal(collect().text, undefined);
});

test("交付路径只允许工作区内的相对 Markdown 路径", () => {
  assert.equal(validDeliverablePath(briefPath), true);
  for (const path of ["/tmp/file.md", "../file.md", "060_reports/../file.md", ".pi-home/file.md", "060_reports\\file.md", "file.json", "file.md\n"]) {
    assert.equal(validDeliverablePath(path), false, path);
  }
});
