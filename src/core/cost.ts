/**
 * 成本效率评估（替代缺乏实证依据的旧 EFC 启发式系数）。
 *
 * 用直观、可解释的物理量度量引入一个 skill 的推理代价：
 * - token 膨胀倍率与单次净增 token
 * - 耗时膨胀倍率与单次净增耗时
 * - 每 1pp 规则断言增益消耗的额外 token（tokensPerGainPp）
 */

import {
  COST_RUNAWAY_TOKENS_PER_PP,
  COST_RUNAWAY_TOKEN_RATIO,
  COST_WARN_DELTA_DURATION_SEC,
  COST_WARN_DELTA_TOKENS,
  COST_WARN_DURATION_RATIO,
  COST_WARN_TOKENS_PER_PP,
  COST_WARN_TOKEN_RATIO,
} from "./thresholds.ts";

export type CostGrade = "lean" | "moderate" | "expensive" | "runaway";

export interface CostEfficiencyInput {
  baselineAvgTokens: number;
  variantAvgTokens: number;
  baselineAvgDurationSec: number;
  variantAvgDurationSec: number;
  /** 规则断言条目累计增益（百分点）。 */
  gainPp: number | null;
}

export interface CostEfficiency {
  grade: CostGrade;
  baselineAvgTokens: number;
  variantAvgTokens: number;
  deltaTokens: number;
  tokenRatio: number | null;
  baselineAvgDurationSec: number;
  variantAvgDurationSec: number;
  deltaDurationSec: number;
  durationRatio: number | null;
  /** 每 1pp 断言增益消耗的额外 token；未增加消耗时为 0，无正增益时为 null。 */
  tokensPerGainPp: number | null;
  reason: string;
}

export function evaluateCostEfficiency(input: CostEfficiencyInput): CostEfficiency {
  const deltaTokens = input.variantAvgTokens - input.baselineAvgTokens;
  const deltaDurationSec = input.variantAvgDurationSec - input.baselineAvgDurationSec;

  const tokenRatio =
    input.baselineAvgTokens > 0
      ? Math.round((input.variantAvgTokens / input.baselineAvgTokens) * 100) / 100
      : null;
  const durationRatio =
    input.baselineAvgDurationSec > 0
      ? Math.round((input.variantAvgDurationSec / input.baselineAvgDurationSec) * 100) / 100
      : null;

  const tokensPerGainPp =
    deltaTokens <= 0
      ? 0
      : input.gainPp !== null && input.gainPp > 0
        ? Math.round(deltaTokens / input.gainPp)
        : null;

  if (deltaTokens <= 0 && deltaDurationSec <= 5) {
    return {
      grade: "lean",
      baselineAvgTokens: input.baselineAvgTokens,
      variantAvgTokens: input.variantAvgTokens,
      deltaTokens,
      tokenRatio,
      baselineAvgDurationSec: input.baselineAvgDurationSec,
      variantAvgDurationSec: input.variantAvgDurationSec,
      deltaDurationSec,
      durationRatio,
      tokensPerGainPp,
      reason: "未增加 token 或耗时开销（紧凑高效）",
    };
  }

  const runawayTokens =
    tokenRatio !== null &&
    tokenRatio > COST_RUNAWAY_TOKEN_RATIO &&
    deltaTokens > COST_WARN_DELTA_TOKENS &&
    (tokensPerGainPp === null || tokensPerGainPp > COST_RUNAWAY_TOKENS_PER_PP);

  if (runawayTokens) {
    return {
      grade: "runaway",
      baselineAvgTokens: input.baselineAvgTokens,
      variantAvgTokens: input.variantAvgTokens,
      deltaTokens,
      tokenRatio,
      baselineAvgDurationSec: input.baselineAvgDurationSec,
      variantAvgDurationSec: input.variantAvgDurationSec,
      deltaDurationSec,
      durationRatio,
      tokensPerGainPp,
      reason: `成本失控：平均 token 膨胀 ${tokenRatio?.toFixed(1)}x（+${Math.round(deltaTokens).toLocaleString()} tokens/次）`,
    };
  }

  const highTokenRatio =
    tokenRatio !== null && tokenRatio > COST_WARN_TOKEN_RATIO && deltaTokens > COST_WARN_DELTA_TOKENS;
  const highUnitCost =
    tokensPerGainPp !== null &&
    tokensPerGainPp > COST_WARN_TOKENS_PER_PP &&
    deltaTokens > COST_WARN_DELTA_TOKENS;
  const highDuration =
    durationRatio !== null &&
    durationRatio > COST_WARN_DURATION_RATIO &&
    deltaDurationSec > COST_WARN_DELTA_DURATION_SEC;

  if (highTokenRatio || highUnitCost || highDuration) {
    const details: string[] = [];
    if (tokenRatio !== null) details.push(`token ${tokenRatio.toFixed(1)}x`);
    if (tokensPerGainPp !== null && tokensPerGainPp > 0) {
      details.push(`${tokensPerGainPp.toLocaleString()} tokens/pp`);
    }
    if (durationRatio !== null && durationRatio > 1.2) {
      details.push(`耗时 ${durationRatio.toFixed(1)}x`);
    }
    return {
      grade: "expensive",
      baselineAvgTokens: input.baselineAvgTokens,
      variantAvgTokens: input.variantAvgTokens,
      deltaTokens,
      tokenRatio,
      baselineAvgDurationSec: input.baselineAvgDurationSec,
      variantAvgDurationSec: input.variantAvgDurationSec,
      deltaDurationSec,
      durationRatio,
      tokensPerGainPp,
      reason: `成本偏高（${details.join("，")}）`,
    };
  }

  return {
    grade: "moderate",
    baselineAvgTokens: input.baselineAvgTokens,
    variantAvgTokens: input.variantAvgTokens,
    deltaTokens,
    tokenRatio,
    baselineAvgDurationSec: input.baselineAvgDurationSec,
    variantAvgDurationSec: input.variantAvgDurationSec,
    deltaDurationSec,
    durationRatio,
    tokensPerGainPp,
    reason: "开销温和可控",
  };
}
