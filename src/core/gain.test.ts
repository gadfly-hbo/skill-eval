import { test } from "node:test";
import assert from "node:assert/strict";

import {
  evaluateGain,
  computeGainPp,
  DEFAULT_GAIN_THRESHOLD_PP,
} from "./gain.ts";

/**
 * 增益门槛的判定规则。
 *
 * 背景：阴性对照实验证明断言整体灵敏度只有 51.9%——skill 完全无效时
 * 断言通过率仍可达 75.9%。所以判定必须看增益，不能看绝对通过率。
 */

/** 门槛取值来自阴性对照实验：原版 +50.0pp，破坏版 +8.6pp。 */
test("默认门槛为 10pp", () => {
  assert.equal(DEFAULT_GAIN_THRESHOLD_PP, 10);
});

test("增益达到门槛即通过", () => {
  const v = evaluateGain(0.5, 1.0);
  assert.equal(v.passed, true);
  assert.equal(v.gainPp, 50);
  assert.equal(v.thresholdPp, 10);
});

test("增益恰好等于门槛时通过", () => {
  const v = evaluateGain(0.5, 0.6);
  assert.equal(v.passed, true);
  assert.equal(v.gainPp, 10);
});

test("增益低于门槛时不通过", () => {
  // 破坏版的实际增益 +8.6pp，应被拦下。
  const v = evaluateGain(0.5, 0.586);
  assert.equal(v.passed, false);
  assert.ok(v.gainPp !== null && Math.abs(v.gainPp - 8.6) < 0.01);
});

test("增益为零不通过", () => {
  const v = evaluateGain(0.75, 0.75);
  assert.equal(v.passed, false);
  assert.equal(v.gainPp, 0);
});

test("增益为负不通过", () => {
  const v = evaluateGain(0.8, 0.6);
  assert.equal(v.passed, false);
  assert.equal(v.gainPp, -20);
  assert.match(v.reason, /不升反降/);
});

test("增益不可判定时不通过（证据不足不能默认放行）", () => {
  const noBaseline = evaluateGain(null, 0.9);
  assert.equal(noBaseline.passed, false);
  assert.equal(noBaseline.gainPp, null);
  assert.match(noBaseline.reason, /不可判定/);

  const noVariant = evaluateGain(0.5, null);
  assert.equal(noVariant.passed, false);
  assert.equal(noVariant.gainPp, null);
});

test("两侧都不可判定时不通过", () => {
  const v = evaluateGain(null, null);
  assert.equal(v.passed, false);
  assert.equal(v.gainPp, null);
});

test("可自定义门槛", () => {
  assert.equal(evaluateGain(0.5, 0.6, 5).passed, true);
  assert.equal(evaluateGain(0.5, 0.6, 20).passed, false);
});

test("门槛为 0 时零增益也通过", () => {
  const v = evaluateGain(0.5, 0.5, 0);
  assert.equal(v.passed, true);
});

test("computeGainPp 只算数字不判定", () => {
  assert.equal(computeGainPp(0.5, 1.0), 50);
  assert.equal(computeGainPp(0.5, 0.6), 10);
  assert.equal(computeGainPp(null, 0.6), null);
  assert.equal(computeGainPp(0.5, null), null);
});

test("computeGainPp 与 evaluateGain 的增益一致", () => {
  const base = 0.37;
  const variant = 0.72;
  assert.equal(computeGainPp(base, variant), evaluateGain(base, variant).gainPp);
});

// ---------------------------------------------------------------------------
// 条目累计通过率
//
// 背景（实测 2026-11-04 deep-research 测评）：报告首屏曾用「整轮全过率」
// 显示 baseline 0.0% → skill 0.0%（判读「无差异」），
// 而归档门控用「条目累计」算出 +13.2pp 判定达标——同一份数据自相矛盾。
// 这里固定条目累计口径的计算行为，防止再次退回整轮口径。
// ---------------------------------------------------------------------------

import { computeAssertionItemRate } from "./gain.ts";

const ROWS = [
  {
    variantId: "baseline",
    assertions: {
      total: 4,
      outcomes: [{ passed: true }, { passed: false }, { passed: false }, { passed: false }],
    },
  },
  {
    variantId: "skill",
    assertions: {
      total: 4,
      outcomes: [{ passed: true }, { passed: true }, { passed: true }, { passed: false }],
    },
  },
];

test("条目累计通过率按条目数计，不按整轮全过计", () => {
  assert.equal(computeAssertionItemRate(ROWS, "baseline"), 0.25);
  assert.equal(computeAssertionItemRate(ROWS, "skill"), 0.75);
});

test("条目累计口径下两侧都能被区分（整轮口径会都是 0）", () => {
  // 整轮全过率：baseline 0/1 轮全过，skill 0/1 轮全过 → 都是 0，看不出差异。
  const baselineAllPassed = ROWS.filter((r) => r.variantId === "baseline").every((r) =>
    r.assertions.outcomes.every((o) => o.passed),
  );
  const skillAllPassed = ROWS.filter((r) => r.variantId === "skill").every((r) =>
    r.assertions.outcomes.every((o) => o.passed),
  );
  assert.equal(baselineAllPassed, false);
  assert.equal(skillAllPassed, false);

  // 条目累计口径：差异可见，且与门控增益一致。
  const b = computeAssertionItemRate(ROWS, "baseline")!;
  const v = computeAssertionItemRate(ROWS, "skill")!;
  assert.equal(evaluateGain(b, v).gainPp, 50);
});

test("条目累计通过率忽略无断言的行", () => {
  const rows = [
    { variantId: "skill", assertions: null },
    { variantId: "skill", assertions: { total: 0, outcomes: [] } },
    { variantId: "skill", assertions: { total: 2, outcomes: [{ passed: true }, { passed: false }] } },
  ];
  assert.equal(computeAssertionItemRate(rows, "skill"), 0.5);
});

test("无任何断言时条目累计通过率不可判定", () => {
  assert.equal(computeAssertionItemRate([{ variantId: "skill", assertions: null }], "skill"), null);
  assert.equal(computeAssertionItemRate([], "skill"), null);
});

test("指定 variantId 时不混入其他变体的条目", () => {
  // 传入 null 表示不过滤——但本用例确认按 id 过滤时结果与期望一致。
  assert.equal(computeAssertionItemRate(ROWS, "baseline"), 0.25);
  assert.equal(computeAssertionItemRate(ROWS, "skill"), 0.75);
});
