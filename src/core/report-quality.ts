/**
 * 报告质量的守恒守卫。
 *
 * 问题：`report --suite-file` 在缺少元信息时会把被测 skill 路径、哈希、
 * 版本、套件名统统写成「（未记录）」。这份**降级报告**一旦被复制到
 * 别处（实验入库、归档），就会把原有的完整版覆盖掉——而且因为两个文件
 * 内容合法，不会触发任何报错，只是悄悄变差了。
 *
 * 典型现场：阴性对照实验的完整报告（含 skill 名、模型、评委轮次）
 * 被源目录里一份「重算后元信息丢失」的报告覆盖，读者从此看到的是
 * 一份看不出评的是什么的报告。
 *
 * 原则：**降级不得覆盖完整**。质量只能向上，不能向下。
 */

/** 元信息丢失时写入的占位符。 */
export const DEGRADED_MARKER = "（未记录）";

/**
 * 判断一份报告是否为降级版（元信息丢失）。
 *
 * 判定依据：
 * - 标题行含占位符 → 连被测 skill 名都没了，一定是降级版
 * - 全文占位符出现 ≥3 次 → 元信息表大面积丢失，视为降级版
 *
 * 阈值取 3：正常报告最多在个别说明性字段里出现 1-2 处占位符。
 */
export function isDegradedReport(text: string): boolean {
  const titleLine = text.split("\n")[0] ?? "";
  if (titleLine.includes(DEGRADED_MARKER)) return true;
  const hits = text.split(DEGRADED_MARKER).length - 1;
  return hits >= 3;
}

export interface QualityGuardVerdict {
  /** 是否拒绝覆盖（true 表示应保留目标原有文件） */
  blocked: boolean;
  /** 拒绝原因（blocked 为 true 时有意义） */
  reason: string | null;
}

/**
 * 判断能否用 `incoming` 覆盖 `existing`。
 *
 * 规则：
 * - 目标不存在 → 放行（没有可丢失的东西）
 * - 源不是降级版 → 放行（正常覆盖）
 * - 源是降级版但目标也是降级版 → 放行（覆盖同级，不损失）
 * - 源是降级版、目标是完整版 → **拒绝**：不让降级品覆盖完整品
 */
export function evaluateOverwriteGuard(
  incoming: string,
  existing: string | null,
): QualityGuardVerdict {
  if (existing === null) {
    return { blocked: false, reason: null };
  }
  if (!isDegradedReport(incoming)) {
    return { blocked: false, reason: null };
  }
  if (isDegradedReport(existing)) {
    return { blocked: false, reason: null };
  }
  return {
    blocked: true,
    reason: "源报告为降级版（元信息缺失），目标已是完整版，拒绝覆盖。",
  };
}
