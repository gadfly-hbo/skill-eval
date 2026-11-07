import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateAssertions, type Assertion } from "./assertions.ts";
import { evaluatePositiveDelivery } from "./positive-delivery.ts";

const assertions: Assertion[] = [{
  kind: "jsonSchema",
  schema: {
    type: "object",
    required: ["total", "label"],
    properties: { total: { type: "number", minimum: 0 }, label: { type: "string" } },
  },
}];
const scriptResult = { total: 14.25, label: "subtotal" };
const json = JSON.stringify(scriptResult);

test("说明文字和 Markdown 围栏不阻断正确的阳性结果，独立记录交付格式未通过", () => {
  const output = `已完成计算，结果如下。\n\n\`\`\`json\n${json}\n\`\`\``;
  const result = evaluatePositiveDelivery(output, scriptResult, assertions);
  assert.equal(result.contentPassed, true);
  assert.equal(result.formatPassed, false);
  assert.equal(result.contentIssue, null);
  assert.deepEqual(result.assertions, evaluateAssertions(output, assertions));
});

test("裸 JSON 可独立通过内容和格式，字段顺序不影响脚本结果比对", () => {
  const result = evaluatePositiveDelivery(' \n{"label":"subtotal", "total":14.25}\n', scriptResult, assertions);
  assert.equal(result.contentPassed, true);
  assert.equal(result.formatPassed, true);
});

test("格式正确但与脚本结果不同的输出仍不通过内容判定", () => {
  const result = evaluatePositiveDelivery('{"total":15,"label":"subtotal"}', scriptResult, assertions);
  assert.equal(result.assertions.allPassed, true);
  assert.equal(result.contentPassed, false);
  assert.equal(result.formatPassed, true);
  assert.equal(result.contentIssue, "script_result_mismatch");
});

test("输出与脚本结果相同仍须通过原冻结断言", () => {
  const different = { total: -1, label: "subtotal" };
  const result = evaluatePositiveDelivery(JSON.stringify(different), different, assertions);
  assert.equal(result.contentPassed, false);
  assert.equal(result.formatPassed, true);
  assert.equal(result.contentIssue, "frozen_assertions_failed");
});

test("同值对象重复交付仍可通过内容，单独记录格式失败", () => {
  const reordered = '{"label":"subtotal","total":14.250}';
  for (const second of [reordered, `\`\`\`json\n${reordered}\n\`\`\``]) {
    const output = `\`\`\`json\n${json}\n\`\`\`\n\n${second}`;
    const result = evaluatePositiveDelivery(output, scriptResult, assertions);
    assert.deepEqual(result.assertions, evaluateAssertions(output, assertions));
    assert.equal(result.contentPassed, true);
    assert.equal(result.contentIssue, null);
    assert.equal(result.formatPassed, false);
  }
});

test("正确对象之后的矛盾、非法对象、数组和重复键仍使内容失败", () => {
  for (const second of [
    '{"total":15,"label":"subtotal"}',
    '{"total":14.25,}',
    '{"total":14.25',
    `[${json}]`,
    '[]',
    '{"total":15,"total":14.25,"label":"subtotal"}',
  ]) {
    const output = `\`\`\`json\n${json}\n\`\`\`\n\n${second}`;
    const result = evaluatePositiveDelivery(output, scriptResult, assertions);
    assert.equal(result.assertions.allPassed, true);
    assert.equal(result.contentPassed, false);
    assert.equal(result.formatPassed, false);
  }
});

test("数组和非法 JSON 不能通过阳性内容判定", () => {
  for (const output of [`[${json}]`, `结果如下\n\`\`\`json\n[${json}]\n\`\`\``, '{"total":14.25,}']) {
    assert.equal(evaluatePositiveDelivery(output, scriptResult, assertions).contentIssue, "not_unique_json_object");
  }
});

test("重复键及转义等价键不会在 JSON.parse 折叠后通过内容判定", () => {
  for (const output of [
    '{"total":15,"total":14.25,"label":"subtotal"}',
    String.raw`{"total":15,"\u0074otal":14.25,"label":"subtotal"}`,
  ]) {
    const result = evaluatePositiveDelivery(output, scriptResult, assertions);
    assert.equal(result.formatPassed, true);
    assert.equal(result.contentPassed, false);
    assert.equal(result.contentIssue, "duplicate_json_key");
  }
});

test("不同嵌套对象可同名，字符串中的括号与键文本不参与扫描", () => {
  const nestedResult = {
    ...scriptResult,
    children: [{ total: 2 }, { total: 3 }],
    note: '样例 {"total":0}',
  };
  const result = evaluatePositiveDelivery(JSON.stringify(nestedResult), nestedResult, assertions);
  assert.equal(result.formatPassed, true);
  assert.equal(result.contentPassed, true);

  const duplicate = '{"total":14.25,"label":"subtotal","children":[{"total":5,"total":2},{"total":3}],"note":"样例 {\\"total\\":0}"}';
  assert.equal(evaluatePositiveDelivery(duplicate, nestedResult, assertions).contentIssue, "duplicate_json_key");
});
