import { test } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict } from "./verdict.ts";
import { summarizeVariants, summarizeTasks, type EvaluationSummary, type RunResult, type EvalTask } from "./runner.ts";

const fixtureVariants = [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Skill", skillPaths: ["/tmp/SKILL.md"] }];

/** 合成的独立任务测试数据，只检验判定算法，不代表真实 skill 的测评证据。 */
function makeSummary(taskCount = 16, basePassed = 0, variantPassed = 10): EvaluationSummary {
  const tasks: EvalTask[] = Array.from({ length: taskCount }, (_, i) => ({
    id: `task-${i}`, prompt: `独立任务 ${i}`, assertions: Array.from({ length: 10 }, (_, j) => ({ kind: "mustContain" as const, value: `criterion-${j}` })),
  }));
  const results: RunResult[] = tasks.flatMap(task => fixtureVariants.map(v => {
    const passed = v.id === "baseline" ? basePassed : variantPassed;
    return {
      id: `${v.id}-${task.id}-1`, variantId: v.id, variantLabel: v.label, taskId: task.id, attempt: 1,
      status: "success", startedAt: 0, endedAt: 1000, durationSec: 1, skillPaths: v.skillPaths,
      totalTokens: 100, totalCost: .001, toolCalls: 1, output: "valid output",
      activation: { activated: v.id === "skill", status: v.id === "skill" ? "activated" : "not_activated", readSkillPaths: v.skillPaths, matchedKeywords: [], evidence: [] },
      assertions: { total: 10, passed, failed: 10 - passed, allPassed: passed === 10,
        outcomes: Array.from({ length: 10 }, (_, i) => ({ kind: "mustContain" as const, passed: i < passed, detail: "test" })) },
      evidenceDir: "cases", error: null,
    };
  }));
  const pairwise = tasks.map(t => ({
    baselineResultId: `baseline-${t.id}-1`, variantResultId: `skill-${t.id}-1`, variantId: "skill", taskId: t.id, attempt: 1,
    verdict: "win" as const, scoreDelta: 20, baselineScore: 70, variantScore: 90, confidence: .8, reason: "test", error: null, judgeRuns: [], biasProbe: null,
  }));
  return {
    runId: "synthetic", model: "m1", judgeModel: "m2", repeat: 1, judgeRepeat: 2,
    startedAt: 0, endedAt: 1000, durationSec: 1, status: "success", tasks, results, pairwise,
    variantSummaries: summarizeVariants({ variants: fixtureVariants, tasks, repeat: 1 } as never, results, pairwise),
    taskSummaries: summarizeTasks({ variants: fixtureVariants, tasks } as never, results, pairwise),
    disagreements: [], totalTokens: results.length * 100, totalCost: results.length * .001,
    integrity: { verified: true, issues: [] }, isolation: { verified: true, issues: [] },
  };
}

test("完整核验、足够独立任务及显著配对增益才判 effective", () => {
  const decision = decideVerdict(makeSummary());
  assert.equal(decision.verdict, "effective");
  assert.equal(decision.expensive, false);
  assert.equal(decision.metrics.gainPp, 100);
  assert.equal(decision.metrics.gainCiPp?.method, "task-hoeffding");
  assert.deepEqual(decision.blockers, []);
});

test("缺少身份完整性/隔离核验、核验失败或存在污染时不得 effective", () => {
  const clean = makeSummary();
  for (const changed of [
    { integrity: undefined }, { isolation: undefined },
    { integrity: { verified: false, issues: ["候选哈希漂移"] } },
    { isolation: { verified: false, issues: ["可访问私有材料"] } },
    { integrity: { verified: true, issues: ["未解决问题"] } },
    { results: clean.results.map((r, i) => i === 0 ? { ...r, contamination: { contaminated: true, evidence: [] } } : r) },
  ]) {
    const decision = decideVerdict({ ...clean, ...changed } as EvaluationSummary);
    assert.equal(decision.verdict, "inconclusive");
    assert.ok(decision.blockers.some(b => /完整性|隔离|污染/.test(b)));
  }
});

test("summary-only 摘要声称完美也不能替代原始核验证据", () => {
  const summary = makeSummary();
  const decision = decideVerdict({ ...summary, results: [], tasks: undefined, integrity: undefined });
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.some(b => /完整性|冻结任务|原始运行/.test(b)));
});

test("少量独立任务不会因断言数或attempt很多就显著", () => {
  const decision = decideVerdict(makeSummary(3), { minJudgedPairs: 1 });
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.some(b => b.includes("置信区间")));
  assert.equal(decision.metrics.gainCiPp?.independentTasks, 3);
});

test("诊断用例再大也不能补足计分用例增益", () => {
  const summary = makeSummary(16, 10, 10);
  const diag = { ...summary.tasks![0]!, id: "diagnostic", kind: "diagnostic" as const };
  summary.tasks!.push(diag);
  summary.results.push(...summary.results.slice(0, 2).map((r, i) => ({ ...r, id: `${r.variantId}-diagnostic-1`, taskId: diag.id,
    assertions: { total: 100, passed: i ? 100 : 0, failed: i ? 0 : 100, allPassed: i === 1,
      outcomes: Array.from({ length: 100 }, () => ({ kind: "mustContain" as const, passed: i === 1, detail: "diagnostic" })) } })));
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.equal(decision.metrics.gainPp, 0);
});

test("缺失配对不得以幸存样本增益放行", () => {
  const summary = makeSummary();
  summary.results = summary.results.filter(r => r.id !== "skill-task-0-1");
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.equal(decision.metrics.gainPp, null);
  assert.ok(decision.blockers.some(b => /配对|覆盖/.test(b)));
});

test("完整低增益仍可判无效，缺一对时保留冻结分母并判结论不足", () => {
  const summary = makeSummary(5, 5, 5);
  const complete = decideVerdict(summary);
  assert.equal(complete.metrics.gainPp, 0);
  assert.equal(complete.metrics.ruleAdjustedWinRate, 0);
  assert.equal(complete.verdict, "ineffective");

  const missing = summary.pairwise.pop()!;
  summary.status = "partial";
  const plan = { variants: fixtureVariants, tasks: summary.tasks!, repeat: summary.repeat } as never;
  summary.variantSummaries = summarizeVariants(plan, summary.results, summary.pairwise);
  const judgeOnlyMissing = decideVerdict(summary);
  assert.equal(judgeOnlyMissing.metrics.gainPp, 0);
  assert.equal(judgeOnlyMissing.verdict, "ineffective");

  summary.results = summary.results.filter(r => r.id !== missing.variantResultId);
  summary.variantSummaries = summarizeVariants(plan, summary.results, summary.pairwise);
  const incomplete = decideVerdict(summary);
  assert.equal(incomplete.metrics.scoredJudged, 4);
  assert.equal(incomplete.metrics.totalScoredPairs, 5);
  assert.equal(incomplete.metrics.pairCoverage, 4 / 5);
  assert.equal(incomplete.metrics.gainPp, null);
  assert.equal(incomplete.verdict, "inconclusive");
  assert.match(incomplete.reason, /配对断言覆盖不完整/);
  assert.doesNotMatch(incomplete.reason, /不可判定 未达/);
});

test("高超时率、低评判覆盖率和低全样本胜率分别阻断", () => {
  for (const changed of [{ timeoutRate: .35 }, { pairCoverage: .4 }, { winRateLowerBound: .3 }]) {
    const summary = makeSummary();
    Object.assign(summary.variantSummaries[1]!, changed);
    assert.equal(decideVerdict(summary).verdict, "inconclusive");
  }
});

test("规则纠偏、负向误触发及失控成本各自阻断", () => {
  for (const changed of [{ ruleAdjustedWinRate: .4 }, { falseActivationRate: .5 }, { costEfficiency: { grade: "runaway", reason: "成本失控" } }]) {
    const summary = makeSummary();
    Object.assign(summary.variantSummaries[1]!, changed);
    assert.equal(decideVerdict(summary).verdict, "inconclusive");
  }
});

test("指标达标但成本昂贵时保留 effective 并标 expensive", () => {
  const summary = makeSummary();
  Object.assign(summary.variantSummaries[1]!, { costEfficiency: { grade: "expensive", reason: "成本偏高" } });
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "effective");
  assert.equal(decision.expensive, true);
  assert.equal(decision.costGrade, "expensive");
});

test("独立任务确认客观强增益后可用50%守门线，低于50%仍阻断", () => {
  const summary = makeSummary(32, 2, 9);
  Object.assign(summary.variantSummaries[1]!, { winRate: .5333, effectiveWinRate: .5333, ruleAdjustedWinRate: .5333, winRateLowerBound: .5333 });
  const accepted = decideVerdict(summary);
  assert.equal(accepted.verdict, "effective");
  assert.ok(accepted.warnings.some(w => w.includes("断言驱动")));
  Object.assign(summary.variantSummaries[1]!, { winRate: .4667, effectiveWinRate: .4667, ruleAdjustedWinRate: .4667, winRateLowerBound: .4667 });
  const rejected = decideVerdict(summary);
  assert.equal(rejected.verdict, "inconclusive");
  assert.ok(rejected.blockers.some(b => b.includes("断言驱动守门线")));
});

test("弱增益不放宽60%胜率线", () => {
  const summary = makeSummary(16, 5, 6);
  Object.assign(summary.variantSummaries[1]!, { winRate: .5333, effectiveWinRate: .5333, ruleAdjustedWinRate: .5333, winRateLowerBound: .5333 });
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.some(b => /胜率.*60%/.test(b)));
});

test("无断言时也不能靠同任务重跑冒充独立评委证据", () => {
  const summary = makeSummary(3);
  summary.tasks!.forEach(t => { t.assertions = []; });
  summary.results.forEach(r => { r.assertions = null; });
  Object.assign(summary.variantSummaries[1]!, { scoredJudged: 60, totalScoredPairs: 60, winRateCi: { low: .9, high: 1 } });
  assert.equal(decideVerdict(summary).verdict, "inconclusive");
});

test("核验完整且数据充足时零激活零改善可证伪，污染未知则证据不足", () => {
  const summary = makeSummary(16, 5, 5);
  Object.assign(summary.variantSummaries[1]!, { activationRate: 0, winRate: 0, effectiveWinRate: 0, ruleAdjustedWinRate: 0, winRateLowerBound: 0 });
  assert.equal(decideVerdict(summary).verdict, "ineffective");
  summary.integrity = undefined;
  assert.equal(decideVerdict(summary).verdict, "inconclusive");
});

test("零激活且零有效评判时保留冻结分母并判结论不足", () => {
  const summary = makeSummary(5, 5, 5);
  for (const row of summary.results) {
    row.activation = { activated: false, status: "not_activated", readSkillPaths: [], matchedKeywords: [], evidence: [] };
  }
  summary.status = "partial";
  summary.pairwise = [];
  const plan = { variants: fixtureVariants, tasks: summary.tasks!, repeat: summary.repeat } as never;
  summary.variantSummaries = summarizeVariants(plan, summary.results, summary.pairwise);
  const decision = decideVerdict(summary);
  assert.equal(decision.metrics.activationRate, 0);
  assert.equal(decision.metrics.winRate, null);
  assert.equal(decision.metrics.scoredJudged, 0);
  assert.equal(decision.metrics.totalScoredPairs, 5);
  assert.equal(decision.metrics.pairCoverage, 0);
  assert.equal(decision.verdict, "inconclusive");
});
