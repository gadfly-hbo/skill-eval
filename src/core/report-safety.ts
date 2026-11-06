/**
 * 重算报告的安全守卫。
 *
 * `report --suite-file` 从 cases/ 下的原始 result.json 重算汇总。
 * 但入库时往往只保留 summary.json 与 REPORT.md（cases/ 体积可达 20M+，
 * 已被 .gitignore 排除）——此时重算会得到**空汇总**。
 *
 * 如果照常写盘，一份完好的报告会被空报告覆盖，且不可逆。
 * 所以重算前必须先判断：这次重算是真的没数据，还是数据被清理了？
 */

/** 重算结果的最小形态——只需知道有没有拿到运行记录。 */
export interface RecomputeOutcome {
  /** 重算后归集到的运行记录条数 */
  resultCount: number;
  /** 原摘要里已有的运行记录条数 */
  storedResultCount: number;
  /** 原摘要是否存在（不存在时视为无对照基准） */
  hasStored: boolean;
}

export interface RecomputeGuardVerdict {
  /** 是否拒绝写盘 */
  blocked: boolean;
  /** 拒绝原因（blocked 为 true 时有意义） */
  reason: string | null;
  /** 给用户看的处理建议 */
  hint: string | null;
}

/**
 * 判断这次重算是否可以安全写盘。
 *
 * 判定规则：
 * - 重算拿到记录 → 放行（正常重算路径）
 * - 重算为空且原摘要也无记录 → 放行（原摘要本来就是空的，覆盖无损失）
 * - 重算为空但原摘要有记录 → **拒绝**：cases/ 产物缺失，写盘等于用空报告覆盖好报告
 */
export function evaluateRecomputeGuard(outcome: RecomputeOutcome): RecomputeGuardVerdict {
  const { resultCount, storedResultCount, hasStored } = outcome;

  if (hasStored && resultCount > 0 && resultCount < storedResultCount) {
    return {
      blocked: true,
      reason: `原始产物不完整：仅找到 ${resultCount}/${storedResultCount} 条运行记录，不能缩小历史分母。`,
      hint: "保留原始报告；恢复缺失 cases/ 后重算，或另存标明缺失的派生复核。",
    };
  }
  if (resultCount > 0) {
    return { blocked: false, reason: null, hint: null };
  }

  if (!hasStored || storedResultCount === 0) {
    return { blocked: false, reason: null, hint: null };
  }

  return {
    blocked: true,
    reason: `没有 cases/ 原始产物，重算会得到空汇总并覆盖现有报告。原摘要含 ${storedResultCount} 条运行记录。`,
    hint:
      "两种处理方式：\n" +
      "    1. 不带 --suite-file 重新生成（沿用原 summary.json 的汇总，不重算）；\n" +
      "    2. 找回 cases/ 产物后再重算。",
  };
}
