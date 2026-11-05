import { test } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAssertions,
  evaluateAssertion,
  parseJsonObject,
  validateJsonSchema,
} from "./assertions.ts";

test("mustMatch 命中时通过", () => {
  const outcome = evaluateAssertion("订单金额 120 元", { kind: "mustMatch", pattern: "订单金额" });
  assert.equal(outcome.passed, true);
});

test("mustMatch 未命中时失败", () => {
  const outcome = evaluateAssertion("今天天气不错", { kind: "mustMatch", pattern: "订单金额" });
  assert.equal(outcome.passed, false);
});

test("mustNotMatch 出现禁止内容时失败", () => {
  const outcome = evaluateAssertion("作为一个 AI，我建议", { kind: "mustNotMatch", pattern: "作为一个 ?AI" });
  assert.equal(outcome.passed, false);
});

test("mustNotMatch 避开禁止内容时通过", () => {
  const outcome = evaluateAssertion("结论：建议先做灰度", { kind: "mustNotMatch", pattern: "作为一个 ?AI" });
  assert.equal(outcome.passed, true);
});

test("mustContain 区分大小写敏感匹配", () => {
  assert.equal(evaluateAssertion("包含 JSON", { kind: "mustContain", value: "JSON" }).passed, true);
  assert.equal(evaluateAssertion("包含 json", { kind: "mustContain", value: "JSON" }).passed, false);
});

test("mustNotContain 命中时失败", () => {
  assert.equal(evaluateAssertion("这里有免责声明", { kind: "mustNotContain", value: "免责声明" }).passed, false);
});

test("无效正则不抛异常而是判定失败", () => {
  const outcome = evaluateAssertion("任意输出", { kind: "mustMatch", pattern: "([未闭合" });
  assert.equal(outcome.passed, false);
  assert.match(outcome.detail, /无效正则/);
});

test("jsonSchema 校验通过", () => {
  const outcome = evaluateAssertion('{"answer": "yes", "confidence": 0.9}', {
    kind: "jsonSchema",
    schema: {
      type: "object",
      required: ["answer", "confidence"],
      properties: {
        answer: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  });
  assert.equal(outcome.passed, true);
});

test("jsonSchema 缺必填字段时失败", () => {
  const outcome = evaluateAssertion('{"answer": "yes"}', {
    kind: "jsonSchema",
    schema: { type: "object", required: ["answer", "confidence"] },
  });
  assert.equal(outcome.passed, false);
});

test("jsonSchema 数值越界时失败", () => {
  const outcome = evaluateAssertion('{"confidence": 1.5}', {
    kind: "jsonSchema",
    schema: { type: "object", properties: { confidence: { type: "number", maximum: 1 } } },
  });
  assert.equal(outcome.passed, false);
});

test("numeric 断言在容差内通过", () => {
  const outcome = evaluateAssertion("置信度 0.85", {
    kind: "numeric",
    pattern: "置信度\\s*([0-9.]+)",
    expected: 0.85,
    tolerance: 0.05,
  });
  assert.equal(outcome.passed, true);
});

test("numeric 断言超出容差失败", () => {
  const outcome = evaluateAssertion("置信度 0.4", {
    kind: "numeric",
    pattern: "置信度\\s*([0-9.]+)",
    expected: 0.85,
    tolerance: 0.05,
  });
  assert.equal(outcome.passed, false);
});

test("numeric 未提取到数值时失败", () => {
  const outcome = evaluateAssertion("没有数字", {
    kind: "numeric",
    pattern: "([0-9.]+)",
    expected: 1,
  });
  assert.equal(outcome.passed, false);
});

test("parseJsonObject 能从代码块中提取 JSON", () => {
  const parsed = parseJsonObject('```json\n{"a": 1}\n```');
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.value, { a: 1 });
});

test("parseJsonObject 能从前缀说明中提取 JSON", () => {
  const parsed = parseJsonObject('结果如下：\n{"a": 1}\n希望有帮助');
  assert.equal(parsed.ok, true);
});

test("parseJsonObject 对非法 JSON 返回失败而非抛异常", () => {
  const parsed = parseJsonObject("完全不是 JSON");
  assert.equal(parsed.ok, false);
});

test("validateJsonSchema 支持数组 items 校验", () => {
  const errors = validateJsonSchema([{ a: 1 }, { b: 2 }], {
    type: "array",
    items: { type: "object", required: ["a"] },
  }, "$");
  assert.equal(errors.length, 1);
  assert.match(errors[0]!, /a 缺失必填字段/);
});

test("evaluateAssertions 汇总通过与失败数", () => {
  const report = evaluateAssertions("订单金额 120 元", [
    { kind: "mustMatch", pattern: "订单金额" },
    { kind: "mustNotMatch", pattern: "未知字段" },
    { kind: "mustContain", value: "120" },
  ]);
  assert.equal(report.total, 3);
  assert.equal(report.passed, 3);
  assert.equal(report.failed, 0);
  assert.equal(report.allPassed, true);
});

test("evaluateAssertions 空断言集不判定为全部通过", () => {
  const report = evaluateAssertions("任意", []);
  assert.equal(report.total, 0);
  assert.equal(report.allPassed, false);
});

/**
 * 等价写法（equivalentPatterns）的判定。
 *
 * 这是区分「断言过严（假失败）」与「skill 真缺陷」的数据来源：
 * 失败时若命中等价写法，说明内容做到了、只是措辞没覆盖。
 */
test("mustMatch 失败但命中等价写法 → 标记为 equivalentMatched=true", () => {
  const outcome = evaluateAssertion("建议由谁做负责跟进", {
    kind: "mustMatch",
    pattern: "责任人",
    equivalentPatterns: ["谁做", "谁负责"],
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.equivalentMatched, true);
  assert.equal(outcome.detail.includes("等价写法"), true);
});

test("mustMatch 失败且等价写法也没命中 → equivalentMatched=false", () => {
  const outcome = evaluateAssertion("今天天气不错", {
    kind: "mustMatch",
    pattern: "责任人",
    equivalentPatterns: ["谁做", "谁负责"],
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.equivalentMatched, false);
  assert.equal(outcome.detail.includes("内容确实缺失"), true);
});

test("mustMatch 通过 → equivalentMatched 为 undefined", () => {
  const outcome = evaluateAssertion("责任人：张三", {
    kind: "mustMatch",
    pattern: "责任人",
    equivalentPatterns: ["谁做"],
  });
  assert.equal(outcome.passed, true);
  assert.equal(outcome.equivalentMatched, undefined);
});

test("未声明等价写法时 equivalentMatched 为 undefined（无法据此区分真假失败）", () => {
  const outcome = evaluateAssertion("无关内容", { kind: "mustMatch", pattern: "责任人" });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.equivalentMatched, undefined);
});

test("等价写法里含无效正则时不影响主判定", () => {
  const outcome = evaluateAssertion("无关内容", {
    kind: "mustMatch",
    pattern: "责任人",
    equivalentPatterns: ["([未闭合"],
  });
  assert.equal(outcome.passed, false);
  assert.equal(outcome.equivalentMatched, false);
});

test("mustNotMatch 命中时也记录等价写法状态", () => {
  // 主 pattern 与等价写法都命中 → 断言失败，且说明「覆盖范围可能过宽」
  const hit = evaluateAssertion("数据含退货且含税", {
    kind: "mustNotMatch",
    pattern: "含退货",
    equivalentPatterns: ["含税"],
  });
  assert.equal(hit.passed, false);
  assert.equal(hit.equivalentMatched, true);

  // 只命中等价写法、主 pattern 没命中 → 断言通过
  const onlyEquivalent = evaluateAssertion("数据含税", {
    kind: "mustNotMatch",
    pattern: "含退货",
    equivalentPatterns: ["含税"],
  });
  assert.equal(onlyEquivalent.passed, true);
  assert.equal(onlyEquivalent.equivalentMatched, undefined);

  // 主 pattern 命中、等价写法没命中 → 断言失败且等价写法未命中
  const noEquivalent = evaluateAssertion("数据含退货", {
    kind: "mustNotMatch",
    pattern: "含退货",
    equivalentPatterns: ["含税"],
  });
  assert.equal(noEquivalent.passed, false);
  assert.equal(noEquivalent.equivalentMatched, false);
});
