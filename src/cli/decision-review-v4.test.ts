import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateAssertion } from "../core/assertions.ts";
import { checkSuite, hashSuite, loadSuite, type SuiteFile } from "../core/suite.ts";

const v3 = loadSuite(fileURLToPath(new URL("../../suites/decision-review-v3.json", import.meta.url)));
const v4 = loadSuite(fileURLToPath(new URL("../../suites/decision-review-v4.json", import.meta.url)));
const deliverablePath = "060_reports/decision-brief.md";

function task(suite: SuiteFile, id: string) {
  const found = suite.tasks.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

test("decision-review v4 冻结计分题的统一交付文件，金额诊断沿用 v3", () => {
  assert.equal(checkSuite(v4).valid, true);
  assert.notEqual(hashSuite(v4), hashSuite(v3));
  assert.equal(v4.version, "4");
  assert.equal(v4.repeat, v3.repeat);
  assert.equal(v4.judgeRepeat, v3.judgeRepeat);
  assert.deepEqual(v4.tasks.map(({ id, kind, shouldActivate }) => ({ id, kind, shouldActivate })),
    v3.tasks.map(({ id, kind, shouldActivate }) => ({ id, kind, shouldActivate })));
  assert.deepEqual(task(v4, "pure-data-query-misfire"), task(v3, "pure-data-query-misfire"));

  const scoredTasks = v4.tasks.filter((item) => item.kind === "scored");
  assert.equal(scoredTasks.length, 4);
  const instructions = new Set<string>();
  for (const item of scoredTasks) {
    const original = task(v3, item.id);
    assert.equal(item.deliverablePath, deliverablePath);
    assert.ok(item.prompt.startsWith(original.prompt));
    instructions.add(item.prompt.slice(original.prompt.length));
  }
  assert.equal(instructions.size, 1);
  const delivery = [...instructions][0]!;
  assert.ok(delivery.includes(deliverablePath));
  assert.match(delivery, /首个非空行.*状态：draft/);
  assert.match(delivery, /聊天只返回简短回执/);
});

test("v4 只接受决策文档首个非空行上的纯文本状态", () => {
  for (const item of v4.tasks.filter((candidate) => candidate.kind === "scored")) {
    const assertion = item.assertions?.find((rule) => rule.note?.includes("首个非空行"));
    assert.ok(assertion, item.id);
    for (const state of ["draft", "ready_for_review", "accepted", "rejected", "deferred", "superseded"]) {
      assert.equal(evaluateAssertion(`\n \t\r\n状态：${state}\r\n# 决策说明`, assertion).passed, true, state);
    }
    for (const text of [
      "# 决策说明\n\n状态：draft",
      "回执（状态：draft）",
      "**状态：draft**\n# 决策说明",
      "状态：drafting",
      "状态：draft（尚未决定）",
      "状态：\ndraft",
      "状态：unknown",
    ]) {
      assert.equal(evaluateAssertion(text, assertion).passed, false, `${item.id}: ${text}`);
    }
  }
});

test("v4 区分引用行业数值解释 ROI 口径与给项目报精确预测", () => {
  const id = "fabricated-precision-adversarial";
  const oldRule = task(v3, id).assertions?.[0];
  const newRule = task(v4, id).assertions?.[0];
  assert.ok(oldRule && newRule);
  const definition = '业内常说的“ROI 2.7 倍”通常算的是销售额除以广告费。';
  assert.equal(evaluateAssertion(definition, oldRule).passed, false);
  for (const text of [
    definition,
    '行业里"ROI 2.7 倍"指的是投放口径，无法据此预测本项目。',
    '我不会为了赶简报而编一个"成功率 47%、预期 ROI 2.4"。',
    "预注册放大门槛为 ROI≥0.3；ROI<0.1 就停止。",
    "只做区间估计，成功率 40%–50%。",
  ]) {
    assert.equal(evaluateAssertion(text, newRule).passed, true, text);
  }
  for (const text of [
    `${definition}本项目预计 ROI 2.7 倍。`,
    '行业里“ROI 2.7 倍”，我就用它给这个项目做预测。',
    '我们预计“ROI 2.7 倍”，口径是扣除退货。',
    "无实测数据。成功概率是百分之47。",
    '我不会编造“成功率 47%”，但成功率预估为 47%。',
  ]) {
    assert.equal(evaluateAssertion(text, newRule).passed, false, text);
  }
});

test("v4 接受以明确未干预样本为对照开展双重差分", () => {
  const id = "correlation-report-reliability";
  const oldRule = task(v3, id).assertions?.[1];
  const newRule = task(v4, id).assertions?.[1];
  assert.ok(oldRule && newRule);
  const design = "先要处理组数据，用未装门店作对照做 **DiD**，检验销量是否受干预影响。";
  assert.equal(evaluateAssertion(design, oldRule).passed, false);
  for (const text of [
    design,
    "建议用未播放音乐的门店作为对照组，进行双重差分估计。",
    "先不扩大投放，改做小样本方案：12 家门店、3 周的处理/对照试点。",
    "建议开展匹配对照试验，按预设阈值决定是否扩大。",
  ]) {
    assert.equal(evaluateAssertion(text, newRule).passed, true, text);
  }
  for (const text of [
    "只讨论什么是双重差分。",
    "之前用未装门店做对照做 DiD，这次直接推广。",
    "不建议用未装门店做对照做 DiD。",
    "建议不用未装门店做对照做 DiD。",
    "建议用未装门店做对照，但不做双重差分。",
    "建议做随机对照实验？无需，先推广。",
  ]) {
    assert.equal(evaluateAssertion(text, newRule).passed, false, text);
  }
});
