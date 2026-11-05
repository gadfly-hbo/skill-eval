/**
 * 对照实验污染检测。
 *
 * ## 要防的问题
 *
 * baseline 变体的唯一设定是「不加载 skill」。但模型的 cwd 是
 * `<runRoot>/cases/<variant>/<task>/<n>/`，它可以向上 `find`、也可以读
 * `<runRoot>` 下的任何文件。若运行目录里存在 `suite.json`（内含
 * `skill.path` 绝对路径），模型就会顺着路径读到被测 skill 全文，
 * 于是 baseline 也拿到了 skill 的行为契约——
 *
 * **对照实验的唯一变量被破坏，增益会被系统性压低。**
 *
 * 实测（data-analysis，2026-11-05）：baseline 第 2 次重复里模型
 * 自行 `find` 到运行目录的 `suite.json`，读到 `skill.path` 后
 * 依次 read 了 SKILL.md / references/method.md / references/sample-data.md /
 * scripts/calc.py / scripts/quality_check.py，并按 skill 的脚本口径重写报告。
 * 同一次运行的第 1 次重复完全干净——这是随机行为，必须靠检测而非靠假设。
 *
 * ## 判定口径
 *
 * 污染 = baseline 侧读取了**被测 skill 目录内的任何文件**，
 * 或读取了**能指向 skill 路径的元数据文件**（如 suite.json）。
 *
 * 不看关键词、不看输出内容——只看工具调用的**路径取证**，
 * 与激活判定同一口径（证据优先于文本匹配）。
 */

/** 一次运行的污染判定结果。 */
export interface ContaminationReport {
  /** 是否检出污染。 */
  contaminated: boolean;
  /** 命中的文件路径（已去重）。 */
  hits: string[];
  /** 命中的原因分类。 */
  reasons: ContaminationReason[];
}

export type ContaminationReason =
  /** baseline 侧读到了被测 skill 目录内的文件。 */
  | "skill-file-read"
  /** baseline 侧读到了含 skill 路径的元数据文件（suite.json 等）。 */
  | "metadata-file-read";

/**
 * 判断一个读取路径是否位于被测 skill 目录内。
 *
 * 用「目录前缀」判断而非简单字符串包含——后者会把
 * `.../data-analysis-extra/x.md` 误判为在 `.../data-analysis/` 内。
 */
export function isInsideSkillDir(readPath: string, skillDir: string): boolean {
  const normalizedRead = normalizePath(readPath);
  const normalizedDir = normalizePath(skillDir);
  if (!normalizedRead || !normalizedDir) return false;
  return normalizedRead === normalizedDir || normalizedRead.startsWith(`${normalizedDir}/`);
}

/**
 * 判断一个读取路径是否是「会泄漏 skill 路径的元数据文件」。
 *
 * 这类文件本身不含契约，但含 `skill.path` 绝对路径，模型顺着它就能
 * 定位被测 skill。实测 data-analysis 的污染就是从读 `suite.json` 开始的。
 */
export function isMetadataFile(readPath: string): boolean {
  const base = basename(normalizePath(readPath));
  return base === "suite.json" || base === "suite.yaml" || base === "suite.yml";
}

/**
 * 检测一次 baseline 运行是否发生污染。
 *
 * @param readPaths 本次运行所有 read 工具调用的路径
 * @param skillPath 被测 skill 的 SKILL.md 路径（空字符串表示跳过 skill 目录检查）
 * @param skillDir 被测 skill 所在目录（空字符串表示跳过 skill 目录检查）
 */
export function detectContamination(
  readPaths: string[],
  skillPath: string,
  skillDir: string,
): ContaminationReport {
  const hits = new Set<string>();
  const reasons = new Set<ContaminationReason>();

  for (const raw of readPaths) {
    const path = typeof raw === "string" ? raw : String(raw);
    if (!path) continue;

    if (skillDir && isInsideSkillDir(path, skillDir)) {
      hits.add(path);
      reasons.add("skill-file-read");
      continue;
    }

    if (isMetadataFile(path)) {
      hits.add(path);
      reasons.add("metadata-file-read");
    }
  }

  return {
    contaminated: hits.size > 0,
    hits: [...hits],
    reasons: [...reasons],
  };
}

/** 去掉路径末尾斜杠，保证目录前缀判断不受写法影响。 */
function normalizePath(path: string): string {
  let p = path.trim();
  if (!p) return "";
  // 去掉末尾的斜杠（但保留根目录）
  while (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** 取路径最后一段。 */
function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? "";
}
