import { test } from "node:test";
import assert from "node:assert/strict";

import { buildImprovementAdvice } from "./improve.ts";
import type { RunResult } from "./runner.ts";

/**
 * 优化建议的归因逻辑。
 *
 * 核心判断：baseline 本来就能过的断言不算 skill 的问题——
 * 阴性对照实验测得断言整体灵敏度只有 51.9%，这类断言占一半，
 * 写进建议会误导用户去改不该改的地方。
 */

interface RowSpec {
  variantId: string;
  taskId: string;
  attempt: number;
  /** 每条断言的通过情况。 */
  passes: boolean[];
  notes?: string[];
}

function makeRows(specs: RowSpec[]): RunResult[] {
  return specs.map((spec, idx) => ({
    id: `${spec.variantId}-${spec.taskId}-${spec.attempt}`,
    variantId: spec.variantId,
    variantLabel: spec.variantId,
    taskId: spec.taskId,
    attempt: spec.attempt,
    status: "success",
    startedAt: 0,
    endedAt: 1,
    durationSec: 1,
    skillPaths: [],
    totalTokens: 0,
    totalCost: 0,
    toolCalls: 0,
    output: "",
    activation: { activated: spec.variantId !== "baseline", status: "activated" },
    assertions: {
      total: spec.passes.length,
      passed: spec.passes.filter(Boolean).length,
      failed: spec.passes.filter((p) => !p).length,
      allPassed: spec.passes.every(Boolean),
      outcomes: spec.passes.map((passed, i) => ({
        kind: "mustMatch",
        passed,
        detail: passed ? "匹配成功" : "未匹配到模式",
        note: spec.notes?.[i] ?? `断言 ${i}`,
      })),
    },
    evidenceDir: "",
    error: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  })) as unknown as RunResult[];
}

/** 取第一条诊断——测试里总会有，缺失时给出明确失败信息。 */
function firstDiagnosis(advice: ReturnType<typeof buildImprovementAdvice>) {
  const d = advice.diagnoses[0];
  assert.ok(d, "应当至少有一条诊断");
  return d;
}

test("全部断言通过时不给优化建议", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true, true] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, true] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.diagnoses.length, 0);
  assert.equal(advice.activationIssue, null);
  assert.match(advice.summary, /规则断言全部通过/);
});

test("baseline 能过、skill 侧过不了 → 判定为契约未落地", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.diagnoses.length, 1);
  assert.equal(firstDiagnosis(advice).mode, "contract-missing");
  assert.match(firstDiagnosis(advice).advice, /可执行的硬性步骤/);
});

test("baseline 也过不了 → 判定为契约无效", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.diagnoses.length, 1);
  assert.equal(firstDiagnosis(advice).mode, "no-effect");
  assert.match(firstDiagnosis(advice).advice, /写清/);
});

test("baseline 时过时不过 → 判定为约束不稳", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true] },
    { variantId: "baseline", taskId: "t1", attempt: 2, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 2, passes: [false] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.diagnoses.length, 1);
  assert.equal(firstDiagnosis(advice).mode, "unstable");
});

test("skill 侧多次重复里时过时不过 → 判定为约束不稳", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "baseline", taskId: "t1", attempt: 2, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true] },
    { variantId: "skill", taskId: "t1", attempt: 2, passes: [false] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.diagnoses.length, 1);
  assert.equal(firstDiagnosis(advice).mode, "unstable");
});

test("激活率过低时给出独立的激活问题提示", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true] },
  ]);

  const advice = buildImprovementAdvice(rows, 0.3);

  assert.ok(advice.activationIssue, "激活率过低必须单独提示");
  assert.match(advice.activationIssue, /description/);
  assert.match(advice.summary, /激活率不足/);
});

test("激活率达标时不产生激活问题提示", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.activationIssue, null);
});

test("baseline 本来就能过的断言不列入建议", () => {
  // 第 2 条 baseline 就能过，skill 侧也过——它不该出现在建议里。
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true, true] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false, true] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.diagnoses.length, 1);
  assert.equal(firstDiagnosis(advice).note, "断言 0");
});

test("按模式归类并按优先级排序", () => {
  const rows = makeRows([
    // 断言 0：baseline 过、skill 不过是「契约未落地」
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false, false] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);

  assert.equal(advice.byMode.length, 2);
  assert.equal(advice.byMode[0]?.mode, "contract-missing", "真问题应排最前");
  assert.equal(advice.byMode[1]?.mode, "no-effect");
  assert.equal(advice.byMode[0]?.count, 1);
});

test("诊断结果带用例名、断言说明与失败原因", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "attribution", attempt: 1, passes: [true], notes: ["红线 2：须声明样本量"] },
    { variantId: "skill", taskId: "attribution", attempt: 1, passes: [false], notes: ["红线 2：须声明样本量"] },
  ]);

  const advice = buildImprovementAdvice(rows, 1);
  const d = firstDiagnosis(advice);

  assert.equal(d.taskId, "attribution");
  assert.equal(d.note, "红线 2：须声明样本量");
  assert.equal(d.detail, "未匹配到模式");
});

test("无断言数据时不产生诊断", () => {
  const advice = buildImprovementAdvice([], 1);
  assert.equal(advice.diagnoses.length, 0);
});
