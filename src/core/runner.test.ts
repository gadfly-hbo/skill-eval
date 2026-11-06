import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeTasks,
  summarizeVariants,
  findDisagreements,
  parseResultId,
  type RunnerOptions,
  type EvalTask,
  type Variant,
  type RunResult,
  type PairwiseResult,
} from "./runner.ts";

const variants: Variant[] = [
  { id: "baseline", label: "Baseline", skillPaths: [] },
  { id: "skill", label: "Skill", skillPaths: ["/tmp/skill/SKILL.md"] },
];

const tasks: EvalTask[] = [{ id: "t1", prompt: "p", assertions: [{ kind: "mustMatch", pattern: "x" }] }];

/** 构造一个运行结果。 */
function makeResult(
  variantId: string,
  attempt: number,
  options: { activated?: boolean; assertionPassed?: boolean; status?: "success" | "failed" } = {},
): RunResult {
  const { activated = false, assertionPassed = false, status = "success" } = options;
  return {
    id: `${variantId}-t1-${attempt}`,
    variantId,
    variantLabel: variantId,
    taskId: "t1",
    attempt,
    status,
    startedAt: 0,
    endedAt: 1,
    durationSec: 1,
    skillPaths: variantId === "skill" ? ["/tmp/skill/SKILL.md"] : [],
    totalTokens: 100,
    totalCost: 0.01,
    toolCalls: 1,
    output: "output",
    activation: {
      status: activated ? "activated" : "not_activated",
      activated,
      matchedKeywords: [],
      readSkillPaths: activated ? ["/tmp/skill/SKILL.md"] : [],
      evidence: [],
    },
    assertions: { total: 1, passed: assertionPassed ? 1 : 0, failed: assertionPassed ? 0 : 1, allPassed: assertionPassed, outcomes: [] },
    evidenceDir: "",
    error: null,
  };
}

function makePairwise(verdict: "win" | "tie" | "loss" | "not_judged"): PairwiseResult {
  return {
    baselineResultId: "baseline-t1-1",
    variantResultId: "skill-t1-1",
    variantId: "skill",
    taskId: "t1",
    attempt: 1,
    verdict,
    scoreDelta: null,
    baselineScore: null,
    variantScore: null,
    confidence: null,
    reason: "",
    error: null,
    judgeRuns: [],
    biasProbe: null,
  };
}

test("任务级激活率不把 baseline 计入分母", () => {
  const results = [
    makeResult("baseline", 1),
    makeResult("baseline", 2),
    makeResult("skill", 1, { activated: true }),
    makeResult("skill", 2, { activated: true }),
  ];
  const summaries = summarizeTasks({ variants, tasks } as never, results, []);

  assert.equal(summaries.length, 1);
  // skill 侧 2/2 激活，baseline 侧按设计不加载 skill，不应拉低分母。
  assert.equal(summaries[0]!.activationRate, 1);
});

test("skill 侧未激活时任务激活率为 0", () => {
  const results = [makeResult("baseline", 1), makeResult("skill", 1, { activated: false })];
  const summaries = summarizeTasks({ variants, tasks } as never, results, []);
  assert.equal(summaries[0]!.activationRate, 0);
});

test("规则与评委一致时不记为分歧", () => {
  // skill 通过断言、baseline 未通过 → 规则判定「改善」；评委也说 win → 一致。
  const results = [
    makeResult("baseline", 1, { assertionPassed: false }),
    makeResult("skill", 1, { assertionPassed: true }),
  ];
  const disagreements = findDisagreements({ variants, tasks } as never, results, [makePairwise("win")]);
  assert.equal(disagreements.length, 0);
});

test("规则判定改善但评委说倒退时记为分歧", () => {
  const results = [
    makeResult("baseline", 1, { assertionPassed: false }),
    makeResult("skill", 1, { assertionPassed: true }),
  ];
  const disagreements = findDisagreements({ variants, tasks } as never, results, [makePairwise("loss")]);
  assert.equal(disagreements.length, 1);
  assert.match(disagreements[0]!.note, /以规则断言为准/);
});

test("规则判定倒退但评委说改善时记为分歧", () => {
  const results = [
    makeResult("baseline", 1, { assertionPassed: true }),
    makeResult("skill", 1, { assertionPassed: false }),
  ];
  const disagreements = findDisagreements({ variants, tasks } as never, results, [makePairwise("win")]);
  assert.equal(disagreements.length, 1);
});

test("双方表现相同时评委说 tie 不记为分歧", () => {
  const results = [
    makeResult("baseline", 1, { assertionPassed: true }),
    makeResult("skill", 1, { assertionPassed: true }),
  ];
  const disagreements = findDisagreements({ variants, tasks } as never, results, [makePairwise("tie")]);
  assert.equal(disagreements.length, 0);
});

test("双方表现相同时评委说 win 记为分歧", () => {
  const results = [
    makeResult("baseline", 1, { assertionPassed: true }),
    makeResult("skill", 1, { assertionPassed: true }),
  ];
  const disagreements = findDisagreements({ variants, tasks } as never, results, [makePairwise("win")]);
  assert.equal(disagreements.length, 1);
});

test("variant 级胜率只统计可判定用例", () => {
  const scoredTasks: EvalTask[] = [
    { id: "t1", prompt: "p", kind: "scored" },
    { id: "t2", prompt: "p", kind: "diagnostic" },
  ];
  const results = [
    { ...makeResult("baseline", 1), taskId: "t1" },
    { ...makeResult("skill", 1), taskId: "t1" },
    { ...makeResult("baseline", 1), taskId: "t2", id: "baseline-t2-1" },
    { ...makeResult("skill", 1), taskId: "t2", id: "skill-t2-1" },
  ];
  const pairwise = [
    { ...makePairwise("win"), taskId: "t1" },
    { ...makePairwise("win"), taskId: "t2", variantResultId: "skill-t2-1" },
  ];
  const summaries = summarizeVariants({ variants, tasks: scoredTasks } as never, results, pairwise);
  const skill = summaries.find((s) => s.variantId === "skill");

  // 诊断用例的 win 不计入胜率分子。
  assert.equal(skill!.win, 2);
  assert.equal(skill!.winRate, 1);
});

test("失败的运行计入分母不改变胜率口径", () => {
  const results = [
    makeResult("baseline", 1),
    makeResult("skill", 1, { status: "failed" }),
  ];
  const summaries = summarizeVariants({ variants, tasks } as never, results, []);
  const skill = summaries.find((s) => s.variantId === "skill");
  assert.equal(skill!.total, 1);
  assert.equal(skill!.failed, 1);
  assert.equal(skill!.success, 0);
});

test("parseResultId 正确处理含连字符的 taskId", () => {
  const parsed = parseResultId("skill-simple-answer-1", ["baseline", "skill"]);
  assert.deepEqual(parsed, { variantId: "skill", taskId: "simple-answer", attempt: 1 });
});

test("parseResultId 正确处理多段连字符的 taskId", () => {
  const parsed = parseResultId("skill-adversarial-instruction-2", ["baseline", "skill"]);
  assert.deepEqual(parsed, { variantId: "skill", taskId: "adversarial-instruction", attempt: 2 });
});

test("parseResultId 对不匹配的 ID 返回 null", () => {
  assert.equal(parseResultId("unknown-thing", ["baseline", "skill"]), null);
});

test("parseResultId 优先匹配更长的 variantId 前缀", () => {
  const parsed = parseResultId("skill-expert-t1-3", ["baseline", "skill", "skill-expert"]);
  assert.deepEqual(parsed, { variantId: "skill-expert", taskId: "t1", attempt: 3 });
});

/**
 * 重算时用**当前套件**重新评估断言。
 *
 * 背景：重算的目的就是「拿新套件重新看这批产物」。
 * 沿用跑批时的旧断言结果，会让「改套件后重算」看起来没反应——
 * 断言修订（放宽过严断言、补等价写法）只有这样才能生效。
 */
test("重算时用当前套件重新评估断言（改套件后重算能生效）", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { recomputeSummary } = await import("./runner.ts");

  const root = mkdtempSync(join(tmpdir(), "skill-eval-recompute-"));
  const caseDir = join(root, "cases", "skill", "t1", "1");
  mkdirSync(caseDir, { recursive: true });
  // 输出里只有「谁做」，没有「责任人」——旧断言（只认责任人）会判失败
  writeFileSync(join(caseDir, "output.md"), "建议由谁做跟进", "utf8");
  writeFileSync(
    join(caseDir, "result.json"),
    JSON.stringify({
      id: "skill-t1-1",
      variantId: "skill",
      taskId: "t1",
      attempt: 1,
      status: "success",
      durationSec: 1,
      totalTokens: 10,
      totalCost: 0.001,
      toolCalls: 1,
      activation: { activated: true, status: "activated" },
      // 跑批时的旧断言结果：通过
      assertions: {
        total: 1, passed: 1, failed: 0, allPassed: true,
        outcomes: [{ kind: "mustMatch", passed: true, detail: "匹配成功" }],
      },
    }),
    "utf8",
  );

  // 当前套件：主 pattern 只认「责任人」，并声明等价写法「谁做」
  const currentTasks: EvalTask[] = [
    {
      id: "t1",
      prompt: "p",
      assertions: [
        { kind: "mustMatch", pattern: "责任人", equivalentPatterns: ["谁做"] },
      ],
    },
  ];

  const summary = await recomputeSummary(root, { variants: [variants[1]!], tasks: currentTasks });
  const result = summary.results[0]!;
  // 重新评估后：主 pattern 不命中，但等价写法命中 → 失败且 equivalentMatched=true
  assert.equal(result.assertions?.outcomes[0]?.passed, false);
  assert.equal(result.assertions?.outcomes[0]?.equivalentMatched, true);
});

test("重算时运行失败的用例沿用旧断言结果（不重算，避免把「没输出」误读成「不合规」）", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { recomputeSummary } = await import("./runner.ts");

  const root = mkdtempSync(join(tmpdir(), "skill-eval-recompute-fail-"));
  const caseDir = join(root, "cases", "skill", "t1", "1");
  mkdirSync(caseDir, { recursive: true });
  writeFileSync(join(caseDir, "output.md"), "", "utf8");
  writeFileSync(
    join(caseDir, "result.json"),
    JSON.stringify({
      id: "skill-t1-1",
      variantId: "skill",
      taskId: "t1",
      attempt: 1,
      status: "failed",
      durationSec: 480,
      totalTokens: 0,
      totalCost: 0,
      toolCalls: 0,
      activation: { activated: false, status: "not_activated" },
      assertions: null,
      stderr: "timeout",
      timedOut: true,
    }),
    "utf8",
  );

  const currentTasks: EvalTask[] = [
    { id: "t1", prompt: "p", assertions: [{ kind: "mustMatch", pattern: "责任人" }] },
  ];

  const summary = await recomputeSummary(root, { variants: [variants[1]!], tasks: currentTasks });
  const result = summary.results[0]!;
  assert.equal(result.status, "failed");
  // 失败用例不该有重新评估出来的断言结论
  assert.equal(result.assertions, null);
});

test("重算时旧产物里失败用例残留的假通过断言也会被清零，且保留未评判的计分对分母", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { recomputeSummary } = await import("./runner.ts");

  const root = mkdtempSync(join(tmpdir(), "skill-eval-recompute-pair-"));
  const baseDir = join(root, "cases", "baseline", "t1", "1");
  const skillDir = join(root, "cases", "skill", "t1", "1");
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(skillDir, { recursive: true });

  writeFileSync(join(baseDir, "output.md"), "正常回答", "utf8");
  writeFileSync(
    join(baseDir, "result.json"),
    JSON.stringify({
      id: "baseline-t1-1",
      variantId: "baseline",
      taskId: "t1",
      attempt: 1,
      status: "success",
      durationSec: 10,
      totalTokens: 100,
      totalCost: 0.01,
      toolCalls: 0,
      activation: { activated: false, status: "not_activated" },
      assertions: { total: 1, passed: 0, failed: 1, allPassed: false, outcomes: [{ kind: "mustMatch", passed: false, detail: "miss" }] },
    }),
    "utf8",
  );

  // skill 侧超时失败，且旧 result.json 残留了 mustNotMatch 空转通过的脏数据
  writeFileSync(join(skillDir, "output.md"), "", "utf8");
  writeFileSync(
    join(skillDir, "result.json"),
    JSON.stringify({
      id: "skill-t1-1",
      variantId: "skill",
      taskId: "t1",
      attempt: 1,
      status: "failed",
      durationSec: 480,
      totalTokens: 500,
      totalCost: 0.05,
      toolCalls: 2,
      activation: { activated: true, status: "activated" },
      assertions: { total: 1, passed: 1, failed: 0, allPassed: true, outcomes: [{ kind: "mustNotMatch", passed: true, detail: "空转通过" }] },
      timedOut: true,
    }),
    "utf8",
  );

  const summary = await recomputeSummary(root, { variants, tasks });
  const skillRow = summary.results.find((r) => r.variantId === "skill")!;
  assert.equal(skillRow.assertions, null, "失败用例残留的脏断言必须清空");
  assert.equal(skillRow.timedOut, true);

  // 即使 pairwise/ 目录为空，未评判的 pair 也必须还原到 summary.pairwise 中计入分母！
  assert.equal(summary.pairwise.length, 1);
  assert.equal(summary.pairwise[0]!.verdict, "not_judged");

  const skillSummary = summary.variantSummaries.find((v) => v.variantId === "skill")!;
  assert.equal(skillSummary.notJudged, 1);
  assert.equal(skillSummary.totalScoredPairs, 1);
  assert.equal(skillSummary.pairCoverage, 0);
  assert.equal(skillSummary.winRateLowerBound, 0);
  assert.equal(skillSummary.timeoutRate, 1);
});

test("多条断言时按实际通过条数判断客观改善，不因双方都未全过就误报为「表现相当」", () => {
  const multiTask: EvalTask[] = [
    {
      id: "t1",
      prompt: "p",
      assertions: [
        { kind: "mustMatch", pattern: "a" },
        { kind: "mustMatch", pattern: "b" },
        { kind: "mustMatch", pattern: "c" },
      ],
    },
  ];
  const base = {
    ...makeResult("baseline", 1),
    assertions: { total: 3, passed: 0, failed: 3, allPassed: false, outcomes: [] },
  };
  const improved = {
    ...makeResult("skill", 1, { activated: true }),
    assertions: { total: 3, passed: 2, failed: 1, allPassed: false, outcomes: [] },
  };
  // skill 2/3 > baseline 0/3，客观改善，与评委 win 一致 -> 不应报分歧
  const d1 = findDisagreements({ variants, tasks: multiTask } as never, [base, improved], [makePairwise("win")]);
  assert.equal(d1.length, 0);

  // skill 0/3 < baseline 1/3，客观倒退，但评委判 win -> 硬分歧且 ruleAdjustedWinRate 扣减
  const baseOne = {
    ...makeResult("baseline", 1),
    assertions: { total: 3, passed: 1, failed: 2, allPassed: false, outcomes: [] },
  };
  const regressed = {
    ...makeResult("skill", 1, { activated: true }),
    assertions: { total: 3, passed: 0, failed: 3, allPassed: false, outcomes: [] },
  };
  const d2 = findDisagreements({ variants, tasks: multiTask } as never, [baseOne, regressed], [makePairwise("win")]);
  assert.equal(d2.length, 1);
  assert.equal(d2[0]!.objectiveVerdict, "loss");

  const vSummary = summarizeVariants({ variants, tasks: multiTask } as never, [baseOne, regressed], [makePairwise("win")]);
  const skillSum = vSummary.find((v) => v.variantId === "skill")!;
  assert.equal(skillSum.winRate, 1);
  assert.equal(skillSum.ruleAdjustedWinRate, 0, "客观违规倒退时规则纠偏后胜率应降为 0");
});

test("shouldActivate=false 分离召回率与误触发率，并识别零激活用例", () => {
  const mixedTasks: EvalTask[] = [
    { id: "pos-1", prompt: "应该触发", shouldActivate: true },
    { id: "pos-zero", prompt: "应该触发但漏了", shouldActivate: true },
    { id: "neg-1", prompt: "闲聊不应触发", shouldActivate: false, kind: "diagnostic" },
  ];
  const results: RunResult[] = [
    { ...makeResult("baseline", 1), id: "baseline-pos-1-1", taskId: "pos-1" },
    { ...makeResult("baseline", 1), id: "baseline-pos-zero-1", taskId: "pos-zero" },
    { ...makeResult("baseline", 1), id: "baseline-neg-1-1", taskId: "neg-1" },
    { ...makeResult("skill", 1, { activated: true }), id: "skill-pos-1-1", taskId: "pos-1" },
    { ...makeResult("skill", 1, { activated: false }), id: "skill-pos-zero-1", taskId: "pos-zero" },
    { ...makeResult("skill", 1, { activated: true }), id: "skill-neg-1-1", taskId: "neg-1" },
  ];

  const summaries = summarizeVariants({ variants, tasks: mixedTasks } as never, results, []);
  const skill = summaries.find((s) => s.variantId === "skill")!;
  // 召回率只统计正向用例：1/2 = 0.5
  assert.equal(skill.activationRate, 0.5);
  // 负向用例误触发率：1/1 = 1.0
  assert.equal(skill.falseActivationRate, 1);
  // 零激活正向用例告警列表
  assert.deepEqual(skill.zeroActivationTasks, ["pos-zero"]);
});

test("诊断任务的断言与成本不能改变计分任务的成本门禁", () => {
  const assertions = Array.from({ length: 1000 }, () => ({ kind: "mustMatch" as const, pattern: "x" }));
  const scoredTasks: EvalTask[] = [{ id: "t1", prompt: "p", assertions }];
  const report = (passed: number) => ({ total: 1000, passed, failed: 1000 - passed, allPassed: passed === 1000,
    outcomes: Array.from({ length: 1000 }, (_, i) => ({ kind: "mustMatch" as const, passed: i < passed, detail: "fixture" })) });
  const base = { ...makeResult("baseline", 1), totalTokens: 100, assertions: report(999) };
  const skill = { ...makeResult("skill", 1), totalTokens: 31000, assertions: report(1000) };
  const before = summarizeVariants({ variants, tasks: scoredTasks, repeat: 1 } as RunnerOptions, [base, skill], []);
  const mixedTasks: EvalTask[] = [...scoredTasks, { id: "diagnostic", prompt: "d", kind: "diagnostic", assertions }];
  const after = summarizeVariants({ variants, tasks: mixedTasks, repeat: 1 } as RunnerOptions, [base, skill,
    { ...base, id: "baseline-diagnostic-1", taskId: "diagnostic", assertions: report(0) },
    { ...skill, id: "skill-diagnostic-1", taskId: "diagnostic", totalTokens: 100, assertions: report(1000) },
  ], []);
  assert.equal(before[1]!.costEfficiency?.grade, "runaway");
  assert.deepEqual(after[1]!.costEfficiency, before[1]!.costEfficiency);
});
