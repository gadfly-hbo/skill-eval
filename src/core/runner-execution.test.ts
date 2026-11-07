import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEvaluation, type RunnerOptions } from "./runner.ts";
import { emptyMetrics, type PiRunOptions, type PiRunResult } from "./pi.ts";
import { ControlledBudget } from "./controlled-budget.ts";
import { renderReport } from "../report/markdown.ts";

function fixture(t: { after(fn: () => void): void }, answer?: (role: string, index: number) => string | Error) {
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
        const response = answer?.(role, calls.length);
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
