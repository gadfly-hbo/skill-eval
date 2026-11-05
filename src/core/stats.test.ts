import { test } from "node:test";
import assert from "node:assert/strict";
import { wilsonInterval, newcombeDiffInterval, cohensKappa } from "./stats.ts";

test("wilsonInterval 对 0/0 返回 null", () => {
  assert.equal(wilsonInterval(0, 0), null);
});

test("wilsonInterval 在极端比例 0% 与 100% 时不退化为零宽度区间", () => {
  const zero = wilsonInterval(0, 10)!;
  assert.equal(zero.point, 0);
  assert.equal(zero.low, 0);
  assert.ok(zero.high > 0.2 && zero.high < 0.35);

  const full = wilsonInterval(14, 14)!;
  assert.equal(full.point, 1);
  assert.equal(full.high, 1);
  assert.ok(full.low > 0.75 && full.low < 0.85);
});

test("wilsonInterval 对常规样本给出对称合理的 95% 区间", () => {
  const half = wilsonInterval(50, 100)!;
  assert.equal(half.point, 0.5);
  assert.ok(Math.abs(half.low - 0.4038) < 0.005);
  assert.ok(Math.abs(half.high - 0.5962) < 0.005);
});

test("newcombeDiffInterval 区分显著正增益与跨零噪声增益", () => {
  // data-analysis 真实样本：baseline 22/106 (20.8%) -> skill 101/106 (95.3%)
  const strong = newcombeDiffInterval(22, 106, 101, 106)!;
  assert.ok(strong.diffPp > 74 && strong.diffPp < 75);
  assert.ok(strong.lowPp > 60, `强增益下界应远大于 0，实得 ${strong.lowPp}`);

  // json-contract 边界样本（variant 100%）：baseline 2/14 -> skill 14/14
  const fullVariant = newcombeDiffInterval(2, 14, 14, 14)!;
  assert.ok(fullVariant.lowPp > 45, `14/14 vs 2/14 下界应显著大于 0，实得 ${fullVariant.lowPp}`);

  // deep-research 真实样本：baseline 11/68 (16.2%) -> skill 20/68 (29.4%)，点估计 +13.2pp 但区间跨零
  const noisy = newcombeDiffInterval(11, 68, 20, 68)!;
  assert.ok(noisy.diffPp > 13 && noisy.diffPp < 13.5);
  assert.ok(noisy.lowPp <= 0, `小样本弱增益 95% 下界应跨零，实得 ${noisy.lowPp}`);
});

test("newcombeDiffInterval 任一侧分母为 0 时返回 null", () => {
  assert.equal(newcombeDiffInterval(0, 0, 5, 10), null);
  assert.equal(newcombeDiffInterval(5, 10, 0, 0), null);
});

test("cohensKappa 计算评委与人工标注的一致性系数", () => {
  // 完全一致 -> kappa = 1
  const perfect = cohensKappa([
    ["win", "win"],
    ["tie", "tie"],
    ["loss", "loss"],
    ["win", "win"],
  ]);
  assert.equal(perfect, 1);

  // 完全随机对冲 -> kappa <= 0
  const opposite = cohensKappa([
    ["win", "loss"],
    ["loss", "win"],
  ]);
  assert.ok(opposite !== null && opposite <= 0);

  // 空样本 -> null
  assert.equal(cohensKappa([]), null);
});
