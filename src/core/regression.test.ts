import { test } from "node:test";
import assert from "node:assert/strict";
import { strictGate, compareRegression, parseThresholds, DEFAULT_THRESHOLDS } from "./regression.ts";

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

test("套件哈希漂移时标记 suiteDrift=true 且不跨套件强行对比", () => {
  const comparison = compareRegression(
    { score: 0.5, activationRate: 0.9, suiteHash: "sha256:v2" },
    {
      evaluationId: "old",
      skillVersion: "v1",
      model: "m",
      timestamp: 0,
      metrics: { score: 0.8, activationRate: 0.9, suiteHash: "sha256:v1" },
    },
  );
  assert.equal(comparison.regressionStatus, "unknown");
  assert.equal(comparison.suiteDrift, true);
  assert.match(comparison.regressionReason ?? "", /套件哈希已变更/);
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
