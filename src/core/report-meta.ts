/**
 * 报告元信息的回填与继承。
 *
 * `report` 子命令重新生成报告时，候选身份（被测 skill 路径、内容哈希、版本标识、
 * 套件标识与版本）需要从外部传入。这些信息只存在于原始 REPORT.md 里——
 * summary.json 不存它们（那会重复 skill 路径，且各次运行可能对应不同 skill）。
 *
 * 结果：不带参数重生成报告会把这些字段写成「（未记录）」，等于抹掉了一份报告
 * 里最有价值的溯源信息——读者再也无法知道这份结论测的是哪个文件。
 *
 * 这里从已有 REPORT.md 反解回来，作为缺省值。
 */

/** 从 REPORT.md 解析出的候选身份 */
export interface RecoveredMeta {
  skillPath: string | null;
  skillHash: string | null;
  skillVersion: string | null;
  suiteId: string | null;
  suiteVersion: string | null;
  suiteHash?: string | null;
  /** pi 隔离 HOME（运行配置表里的一行） */
  piHome: string | null;
}

const EMPTY_META: RecoveredMeta = {
  skillPath: null,
  skillHash: null,
  skillVersion: null,
  suiteId: null,
  suiteVersion: null,
  suiteHash: null,
  piHome: null,
};

/**
 * 从报告正文反解候选身份。
 *
 * 报告里的对应行形如：
 * - `| 被测 skill | \`/path/to/SKILL.md\` |`
 * - `| 内容哈希 | \`sha256:abc123\` |`
 * - `| 版本标识 | 1.8.0 |`
 * - `| 套件 | my-suite (v2) |`
 * - `| pi 隔离 HOME | \`/tmp/pi-home\` |`
 *
 * 解析失败一律返回 null（调用方决定用不用「（未记录）」），
 * 不猜测、不抛错——元信息缺失不该阻断报告生成。
 */
export function recoverMetaFromReport(reportText: string): RecoveredMeta {
  const meta: RecoveredMeta = { ...EMPTY_META };

  const skillPath = matchCell(reportText, "被测 skill");
  if (skillPath !== null) {
    const value = stripBackticks(skillPath).trim();
    meta.skillPath = isPlaceholder(value) ? null : value;
  }

  const skillHash = matchCell(reportText, "内容哈希");
  if (skillHash !== null) {
    const value = stripBackticks(skillHash).trim();
    meta.skillHash = isPlaceholder(value) ? null : value;
  }

  const skillVersion = matchCell(reportText, "版本标识");
  if (skillVersion !== null) {
    const value = skillVersion.trim();
    meta.skillVersion = isPlaceholder(value) ? null : value;
  }

  const suite = matchCell(reportText, "套件");
  if (suite !== null) {
    const parsed = parseSuiteCell(suite);
    meta.suiteId = parsed.id;
    meta.suiteVersion = parsed.version;
  }

  const suiteHash = matchCell(reportText, "套件哈希");
  if (suiteHash !== null) {
    const value = stripBackticks(suiteHash).trim();
    meta.suiteHash = isPlaceholder(value) ? null : value;
  }

  const piHome = matchCell(reportText, "pi 隔离 HOME");
  if (piHome !== null) {
    const value = stripBackticks(piHome).trim();
    // 「—」表示当时没用隔离 HOME，不算有效值
    meta.piHome = value === "—" || value === "" ? null : value;
  }

  return meta;
}

/**
 * 合并元信息：显式传入的优先，回填的作为缺省。
 *
 * 「（未记录）」视为未提供——它是报告里的占位符，不是真实值。
 */
export function mergeMeta(
  explicit: Partial<RecoveredMeta>,
  recovered: RecoveredMeta,
): RecoveredMeta {
  const pick = (a: string | null | undefined, b: string | null): string | null => {
    if (a === undefined || a === null) return b;
    if (a === "" || a === "（未记录）") return b;
    return a;
  };

  return {
    skillPath: pick(explicit.skillPath, recovered.skillPath),
    skillHash: pick(explicit.skillHash, recovered.skillHash),
    skillVersion: pick(explicit.skillVersion, recovered.skillVersion),
    suiteId: pick(explicit.suiteId, recovered.suiteId),
    suiteVersion: pick(explicit.suiteVersion, recovered.suiteVersion),
    suiteHash: pick(explicit.suiteHash, recovered.suiteHash ?? null),
    piHome: pick(explicit.piHome, recovered.piHome),
  };
}

/**
 * 解析表格单元：精确匹配 `| <标签> | <值> |` 这样的行并取出值部分（避免「套件」误匹配「套件哈希」）。
 */
function matchCell(text: string, label: string): string | null {
  const pattern = new RegExp(`^\\|\\s*${escapeRegExp(label)}\\s*\\|(.+)\\|\\s*$`, "m");
  const match = pattern.exec(text);
  return match?.[1]?.trim() ?? null;
}

/**
 * 解析「套件」单元：`my-suite (v2)` → id=my-suite, version=2；
 * `my-suite` → id=my-suite, version=null。
 */
function parseSuiteCell(cell: string): { id: string | null; version: string | null } {
  const value = stripBackticks(cell).trim();
  const match = /^(.*?)\s*\(v(.+?)\)$/.exec(value);
  if (match) {
    const id = match[1]?.trim();
    const version = match[2]?.trim();
    return {
      id: id && id !== "（未记录）" ? id : null,
      version: version && version !== "（未记录）" ? version : null,
    };
  }
  return { id: value && value !== "（未记录）" ? value : null, version: null };
}

function stripBackticks(value: string): string {
  return value.replace(/^`+|`+$/g, "");
}

/**
 * 占位符判定：「（未记录）」「—」「未知」都不是真实值。
 *
 * 报告里这些是「当时没记录到」的占位，回填时必须当作没有，
 * 否则会用「（未记录）」覆盖真正显式传入的值。
 */
function isPlaceholder(value: string): boolean {
  return value === "" || value === "（未记录）" || value === "—" || value === "未知";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
