import { test } from "node:test";
import assert from "node:assert/strict";
import { decideVerdict } from "./verdict.ts";
import type { EvaluationSummary, RunResult, VariantSummary } from "./runner.ts";

function makeAssertionResult(
  variantId: string,
  taskId: string,
  attempt: number,
  passedCount: number,
  totalCount: number,
  status: "success" | "failed" = "success",
  timedOut = false,
): RunResult {
  const outcomes = Array.from({ length: totalCount }, (_, i) => ({
    kind: "mustMatch" as const,
    passed: i < passedCount,
    detail: i < passedCount ? "ok" : "fail",
  }));
  return {
    id: `${variantId}-${taskId}-${attempt}`,
    variantId,
    variantLabel: variantId,
    taskId,
    attempt,
    status,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 1,
    skillPaths: variantId === "baseline" ? [] : ["/tmp/SKILL.md"],
    totalTokens: 1000,
    totalCost: 0.001,
    toolCalls: 1,
    output: status === "failed" ? "" : "valid output",
    activation: {
      status: variantId === "baseline" ? "not_activated" : "activated",
      activated: variantId !== "baseline",
      readSkillPaths: variantId === "baseline" ? [] : ["/tmp/SKILL.md"],
      matchedKeywords: [],
      evidence: [],
    },
    assertions:
      status === "failed" || totalCount === 0
        ? null
        : {
            total: totalCount,
            passed: passedCount,
            failed: totalCount - passedCount,
            allPassed: passedCount === totalCount,
            outcomes,
          },
    evidenceDir: `cases/${variantId}/${taskId}/${attempt}`,
    error: status === "failed" ? (timedOut ? "运行超时" : "error") : null,
    timedOut,
  };
}

test("json-contract 画像：激活充分、胜率达标、断言增益显著且开销省算力 → effective（非昂贵）", () => {
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 1, 3),
    makeAssertionResult("baseline", "t1", 2, 1, 3),
    makeAssertionResult("baseline", "t2", 1, 0, 2),
    makeAssertionResult("baseline", "t2", 2, 0, 2),
    makeAssertionResult("baseline", "t3", 1, 0, 2),
    makeAssertionResult("baseline", "t3", 2, 0, 2),
    makeAssertionResult("skill", "t1", 1, 3, 3),
    makeAssertionResult("skill", "t1", 2, 3, 3),
    makeAssertionResult("skill", "t2", 1, 2, 2),
    makeAssertionResult("skill", "t2", 2, 2, 2),
    makeAssertionResult("skill", "t3", 1, 2, 2),
    makeAssertionResult("skill", "t3", 2, 2, 2),
  ];

  const summary: EvaluationSummary = {
    runId: "json-contract-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 10,
    status: "success",
    results,
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 6,
        success: 6,
        failed: 0,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: 0,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 7758,
        avgCost: 0.01,
        avgDurationSec: 12.3,
        avgToolCalls: 0,
      },
      {
        variantId: "skill",
        variantLabel: "Skill",
        total: 6,
        success: 6,
        failed: 0,
        timedOut: 0,
        timeoutRate: 0,
        activationRate: 1.0,
        weakActivationRate: 0,
        falseActivationRate: null,
        zeroActivationTasks: [],
        assertionPassRate: 1.0,
        winRate: 4 / 6,
        winRateLowerBound: 4 / 6,
        effectiveWinRate: 4 / 6,
        ruleAdjustedWinRate: 4 / 6,
        totalScoredPairs: 6,
        scoredJudged: 6,
        pairCoverage: 1.0,
        win: 4,
        tie: 1,
        loss: 1,
        notJudged: 0,
        avgTokens: 5997,
        avgCost: 0.01,
        avgDurationSec: 10.1,
        avgToolCalls: 1,
        costEfficiency: {
          grade: "lean",
          baselineAvgTokens: 7758,
          variantAvgTokens: 5997,
          deltaTokens: -1761,
          tokenRatio: 0.77,
          baselineAvgDurationSec: 12.3,
          variantAvgDurationSec: 10.1,
          deltaDurationSec: -2.2,
          durationRatio: 0.82,
          tokensPerGainPp: 0,
          reason: "未增加 token 或耗时开销（紧凑高效）",
        },
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0.02,
    totalTokens: 82526,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "effective");
  assert.equal(decision.expensive, false);
  assert.equal(decision.costGrade, "lean");
  assert.equal(decision.blockers.length, 0);
});

test("data-analysis v2 画像：指标全部过硬但 token 膨胀 15.2x → effective 且标记 expensive=true", () => {
  // 模拟 baseline 22/106 → skill 101/106
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 22, 106),
    makeAssertionResult("skill", "t1", 1, 101, 106),
  ];

  const summary: EvaluationSummary = {
    runId: "da-v2-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 100,
    status: "success",
    results,
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 10,
        success: 10,
        failed: 0,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: 0,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 12175,
        avgCost: 0.05,
        avgDurationSec: 36,
        avgToolCalls: 2,
      },
      {
        variantId: "skill",
        variantLabel: "Skill",
        total: 10,
        success: 10,
        failed: 0,
        timedOut: 0,
        timeoutRate: 0,
        activationRate: 1.0,
        weakActivationRate: 0,
        falseActivationRate: null,
        zeroActivationTasks: [],
        assertionPassRate: 0.8,
        winRate: 0.9,
        winRateLowerBound: 0.9,
        effectiveWinRate: 0.9,
        ruleAdjustedWinRate: 0.9,
        totalScoredPairs: 10,
        scoredJudged: 10,
        pairCoverage: 1.0,
        win: 9,
        tie: 0,
        loss: 1,
        notJudged: 0,
        avgTokens: 185541,
        avgCost: 0.8,
        avgDurationSec: 137,
        avgToolCalls: 12,
        costEfficiency: {
          grade: "expensive",
          baselineAvgTokens: 12175,
          variantAvgTokens: 185541,
          deltaTokens: 173366,
          tokenRatio: 15.24,
          baselineAvgDurationSec: 36,
          variantAvgDurationSec: 137,
          deltaDurationSec: 101,
          durationRatio: 3.81,
          tokensPerGainPp: 2326,
          reason: "成本偏高（token 15.2x，2,326 tokens/pp）",
        },
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 8.5,
    totalTokens: 1977160,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "effective");
  assert.equal(decision.expensive, true);
  assert.equal(decision.costGrade, "expensive");
  assert.match(decision.reason, /昂贵|成本偏高/);
});

test("deep-research 画像：高超时率 + 评判覆盖率仅 40% + 全样本胜率 30% + 增益置信区间跨零 → 拦截为 inconclusive", () => {
  // 模拟 baseline 11/68 → skill 20/68（+13.2pp，但 Newcombe 95% CI [-0.9pp, +26.8pp] 跨零）
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 11, 68),
    makeAssertionResult("skill", "t1", 1, 20, 68),
  ];

  const summary: EvaluationSummary = {
    runId: "deep-research-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 500,
    status: "partial",
    results,
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 20,
        success: 19,
        failed: 1,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: 0.05,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 18500,
        avgCost: 0.05,
        avgDurationSec: 65,
        avgToolCalls: 3,
      },
      {
        variantId: "skill",
        variantLabel: "Skill",
        total: 20,
        success: 13,
        failed: 7,
        timedOut: 7,
        timeoutRate: 0.35,
        activationRate: 0.85,
        weakActivationRate: 0,
        falseActivationRate: null,
        zeroActivationTasks: [],
        assertionPassRate: 0.15,
        winRate: 0.75,
        winRateLowerBound: 0.3,
        effectiveWinRate: 0.3,
        ruleAdjustedWinRate: 0.5,
        totalScoredPairs: 10,
        scoredJudged: 4,
        pairCoverage: 0.4,
        win: 3,
        tie: 0,
        loss: 1,
        notJudged: 6,
        avgTokens: 98000,
        avgCost: 0.3,
        avgDurationSec: 210,
        avgToolCalls: 15,
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 7.0,
    totalTokens: 2330000,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.length >= 3);
  assert.ok(decision.blockers.some((b) => b.includes("覆盖率")));
  assert.ok(decision.blockers.some((b) => b.includes("超时")));
  assert.ok(decision.blockers.some((b) => b.includes("置信区间") || b.includes("纠偏")));
});

test("规则优先于评委：增益未过硬（+16.7pp）时评委 75% 胜率但规则纠偏后 50% < 严格 60% 门槛 → inconclusive", () => {
  // baseline 5/30 (16.7%) → skill 10/30 (33.3%)：+16.7pp 落在 10–20pp 压线区间，
  // 未过硬 → 走严格 60% 胜率门槛（断言驱动降级仅适用于 ≥ 20pp 且 CI 下界 > 0）。
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 5, 30),
    makeAssertionResult("skill", "t1", 1, 10, 30),
  ];

  const summary: EvaluationSummary = {
    runId: "rule-conflict-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 20,
    status: "success",
    results,
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 8,
        success: 8,
        failed: 0,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: 0.1,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 5000,
        avgCost: 0.01,
        avgDurationSec: 10,
        avgToolCalls: 1,
      },
      {
        variantId: "skill",
        variantLabel: "Skill",
        total: 8,
        success: 8,
        failed: 0,
        timedOut: 0,
        timeoutRate: 0,
        activationRate: 1.0,
        weakActivationRate: 0,
        assertionPassRate: 0.6,
        winRate: 0.75,
        winRateLowerBound: 0.75,
        effectiveWinRate: 0.75,
        ruleAdjustedWinRate: 0.5, // 2/8 次 win 在客观断言上倒退或零改善
        totalScoredPairs: 8,
        scoredJudged: 8,
        pairCoverage: 1.0,
        win: 6,
        tie: 0,
        loss: 2,
        notJudged: 0,
        avgTokens: 6000,
        avgCost: 0.01,
        avgDurationSec: 12,
        avgToolCalls: 2,
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0.16,
    totalTokens: 88000,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.some((b) => b.includes("规则")));
});

test("负向用例误触发率超标（> 20%）→ 阻断判为 effective", () => {
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 2, 20),
    makeAssertionResult("skill", "t1", 1, 18, 20),
  ];

  const summary: EvaluationSummary = {
    runId: "overtrigger-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 20,
    status: "success",
    results,
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 8,
        success: 8,
        failed: 0,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: 0.1,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 3000,
        avgCost: 0.01,
        avgDurationSec: 5,
        avgToolCalls: 0,
      },
      {
        variantId: "skill",
        variantLabel: "Skill",
        total: 8,
        success: 8,
        failed: 0,
        timedOut: 0,
        timeoutRate: 0,
        activationRate: 1.0,
        weakActivationRate: 0,
        falseActivationRate: 0.5, // 50% 误触发
        zeroActivationTasks: [],
        assertionPassRate: 0.9,
        winRate: 0.833,
        winRateLowerBound: 0.833,
        effectiveWinRate: 0.833,
        ruleAdjustedWinRate: 0.833,
        totalScoredPairs: 6,
        scoredJudged: 6,
        pairCoverage: 1.0,
        win: 5,
        tie: 1,
        loss: 0,
        notJudged: 0,
        avgTokens: 4000,
        avgCost: 0.01,
        avgDurationSec: 6,
        avgToolCalls: 1,
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0.1,
    totalTokens: 56000,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.some((b) => b.includes("误触发")));
});

test("0 断言套件且小样本（4/6 胜率 66.7%，Wilson 95% 下界 <= 50%）→ 拦截为 inconclusive", () => {
  const summary: EvaluationSummary = {
    runId: "zero-assertion-small-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 20,
    status: "success",
    results: [
      makeAssertionResult("baseline", "t1", 1, 0, 0),
      makeAssertionResult("skill", "t1", 1, 0, 0),
    ],
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 6,
        success: 6,
        failed: 0,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: null,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 3000,
        avgCost: 0.01,
        avgDurationSec: 5,
        avgToolCalls: 0,
      },
      {
        variantId: "skill",
        variantLabel: "Skill",
        total: 6,
        success: 6,
        failed: 0,
        timedOut: 0,
        timeoutRate: 0,
        activationRate: 1.0,
        weakActivationRate: 0,
        assertionPassRate: null,
        winRate: 4 / 6,
        winRateLowerBound: 4 / 6,
        effectiveWinRate: 4 / 6,
        ruleAdjustedWinRate: 4 / 6,
        totalScoredPairs: 6,
        scoredJudged: 6,
        pairCoverage: 1.0,
        win: 4,
        tie: 1,
        loss: 1,
        notJudged: 0,
        avgTokens: 3500,
        avgCost: 0.01,
        avgDurationSec: 6,
        avgToolCalls: 1,
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0.1,
    totalTokens: 39000,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(decision.blockers.some((b) => b.includes("无规则断言") || b.includes("缺少规则断言")));
});

test("阴性对照破坏版画像：100% 激活、充足样本下胜率 22.2% 且断言增益 8.6pp 未达标 → 证伪为 ineffective", () => {
  // baseline 29/58 (50.0%) → broken 34/58 (58.6%, +8.6pp)
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 29, 58),
    makeAssertionResult("skill", "t1", 1, 34, 58),
  ];

  const summary: EvaluationSummary = {
    runId: "nc-broken-run",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 50,
    status: "success",
    results,
    pairwise: [],
    variantSummaries: [
      {
        variantId: "baseline",
        variantLabel: "Baseline",
        total: 10,
        success: 10,
        failed: 0,
        activationRate: 0,
        weakActivationRate: 0,
        assertionPassRate: 0.3,
        winRate: null,
        win: 0,
        tie: 0,
        loss: 0,
        notJudged: 0,
        avgTokens: 11323,
        avgCost: 0.03,
        avgDurationSec: 25,
        avgToolCalls: 1,
      },
      {
        variantId: "skill",
        variantLabel: "Broken Skill",
        total: 10,
        success: 10,
        failed: 0,
        timedOut: 0,
        timeoutRate: 0,
        activationRate: 1.0,
        weakActivationRate: 0,
        assertionPassRate: 0.5,
        winRate: 2 / 9,
        winRateLowerBound: 2 / 10,
        effectiveWinRate: 2 / 9,
        ruleAdjustedWinRate: 2 / 9,
        totalScoredPairs: 10,
        scoredJudged: 9,
        pairCoverage: 0.9,
        win: 2,
        tie: 7,
        loss: 0,
        notJudged: 1,
        avgTokens: 65942,
        avgCost: 0.2,
        avgDurationSec: 60,
        avgToolCalls: 4,
      },
    ],
    taskSummaries: [],
    disagreements: [],
    totalCost: 2.3,
    totalTokens: 772650,
  };

  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "ineffective");
});

/**
 * 构造带完整胜率/覆盖率字段的 summary，服务于断言驱动双档胜率门槛用例。
 * effectiveWinRate 与 ruleAdjustedWinRate 默认等于 winRate（无超时惩罚、无规则纠偏覆盖）。
 */
function makeWinGateSummary(opts: {
  runId: string;
  results: RunResult[];
  win: number;
  tie: number;
  loss: number;
  notJudged?: number;
}): EvaluationSummary {
  const notJudged = opts.notJudged ?? 0;
  const decided = opts.win + opts.tie + opts.loss;
  const expected = decided + notJudged;
  const winRate = decided > 0 ? opts.win / decided : null;
  const lowerBound = expected > 0 ? opts.win / expected : null;
  const baseline: VariantSummary = {
    variantId: "baseline",
    variantLabel: "Baseline",
    total: 15,
    success: 15,
    failed: 0,
    activationRate: 0,
    weakActivationRate: 0,
    assertionPassRate: 0.16,
    winRate: null,
    win: 0,
    tie: 0,
    loss: 0,
    notJudged: 0,
    avgTokens: 12000,
    avgCost: 0.03,
    avgDurationSec: 30,
    avgToolCalls: 2,
  };
  const skill: VariantSummary = {
    variantId: "skill",
    variantLabel: "Skill",
    total: expected,
    success: expected - notJudged,
    failed: 0,
    timedOut: 0,
    timeoutRate: 0,
    activationRate: 1.0,
    weakActivationRate: 0,
    falseActivationRate: null,
    zeroActivationTasks: [],
    assertionPassRate: 0.6,
    winRate,
    winRateLowerBound: lowerBound,
    effectiveWinRate: winRate,
    ruleAdjustedWinRate: winRate,
    totalScoredPairs: expected,
    scoredJudged: decided,
    pairCoverage: expected > 0 ? decided / expected : null,
    win: opts.win,
    tie: opts.tie,
    loss: opts.loss,
    notJudged,
    avgTokens: 12000,
    avgCost: 0.03,
    avgDurationSec: 28,
    avgToolCalls: 4,
    costEfficiency: {
      grade: "lean",
      baselineAvgTokens: 12000,
      variantAvgTokens: 12000,
      deltaTokens: 0,
      tokenRatio: 1,
      baselineAvgDurationSec: 30,
      variantAvgDurationSec: 28,
      deltaDurationSec: -2,
      durationRatio: 0.93,
      tokensPerGainPp: 0,
      reason: "未增加 token 或耗时开销（紧凑高效）",
    },
  };
  return {
    runId: opts.runId,
    model: "m1",
    judgeModel: "m2",
    repeat: 3,
    judgeRepeat: 2,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 60,
    status: "success",
    results: opts.results,
    pairwise: [],
    variantSummaries: [baseline, skill],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0.5,
    totalTokens: 360000,
  };
}

test("断言驱动双档门槛：增益 +62.3pp 过硬而胜率仅 53.3%（run1 画像）→ effective 并提示按守门线判定", () => {
  // 2026-11-05 data-analysis run1 实测画像：增益 +62.9pp（稳定），胜率 8/15 = 53.3%（噪声）。
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 17, 106),
    makeAssertionResult("skill", "t1", 1, 83, 106),
  ];
  const summary = makeWinGateSummary({ runId: "drive-gate-run", results, win: 8, tie: 4, loss: 3 });
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "effective");
  assert.equal(decision.blockers.length, 0, `不应有阻断项：${decision.blockers.join("；")}`);
  assert.ok(
    decision.warnings.some((w) => w.includes("断言驱动")),
    `应有断言驱动提示：${decision.warnings.join("；")}`,
  );
  assert.match(decision.reason, /断言驱动守门线/);
});

test("断言驱动双档门槛边界：增益 +15pp 未过硬（10–20pp 压线）+ 胜率 53.3% → 仍走严格 60% 门槛判 inconclusive", () => {
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 50, 100),
    makeAssertionResult("skill", "t1", 1, 65, 100),
  ];
  const summary = makeWinGateSummary({ runId: "marginal-gain-run", results, win: 8, tie: 4, loss: 3 });
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(
    decision.blockers.some((b) => b.includes("胜率") && b.includes("60%")),
    `应有严格 60% 胜率阻断项：${decision.blockers.join("；")}`,
  );
});

test("断言驱动双档门槛下界：增益 +62.3pp 过硬但胜率 46.7% 低于 50% 守门线 → inconclusive", () => {
  const results: RunResult[] = [
    makeAssertionResult("baseline", "t1", 1, 17, 106),
    makeAssertionResult("skill", "t1", 1, 83, 106),
  ];
  const summary = makeWinGateSummary({ runId: "weak-judge-run", results, win: 7, tie: 5, loss: 3 });
  const decision = decideVerdict(summary);
  assert.equal(decision.verdict, "inconclusive");
  assert.ok(
    decision.blockers.some((b) => b.includes("断言驱动守门线")),
    `应有 50% 守门线阻断项：${decision.blockers.join("；")}`,
  );
});
