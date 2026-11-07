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
  /**
   * 每条断言的「等价写法是否命中」。
   *
   * `true` = 失败但命中了等价写法 → 假失败（断言过严）
   * `false` = 失败且等价写法也没命中 → 真缺陷
   * 不给 = 断言没声明等价写法 → 无法据此区分
   */
  equivalentMatched?: (boolean | undefined)[];
  /** 断言类型，默认 mustMatch。 */
  kinds?: string[];
  /** 显式覆盖激活状态（默认 baseline=false, skill=true）。 */
  activated?: boolean;
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
    activation: {
      activated: spec.activated ?? spec.variantId !== "baseline",
      status: (spec.activated ?? spec.variantId !== "baseline") ? "activated" : "not_activated",
    },
    assertions: {
      total: spec.passes.length,
      passed: spec.passes.filter(Boolean).length,
      failed: spec.passes.filter((p) => !p).length,
      allPassed: spec.passes.every(Boolean),
      outcomes: spec.passes.map((passed, i) => ({
        kind: (spec.kinds?.[i] ?? "mustMatch") as "mustMatch",
        passed,
        detail: passed ? "匹配成功" : "未匹配到模式",
        note: spec.notes?.[i] ?? `断言 ${i}`,
        equivalentMatched: spec.equivalentMatched?.[i],
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

test("mustNotMatch 失败且命中等价写法 → 不判「断言过严」（违反禁令是真缺陷）", () => {
  // 审核发现的原缺陷：mustNotMatch 失败时 equivalentMatched=true 的含义是
  // 「输出出现了被禁的等价写法」——那是违反禁令，该改 skill。
  // 旧判据不区分 kind，会把它误判成「断言过严（要改套件）」，归因方向完全反掉。
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [true] },
    {
      variantId: "skill",
      taskId: "t1",
      attempt: 1,
      passes: [false],
      kinds: ["mustNotMatch"],
      equivalentMatched: [true],
      notes: ["红线：禁止编造来源"],
    },
  ]);

  const advice = buildImprovementAdvice(rows, 1);
  const d = firstDiagnosis(advice);

  assert.notEqual(d.mode, "assertion-too-strict", "违反禁令绝不能归成套件问题");
  assert.equal(d.mode, "contract-missing", "baseline 稳过、skill 违反禁令 → 真问题（契约未落地）");
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

// ---------------------------------------------------------------------------
// 措辞必须与结论等级一致
//
// 背景（实测 2026-11-04 deep-research 测评）：报告首屏写「判定：有效」，
// 紧接着第 8 节写「skill 未通过：28 条断言失败」——同一份报告自相矛盾。
// 结论为 effective 时，断言失败只是「可加固项」，措辞不能写成「未通过」。
// ---------------------------------------------------------------------------

test("结论为 effective 时，摘要不说「skill 未通过」", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  assert.equal(advice.diagnoses.length > 0, true);
  assert.equal(advice.summary.includes("未通过"), false);
  assert.equal(advice.summary.includes("已通过"), true);
});

test("结论为 ineffective 时，摘要明确说「未通过」", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "ineffective");
  assert.equal(advice.summary.includes("未通过"), true);
});

test("不传 verdict 时按未通过措辞（向后兼容）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0);
  assert.equal(advice.summary.includes("未通过"), true);
});

test("激活率不足时不出现「未通过」字样（有效结论下）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false] },
  ]);
  const advice = buildImprovementAdvice(rows, 0.2, "effective");
  assert.equal(advice.activationIssue !== null, true);
  assert.equal(advice.summary.includes("首要问题是激活率不足"), true);
  assert.equal(advice.summary.includes("未通过"), false);
});

/**
 * 「断言过严」（假失败）与「skill 真缺陷」的区分。
 *
 * 背景（2026-11-05 实测）：这两者**在布尔数据里完全无法区分**——
 * 两条假失败与一条真缺陷的签名都是 `baseline ✗✗ / skill ✓✗`。
 * 区别只在输出文本里：假失败命中了断言声明的等价写法，真缺陷连等价写法都没有。
 *
 * 所以判据是「skill 侧至少有一次失败命中了等价写法」。
 */
test("失败但命中等价写法 → 判为断言过严（不是 skill 的问题）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false], equivalentMatched: [undefined, true] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  const d = firstDiagnosis(advice);
  assert.equal(d.mode, "assertion-too-strict");
  assert.equal(advice.skillIssueCount, 0);
  assert.equal(advice.falseFailureCount, 1);
});

test("失败且等价写法也没命中 → 判为真缺陷（不判断言过严）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false], equivalentMatched: [undefined, false] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  const d = firstDiagnosis(advice);
  assert.notEqual(d.mode, "assertion-too-strict");
  assert.equal(advice.skillIssueCount, 1);
});

test("真假失败的布尔签名相同时，等价模式是唯一区分依据", () => {
  // 两条断言逐次签名完全一致（baseline ✗✗ / skill ✓✗），只有等价模式不同
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false], equivalentMatched: [undefined, true] },
    { variantId: "baseline", taskId: "t2", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t2", attempt: 1, passes: [true, false], equivalentMatched: [undefined, false] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  const byTask = new Map(advice.diagnoses.map((d) => [d.taskId, d.mode]));
  assert.equal(byTask.get("t1"), "assertion-too-strict");
  assert.notEqual(byTask.get("t2"), "assertion-too-strict");
  assert.equal(advice.skillIssueCount, 1);
  assert.equal(advice.falseFailureCount, 1);
});

test("未声明等价写法的断言失败 → 不判断言过严（无信息不等于无问题）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  assert.notEqual(firstDiagnosis(advice).mode, "assertion-too-strict");
});

test("断言过严排在优先级最后（先改 skill 的真问题）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false], equivalentMatched: [undefined, false] },
    { variantId: "baseline", taskId: "t2", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t2", attempt: 1, passes: [true, false], equivalentMatched: [undefined, true] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  const modes = advice.byMode.map((m) => m.mode);
  assert.equal(modes[modes.length - 1], "assertion-too-strict");
  // t1 两侧都全失败 → no-effect；t2 skill 侧命中等价写法 → assertion-too-strict
  assert.equal(modes[0], "no-effect");
});

test("全部失败都是断言过严时，摘要指向套件而不是 skill", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false], equivalentMatched: [true] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  assert.equal(advice.skillIssueCount, 0);
  assert.equal(advice.falseFailureCount, 1);
  assert.equal(advice.summary.includes("不是 skill 的问题"), true);
  assert.equal(advice.summary.includes("要改的是套件"), true);
});

test("混合场景下摘要区分 skill 问题与套件问题", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [true, false], equivalentMatched: [undefined, false] },
    { variantId: "baseline", taskId: "t2", attempt: 1, passes: [false, false] },
    { variantId: "skill", taskId: "t2", attempt: 1, passes: [true, false], equivalentMatched: [undefined, true] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  assert.equal(advice.skillIssueCount, 1);
  assert.equal(advice.falseFailureCount, 1);
  assert.equal(advice.summary.includes("另有 1 条"), true);
  assert.equal(advice.summary.includes("要改的是套件"), true);
});

test("断言过严的建议文案明确指向套件", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false], equivalentMatched: [true] },
  ]);
  const advice = buildImprovementAdvice(rows, 1.0, "effective");
  assert.equal(firstDiagnosis(advice).advice.includes("套件"), true);
});

test("0% 激活用例上的断言失败归因为 activation-missing（而非怪罪正文契约无效）", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "strip-disclaimer", attempt: 1, passes: [false, false] },
    {
      variantId: "skill",
      taskId: "strip-disclaimer",
      attempt: 1,
      passes: [false, false],
      activated: false,
      notes: ["禁止末尾免责声明", "必须给出处"],
    },
  ]);

  const advice = buildImprovementAdvice(rows, 0.85, "inconclusive");
  assert.equal(advice.diagnoses.length, 2);
  assert.ok(advice.diagnoses.every((d) => d.mode === "activation-missing"));
  assert.match(advice.diagnoses[0]!.advice, /description/);
});

test("shouldActivate=false 的负向用例误触发时产生 over-trigger 归因", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "neg-1", attempt: 1, passes: [true] },
    { variantId: "skill", taskId: "neg-1", attempt: 1, passes: [false], activated: true },
  ]);

  const advice = buildImprovementAdvice(rows, 1.0, {
    verdict: "inconclusive",
    tasks: [{ id: "neg-1", shouldActivate: false }],
  });
  assert.equal(advice.diagnoses.length, 1);
  assert.equal(advice.diagnoses[0]!.mode, "over-trigger");
});

test("不应触发的查数题断言失败不建议扩大 skill 的触发范围", () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "pure-data-query-misfire", attempt: 1, passes: [false], kinds: ["numeric"] },
    { variantId: "skill", taskId: "pure-data-query-misfire", attempt: 1, passes: [false], kinds: ["numeric"], activated: false },
  ]);
  const advice = buildImprovementAdvice(rows, 0, {
    verdict: "inconclusive",
    tasks: [{ id: "pure-data-query-misfire", shouldActivate: false }],
  });
  assert.deepEqual(advice.diagnoses, []);
  assert.equal(advice.activationIssue, null);
  assert.equal(advice.skillIssueCount, 0);
  assert.match(advice.summary, /不应触发用例的断言失败/);
  assert.doesNotMatch(advice.summary, /漏触发|description/);
});

test("跨用例相同契约合并为 groupedDiagnoses，计算 expectedGainPp 并识别未读附属文件", async () => {
  const rows = makeRows([
    { variantId: "baseline", taskId: "t1", attempt: 1, passes: [false, true], notes: ["红线：禁止免责声明", "标题规范"] },
    { variantId: "skill", taskId: "t1", attempt: 1, passes: [false, true], notes: ["红线：禁止免责声明", "标题规范"] },
    { variantId: "baseline", taskId: "t2", attempt: 1, passes: [false, true], notes: ["红线：禁止免责声明", "标题规范"] },
    { variantId: "skill", taskId: "t2", attempt: 1, passes: [false, true], notes: ["红线：禁止免责声明", "标题规范"] },
  ]);

  const advice = buildImprovementAdvice(rows, 1.0, {
    verdict: "inconclusive",
    skillContext: {
      skillContent: "# Deep Research\n\n遵循研究流程输出。",
      subFiles: {
        "references/report-structure.md": "报告末尾严禁添加免责声明。",
      },
      readSubPaths: [],
    },
  });

  // 2 条逐用例诊断合并为 1 条核心根因，失败条目 2 / 总条目 4 = +50.0pp 预计增益
  assert.equal(advice.diagnoses.length, 2);
  assert.equal(advice.groupedDiagnoses.length, 1);
  assert.deepEqual(advice.groupedDiagnoses[0]!.tasks, ["t1", "t2"]);
  assert.equal(advice.groupedDiagnoses[0]!.expectedGainPp, 50);
  assert.match(advice.groupedDiagnoses[0]!.skillLocationHint ?? "", /report-structure\.md/);
  assert.match(advice.groupedDiagnoses[0]!.skillLocationHint ?? "", /未读取/);


});


// --- 关键词抽取：skill 改版后措辞变化，定位不应再落空 ---------------------
//
// 回归背景（2026-11-05）：断言 note 写的是旧版措辞（「第六段四要素含时限」
// 「须识别期间不完整」），新版 SKILL.md 改成（「何时完成」「期间不完整」）。
// 关键词抽取只产出长语，长语匹配必然落空 → 报告误报「SKILL.md 正文未检索到
// 对应约束关键词，属于规则缺失」，把「措辞变了」说成「规则没写」。
test("关键词抽取能命中改版后的等义措辞", async () => {
  const mod = await import("./improve.ts");
  const locate = (mod as unknown as {
    locateInSkillDocs?: (note: string, mode: string, ctx: unknown, pattern?: string) => string | undefined;
  }).locateInSkillDocs;
  assert.equal(typeof locate, "function", "locateInSkillDocs 应导出以便测试");

  const skillContent = [
    "六、行动建议与跟踪指标：做什么＋谁做＋何时完成＋什么指标验证",
    "2. 期间不完整：进行中的本期 vs 完整基期",
  ].join("\n");

  // 断言 pattern 里的字面量（时限|责任人|跟踪指标…）参与匹配——
  // note 写旧版措辞时靠它兜底。
  const cases: Array<[string, string | undefined, RegExp]> = [
    [
      "第六段四要素含时限（SKILL.md 第二节第六段写法）",
      "时限|个工作日|天内|完成时间",
      /已提及相关概念/,
    ],
    [
      "第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）",
      "跟踪指标|监控指标|验证指标",
      /已提及相关概念/,
    ],
    [
      "红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）",
      "期间不完整|未完成期间|未完成|进行中",
      /已提及相关概念/,
    ],
  ];

  for (const [note, pattern, expected] of cases) {
    const hint = locate!(note, "unstable", { skillContent }, pattern);
    assert.match(hint ?? "", expected, `note「${note}」应定位为「已提及相关概念」`);
  }
});

test("关键词抽取对确实缺失的约束仍报规则缺失", async () => {
  const mod = await import("./improve.ts");
  const locate = (mod as unknown as {
    locateInSkillDocs?: (note: string, mode: string, ctx: unknown, pattern?: string) => string | undefined;
  }).locateInSkillDocs;
  assert.equal(typeof locate, "function");

  const skillContent = "# 运营数据分析\n\n只讲数据口径。";
  const hint = locate!(
    "红线 9：必须声明火星轨道倾角与近日点距离（SKILL.md 第九节）",
    "unstable",
    { skillContent },
  );
  assert.match(hint ?? "", /未检索到对应约束关键词|规则缺失/);
});
