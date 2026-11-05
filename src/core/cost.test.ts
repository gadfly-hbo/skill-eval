import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCostEfficiency } from "./cost.ts";

test("token 与耗时未增加时评为 lean（省算力）", () => {
  // json-contract 实测：7758 -> 5997 tokens，12.3s -> 10.1s，增益 +85.7pp
  const c = evaluateCostEfficiency({
    baselineAvgTokens: 7758,
    variantAvgTokens: 5997,
    baselineAvgDurationSec: 12.3,
    variantAvgDurationSec: 10.1,
    gainPp: 85.7,
  });
  assert.equal(c.grade, "lean");
  assert.equal(c.tokensPerGainPp, 0);
});

test("token 膨胀 15 倍（data-analysis 实测）评为 expensive", () => {
  const c = evaluateCostEfficiency({
    baselineAvgTokens: 9056,
    variantAvgTokens: 135473,
    baselineAvgDurationSec: 23.3,
    variantAvgDurationSec: 81.9,
    gainPp: 74.5,
  });
  assert.equal(c.grade, "expensive");
  assert.ok(c.tokenRatio !== null && c.tokenRatio > 14.9);
  assert.ok(c.tokensPerGainPp !== null && c.tokensPerGainPp > 1600 && c.tokensPerGainPp < 1800);
});

test("单位增益 token 成本过高（deep-research 实测）评为 expensive", () => {
  const c = evaluateCostEfficiency({
    baselineAvgTokens: 1_111_630,
    variantAvgTokens: 1_720_822,
    baselineAvgDurationSec: 278.9,
    variantAvgDurationSec: 460.8,
    gainPp: 13.2,
  });
  assert.equal(c.grade, "expensive");
  assert.ok(c.tokensPerGainPp !== null && c.tokensPerGainPp > 40_000);
});

test("极端膨胀且性价比极低时评为 runaway", () => {
  const c = evaluateCostEfficiency({
    baselineAvgTokens: 5000,
    variantAvgTokens: 300_000,
    baselineAvgDurationSec: 10,
    variantAvgDurationSec: 120,
    gainPp: 10,
  });
  assert.equal(c.grade, "runaway");
});

test("温和增加评为 moderate", () => {
  const c = evaluateCostEfficiency({
    baselineAvgTokens: 10_000,
    variantAvgTokens: 18_000,
    baselineAvgDurationSec: 15,
    variantAvgDurationSec: 22,
    gainPp: 35,
  });
  assert.equal(c.grade, "moderate");
});
