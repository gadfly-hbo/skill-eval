/**
 * 回归门禁。
 *
 * 移植自 pi-xanthil 的 `skill-regression.ts`，剥离数据库依赖。
 *
 * 用途：skill 改版后判断「新版是否比旧版更好」，防止改了更差。
 *
 * 两个维度：
 * - score：胜率（win / (win + tie + loss)）
 * - activationRate：激活率
 *
 * 门禁是**严格接受**：分数必须严格优于当前版本，平局不算改进。
 */

export interface RegressionThresholds {
  /** 胜率最大允许下降幅度。默认 0.1。 */
  scoreDrop: number;
  /** 激活率最大允许下降幅度。默认 0.2。 */
  activationRateDrop: number;
}

export const DEFAULT_THRESHOLDS: RegressionThresholds = {
  scoreDrop: 0.1,
  activationRateDrop: 0.2,
};

export interface EvalMetrics {
  score: number | null;
  activationRate: number | null;
}

export interface EvalHistoryEntry {
  evaluationId: string;
  skillVersion: string;
  model: string;
  timestamp: number;
  metrics: EvalMetrics;
  /** 触发原因。 */
  trigger?: string;
}

export interface RegressionComparison {
  regressionStatus: "regression" | "none" | "unknown";
  regressionReason: string | null;
  scoreDelta: number | null;
  activationDelta: number | null;
  previous: EvalHistoryEntry | null;
}

/**
 * 严格接受门。
 *
 * candidate 必须严格优于 current 才接受，平局判 reject。
 */
export function strictGate(
  candidateScore: number | null,
  currentScore: number | null,
): { accepted: boolean; reason: string } {
  if (candidateScore === null) {
    return { accepted: false, reason: "候选分数为 null" };
  }
  if (currentScore === null) {
    return { accepted: true, reason: "无当前版本基线" };
  }
  if (candidateScore > currentScore) {
    return { accepted: true, reason: `候选 ${candidateScore} > 当前 ${currentScore}` };
  }
  return {
    accepted: false,
    reason: `候选 ${candidateScore} 未严格优于当前 ${currentScore}（严格接受门要求严格大于）`,
  };
}

/**
 * 比较当前指标与历史指标，检测回归。
 */
export function compareRegression(
  current: EvalMetrics,
  previous: EvalHistoryEntry | null,
  thresholds: RegressionThresholds = DEFAULT_THRESHOLDS,
): RegressionComparison {
  if (!previous) {
    return {
      regressionStatus: "unknown",
      regressionReason: "无历史基线，无法比较",
      scoreDelta: null,
      activationDelta: null,
      previous: null,
    };
  }

  const scoreDelta =
    current.score !== null && previous.metrics.score !== null ? current.score - previous.metrics.score : null;
  const activationDelta =
    current.activationRate !== null && previous.metrics.activationRate !== null
      ? current.activationRate - previous.metrics.activationRate
      : null;

  const reasons: string[] = [];
  if (scoreDelta !== null && scoreDelta <= -thresholds.scoreDrop) {
    reasons.push(`胜率下降 ${formatDelta(scoreDelta)}（阈值 -${thresholds.scoreDrop}）`);
  }
  if (activationDelta !== null && activationDelta <= -thresholds.activationRateDrop) {
    reasons.push(`激活率下降 ${formatDelta(activationDelta)}（阈值 -${thresholds.activationRateDrop}）`);
  }

  return {
    regressionStatus: reasons.length > 0 ? "regression" : "none",
    regressionReason: reasons.length > 0 ? reasons.join("；") : null,
    scoreDelta,
    activationDelta,
    previous,
  };
}

/** 解析阈值输入，非法值回落到默认。 */
export function parseThresholds(raw: unknown): RegressionThresholds {
  const body =
    typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const source =
    typeof body.thresholds === "object" && body.thresholds !== null
      ? (body.thresholds as Record<string, unknown>)
      : body;

  return {
    scoreDrop: parseThreshold(source.scoreDrop, DEFAULT_THRESHOLDS.scoreDrop),
    activationRateDrop: parseThreshold(source.activationRateDrop, DEFAULT_THRESHOLDS.activationRateDrop),
  };
}

function parseThreshold(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

function formatDelta(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
