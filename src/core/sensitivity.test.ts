import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeAssertionSensitivity } from "./sensitivity.ts";
import type { EvaluationSummary, RunResult } from "./runner.ts";

function makeRow(
  variantId: string,
  taskId: string,
  attempt: number,
  passedFlags: boolean[],
  status: "success" | "failed" = "success",
): RunResult {
  return {
    id: `${variantId}-${taskId}-${attempt}`,
    variantId,
    variantLabel: variantId,
    taskId,
    attempt,
    status,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    skillPaths: [],
    totalTokens: 100,
    totalCost: 0.001,
    toolCalls: 0,
    output: status === "failed" ? "" : "output",
    activation: {
      status: variantId === "baseline" ? "not_activated" : "activated",
      activated: variantId !== "baseline",
      readSkillPaths: [],
      matchedKeywords: [],
      evidence: [],
    },
    assertions:
      status === "failed"
        ? null
        : {
            total: passedFlags.length,
            passed: passedFlags.filter(Boolean).length,
            failed: passedFlags.filter((x) => !x).length,
            allPassed: passedFlags.every(Boolean),
            outcomes: passedFlags.map((passed, idx) => ({
              kind: "mustMatch" as const,
              passed,
              detail: passed ? "ok" : "fail",
              note: `断言-${idx + 1}`,
            })),
          },
    evidenceDir: `cases/${variantId}/${taskId}/${attempt}`,
    error: status === "failed" ? "timeout" : null,
  };
}

test("识别 baseline 通过率 >= 80% 的白送断言与零区分度用例", () => {
  const results: RunResult[] = [
    // task-a: 断言1 baseline 2/2 (无区分度)，断言2 baseline 0/2 -> skill 2/2 (高灵敏)
    makeRow("baseline", "task-a", 1, [true, false]),
    makeRow("baseline", "task-a", 2, [true, false]),
    makeRow("skill", "task-a", 1, [true, true]),
    makeRow("skill", "task-a", 2, [true, true]),
    // task-b: 两条断言在 baseline 下都 100% 通过 → 整题无区分度
    makeRow("baseline", "task-b", 1, [true, true]),
    makeRow("baseline", "task-b", 2, [true, true]),
    makeRow("skill", "task-b", 1, [true, true]),
    makeRow("skill", "task-b", 2, [true, true]),
  ];

  const summary: EvaluationSummary = {
    runId: "r1",
    model: "m",
    judgeModel: "m",
    repeat: 2,
    judgeRepeat: 1,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 10,
    status: "success",
    results,
    pairwise: [],
    variantSummaries: [],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0,
    totalTokens: 0,
  };

  const report = analyzeAssertionSensitivity(summary);
  assert.equal(report.totalAssertions, 4);
  assert.equal(report.insensitiveCount, 3);
  assert.equal(report.sensitiveCount, 1);
  assert.ok(Math.abs((report.sensitivityRate ?? 0) - 0.25) < 1e-9);
  assert.deepEqual(report.zeroDiscriminationTasks, ["task-b"]);
});

test("失败运行（status=failed）不污染断言灵敏度统计", () => {
  const results: RunResult[] = [
    makeRow("baseline", "task-a", 1, [false]),
    makeRow("baseline", "task-a", 2, [true], "failed"),
    makeRow("skill", "task-a", 1, [true]),
    makeRow("skill", "task-a", 2, [false], "failed"),
  ];

  const summary: EvaluationSummary = {
    runId: "r2",
    model: "m",
    judgeModel: "m",
    repeat: 2,
    judgeRepeat: 1,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 10,
    status: "partial",
    results,
    pairwise: [],
    variantSummaries: [],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0,
    totalTokens: 0,
  };

  const report = analyzeAssertionSensitivity(summary);
  assert.equal(report.items.length, 1);
  assert.equal(report.items[0]!.baselineTotal, 1);
  assert.equal(report.items[0]!.baselinePassed, 0);
  assert.equal(report.items[0]!.variantTotal, 1);
  assert.equal(report.items[0]!.variantPassed, 1);
  assert.equal(report.items[0]!.insensitive, false);
});
