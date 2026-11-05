/**
 * 断言灵敏度与区分度诊断。
 *
 * 阴性对照实验表明：若一条断言在 baseline（不装 skill）下通过率已经 ≥ 80%，
 * 说明模型本来就能满足该要求，该断言对「skill 是否有效」不具备区分能力（白送断言）。
 * 当某个用例的全部断言都属于白送断言时，该用例在客观规则层面对评估是「零区分度」的。
 */

import { INSENSITIVE_BASELINE_PASS_RATE } from "./thresholds.ts";
import type { Assertion } from "./assertions.ts";
import type { EvaluationSummary, EvalTask } from "./runner.ts";

export interface AssertionSensitivityItem {
  taskId: string;
  assertionIndex: number;
  kind: Assertion["kind"];
  note: string;
  baselinePassed: number;
  baselineTotal: number;
  baselinePassRate: number | null;
  variantPassed: number;
  variantTotal: number;
  variantPassRate: number | null;
  deltaPp: number | null;
  /** baseline 通过率 ≥ 80%，属于无区分度（白送）断言。 */
  insensitive: boolean;
}

export interface AssertionSensitivityReport {
  totalAssertions: number;
  sensitiveCount: number;
  insensitiveCount: number;
  /** 有区分度的断言占比（sensitiveCount / totalAssertions）。 */
  sensitivityRate: number | null;
  /** 全部断言在 baseline 下均 ≥ 80% 通过的「零区分度用例」列表。 */
  zeroDiscriminationTasks: string[];
  items: AssertionSensitivityItem[];
}

export function analyzeAssertionSensitivity(
  summary: EvaluationSummary,
  tasks?: EvalTask[],
): AssertionSensitivityReport {
  const taskMap = new Map<string, EvalTask>();
  for (const t of tasks ?? []) {
    taskMap.set(t.id, t);
  }

  // 按 (taskId, assertionIndex) 聚合
  const bucketMap = new Map<
    string,
    {
      taskId: string;
      assertionIndex: number;
      kind: Assertion["kind"];
      note: string;
      baselinePassed: number;
      baselineTotal: number;
      variantPassed: number;
      variantTotal: number;
    }
  >();

  for (const row of summary.results) {
    if (row.status === "failed") continue;
    if (!row.assertions || row.assertions.outcomes.length === 0) continue;

    const isBaseline = row.variantId === "baseline";
    const taskDef = taskMap.get(row.taskId);

    row.assertions.outcomes.forEach((outcome, index) => {
      const key = `${row.taskId}::${index}`;
      const defAssertion = taskDef?.assertions?.[index];
      const fallbackNote =
        outcome.note ??
        defAssertion?.note ??
        ("pattern" in (defAssertion ?? {})
          ? String((defAssertion as { pattern?: string }).pattern ?? "")
          : "value" in (defAssertion ?? {})
            ? String((defAssertion as { value?: string }).value ?? "")
            : `${outcome.kind}#${index + 1}`);

      let bucket = bucketMap.get(key);
      if (!bucket) {
        bucket = {
          taskId: row.taskId,
          assertionIndex: index,
          kind: outcome.kind,
          note: fallbackNote,
          baselinePassed: 0,
          baselineTotal: 0,
          variantPassed: 0,
          variantTotal: 0,
        };
        bucketMap.set(key, bucket);
      }

      if (isBaseline) {
        bucket.baselineTotal += 1;
        if (outcome.passed) bucket.baselinePassed += 1;
      } else {
        bucket.variantTotal += 1;
        if (outcome.passed) bucket.variantPassed += 1;
      }
    });
  }

  const items: AssertionSensitivityItem[] = [];
  const byTask = new Map<string, AssertionSensitivityItem[]>();

  for (const bucket of bucketMap.values()) {
    const baselinePassRate =
      bucket.baselineTotal > 0 ? bucket.baselinePassed / bucket.baselineTotal : null;
    const variantPassRate =
      bucket.variantTotal > 0 ? bucket.variantPassed / bucket.variantTotal : null;
    const deltaPp =
      baselinePassRate !== null && variantPassRate !== null
        ? Math.round((variantPassRate - baselinePassRate) * 100 * 1e6) / 1e6
        : null;
    const insensitive =
      baselinePassRate !== null && baselinePassRate >= INSENSITIVE_BASELINE_PASS_RATE - 1e-9;

    const item: AssertionSensitivityItem = {
      taskId: bucket.taskId,
      assertionIndex: bucket.assertionIndex,
      kind: bucket.kind,
      note: bucket.note,
      baselinePassed: bucket.baselinePassed,
      baselineTotal: bucket.baselineTotal,
      baselinePassRate,
      variantPassed: bucket.variantPassed,
      variantTotal: bucket.variantTotal,
      variantPassRate,
      deltaPp,
      insensitive,
    };
    items.push(item);

    const list = byTask.get(bucket.taskId) ?? [];
    list.push(item);
    byTask.set(bucket.taskId, list);
  }

  const zeroDiscriminationTasks: string[] = [];
  for (const [taskId, taskItems] of byTask) {
    if (taskItems.length > 0 && taskItems.every((item) => item.insensitive)) {
      zeroDiscriminationTasks.push(taskId);
    }
  }

  const totalAssertions = items.length;
  const insensitiveCount = items.filter((item) => item.insensitive).length;
  const sensitiveCount = totalAssertions - insensitiveCount;

  return {
    totalAssertions,
    sensitiveCount,
    insensitiveCount,
    sensitivityRate: totalAssertions > 0 ? sensitiveCount / totalAssertions : null,
    zeroDiscriminationTasks,
    items,
  };
}
