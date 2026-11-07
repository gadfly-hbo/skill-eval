/**
 * 综合结论判定引擎（单一真相来源）。
 *
 * 将原本耦合在 CLI 入口中的 `decideVerdict` 下沉为核心纯函数模块，并补齐：
 * 1. 样本覆盖率（pairCoverage >= 70%）与最低有效判定对数（scoredJudged >= 4）门禁
 * 2. skill 侧超时率门禁（timeoutRate <= 20%）与全样本胜率下界（winRateLowerBound >= 50%）
 * 3. 不对称超时惩罚后的有效胜率（effectiveWinRate >= 胜率门槛）
 * 4. 规则优先于评委（ruleAdjustedWinRate >= 胜率门槛，防止评委乐观分覆盖客观断言倒退）
 * 5. 任务等权配对断言增益及保守 95% Hoeffding 下界 > 0（假定任务簇独立）
 * 6. 0 断言套件同样按任务簇统计，避免重跑次数冒充独立任务数
 * 7. 负向用例误触发率门禁（falseActivationRate <= 20%）
 * 8. 成本效率分级：expensive 标记「有效但昂贵」，runaway 降级为 inconclusive
 *
 * 断言驱动的双档胜率门槛（判定稳定性，2026-11-06）：
 * 胜率是噪声指标（同 skill 两轮复评 53.3% ↔ 78.6%，n≈15 时 Wilson CI 宽约 40pp），
 * 断言增益是稳定指标（两轮 +62.9pp ↔ +60.7pp）。当增益过硬（≥ 20pp 且 CI 下界 > 0）时，
 * 三个胜率门禁（原始 / 超时惩罚 / 规则纠偏）从 60% 降为 50% 守门线（WIN_RATE_RELAXED_THRESHOLD），
 * 全样本下界仍为 50%；增益未过硬时维持 60% 严格门槛。两条路径都不放松激活、覆盖率、
 * 样本量、超时率、误触发与增益本身的门禁。
 */

import {
  ACTIVATION_STRONG_THRESHOLD,
  ACTIVATION_THRESHOLD,
  GAIN_STRONG_THRESHOLD_PP,
  GAIN_THRESHOLD_PP,
  MAX_FALSE_ACTIVATION_RATE,
  MAX_VARIANT_TIMEOUT_RATE,
  MIN_JUDGED_PAIRS,
  MIN_PAIR_COVERAGE,
  MIN_WIN_RATE_LOWER_BOUND,
  WIN_RATE_MARGINAL_THRESHOLD,
  WIN_RATE_RELAXED_THRESHOLD,
  WIN_RATE_STRONG_THRESHOLD,
  WIN_RATE_THRESHOLD,
} from "./thresholds.ts";
import { evaluateGainFromResults, isScoredTask } from "./gain.ts";
import { evaluateCostEfficiency, type CostGrade } from "./cost.ts";
import { wilsonInterval, taskGainInterval, type DiffIntervalPp } from "./stats.ts";
import type { EvaluationSummary } from "./runner.ts";

export type VerdictOutcome = "effective" | "ineffective" | "inconclusive";

export interface VerdictOptions {
  /** 断言增益门槛（百分点），默认 GAIN_THRESHOLD_PP (10)。 */
  gainThresholdPp?: number;
  /** 最低有效判定对数，默认 MIN_JUDGED_PAIRS (4)。 */
  minJudgedPairs?: number;
}

export interface VerdictMetrics {
  activationRate: number;
  falseActivationRate: number | null;
  winRate: number | null;
  effectiveWinRate: number | null;
  ruleAdjustedWinRate: number | null;
  winRateLowerBound: number | null;
  winRateCi: { low: number; high: number } | null;
  pairCoverage: number | null;
  scoredJudged: number;
  totalScoredPairs: number;
  timeoutRate: number;
  hasAssertions: boolean;
  gainPp: number | null;
  gainCiPp: DiffIntervalPp | null;
}

function judgeTaskInterval(summary: EvaluationSummary, variantId: string): { low: number; high: number } | null {
  const tasks = summary.tasks?.filter(isScoredTask);
  if (!tasks?.length || !Number.isInteger(summary.repeat) || summary.repeat < 1) return null;
  const taskRates: number[] = [];
  for (const task of tasks) {
    let wins = 0;
    for (let attempt = 1; attempt <= summary.repeat; attempt++) {
      const pairs = summary.pairwise.filter(p => p.variantId === variantId && p.taskId === task.id && p.attempt === attempt);
      if (pairs.length !== 1) return null;
      const pair = pairs[0]!;
      const base = summary.results.filter(r => r.id === pair.baselineResultId);
      const variant = summary.results.filter(r => r.id === pair.variantResultId);
      if (base.length !== 1 || variant.length !== 1) return null;
      if (pair.verdict === "win") wins++;
    }
    taskRates.push(2 * wins / summary.repeat - 1);
  }
  const interval = taskGainInterval(taskRates);
  return interval ? { low: (interval.lowPp / 100 + 1) / 2, high: (interval.highPp / 100 + 1) / 2 } : null;
}

export interface VerdictDecision {
  verdict: VerdictOutcome;
  costGrade: CostGrade | null;
  /** 是否属于「有效但昂贵」（指标过硬但成本越过警告红线）。 */
  expensive: boolean;
  reason: string;
  /** 阻断判为 effective 的具体项。 */
  blockers: string[];
  /** 不阻断但需提示用户的边界或成本告警。 */
  warnings: string[];
  metrics: VerdictMetrics;
}

const EPS = 1e-9;

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "不可判定";
  return `${(value * 100).toFixed(1)}%`;
}

export function decideVerdict(
  summary: EvaluationSummary,
  options: VerdictOptions = {},
): VerdictDecision {
  const gainThresholdPp = options.gainThresholdPp ?? GAIN_THRESHOLD_PP;
  const minJudgedPairs = options.minJudgedPairs ?? MIN_JUDGED_PAIRS;

  const emptyMetrics: VerdictMetrics = {
    activationRate: 0,
    falseActivationRate: null,
    winRate: null,
    effectiveWinRate: null,
    ruleAdjustedWinRate: null,
    winRateLowerBound: null,
    winRateCi: null,
    pairCoverage: null,
    scoredJudged: 0,
    totalScoredPairs: 0,
    timeoutRate: 0,
    hasAssertions: false,
    gainPp: null,
    gainCiPp: null,
  };

  const baseline = summary.variantSummaries.find((item) => item.variantId === "baseline");
  const variant = summary.variantSummaries.find((item) => item.variantId !== "baseline");
  if (!variant) {
    return {
      verdict: "inconclusive",
      costGrade: null,
      expensive: false,
      reason: "没有可判定的 variant",
      blockers: ["没有可判定的 variant"],
      warnings: [],
      metrics: emptyMetrics,
    };
  }

  if (variant.total === 0) {
    return {
      verdict: "inconclusive",
      costGrade: null,
      expensive: false,
      reason: "没有运行记录",
      blockers: ["没有运行记录"],
      warnings: [],
      metrics: emptyMetrics,
    };
  }

  const activationRate = variant.activationRate;
  const falseActivationRate = variant.falseActivationRate ?? null;
  const winRate = variant.winRate;
  const scoredJudged = variant.scoredJudged ?? variant.win + variant.tie + variant.loss;
  const totalScoredPairs = variant.totalScoredPairs ?? scoredJudged + variant.notJudged;
  const pairCoverage =
    variant.pairCoverage !== undefined
      ? variant.pairCoverage
      : totalScoredPairs > 0
        ? scoredJudged / totalScoredPairs
        : null;
  const winRateLowerBound =
    variant.winRateLowerBound !== undefined
      ? variant.winRateLowerBound
      : totalScoredPairs > 0
        ? variant.win / totalScoredPairs
        : null;
  const effectiveWinRate =
    variant.effectiveWinRate !== undefined ? variant.effectiveWinRate : winRate;
  const ruleAdjustedWinRate =
    variant.ruleAdjustedWinRate !== undefined ? variant.ruleAdjustedWinRate : winRate;
  const winRateCi =
    variant.winRateCi !== undefined
      ? variant.winRateCi
      : scoredJudged > 0
        ? wilsonInterval(variant.win, scoredJudged)
        : null;

  const inferredTimedOut =
    variant.timedOut ??
    summary.results.filter(
      (r) =>
        r.variantId === variant.variantId &&
        (r.timedOut === true || (r.error ?? "").includes("超时")),
    ).length;
  const timeoutRate =
    variant.timeoutRate !== undefined
      ? variant.timeoutRate
      : variant.total > 0
        ? inferredTimedOut / variant.total
        : 0;

  // 只依据冻结计分任务和完整配对运行推断；历史摘要缺证据不回退为已验证。
  const fromResults = evaluateGainFromResults(summary.results, variant.variantId, gainThresholdPp, summary.tasks, summary.repeat);
  const hasAssertions = Boolean(summary.tasks?.some(t => isScoredTask(t) && t.assertions?.length)) ||
    (fromResults.baselineCounts.total > 0 && fromResults.variantCounts.total > 0);
  let gainPp: number | null = null;
  let gainCiPp: DiffIntervalPp | null = null;
  let gainThresholdOk = false;

  if (hasAssertions) {
    gainPp = fromResults.gainPp;
    gainCiPp = fromResults.ciPp ?? null;
    gainThresholdOk = fromResults.passed;
  }

  // 断言驱动的双档胜率门槛：客观增益过硬（≥ 20pp 且 CI 下界 > 0）时，
  // 胜率从「明显优于」60% 降为「不劣于 baseline」50% 守门——胜率是噪声指标，
  // 增益是稳定指标（见 thresholds.ts WIN_RATE_RELAXED_THRESHOLD 的两轮复评依据）。
  const objectiveStrong =
    hasAssertions &&
    gainThresholdOk &&
    gainPp !== null &&
    gainPp >= GAIN_STRONG_THRESHOLD_PP - EPS &&
    gainCiPp !== null && gainCiPp.lowPp > 0;
  const winGate = objectiveStrong ? WIN_RATE_RELAXED_THRESHOLD : WIN_RATE_THRESHOLD;

  const costEfficiency =
    variant.costEfficiency !== undefined
      ? variant.costEfficiency
      : baseline
        ? evaluateCostEfficiency({
            baselineAvgTokens: baseline.avgTokens,
            variantAvgTokens: variant.avgTokens,
            baselineAvgDurationSec: baseline.avgDurationSec,
            variantAvgDurationSec: variant.avgDurationSec,
            gainPp,
          })
        : null;
  const costGrade = costEfficiency?.grade ?? null;

  const metrics: VerdictMetrics = {
    activationRate,
    falseActivationRate,
    winRate,
    effectiveWinRate,
    ruleAdjustedWinRate,
    winRateLowerBound,
    winRateCi,
    pairCoverage,
    scoredJudged,
    totalScoredPairs,
    timeoutRate,
    hasAssertions,
    gainPp,
    gainCiPp,
  };

  if (summary.status === "failed") {
    return {
      verdict: "inconclusive",
      costGrade,
      expensive: false,
      reason: "评估运行全部失败（status=failed），无法对 skill 本身给出有效或无效结论。",
      blockers: ["评估运行全部失败（status=failed）"],
      warnings: [],
      metrics,
    };
  }

  const timeoutOk = timeoutRate <= MAX_VARIANT_TIMEOUT_RATE + EPS;
  const evidenceIssues: string[] = [];
  if (!summary.integrity?.verified || summary.integrity.issues.length > 0) evidenceIssues.push(`运行身份完整性未通过核验${summary.integrity?.issues.length ? `：${summary.integrity.issues.join("；")}` : "（缺少核验证据）"}`);
  if (!summary.isolation?.verified || summary.isolation.issues.length > 0) evidenceIssues.push(`实验隔离未通过核验${summary.isolation?.issues.length ? `：${summary.isolation.issues.join("；")}` : "（缺少核验证据）"}`);
  if (summary.results.some(r => r.contamination?.contaminated)) evidenceIssues.push("运行存在被测 skill 或评测私有材料污染");
  if (!summary.tasks?.length) evidenceIssues.push("缺少冻结任务范围");
  if (summary.results.length === 0) evidenceIssues.push("缺少可复算的原始运行记录");
  const evidenceOk = evidenceIssues.length === 0;

  // 零激活且无任何胜出（且运行本身正常完成而非全超时崩溃）→ 直接证伪。
  if (evidenceOk && variant.success > 0 && timeoutOk && activationRate === 0 && (winRate === null || winRate === 0)) {
    return {
      verdict: "ineffective",
      costGrade,
      expensive: false,
      reason:
        "skill 从未被模型读取（激活率 0%），且未观察到任何相对 baseline 的改善。该 skill 在当前用例集下不产生实际价值。",
      blockers: ["激活率 0%，且胜率 0%"],
      warnings: [],
      metrics,
    };
  }

  const blockers: string[] = [...evidenceIssues];
  const warnings: string[] = [];

  const activationOk = activationRate >= ACTIVATION_THRESHOLD - EPS;
  if (!activationOk) {
    blockers.push(`激活率 ${pct(activationRate)} 未达 ${(ACTIVATION_THRESHOLD * 100).toFixed(0)}% 门槛`);
  } else if (activationRate < ACTIVATION_STRONG_THRESHOLD - EPS) {
    warnings.push(`激活率 ${pct(activationRate)} 处于压线区间（60%–80%），偶有漏触发`);
  }

  if (variant.zeroActivationTasks && variant.zeroActivationTasks.length > 0) {
    warnings.push(`存在 0% 激活的正向用例：${variant.zeroActivationTasks.join(", ")}`);
  }

  const falseActivationOk =
    falseActivationRate === null || falseActivationRate <= MAX_FALSE_ACTIVATION_RATE + EPS;
  if (!falseActivationOk) {
    blockers.push(
      `负向用例误触发率 ${pct(falseActivationRate)} 超过 ${(MAX_FALSE_ACTIVATION_RATE * 100).toFixed(0)}% 上限（description 过泛）`,
    );
  }

  const coverageOk = pairCoverage !== null && pairCoverage >= MIN_PAIR_COVERAGE - EPS;
  if (!coverageOk) {
    blockers.push(
      `有效评判覆盖率 ${pct(pairCoverage)}（${scoredJudged}/${totalScoredPairs} 对）低于 ${(MIN_PAIR_COVERAGE * 100).toFixed(0)}% 门槛`,
    );
  }

  const sampleSizeOk = scoredJudged >= minJudgedPairs;
  if (!sampleSizeOk) {
    blockers.push(`有效计分判定仅 ${scoredJudged} 对，不足最低 ${minJudgedPairs} 对样本要求`);
  }

  if (!timeoutOk) {
    blockers.push(
      `skill 侧超时率 ${pct(timeoutRate)} 超过 ${(MAX_VARIANT_TIMEOUT_RATE * 100).toFixed(0)}% 上限`,
    );
  }

  const gateLabel = `${(winGate * 100).toFixed(0)}%`;
  const rawWinOk = winRate !== null && winRate >= winGate - EPS;
  if (!rawWinOk) {
    blockers.push(
      objectiveStrong
        ? `原始评委胜率 ${pct(winRate)} 未达断言驱动守门线 ${gateLabel}（客观增益虽过硬，但评委并不认为其不劣于 baseline）`
        : `原始评委胜率 ${pct(winRate)} 未达 ${gateLabel} 门槛`,
    );
  } else if (winRate !== null && winRate < WIN_RATE_STRONG_THRESHOLD - EPS) {
    if (objectiveStrong && winRate < WIN_RATE_THRESHOLD - EPS) {
      warnings.push(
        `客观增益过硬（≥${GAIN_STRONG_THRESHOLD_PP}pp 且 95% CI 下界 > 0），评委胜率 ${pct(winRate)} 未达 60% 强线——按断言驱动守门线 ${gateLabel} 判定`,
      );
    } else {
      warnings.push(`评委胜率 ${pct(winRate)} 处于压线达标区间（60%–70%）`);
    }
  }

  const effectiveWinOk =
    effectiveWinRate !== null && effectiveWinRate >= winGate - EPS;
  if (rawWinOk && !effectiveWinOk) {
    blockers.push(
      `计入不对称超时惩罚后的有效胜率仅 ${pct(effectiveWinRate)}，未达 ${gateLabel} 门槛`,
    );
  }

  const ruleWinOk =
    ruleAdjustedWinRate !== null && ruleAdjustedWinRate >= winGate - EPS;
  if (rawWinOk && !ruleWinOk) {
    blockers.push(
      `规则断言纠偏后胜率降至 ${pct(ruleAdjustedWinRate)}，未达 ${gateLabel} 门槛（部分评委判赢的样本在客观规则断言上零改善或倒退）`,
    );
  }

  const lowerBoundOk =
    winRateLowerBound !== null && winRateLowerBound >= MIN_WIN_RATE_LOWER_BOUND - EPS;
  if (!lowerBoundOk) {
    blockers.push(
      `全样本胜率下界 ${pct(winRateLowerBound)} 低于 ${(MIN_WIN_RATE_LOWER_BOUND * 100).toFixed(0)}% 门槛`,
    );
  }

  let objectiveOk = true;
  if (hasAssertions) {
    if (!fromResults.complete) {
      objectiveOk = false;
      blockers.push(`配对断言覆盖不完整：${fromResults.issues.join("；")}`);
    }
    if (!gainThresholdOk) {
      objectiveOk = false;
      blockers.push(
        `规则断言任务等权配对增益 ${gainPp === null ? "不可判定" : `${gainPp >= 0 ? "+" : ""}${gainPp.toFixed(1)}pp`} 未达 +${gainThresholdPp}pp 门槛`,
      );
    } else if (gainCiPp !== null && gainCiPp.lowPp <= 0) {
      objectiveOk = false;
      blockers.push(
        `任务等权增益保守 95% Hoeffding 置信区间 [${gainCiPp.lowPp >= 0 ? "+" : ""}${gainCiPp.lowPp.toFixed(1)}pp, ${gainCiPp.highPp >= 0 ? "+" : ""}${gainCiPp.highPp.toFixed(1)}pp] 跨越 0（独立任务 ${fromResults.pairedTaskCount} 个），证据不足`,
      );
    } else if (gainPp !== null && gainPp < GAIN_STRONG_THRESHOLD_PP - EPS) {
      warnings.push(`断言增益 +${gainPp.toFixed(1)}pp 处于压线区间（10pp–20pp）`);
    }
  } else {
    // 纯评委同样按冻结任务簇推断，不能让同任务多次重跑制造样本量。
    const taskCi = judgeTaskInterval(summary, variant.variantId);
    const judgeCiOk = taskCi !== null && taskCi.low > 0.5;
    if (!judgeCiOk) {
      objectiveOk = false;
      blockers.push(
        `套件缺少规则断言，且任务级纯评委胜率保守 95% 置信下界（${pct(taskCi?.low ?? null)}）未超过 50%，独立任务证据不足`,
      );
    }
  }

  const costRunaway = costGrade === "runaway";
  if (costRunaway && costEfficiency) {
    blockers.push(`${costEfficiency.reason}，触发失控红线`);
  }

  const expensive = costGrade === "expensive";
  if (expensive && costEfficiency) {
    warnings.push(costEfficiency.reason);
  }

  // 所有硬门禁全部通过 → effective（若 expensive=true，报告与归档呈现「有效但昂贵」）。
  if (
    evidenceOk &&
    activationOk &&
    falseActivationOk &&
    coverageOk &&
    sampleSizeOk &&
    timeoutOk &&
    rawWinOk &&
    effectiveWinOk &&
    ruleWinOk &&
    lowerBoundOk &&
    objectiveOk &&
    !costRunaway
  ) {
    const gainNote =
      hasAssertions && gainPp !== null ? `、断言增益 +${gainPp.toFixed(1)}pp` : "";
    const driveNote =
      objectiveStrong && winRate !== null && winRate < WIN_RATE_THRESHOLD - EPS
        ? `（断言增益过硬，胜率按断言驱动守门线 ${gateLabel} 判定而非 60%）`
        : "";
    const costNote =
      expensive && costEfficiency ? `（注意：${costEfficiency.reason}，属于「有效但昂贵」）` : "";
    return {
      verdict: "effective",
      costGrade,
      expensive,
      reason: `激活率 ${pct(activationRate)}，原始评委胜率 ${pct(winRate)}${gainNote}，各项统计与覆盖率门禁均达标${driveNote}。该 skill 在当前用例集下有效${costNote}。`,
      blockers: [],
      warnings,
      metrics,
    };
  }

  // 区分「明确证伪（ineffective）」与「证据不足/超时污染/偏科（inconclusive）」：
  // 1. 样本健康时，激活率与胜率双双不及格 → ineffective
  // 2. 激活充分、样本充足且无超时污染时，胜率低于弱提升线（45%）且客观断言增益也未达标 → 空壳/无效契约证伪为 ineffective
  if (evidenceOk && coverageOk && sampleSizeOk && timeoutOk) {
    if (!activationOk && !rawWinOk) {
      return {
        verdict: "ineffective",
        costGrade,
        expensive: false,
        reason: `激活率 ${pct(activationRate)} 未达 60% 门槛，原始评委胜率 ${pct(winRate)} 未达 60% 门槛。skill 未产生稳定可观测的价值。`,
        blockers,
        warnings,
        metrics,
      };
    }

    const clearlyWeakJudge =
      ruleAdjustedWinRate !== null && ruleAdjustedWinRate < WIN_RATE_MARGINAL_THRESHOLD - EPS;
    const clearlyWeakAssertions = hasAssertions && !gainThresholdOk;
    if (
      activationRate >= ACTIVATION_STRONG_THRESHOLD - EPS &&
      clearlyWeakJudge &&
      clearlyWeakAssertions
    ) {
      return {
        verdict: "ineffective",
        costGrade,
        expensive: false,
        reason: `skill 已被充分读取（激活率 ${pct(activationRate)}），但规则纠偏胜率仅 ${pct(ruleAdjustedWinRate)} 且断言增益 ${gainPp === null ? "不可判定" : `${gainPp >= 0 ? "+" : ""}${gainPp.toFixed(1)}pp`} 未达 +${gainThresholdPp}pp 门槛，未能带来实质改善。`,
        blockers,
        warnings,
        metrics,
      };
    }
  }

  return {
    verdict: "inconclusive",
    costGrade,
    expensive: false,
    reason: `未通过全部有效门禁：${blockers.join("；")}。`,
    blockers,
    warnings,
    metrics,
  };
}
