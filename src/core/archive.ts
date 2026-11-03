/**
 * 通过测评的 skill 归档。
 *
 * 用途：把一次评估中被判定为 `effective` 的 skill 快照存进版本库，
 * 让「这份 skill 为什么值得信」有据可查、可回滚、可复现。
 *
 * 设计约束：
 * - 归档必须绑定**某一次评估的产物**，不能只凭 skill 路径——否则无法确定
 *   对应的 verdict 与内容哈希，会产生第二套判定逻辑。
 * - 归档目录必须**自包含**：skill 树 + ARCHIVE.md 元信息卡 + 复制的评估报告。
 *   报告不能只给引用，因为运行目录通常在 `.gitignore` 内，引用在 git 上不可达。
 * - 幂等：内容哈希相同则跳过，不产生重复归档。
 * - 安全：目标路径不得落在 `skills/` 下——归档区一旦进入 skill 自动扫描路径，
 *   会污染后续评估（见 AGENTS.md 反作弊一节）。
 */

import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

/** 归档结论等级。与 CLI 的 decideVerdict 保持一致。 */
export type ArchiveVerdict = "effective" | "ineffective" | "inconclusive";

/** 复制时跳过的噪声文件与目录。 */
export const ARCHIVE_EXCLUDES = new Set([
  ".DS_Store",
  "node_modules",
  "__pycache__",
  ".git",
  ".venv",
  "venv",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
]);

/**
 * 复制时跳过的具体文件。
 *
 * 平台元数据描述的是 skill 在某个商店里的上架信息，不属于 skill 本身，
 * 归档进去会造成版本污染（同一 skill 在不同平台的元数据不同）。
 */
export const ARCHIVE_EXCLUDE_FILES = new Set(["_skillhub_meta.json"]);

/** 复制时跳过的文件后缀。 */
const ARCHIVE_EXCLUDE_SUFFIXES = [".log", ".pyc", ".swp", ".tmp"];

/** 归档元信息：来自一次评估的产物。 */
export interface ArchiveInput {
  /** 运行目录。 */
  runDir: string;
  /** 运行标识。 */
  runId: string;
  /** 被测 skill 源路径（SKILL.md）。 */
  skillPath: string;
  /** skill 内容哈希，与评估报告一致。 */
  skillHash: string;
  /** 评估结论。 */
  verdict: ArchiveVerdict;
  /** 结论说明。 */
  verdictReason: string;
  /** 被评模型。 */
  model: string;
  /** 评委模型。 */
  judgeModel: string;
  /** 套件标识。 */
  suiteId: string;
  /** 套件版本。 */
  suiteVersion: string;
  /** skill 版本标识（来自 frontmatter 或套件）。 */
  skillVersion: string;
  /** 激活率。 */
  activationRate: number;
  /** 胜率。 */
  winRate: number | null;
  /** baseline 断言条目累计通过率。 */
  baselineAssertionRate: number | null;
  /** skill 侧断言条目累计通过率。 */
  variantAssertionRate: number | null;
  /** 断言条目累计总数（baseline + skill 两侧）。 */
  assertionTotal: number;
  /** baseline 侧「整轮全过率」——每次运行的断言全部通过才算过。 */
  baselineAllPassedRate: number | null;
  /** skill 侧「整轮全过率」。 */
  variantAllPassedRate: number | null;
  /** 评估报告路径。 */
  reportPath: string;
  /** 归档时间。 */
  archivedAt: string;
  /** 复现命令。 */
  reproduceCommand: string;
}

/** 归档结果。 */
export interface ArchiveResult {
  /** 归档根目录。 */
  archiveRoot: string;
  /** 本次版本目录。 */
  versionDir: string;
  /** 版本标识。 */
  version: string;
  /** 是否因内容哈希相同而跳过。 */
  skipped: boolean;
  /** 是否为 provisional（结论不足但被放行）。 */
  provisional: boolean;
  /** 复制的文件数。 */
  fileCount: number;
  /** 跳过的噪声条目数。 */
  skippedNoise: number;
}

/** 归档选项。 */
export interface ArchiveOptions {
  /** 运行目录。 */
  runDir: string;
  /** 被测 skill 源路径。 */
  skillPath: string;
  /** 归档根目录。默认 `<仓库>/archive`。 */
  archiveRoot: string;
  /** 仓库根目录，用于安全校验与元信息卡记录。 */
  repoRoot?: string | undefined;
  /** 显式版本标识。为空则按 frontmatter 版本 + 时间戳生成。 */
  version?: string | undefined;
  /** 放行 `inconclusive` 结论。 */
  allowInconclusive?: boolean;
  /** 现在时间戳（毫秒），便于测试注入。 */
  now?: number | undefined;
}

/** 计算文件内容哈希，与报告中的格式一致。 */
export function hashSkillFile(path: string): string {
  if (!existsSync(path)) return "missing";
  const content = readFileSync(path);
  return `sha256:${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;
}

/**
 * 从 SKILL.md 的 frontmatter 读取 version 字段。
 *
 * 只做最朴素的行扫描——frontmatter 是 YAML，但这里不需要完整解析，
 * 只需要 `version: xxx` 这一行。
 */
export function readFrontmatterVersion(skillPath: string): string | null {
  if (!existsSync(skillPath)) return null;
  const content = readFileSync(skillPath, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) return null;
  const versionLine = match[1].match(/^\s*version\s*:\s*["']?([^"'\n]+?)["']?\s*$/m);
  return versionLine?.[1]?.trim() ?? null;
}

/** 把时间戳格式化为 `YYYYMMDD-HHMM`。 */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}`
  );
}

/**
 * 生成版本标识。
 *
 * 规则：`<frontmatter版本>__<时间戳>`；frontmatter 没有版本时退化为纯时间戳。
 */
export function buildVersion(skillPath: string, now: number): string {
  const stamp = formatTimestamp(now);
  const fm = readFrontmatterVersion(skillPath);
  return fm ? `${fm}__${stamp}` : stamp;
}

/** 判断条目是否属于应跳过的噪声。 */
export function isNoise(name: string): boolean {
  if (ARCHIVE_EXCLUDES.has(name)) return true;
  if (ARCHIVE_EXCLUDE_FILES.has(name)) return true;
  return ARCHIVE_EXCLUDE_SUFFIXES.some((suffix) => name.endsWith(suffix));
}

/**
 * 递归复制 skill 树，跳过噪声文件。
 *
 * 返回复制的文件数与跳过的噪声条目数。
 */
export function copySkillTree(srcDir: string, destDir: string): { fileCount: number; skippedNoise: number } {
  let fileCount = 0;
  let skippedNoise = 0;

  mkdirSync(destDir, { recursive: true });

  const walk = (src: string, dest: string) => {
    mkdirSync(dest, { recursive: true });
    const entries = readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      if (isNoise(entry.name)) {
        skippedNoise += 1;
        continue;
      }
      const from = join(src, entry.name);
      const to = join(dest, entry.name);
      if (entry.isDirectory()) {
        walk(from, to);
      } else if (entry.isFile()) {
        cpSync(from, to);
        fileCount += 1;
      }
    }
  };

  walk(srcDir, destDir);
  return { fileCount, skippedNoise };
}

/**
 * 安全校验：归档目标不得落在 skill 自动扫描路径内。
 *
 * `skills/` 下的目录会被 pi / Claude Code / Codex 自动发现，
 * 归档内容一旦进入那里，就会污染后续评估（见 AGENTS.md 反作弊一节）。
 *
 * 检查归档根目录的**每一段路径**，而不只是相对某个仓库根的 `skills/`——
 * 否则用户直接传 `--archive-root <某处>/skills/x` 时校验会被绕过。
 */
export function assertArchiveTargetSafe(versionDir: string, repoRoot?: string | undefined): void {
  const target = resolve(versionDir);

  // 路径任一段名为 skills 即视为落在扫描路径内。
  const segments = target.split(sep);
  if (segments.includes("skills")) {
    throw new Error(
      `归档目标位于 skills/ 下，会被 agent 自动扫描并污染评估：${target}\n` +
        "  请改用 <仓库>/archive/ 或其它不含 skills 段的路径。",
    );
  }

  // 若已知仓库根，额外确认没有落在其 skills/ 下（覆盖符号链接等边界情况）。
  if (repoRoot) {
    const skillsDir = resolve(join(repoRoot, "skills"));
    const rel = relative(skillsDir, target);
    const insideSkills = rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep));
    if (insideSkills) {
      throw new Error(`归档目标位于 skills/ 下，会被 agent 自动扫描并污染评估：${target}`);
    }
  }
}

/**
 * 脱敏绝对路径中的用户目录。
 *
 * 归档会进版本库并可能公开，源路径里的用户名（`/Users/<name>/...`）属于个人信息，
 * 替换成 `~` 保留可读性同时不泄露身份。
 */
export function redactHomePath(path: string): string {
  const home = process.env.HOME ?? "";
  if (home && home.length > 1 && path.startsWith(home)) {
    return `~${path.slice(home.length)}`;
  }
  // 兜底：匹配任意 /Users/<name> 前缀（HOME 未设置或路径已被搬过）。
  return path.replace(/^\/Users\/[^/]+/, "~");
}

/**
 * 把文本中的用户目录脱敏。
 *
 * 报告里记录了被测 skill 路径、pi 隔离 HOME、证据目录，都带用户名。
 * 归档会进版本库且可能公开，必须脱敏。
 */
export function redactHomeInText(text: string): string {
  const home = process.env.HOME ?? "";
  let out = text;
  if (home && home.length > 1) {
    out = out.split(home).join("~");
  }
  // 通用模式也要应用——正文里可能出现别的用户目录（如报告里记录的旧路径）。
  return out.replace(/\/Users\/[^/\s`|)]+/g, "~");
}

/**
 * 生成归档版报告：脱敏 + 把证据目录改写为归档内相对位置。
 *
 * 原始报告里的「证据目录」指向运行产物目录（常在 .gitignore 内），
 * 归档里这份报告的证据应指向同目录的 ARCHIVE.md。
 */
export function renderArchivedReport(reportText: string): string {
  let text = redactHomeInText(reportText);
  // 证据目录行改写：指向归档目录自身。
  text = text.replace(/\| 证据目录 \| `[^`]*` \|/, "| 证据目录 | 本目录（归档快照，证据见同目录 ARCHIVE.md） |");
  text = text.replace(
    /证据目录 `[^`]*`/g,
    "证据目录 `本目录`",
  );
  return text;
}

/** 渲染 ARCHIVE.md 元信息卡。 */
export function renderArchiveCard(input: ArchiveInput, version: string): string {
  const lines: string[] = [];
  const pct = (v: number | null) => (v === null ? "不可判定" : `${(v * 100).toFixed(1)}%`);
  const gain =
    input.baselineAssertionRate !== null && input.variantAssertionRate !== null
      ? `${((input.variantAssertionRate - input.baselineAssertionRate) * 100).toFixed(1)} pp`
      : "不可判定";
  const sourcePath = redactHomePath(input.skillPath);

  lines.push(`# 归档：${basename(dirname(input.skillPath))} ${version}`);
  lines.push("");
  lines.push("> 本目录是某次评估中被判定为通过（`effective`）的 skill 快照。");
  lines.push("> 快照内容与被测内容逐字节一致，内容哈希见下表。");
  lines.push("");

  lines.push("## 身份");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("|---|---|");
  lines.push(`| 版本标识 | \`${version}\` |`);
  lines.push(`| skill 版本 | ${input.skillVersion} |`);
  lines.push(`| 源路径 | \`${sourcePath}\` |`);
  lines.push(`| 内容哈希 | \`${input.skillHash}\` |`);
  lines.push(`| 归档时间 | ${input.archivedAt} |`);
  lines.push(`| 运行标识 | \`${input.runId}\` |`);
  lines.push("");

  lines.push("## 评估结论");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("|---|---|");
  lines.push(`| 结论 | **${input.verdict}** |`);
  lines.push(`| 结论说明 | ${input.verdictReason} |`);
  lines.push(`| 激活率 | ${pct(input.activationRate)} |`);
  lines.push(`| 胜率 | ${pct(input.winRate)} |`);
  lines.push(
    `| 断言通过率（条目累计） | baseline ${pct(input.baselineAssertionRate)} → skill ${pct(input.variantAssertionRate)}（增益 ${gain}） |`,
  );
  lines.push(
    `| 断言通过率（整轮全过） | baseline ${pct(input.baselineAllPassedRate)} → skill ${pct(input.variantAllPassedRate)} |`,
  );
  lines.push(`| 断言判定总数 | ${input.assertionTotal} |`);
  lines.push("");
  lines.push(
    "> 两种断言口径都列出：条目累计口径用于增益比较，整轮全过口径是 `variantSummaries` 里的字段。",
  );
  lines.push("");

  lines.push("## 运行配置");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("|---|---|");
  lines.push(`| 套件 | \`${input.suiteId}\`（版本 ${input.suiteVersion}） |`);
  lines.push(`| 被评模型 | \`${input.model}\` |`);
  lines.push(`| 评委模型 | \`${input.judgeModel}\` |`);
  lines.push("");

  lines.push("## 复现方式");
  lines.push("");
  lines.push("```bash");
  lines.push(input.reproduceCommand);
  lines.push("```");
  lines.push("");
  lines.push("评估报告见同目录 `REPORT.md`。");
  lines.push("");

  return lines.join("\n");
}

/** 读取运行目录的 summary.json。 */
function loadSummary(runDir: string): Record<string, unknown> {
  const p = join(runDir, "summary.json");
  if (!existsSync(p)) throw new Error(`找不到运行摘要：${p}`);
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
}

/**
 * 从一次评估的产物中收集归档元信息。
 *
 * verdict 由调用方传入（复用 CLI 的 decideVerdict），这里只做提取，
 * 不重新实现判定逻辑——避免出现第二套真相来源。
 */
export function collectArchiveInput(options: {
  runDir: string;
  skillPath: string;
  verdict: ArchiveVerdict;
  verdictReason: string;
  suiteId?: string | undefined;
  suiteVersion?: string | undefined;
  skillVersion?: string | undefined;
  now?: number | undefined;
}): ArchiveInput {
  const summary = loadSummary(options.runDir);
  const variants = (summary.variantSummaries ?? []) as Array<Record<string, unknown>>;
  const variant = variants.find((v) => v.variantId !== "baseline");

  const now = options.now ?? Date.now();
  const skillHash = hashSkillFile(options.skillPath);
  const frontmatterVersion = readFrontmatterVersion(options.skillPath);
  const reportPath = join(options.runDir, "REPORT.md");

  const model = String(summary.model ?? "未标注");
  const judgeModel = String(summary.judgeModel ?? "未标注");

  // 断言统计有两种口径，必须都算清楚：
  // 1. 条目累计通过率 = 通过的断言条目数 / 断言条目总数（阴性对照实验用此口径）
  // 2. 整轮全过率 = 断言全过的运行次数 / 运行次数（variantSummaries 用此口径）
  // 只报一个会让读者与另一处数据对不上。
  const results = (summary.results ?? []) as Array<Record<string, unknown>>;
  const sumAssertions = (variantId: string | null) => {
    const rows = variantId
      ? results.filter((r) => r.variantId === variantId)
      : results.filter((r) => r.variantId !== "baseline");
    let total = 0;
    let passed = 0;
    let allPassedRuns = 0;
    let countedRuns = 0;
    for (const r of rows) {
      const a = r.assertions as { total?: number; passed?: number; allPassed?: boolean } | null | undefined;
      if (!a || !a.total) continue;
      total += a.total;
      passed += a.passed ?? 0;
      countedRuns += 1;
      if (a.allPassed) allPassedRuns += 1;
    }
    return {
      rate: total ? passed / total : null,
      total,
      allPassedRate: countedRuns ? allPassedRuns / countedRuns : null,
    };
  };

  const base = sumAssertions("baseline");
  const skillSide = sumAssertions(null);

  const suiteMeta = (summary.suiteMeta ?? {}) as Record<string, unknown>;

  const reproduceCommand =
    `skill-eval eval --suite <套件.json> --skill ${redactHomePath(options.skillPath)} ` +
    `--model ${model} --judge-model ${judgeModel} --out <运行目录>`;

  return {
    runDir: options.runDir,
    runId: String(summary.runId ?? "未标注"),
    skillPath: options.skillPath,
    skillHash,
    verdict: options.verdict,
    verdictReason: options.verdictReason,
    model,
    judgeModel,
    suiteId:
      options.suiteId ?? String(suiteMeta.suiteId ?? "未标注（归档时未提供 --suite）"),
    suiteVersion:
      options.suiteVersion ?? String(suiteMeta.suiteVersion ?? "未标注"),
    skillVersion:
      options.skillVersion ?? String(suiteMeta.skillVersion ?? frontmatterVersion ?? "未标注"),
    activationRate: Number(variant?.activationRate ?? 0),
    winRate: typeof variant?.winRate === "number" ? variant.winRate : null,
    baselineAssertionRate: base.rate,
    variantAssertionRate: skillSide.rate,
    assertionTotal: base.total + skillSide.total,
    baselineAllPassedRate: base.allPassedRate,
    variantAllPassedRate: skillSide.allPassedRate,
    reportPath,
    archivedAt: new Date(now).toISOString(),
    reproduceCommand,
  };
}

/**
 * 执行归档。
 *
 * 幂等：目标版本目录已存在且内容哈希相同则跳过。
 * 同名不同内容：不覆盖原目录，改用 `-r2`、`-r3` 后缀另起一版。
 */
export function archiveSkill(options: ArchiveOptions & { input: ArchiveInput }): ArchiveResult {
  const { input, archiveRoot, repoRoot } = options;
  const now = options.now ?? Date.now();

  const skillDir = dirname(resolve(options.skillPath));
  const skillName = basename(skillDir);
  const baseVersion = options.version ?? buildVersion(options.skillPath, now);

  const skillArchiveRoot = join(archiveRoot, skillName);

  // 安全校验必须总是执行——不能因为没传 repoRoot 就跳过。
  assertArchiveTargetSafe(join(skillArchiveRoot, baseVersion), repoRoot);

  // 选一个不冲突的版本目录：同名同哈希 → 幂等跳过；同名不同哈希 → 加后缀。
  let version = baseVersion;
  let versionDir = join(skillArchiveRoot, version);
  let skipped = false;

  if (existsSync(join(versionDir, "ARCHIVE.md"))) {
    const existing = readFileSync(join(versionDir, "ARCHIVE.md"), "utf8");
    if (existing.includes(input.skillHash)) {
      skipped = true;
    } else {
      let suffix = 2;
      while (existsSync(join(skillArchiveRoot, `${baseVersion}-r${suffix}`))) {
        suffix += 1;
      }
      version = `${baseVersion}-r${suffix}`;
      versionDir = join(skillArchiveRoot, version);
    }
  }

  if (skipped) {
    return {
      archiveRoot: skillArchiveRoot,
      versionDir,
      version,
      skipped: true,
      provisional: input.verdict === "inconclusive",
      fileCount: 0,
      skippedNoise: 0,
    };
  }

  mkdirSync(versionDir, { recursive: true });

  const { fileCount, skippedNoise } = copySkillTree(skillDir, versionDir);

  // 复制评估报告，让归档目录自包含（运行目录常在 .gitignore 内）。
  // 同时脱敏用户目录、改写证据目录——归档可能进公开仓库。
  if (existsSync(input.reportPath)) {
    const reportText = readFileSync(input.reportPath, "utf8");
    writeFileSync(join(versionDir, "REPORT.md"), renderArchivedReport(reportText), "utf8");
  }

  writeFileSync(join(versionDir, "ARCHIVE.md"), renderArchiveCard(input, version), "utf8");

  // 写 latest 索引（纯文本，避免符号链接的跨平台问题）。
  writeFileSync(
    join(skillArchiveRoot, "latest.json"),
    JSON.stringify(
      {
        skill: skillName,
        version,
        skillHash: input.skillHash,
        verdict: input.verdict,
        provisional: input.verdict === "inconclusive",
        archivedAt: input.archivedAt,
        runId: input.runId,
        path: relative(archiveRoot, versionDir),
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    archiveRoot: skillArchiveRoot,
    versionDir,
    version,
    skipped: false,
    provisional: input.verdict === "inconclusive",
    fileCount,
    skippedNoise,
  };
}

/** 判断某个路径是否为空目录或不存在。 */
export function isEmptyDir(path: string): boolean {
  if (!existsSync(path)) return true;
  if (!statSync(path).isDirectory()) return true;
  return readdirSync(path).length === 0;
}

/** 清理空目录（递归自底向上）。 */
export function pruneEmptyDirs(root: string): number {
  let removed = 0;
  const walk = (dir: string): boolean => {
    let allEmpty = true;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(p)) {
          rmSync(p, { recursive: true, force: true });
          removed += 1;
        } else {
          allEmpty = false;
        }
      } else {
        allEmpty = false;
      }
    }
    return allEmpty;
  };
  if (existsSync(root)) walk(root);
  return removed;
}
