import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeTasks,
  summarizeVariants,
  findDisagreements,
  parseResultId,
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
