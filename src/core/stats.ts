/**
 * 统计置信区间与一致性指标。
 *
 * 纯函数、零随机性（闭式解），保证重算报告 100% 确定性可复现。
 */

import { Z_95 } from "./thresholds.ts";

export interface ProportionInterval {
  /** 点估计 passed / total (0..1)。 */
  point: number;
  /** 95% Wilson 下界 (0..1)。 */
  low: number;
  /** 95% Wilson 上界 (0..1)。 */
  high: number;
  passed: number;
  total: number;
}

export interface DiffIntervalPp {
  /** (p2 - p1) 百分点。 */
  diffPp: number;
  /** 95% Newcombe-Wilson 下界（百分点）。 */
  lowPp: number;
  /** 95% Newcombe-Wilson 上界（百分点）。 */
  highPp: number;
  /** 推断方法及独立样本单位；旧独立比例区间不提供这些字段。 */
  method?: "task-hoeffding";
  independentTasks?: number;
  confidenceLevel?: number;
}

/**
 * 等权配对任务增益的保守 Hoeffding 区间。
 *
 * 每个输入是一个任务内所有预定 attempt 的平均通过率差，范围 [-1, 1]。
 * 只把任务视作独立单位，断言数量和任务内重复数均不增加 n。
 * P(|mean-E mean| >= e) <= 2 exp(-n e²/2)。假定各任务簇独立；
 * 不假定正态性，不用同一输出上的相关断言制造显著性。小套件区间会很宽。
 */
export function taskGainInterval(differences: readonly number[], alpha = 0.05): DiffIntervalPp | null {
  if (differences.length === 0 || !(alpha > 0 && alpha < 1) ||
      differences.some(d => !Number.isFinite(d) || d < -1 || d > 1)) return null;
  const point = differences.reduce((sum, d) => sum + d, 0) / differences.length;
  const radius = Math.sqrt(2 * Math.log(2 / alpha) / differences.length);
  const pp = (v: number) => Math.round(v * 100 * 1e6) / 1e6;
  return {
    diffPp: pp(point),
    lowPp: pp(Math.max(-1, point - radius)),
    highPp: pp(Math.min(1, point + radius)),
    method: "task-hoeffding",
    independentTasks: differences.length,
    confidenceLevel: 1 - alpha,
  };
}

/**
 * 二项比例的 Wilson score 置信区间（默认 95%）。
 *
 * 相比简单正态近似（Wald 区间），Wilson 区间在小样本（n=4..20）以及极端比例
 * （0% 或 100%）时不会坍缩为零宽度或越出 [0, 1]，适合评估套件规模。
 */
export function wilsonInterval(
  passed: number,
  total: number,
  z: number = Z_95,
): ProportionInterval | null {
  if (total <= 0 || passed < 0 || passed > total) return null;

  const p = passed / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const halfWidth =
    (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;

  return {
    point: p,
    low: Math.max(0, Math.min(1, center - halfWidth)),
    high: Math.max(0, Math.min(1, center + halfWidth)),
    passed,
    total,
  };
}

/**
 * 两个独立二项比例之差 (p2 - p1) 的 Newcombe-Wilson 混合置信区间（返回百分点 pp）。
 *
 * 用于度量「skill 相对 baseline 的断言通过率增益」是否统计显著（95% 下界 > 0pp）。
 */
export function newcombeDiffInterval(
  basePassed: number,
  baseTotal: number,
  variantPassed: number,
  variantTotal: number,
  z: number = Z_95,
): DiffIntervalPp | null {
  const w1 = wilsonInterval(basePassed, baseTotal, z);
  const w2 = wilsonInterval(variantPassed, variantTotal, z);
  if (!w1 || !w2) return null;

  const diff = w2.point - w1.point;
  const low =
    diff - Math.sqrt((w2.point - w2.low) ** 2 + (w1.high - w1.point) ** 2);
  const high =
    diff + Math.sqrt((w2.high - w2.point) ** 2 + (w1.point - w1.low) ** 2);

  const round = (v: number) => Math.round(v * 100 * 1e6) / 1e6;
  return {
    diffPp: round(diff),
    lowPp: round(low),
    highPp: round(high),
  };
}

/**
 * 计算评委判定与人工标注之间的 Cohen's Kappa 一致性系数。
 *
 * 返回 [-1, 1]；当两者都只取单一相同类别且 100% 一致时返回 1，空输入返回 null。
 */
export function cohensKappa<T extends string>(pairs: ReadonlyArray<readonly [T, T]>): number | null {
  const n = pairs.length;
  if (n === 0) return null;

  const categories = new Set<T>();
  let agree = 0;
  const leftCounts = new Map<T, number>();
  const rightCounts = new Map<T, number>();

  for (const [left, right] of pairs) {
    categories.add(left);
    categories.add(right);
    if (left === right) agree += 1;
    leftCounts.set(left, (leftCounts.get(left) ?? 0) + 1);
    rightCounts.set(right, (rightCounts.get(right) ?? 0) + 1);
  }

  const po = agree / n;
  let pe = 0;
  for (const cat of categories) {
    const pLeft = (leftCounts.get(cat) ?? 0) / n;
    const pRight = (rightCounts.get(cat) ?? 0) / n;
    pe += pLeft * pRight;
  }

  if (Math.abs(1 - pe) < 1e-12) {
    return agree === n ? 1 : 0;
  }

  const kappa = (po - pe) / (1 - pe);
  return Math.round(kappa * 1e6) / 1e6;
}
