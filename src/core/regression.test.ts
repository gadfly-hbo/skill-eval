import { test } from "node:test";
import assert from "node:assert/strict";
import { strictGate, compareRegression, parseThresholds, DEFAULT_THRESHOLDS } from "./regression.ts";
import { scoreEfcRuns, computeDifficulty, defaultDifficulty } from "./efc.ts";

test("严格接受门拒绝平局", () => {
  const gate = strictGate(0.6, 0.6);
  assert.equal(gate.accepted, false);
  assert.match(gate.reason, /严格大于/);
});

test("严格接受门接受严格更优", () => {
  const gate = strictGate(0.7, 0.6);
  assert.equal(gate.accepted, true);
});

test("严格接受门在无基线时接受", () => {
  const gate = strictGate(0.5, null);
  assert.equal(gate.accepted, true);
  assert.match(gate.reason, /无当前版本基线/);
});

test("严格接受门在候选分数为 null 时拒绝", () => {
  const gate = strictGate(null, 0.6);
  assert.equal(gate.accepted, false);
});

test("胜率下降超过阈值判定为回归", () => {
  const comparison = compareRegression(
    { score: 0.5, activationRate: 0.9 },
    {
      evaluationId: "old",
      skillVersion: "v1",
      model: "m",
      timestamp: 0,
      metrics: { score: 0.7, activationRate: 0.9 },
    },
  );
  assert.equal(comparison.regressionStatus, "regression");
  assert.ok(comparison.scoreDelta !== null && comparison.scoreDelta < 0);
});

test("胜率下降未超阈值不算回归", () => {
  const comparison = compareRegression(
    { score: 0.65, activationRate: 0.9 },
    {
      evaluationId: "old",
      skillVersion: "v1",
      model: "m",
      timestamp: 0,
      metrics: { score: 0.7, activationRate: 0.9 },
    },
  );
  assert.equal(comparison.regressionStatus, "none");
});

test("激活率下降超过阈值判定为回归", () => {
  const comparison = compareRegression(
    { score: 0.8, activationRate: 0.4 },
    {
      evaluationId: "old",
      skillVersion: "v1",
      model: "m",
      timestamp: 0,
      metrics: { score: 0.8, activationRate: 0.9 },
    },
  );
  assert.equal(comparison.regressionStatus, "regression");
  assert.match(comparison.regressionReason ?? "", /激活率下降/);
});

test("无历史基线时状态为 unknown", () => {
  const comparison = compareRegression({ score: 0.8, activationRate: 0.9 }, null);
  assert.equal(comparison.regressionStatus, "unknown");
});

test("阈值解析对非法值回落到默认", () => {
  const thresholds = parseThresholds({ scoreDrop: "abc", activationRateDrop: 5 });
  assert.equal(thresholds.scoreDrop, DEFAULT_THRESHOLDS.scoreDrop);
  assert.equal(thresholds.activationRateDrop, DEFAULT_THRESHOLDS.activationRateDrop);
});

test("阈值解析支持嵌套结构", () => {
  const thresholds = parseThresholds({ thresholds: { scoreDrop: 0.05 } });
  assert.equal(thresholds.scoreDrop, 0.05);
});

test("EFC 分数随工具调用增加而升高", () => {
  const withTools = scoreEfcRuns([
    { status: "success", hasOutput: true, toolCalls: 3, totalTokens: 1000 },
  ]);
  const withoutTools = scoreEfcRuns([
    { status: "success", hasOutput: true, toolCalls: 0, totalTokens: 1000 },
  ]);
  assert.ok(withTools.efc > withoutTools.efc);
});

test("EFC 断言失败的有效性低于通过", () => {
  const passing = scoreEfcRuns([{ status: "success", validity: "passing", hasOutput: true }]);
  const failing = scoreEfcRuns([{ status: "success", validity: "assertion", hasOutput: true }]);
  assert.ok(passing.efc > failing.efc);
});

test("重复输出因相关性惩罚而降低 EFC", () => {
  const unique = scoreEfcRuns([
    { status: "success", hasOutput: true, signature: "a" },
    { status: "success", hasOutput: true, signature: "b" },
  ]);
  const duplicated = scoreEfcRuns([
    { status: "success", hasOutput: true, signature: "a" },
    { status: "success", hasOutput: true, signature: "a" },
  ]);
  assert.ok(unique.efc > duplicated.efc);
});

test("难度升高时归一化分数降低", () => {
  // minSteps 是乘数，难度越高 computeDifficulty 越大；
  // 而 normalized = efc / difficulty，因此同等 EFC 下归一化分数越低。
  const runs = [{ status: "success" as const, hasOutput: true, toolCalls: 1, totalTokens: 1000 }];
  const easy = scoreEfcRuns(runs, defaultDifficulty());
  const hard = scoreEfcRuns(runs, { ...defaultDifficulty(), minSteps: 4 });

  assert.ok(computeDifficulty(defaultDifficulty()) < computeDifficulty({ ...defaultDifficulty(), minSteps: 4 }));
  assert.equal(easy.efc, hard.efc);
  assert.ok(easy.normalized > hard.normalized);
});
