/**
 * 增益判定：断言通过率的差值门槛。
 *
 * 背景：阴性对照实验证明，断言整体灵敏度只有 51.9%——27 条断言中 13 条
 * baseline 不装 skill 也能全过。这意味着：
 *
 * - 绝对通过率虚高：skill 完全无效时，破坏版仍能拿到 75.9%
 * - 结论不可靠：一个 `effective` 结论里可能混着大量「白送断言」
 *
 * 所以判定必须看**增益**（baseline → variant 的差值），不能看绝对值。
 * 本模块把增益门槛抽成单一真相来源，判定逻辑、归档门控与阴性对照共用同一套规则。
 *
 * 阈值取 10pp：来自阴性对照实验的判定线——原版 skill 增益 +50.0pp，
 * 契约剥离后的破坏版 +8.6pp，10pp 恰好落在两者之间，能区分「真契约有效」
 * 与「模型自发守纪律」。
 */

import { GAIN_THRESHOLD_PP } from "./thresholds.ts";
import { taskGainInterval, type DiffIntervalPp } from "./stats.ts";

/** 默认增益门槛（百分点）。 */
export const DEFAULT_GAIN_THRESHOLD_PP = GAIN_THRESHOLD_PP;

/**
 * 浮点比较容差。
 *
 * 通过率是 0-1 的小数，相减再乘 100 会引入二进制浮点误差——
 * `0.6 - 0.5` 实际是 `0.09999999999999998`，乘 100 得 9.999999999999998。
 * 不加容差的话，「恰好达到门槛」反而会被判为不达标。
 */
const FLOAT_TOLERANCE = 1e-9;

/** 增益门槛判定结果。 */
export interface GainVerdict {
  /** 是否达标。 */
  passed: boolean;
  /** 实际增益（百分点）。增益不可判定时为 null。 */
  gainPp: number | null;
  /** 使用的门槛（百分点）。 */
  thresholdPp: number;
  /** 任务等权配对增益的保守 95% 区间；描述性条目率不做独立样本推断。 */
  ciPp?: DiffIntervalPp | null;
  /** 判定说明。 */
  reason: string;
}

export interface AssertionItemCounts {
  passed: number;
  total: number;
  rate: number | null;
  /** 因 status="failed" 被排除的运行次数（避免空输出让负向断言空转通过）。 */
  skippedFailedRuns: number;
}

/**
 * 判定断言增益是否达标。
 *
 * @param baselineRate baseline 侧断言条目累计通过率（0-1）。null 表示不可判定。
 * @param variantRate skill 侧断言条目累计通过率（0-1）。null 表示不可判定。
 * @param thresholdPp 门槛（百分点），默认 10。
 */
export function evaluateGain(
  baselineRate: number | null,
  variantRate: number | null,
  thresholdPp: number = DEFAULT_GAIN_THRESHOLD_PP,
): GainVerdict {
  // 增益不可判定：任一侧没有断言数据。
  // 这类情况不能算「通过」——证据不足就是证据不足，不能默认放行。
  if (baselineRate === null || variantRate === null) {
    return {
      passed: false,
      gainPp: null,
      thresholdPp,
      ciPp: null,
      reason:
        "断言增益不可判定（缺少 baseline 或 skill 侧的断言通过率数据）。" +
        "证据不足时不能视为达标。",
    };
  }

  const gainPp = computeGainPp(baselineRate, variantRate)!;
  const passed = gainPp >= thresholdPp - FLOAT_TOLERANCE;

  return {
    passed,
    gainPp,
    thresholdPp,
    ciPp: null,
    reason: passed
      ? `断言增益 ${gainPp.toFixed(1)}pp，达到 ${thresholdPp}pp 门槛。`
      : `断言增益 ${gainPp.toFixed(1)}pp，未达到 ${thresholdPp}pp 门槛` +
        (gainPp <= 0
          ? "（不升反降，说明 skill 未带来任何断言层面的改善）。"
          : "（改善幅度不足以支撑归档结论）。"),
  };
}

/**
 * 计算断言通过率的增益（百分点）。
 *
 * 与 `evaluateGain` 分开：有些场景只需要数字，不需要判定。
 *
 * 结果会做浮点规整（消除二进制表示误差），使
 * 「0.5 → 0.6」这类边界值得到干净的 10 而不是 9.999999999999998。
 */
export function computeGainPp(
  baselineRate: number | null,
  variantRate: number | null,
): number | null {
  if (baselineRate === null || variantRate === null) return null;
  const raw = (variantRate - baselineRate) * 100;
  // 规整到 1e-9 精度，消掉二进制浮点尾差。
  return Math.round(raw * 1e9) / 1e9;
}

/**
 * 统计断言条目累计计数与通过率（排除运行失败的行）。
 *
 * 失败或超时的运行（status === "failed"）没有有效模型输出；若仍跑负向断言
 * （mustNotMatch / mustNotContain），空字符串会「成功避开」所有禁令，人为虚增通过率。
 */
export function computeAssertionItemCounts(
  results: Array<{
    variantId: string;
    status?: "success" | "failed";
    assertions?: { total: number; outcomes: Array<{ passed: boolean }> } | null;
  }>,
  variantId: string | null,
): AssertionItemCounts {
  const rows = results.filter((row) =>
    variantId === null ? true : row.variantId === variantId,
  );
  let passed = 0;
  let total = 0;
  let skippedFailedRuns = 0;

  for (const row of rows) {
    if (row.status === "failed") {
      skippedFailedRuns += 1;
      continue;
    }
    const assertions = row.assertions;
    if (!assertions || assertions.total === 0) continue;
    total += assertions.total;
    for (const outcome of assertions.outcomes) {
      if (outcome.passed) passed += 1;
    }
  }

  return {
    passed,
    total,
    rate: total > 0 ? passed / total : null,
    skippedFailedRuns,
  };
}

/**
 * 断言条目累计通过率。
 *
 * 口径：把每一次成功运行的**每一条断言**当作一个条目，累计通过数 / 累计条目数。
 */
export function computeAssertionItemRate(
  results: Array<{
    variantId: string;
    status?: "success" | "failed";
    assertions?: { total: number; outcomes: Array<{ passed: boolean }> } | null;
  }>,
  variantId: string | null,
): number | null {
  return computeAssertionItemCounts(results, variantId).rate;
}

export interface ScoringTask {
  id: string;
  kind?: "scored" | "diagnostic";
  shouldActivate?: boolean;
  assertions?: readonly unknown[];
}

export interface GainRun {
  variantId: string;
  taskId?: string;
  attempt?: number;
  status?: "success" | "failed";
  assertions?: { total: number; outcomes: Array<{ passed: boolean }> } | null;
}

export interface PairedGainVerdict extends GainVerdict {
  baselineCounts: AssertionItemCounts;
  variantCounts: AssertionItemCounts;
  /** 成功输出的条目累计描述增益，不能用于显著性门禁。 */
  itemGainPp: number | null;
  complete: boolean;
  issues: string[];
  pairedTaskCount: number;
  pairedRunCount: number;
  expectedPairs: number;
  statisticalUnit: "task";
}

/** 计分范围供报告、判定与归档共用。 */
export function isScoredTask(task: ScoringTask): boolean {
  return (task.kind ?? "scored") === "scored" && task.shouldActivate !== false;
}

/**
 * 先在每个任务内平均完整配对 attempt 的断言率差，再按任务等权。
 * 缺少冻结任务/重复次数、缺失或重复 pair、失败和断言覆盖缺口均不做完整增益推断。
 * 条目累计率仅用于描述，不让多断言任务获得更多权重或虚增独立样本数。
 */
export function evaluateGainFromResults(
  results: GainRun[],
  variantId: string,
  thresholdPp: number = DEFAULT_GAIN_THRESHOLD_PP,
  tasks?: readonly ScoringTask[],
  expectedRepeat?: number,
): PairedGainVerdict {
  const issues: string[] = [];
  const scopedTasks = tasks?.filter(isScoredTask) ?? [];
  const ids = new Set(scopedTasks.map(t => t.id));
  if (!tasks) issues.push("缺少冻结任务范围，无法确认计分样本");
  if (scopedTasks.length === 0) issues.push("没有计分任务");
  if (ids.size !== scopedTasks.length) issues.push("冻结任务 ID 重复");
  const repeatValid = Number.isInteger(expectedRepeat) && expectedRepeat! > 0;
  if (!repeatValid) issues.push("缺少有效冻结重复次数");
  const rows = results.filter(r =>
    (r.variantId === "baseline" || r.variantId === variantId) &&
    (!tasks || (r.taskId !== undefined && ids.has(r.taskId))),
  );
  const baselineCounts = computeAssertionItemCounts(rows, "baseline");
  const variantCounts = computeAssertionItemCounts(rows, variantId);
  const itemGainPp = computeGainPp(baselineCounts.rate, variantCounts.rate);
  const index = new Map<string, GainRun[]>();
  for (const row of rows) {
    if (!row.taskId || !Number.isInteger(row.attempt) || row.attempt! < 1 ||
        (repeatValid && row.attempt! > expectedRepeat!)) {
      issues.push("运行缺少有效 taskId/attempt 或超出冻结重复范围");
      continue;
    }
    const key = JSON.stringify([row.taskId, row.attempt, row.variantId]);
    const entries = index.get(key) ?? [];
    entries.push(row);
    index.set(key, entries);
  }
  const taskDiffs: number[] = [];
  let pairedRunCount = 0;
  if (repeatValid) for (const task of scopedTasks) {
    const differences: number[] = [];
    for (let attempt = 1; attempt <= expectedRepeat!; attempt++) {
      const base = index.get(JSON.stringify([task.id, attempt, "baseline"])) ?? [];
      const variant = index.get(JSON.stringify([task.id, attempt, variantId])) ?? [];
      if (base.length !== 1 || variant.length !== 1) {
        issues.push(`${task.id}/${attempt} 缺失或重复配对运行`);
        continue;
      }
      const valid = (row: GainRun) => row.status === "success" && row.assertions &&
        row.assertions.total > 0 && row.assertions.outcomes.length === row.assertions.total &&
        (task.assertions === undefined || row.assertions.total === task.assertions.length);
      if (!valid(base[0]!) || !valid(variant[0]!) || base[0]!.assertions!.total !== variant[0]!.assertions!.total) {
        issues.push(`${task.id}/${attempt} 失败或断言覆盖不完整`);
        continue;
      }
      const rate = (row: GainRun) => row.assertions!.outcomes.filter(o => o.passed).length / row.assertions!.total;
      differences.push(rate(variant[0]!) - rate(base[0]!));
      pairedRunCount++;
    }
    if (differences.length === expectedRepeat) {
      taskDiffs.push(differences.reduce((sum, value) => sum + value, 0) / differences.length);
    }
  }
  const complete = issues.length === 0;
  const ciPp = complete ? taskGainInterval(taskDiffs) : null;
  const gainPp = ciPp?.diffPp ?? null;
  const passed = complete && gainPp !== null && gainPp >= thresholdPp - FLOAT_TOLERANCE;
  return {
    passed,
    gainPp,
    thresholdPp,
    reason: complete
      ? `任务等权配对增益 ${gainPp?.toFixed(1)}pp；独立任务 ${taskDiffs.length} 个，使用保守 95% Hoeffding 区间（假定任务簇独立）。`
      : `配对增益不可判定：${issues.join("；")}`,
    ciPp,
    baselineCounts,
    variantCounts,
    itemGainPp,
    complete,
    issues,
    pairedTaskCount: taskDiffs.length,
    pairedRunCount,
    expectedPairs: repeatValid ? scopedTasks.length * expectedRepeat! : 0,
    statisticalUnit: "task",
  };
}
