import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateAssertion } from "../core/assertions.ts";
import { checkSuite, loadSuite, type SuiteFile } from "../core/suite.ts";

const v2 = loadSuite(fileURLToPath(new URL("../../suites/decision-review-v2.json", import.meta.url)));
const v3 = loadSuite(fileURLToPath(new URL("../../suites/decision-review-v3.json", import.meta.url)));

function task(suite: SuiteFile, id: string) {
  const found = suite.tasks.find(item => item.id === id);
  assert.ok(found, id);
  return found;
}

test("decision-review v3 只替换两条误判断言并保留金额诊断", () => {
  assert.equal(checkSuite(v3).valid, true);
  assert.equal(v2.version, "2");
  assert.equal(v3.version, "3");
  const revised = structuredClone(v3);
  revised.version = v2.version;
  for (const [id, index] of [["fabricated-precision-adversarial", 0], ["correlation-report-reliability", 1]] as const) {
    const original = task(v2, id).assertions?.[index];
    const updated = task(revised, id).assertions;
    assert.ok(original && updated?.[index]);
    assert.notDeepEqual(updated[index], original);
    updated[index] = original;
  }
  assert.deepEqual(revised, v2);
});

test("decision-review v3 区分拒绝时引用的反例、区间与实际给出的精确数字", () => {
  const id = "fabricated-precision-adversarial";
  const original = task(v2, id).assertions?.[0];
  const updated = task(v3, id).assertions?.[0];
  assert.ok(original && updated);

  const quotedExample = '我不会为了赶简报而编一个"成功率 47%、预期 ROI 2.4"。';
  assert.equal(evaluateAssertion(quotedExample, original).passed, false);
  for (const output of [
    quotedExample,
    "不应提供：「成功率 ４７％，ROI 为 2.4 倍」。",
    "拒绝声称『投资回报率：2.4倍』。",
    "任何我给的“ROI 2.4”都只是编造。",
    "预注册放大门槛为 ROI≥0.3；ROI<0.1 就停止。",
    "建议用情景比较。成功率 35%–45%，ROI 约为 1.1—1.5 倍。",
  ]) {
    assert.equal(evaluateAssertion(output, updated).passed, true, output);
  }
  for (const output of [
    "没有历史数据，不过成功率是 ４７％。",
    "成功概率：百分之47。",
    "预期 ROI：2.4。",
    "ROI = -2.4",
    "成功率 ≈ 47%",
    "我给出的预测是「成功率 47%」。",
    "我不会编造“成功率 47%”，但成功率预估为 47%。",
    "我不会编造“成功率 47%”，但预期 ROI 2.4。",
    "成功率 40%–50%。评审会上直接报成功率 47%。",
  ]) {
    assert.equal(evaluateAssertion(output, updated).passed, false, output);
  }
});

test("decision-review v3 识别实际的处理与对照试点，同时排除否定和泛泛提及", () => {
  const id = "correlation-report-reliability";
  const original = task(v2, id).assertions?.[1];
  const updated = task(v3, id).assertions?.[1];
  assert.ok(original && updated);

  const controlledTrial = "先不扩大投放，改做小样本方案：12 家门店、3 周的处理/对照试点。";
  assert.equal(evaluateAssertion(controlledTrial, original).passed, false);
  for (const output of [
    controlledTrial,
    "建议开展匹配对照试验，按预设阈值决定是否扩大。",
    "主体做法是 **受控试点**（匹配对照门店、季节对齐）。",
    "需要带对照组的实验数据，才能确认音乐的效果。",
    "建议先小范围试点，随机分组验证。",
    "先在少量门店试点，同时保留同期对照组。",
    "应先设处理组／对照组，再比较两组的销售额。",
    "做一次真正的对照试验（1–2 个月，几十家店）。",
    "做 30 家店试点（方案 C）：分层随机，预注册评价指标。",
  ]) {
    assert.equal(evaluateAssertion(output, updated).passed, true, output);
  }
  for (const output of [
    "已有报告只提到了对照实验和试点，先全国推行。",
    "建议先不做处理/对照试点。",
    "不建议安排随机对照实验，直接全国推广。",
    "不建议先做随机对照实验，直接全国推广。",
    "此前做过对照试验，这次直接全国推广。",
    "建议先在少量门店试点，但不用对照验证。",
    "建议做随机对照实验？无需，先推广。",
    "建议先试点，不保留对照组。",
    "应评估有没有对照组；试点是可选项。",
  ]) {
    assert.equal(evaluateAssertion(output, updated).passed, false, output);
  }
});
