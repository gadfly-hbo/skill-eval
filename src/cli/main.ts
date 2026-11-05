#!/usr/bin/env node
/**
 * skill-eval 命令行入口。
 *
 * 子命令：
 *   eval       执行对照评估并生成报告
 *   check      校验套件文件（不调用模型）
 *   report     从已有运行产物重新生成报告
 *   threshold  查看或设置回归门禁阈值
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve, join, isAbsolute, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { runEvaluation, recomputeSummary, newRunId, type EvalTask, type Variant, type EvaluationSummary } from "../core/runner.ts";
import { renderReport, hashFile, type ReportMeta } from "../report/markdown.ts";
import { DEFAULT_THRESHOLDS, parseThresholds, type RegressionThresholds } from "../core/regression.ts";
import { expandTilde } from "../core/paths.ts";
import { evaluateGain, DEFAULT_GAIN_THRESHOLD_PP } from "../core/gain.ts";
import { evaluateRecomputeGuard } from "../core/report-safety.ts";
import { recoverMetaFromReport, mergeMeta } from "../core/report-meta.ts";
import {
  pendingRootFor,
  registerPending,
  readPendingState,
  prunePendingAfterArchive,
  ensurePendingRoot,
} from "../core/pending.ts";
import { toPendingJson } from "../core/pending-json.ts";
import { detectRepoRoot as detectRepoRootCore } from "../core/repo-detect.ts";
import {
  archiveSkill,
  collectArchiveInput,
  type ArchiveResult,
} from "../core/archive.ts";

interface SuiteFile {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  skill?: { path?: string; version?: string; note?: string };
  contextPrefix?: string;
  repeat?: number;
  judgeRepeat?: number;
  tasks: EvalTask[];
}

interface CliArgs {
  command: string;
  flags: Record<string, string | boolean>;
}

/** 解析命令行参数。支持 `--key value` 与 `--key=value`。 */
export function parseArgs(argv: string[]): CliArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]!;
    if (!token.startsWith("--")) continue;

    const body = token.slice(2);
    if (body.includes("=")) {
      const [key, ...valueParts] = body.split("=");
      flags[key!] = valueParts.join("=");
      continue;
    }

    const next = rest[i + 1];
    if (next && !next.startsWith("--")) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }

  return { command, flags };
}

function flagString(flags: Record<string, string | boolean>, key: string): string | undefined {
  const value = flags[key];
  return typeof value === "string" ? value : undefined;
}

function flagNumber(flags: Record<string, string | boolean>, key: string): number | undefined {
  const value = flagString(flags, key);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function printHelp(): void {
  process.stdout.write(`skill-eval — 独立评估 Agent Skill 的激活率与实际增益

用法：
  skill-eval eval --suite <套件.json> --skill <SKILL.md> [选项]
  skill-eval check --suite <套件.json>
  skill-eval report --run <运行目录>
  skill-eval archive --run <运行目录> --skill <SKILL.md>
  skill-eval threshold [--score-drop <n>] [--activation-rate-drop <n>]

eval 选项：
  --suite <path>          评估套件定义（必填）
  --skill <path>          被测 SKILL.md 路径（可覆盖套件中的设置）
  --model <id>            被评模型，如 provider/model（可覆盖套件）
  --judge-model <id>      评委模型（默认同被评模型）
  --repeat <n>            每用例重复次数（默认取套件值或 3）
  --judge-repeat <n>      评委轮数，≥2 启用位置偏好探测（默认 1）
  --out <dir>             输出目录（默认 runs/<run-id>）
  --home <dir>            pi 隔离 HOME，避免污染全局配置
  --context <text>        附加上下文前缀（覆盖套件）
  --no-keyword-signal     关闭关键词弱证据，仅用工具调用取证
  --timeout <ms>          单次运行超时
  --judge-timeout <ms>    评委单次超时（默认 300000，评委思考链比被评模型长）
  --archive-to <dir>      评估后把通过测评的 skill 归档到该仓库（默认归档到 <dir>/archive）
  --archive-root <dir>    覆盖归档根目录（配合 --archive-to 使用）
  --archive-version <id>  指定归档版本标识（默认 <frontmatter版本>__<时间戳>）
  --allow-inconclusive    允许归档「结论不足」的评估（配合 --archive-to 使用）
  --allow-low-gain        允许归档断言增益未达标的评估（配合 --archive-to 使用）
  --gain-threshold <pp>   增益门槛（百分点，默认 10）

check 选项：
  --suite <path>          仅校验套件结构，不调用模型

report 选项：
  --run <dir>             从已有运行产物重新生成报告
  --suite-file <path>     提供套件定义，从原始产物重算汇总（推荐）
  --suite <id>            套件标识（仅写入报告元信息）
  --skill <path>          被测 skill 路径（仅写入报告元信息）

archive 选项：
  --run <dir>             评估运行目录（必填，提供 verdict 与元信息）
  --skill <path>          被测 SKILL.md 路径（可从运行产物推断）
  --archive-root <dir>    归档根目录（默认 <仓库>/archive）
  --repo <dir>            仓库根目录（用于安全校验，默认自动探测）
  --version <id>          显式版本标识（默认 <frontmatter版本>__<时间戳>）
  --allow-inconclusive    放行「结论不足」的评估，默认拒绝
  --allow-low-gain        放行断言增益未达标的评估，默认拒绝
  --gain-threshold <pp>   增益门槛（百分点，默认 10）
  --force                 忽略 verdict 强制归档（用于诊断，不建议）
  --pending-root <dir>    待测评暂存区（默认 <仓库>/pending）

pending 选项：
  --repo <dir>            仓库根目录（默认自动探测）
  --skill <path>          登记该 skill 到待测评区；不给则列出待测 skill
  --pending-root <dir>    待测评暂存区（默认 <仓库>/pending）
  --init                  只创建暂存区目录（方便先把 skill 文件夹拖进去）
  --json                  输出 JSON（给 agent 解析用）

  待测评区是常驻目录：skill 文件夹可以直接拖进去，不一定要用 --skill 登记。

产物布局：
  <out>/cases/<variant>/<task>/<attempt>/  单次运行证据（events.json / output.md / result.json）
  <out>/pairwise/<variant>-<task>-<attempt>/ 评委产物（forward / reversed，各含 output.md / prompt.md / events.json）
  <out>/summary.json      运行摘要
  <out>/REPORT.md         评估报告
`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "eval":
      return await commandEval(args);
    case "check":
      return commandCheck(args);
    case "report":
      return await commandReport(args);
    case "archive":
      return await commandArchive(args);
    case "pending":
      return commandPending(args);
    case "threshold":
      return commandThreshold(args);
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      process.stderr.write(`未知命令: ${args.command}\n\n`);
      printHelp();
      return 1;
  }
}

/** 加载并校验套件。 */
function loadSuite(suitePath: string): SuiteFile {
  const absolute = resolve(suitePath);
  if (!existsSync(absolute)) {
    throw new Error(`套件文件不存在: ${absolute}`);
  }
  const parsed = JSON.parse(readFileSync(absolute, "utf8")) as SuiteFile;

  if (!parsed.id) throw new Error("套件缺少 id 字段");
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("套件缺少 tasks 或 tasks 为空");
  }
  const seen = new Set<string>();
  for (const task of parsed.tasks) {
    if (!task.id) throw new Error("存在缺少 id 的用例");
    if (seen.has(task.id)) throw new Error(`用例 id 重复: ${task.id}`);
    seen.add(task.id);
    if (!task.prompt || !task.prompt.trim()) throw new Error(`用例 ${task.id} 缺少 prompt`);
  }

  return parsed;
}

function commandCheck(args: CliArgs): number {
  const suitePath = flagString(args.flags, "suite");
  if (!suitePath) {
    process.stderr.write("缺少 --suite\n");
    return 1;
  }

  try {
    const suite = loadSuite(suitePath);
    const assertionCount = suite.tasks.reduce((acc, task) => acc + (task.assertions?.length ?? 0), 0);
    const scoredCount = suite.tasks.filter((task) => (task.kind ?? "scored") === "scored").length;
    const diagnosticCount = suite.tasks.length - scoredCount;

    process.stdout.write(`套件校验通过：${suite.id}\n`);
    process.stdout.write(`  用例总数：${suite.tasks.length}（计分 ${scoredCount} / 诊断 ${diagnosticCount}）\n`);
    process.stdout.write(`  断言条数：${assertionCount}\n`);
    if (suite.repeat) process.stdout.write(`  重复次数：${suite.repeat}\n`);
    if (suite.judgeRepeat) process.stdout.write(`  评委轮数：${suite.judgeRepeat}\n`);

    if (assertionCount === 0) {
      process.stdout.write("\n⚠️ 该套件没有规则断言，将完全依赖模型评委判定，可信度较弱。\n");
    }
    return 0;
  } catch (error) {
    process.stderr.write(`套件校验失败：${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function commandEval(args: CliArgs): Promise<number> {
  const suitePath = flagString(args.flags, "suite");
  if (!suitePath) {
    process.stderr.write("缺少 --suite\n");
    return 1;
  }

  const suite = loadSuite(suitePath);
  const suiteDir = dirname(resolve(suitePath));

  // 被测 skill 路径：命令行优先于套件。
  const skillFlag = flagString(args.flags, "skill");
  const skillFromSuite = suite.skill?.path
    ? isAbsolute(expandTilde(suite.skill.path))
      ? expandTilde(suite.skill.path)
      : resolve(suiteDir, expandTilde(suite.skill.path))
    : undefined;
  const skillPath = skillFlag ? resolve(expandTilde(skillFlag)) : skillFromSuite;

  if (!skillPath) {
    process.stderr.write("缺少被测 skill 路径：用 --skill 指定，或在套件中设置 skill.path\n");
    return 1;
  }
  if (!existsSync(skillPath)) {
    process.stderr.write(`被测 skill 不存在: ${skillPath}\n`);
    return 1;
  }

  const model = flagString(args.flags, "model") ?? process.env.SKILL_EVAL_MODEL;
  if (!model) {
    process.stderr.write("缺少被评模型：用 --model 指定，或设置 SKILL_EVAL_MODEL 环境变量\n");
    return 1;
  }

  const repeat = flagNumber(args.flags, "repeat") ?? suite.repeat ?? 3;
  const judgeRepeat = flagNumber(args.flags, "judge-repeat") ?? suite.judgeRepeat ?? 1;
  const judgeModel = flagString(args.flags, "judge-model") ?? process.env.SKILL_EVAL_JUDGE_MODEL ?? model;
  const timeoutMs = flagNumber(args.flags, "timeout");
  const judgeTimeoutMs = flagNumber(args.flags, "judge-timeout");
  const keywordSignal = args.flags["no-keyword-signal"] !== true;
  const contextPrefix = flagString(args.flags, "context") ?? suite.contextPrefix;
  const piHome = flagString(args.flags, "home") ?? process.env.SKILL_EVAL_PI_HOME ?? undefined;

  const runId = newRunId();
  const outDir = flagString(args.flags, "out") ? resolve(flagString(args.flags, "out")!) : resolve("runs", runId);
  mkdirSync(outDir, { recursive: true });

  const variants: Variant[] = [
    { id: "baseline", label: "Baseline（不装 skill）", skillPaths: [] },
    { id: "skill", label: `Skill（${suite.skill?.version ?? "当前版本"}）`, skillPaths: [skillPath] },
  ];

  const totalRuns = variants.length * suite.tasks.length * repeat;
  process.stderr.write(
    `开始评估：${suite.id}\n` +
      `  被测 skill：${skillPath}\n` +
      `  模型：${model}（评委：${judgeModel}）\n` +
      `  用例 ${suite.tasks.length} × 变体 ${variants.length} × 重复 ${repeat} = ${totalRuns} 次运行\n` +
      `  评委轮数：${judgeRepeat}\n` +
      `  输出：${outDir}\n\n`,
  );

  const summary = await runEvaluation({
    runRoot: outDir,
    runId,
    model,
    judgeModel,
    variants,
    tasks: suite.tasks,
    repeat,
    judgeRepeat,
    contextPrefix,
    home: piHome,
    keywordSignal,
    timeoutMs,
    judgeTimeoutMs,
    onProgress: (event) => {
      process.stderr.write(`  [${event.phase}] ${event.message}\n`);
    },
  });

  // 落盘运行摘要，便于重新生成报告。
  summary.suiteMeta = {
    suiteId: suite.id,
    suiteVersion: suite.version ?? "未标注",
    skillVersion: suite.skill?.version ?? "未标注",
    skillPath,
  };
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const meta: ReportMeta = {
    skillPath,
    skillHash: hashFile(skillPath),
    skillVersion: suite.skill?.version ?? "未标注",
    suiteId: suite.id,
    suiteVersion: suite.version ?? "未标注",
    runRoot: outDir,
    piHome: piHome ?? null,
    generatedAt: new Date().toISOString(),
  };

  const verdict = decideVerdict(summary);
  const report = renderReport({
    summary,
    meta,
    tasks: suite.tasks,
    variants,
    verdict: verdict.verdict,
    verdictReason: verdict.reason,
  });

  const reportPath = join(outDir, "REPORT.md");
  writeFileSync(reportPath, report, "utf8");

  process.stderr.write(`\n报告已生成：${reportPath}\n`);

  // 可选：把通过测评的 skill 归档进仓库。
  // 传 --archive-to <仓库根> 即启用；不传则 eval 行为与从前完全一致。
  const archiveTo = flagString(args.flags, "archive-to");
  if (archiveTo) {
    const repoRoot = resolve(archiveTo);
    const archiveRoot = flagString(args.flags, "archive-root")
      ? resolve(flagString(args.flags, "archive-root")!)
      : join(repoRoot, "archive");

    process.stderr.write(`\n归档到 ${repoRoot} …\n`);
    const outcome = performArchive({
      runDir: outDir,
      skillPath,
      summary,
      decision: verdict,
      archiveRoot,
      repoRoot,
      version: flagString(args.flags, "archive-version"),
      allowInconclusive: args.flags["allow-inconclusive"] === true,
      force: false,
      suiteId: suite.id,
      suiteVersion: suite.version,
      skillVersion: suite.skill?.version,
      gainThresholdPp: flagNumber(args.flags, "gain-threshold"),
      allowLowGain: args.flags["allow-low-gain"] === true,
    });

    // 归档失败不影响评估结论——评估本身已经成功，报告已落盘。
    if (outcome.ok && outcome.result && outcome.input) {
      printArchiveResult(outcome.result, outcome.input, verdict.verdict);
      // 归档成功后，把该 skill 从待测评暂存区移出（与 archive 子命令同一套逻辑）。
      prunePendingAfterArchiveSkill(outcome.result, repoRoot, args);
    } else {
      process.stderr.write("归档未完成，评估结论不受影响。\n");
    }
  }

  process.stdout.write(`${verdict.verdict}\n${verdict.reason}\n`);

  return summary.status === "failed" ? 1 : 0;
}

/**
 * 判定结论。
 *
 * 判定要求：激活率达标 **且** 胜率有实质提升。
 * 只满足其一 → 结论不足。
 */
function decideVerdict(summary: EvaluationSummary): { verdict: "effective" | "ineffective" | "inconclusive"; reason: string } {
  const variant = summary.variantSummaries.find((item) => item.variantId !== "baseline");
  if (!variant) {
    return { verdict: "inconclusive", reason: "没有可判定的 variant" };
  }

  if (variant.total === 0) {
    return { verdict: "inconclusive", reason: "没有运行记录" };
  }

  const activationOk = variant.activationRate >= 0.6;
  const winRate = variant.winRate;
  const winOk = winRate !== null && winRate >= 0.6;

  if (variant.activationRate === 0 && (winRate === null || winRate === 0)) {
    return {
      verdict: "ineffective",
      reason: `skill 从未被模型读取（激活率 0%），且未观察到任何相对 baseline 的改善。该 skill 在当前用例集下不产生实际价值。`,
    };
  }

  if (activationOk && winOk) {
    return {
      verdict: "effective",
      reason: `激活率 ${(variant.activationRate * 100).toFixed(1)}%（触发稳定），胜率 ${((winRate ?? 0) * 100).toFixed(1)}%（有实质提升）。该 skill 在当前用例集下有效。`,
    };
  }

  if (!activationOk && !winOk) {
    return {
      verdict: "ineffective",
      reason: `激活率 ${(variant.activationRate * 100).toFixed(1)}% 未达 60% 门槛，胜率 ${winRate === null ? "不可判定" : `${(winRate * 100).toFixed(1)}%`} 未达 60% 门槛。skill 未产生稳定可观测的价值。`,
    };
  }

  return {
    verdict: "inconclusive",
    reason: `激活率 ${(variant.activationRate * 100).toFixed(1)}%、胜率 ${winRate === null ? "不可判定" : `${(winRate * 100).toFixed(1)}%`}，两项未同时达标。建议用更多重复次数与多轮评委复核。`,
  };
}

/**
 * 从已有运行产物重新生成报告。
 *
 * 汇总一律从 cases/ 与 pairwise/ 的原始产物重算，不复用 summary.json 里的旧汇总——
 * 否则汇总逻辑修正后，旧报告仍会显示已知错误。
 */
async function commandReport(args: CliArgs): Promise<number> {
  const runDir = flagString(args.flags, "run");
  if (!runDir) {
    process.stderr.write("缺少 --run\n");
    return 1;
  }

  const absolute = resolve(runDir);
  const summaryPath = join(absolute, "summary.json");
  if (!existsSync(summaryPath)) {
    process.stderr.write(`未找到运行摘要：${summaryPath}\n`);
    return 1;
  }

  const stored = JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary;

  // 套件定义决定用例与断言，必须由用户提供以正确重算。
  const suitePath = flagString(args.flags, "suite-file");
  let tasks: EvalTask[];
  let variants: Variant[];
  // 套件元信息用于报告的「套件」栏位与标题——取 id 字段，不是文件路径。
  let loadedSuite: SuiteFile | undefined;

  if (suitePath) {
    const suite = loadSuite(suitePath);
    loadedSuite = suite;
    const suiteDir = dirname(resolve(suitePath));
    const skillPath = suite.skill?.path
      ? isAbsolute(suite.skill.path)
        ? suite.skill.path
        : resolve(suiteDir, suite.skill.path)
      : undefined;
    tasks = suite.tasks;
    variants = [
      { id: "baseline", label: "Baseline（不装 skill）", skillPaths: [] },
      { id: "skill", label: `Skill（${suite.skill?.version ?? "当前版本"}）`, skillPaths: skillPath ? [skillPath] : [] },
    ];
  } else {
    // 未提供套件时，从旧摘要还原最小信息（仅供重新渲染，不重算断言）。
    tasks = (stored.taskSummaries ?? []).map(
      (task): EvalTask => ({ id: task.taskId, prompt: "", kind: task.kind }),
    );
    variants = (stored.variantSummaries ?? []).map(
      (item): Variant => ({ id: item.variantId, label: item.variantLabel, skillPaths: [] }),
    );
  }

  const summary = suitePath ? await recomputeSummary(absolute, { variants, tasks }) : stored;

  // 守卫：重算依赖 cases/ 下的原始产物。产物缺失（已清理、只入了库 summary.json）
  // 时重算会得到空汇总，若照常写盘就会用空报告覆盖掉原本完好的报告。
  // 这是不可逆的数据丢失，必须拒绝而不是静默降级。
  if (suitePath) {
    const guard = evaluateRecomputeGuard({
      resultCount: summary.results.length,
      storedResultCount: stored?.results?.length ?? 0,
      hasStored: Boolean(stored),
    });
    if (guard.blocked) {
      process.stderr.write(
        `拒绝重算：${absolute}\n  ${guard.reason}\n  ${guard.hint}\n`,
      );
      return 1;
    }
  }

  // 候选身份回填：显式传入的优先，否则从已有 REPORT.md 反解。
  // 没有这一步，重生成报告会把「被测 skill / 内容哈希 / 版本 / 套件」全写成
  // 「（未记录）」——读者再也无法知道这份结论测的是哪个文件。
  const existingReportPath = join(absolute, "REPORT.md");
  const recovered = existsSync(existingReportPath)
    ? recoverMetaFromReport(readFileSync(existingReportPath, "utf8"))
    : recoverMetaFromReport("");

  const merged = mergeMeta(
    {
      skillPath: flagString(args.flags, "skill"),
      skillHash: flagString(args.flags, "skill-hash"),
      skillVersion: flagString(args.flags, "skill-version"),
      // 套件标识取套件文件里的 id 字段，不是套件文件的路径。
      // 此前直接用路径，报告标题会变成
      // 「# Skill 评估报告：/Users/.../suite.json」——既难读，也泄漏本地路径。
      suiteId: loadedSuite?.id,
      suiteVersion: flagString(args.flags, "suite-version") ?? loadedSuite?.version,
      piHome: flagString(args.flags, "home"),
    },
    recovered,
  );

  const meta: ReportMeta = {
    skillPath: merged.skillPath ?? "（未记录）",
    skillHash: merged.skillHash ?? "（未记录）",
    skillVersion: merged.skillVersion ?? "（未记录）",
    suiteId: merged.suiteId ?? "（未记录）",
    suiteVersion: merged.suiteVersion ?? "（未记录）",
    runRoot: absolute,
    piHome: merged.piHome ?? null,
    generatedAt: new Date().toISOString(),
  };

  const decision = decideVerdict(summary);
  const report = renderReport({
    summary,
    meta,
    tasks,
    variants,
    verdict: decision.verdict,
    verdictReason: decision.reason,
  });

  const reportPath = join(absolute, "REPORT.md");
  writeFileSync(reportPath, report, "utf8");
  process.stdout.write(`报告已重新生成：${reportPath}\n`);
  process.stdout.write(`${decision.verdict}\n${decision.reason}\n`);
  return 0;
}

/**
 * 执行归档的核心流程。
 *
 * `archive` 子命令与 `eval --archive-to` 共用此函数——
 * 两条入口必须走同一套门控与写入逻辑，否则会出现「手动归档能过、
 * 自动归档被拒」这种行为不一致。
 */
function performArchive(options: {
  runDir: string;
  skillPath: string;
  summary: EvaluationSummary;
  decision: { verdict: "effective" | "ineffective" | "inconclusive"; reason: string };
  archiveRoot: string;
  repoRoot: string | null;
  version?: string | undefined;
  allowInconclusive: boolean;
  force: boolean;
  suiteId?: string | undefined;
  suiteVersion?: string | undefined;
  skillVersion?: string | undefined;
  /** 增益门槛（百分点）。默认 10。 */
  gainThresholdPp?: number | undefined;
  /** 放行增益不达标。 */
  allowLowGain?: boolean | undefined;
}): { ok: boolean; result?: ArchiveResult; input?: ReturnType<typeof collectArchiveInput> } {
  const { decision } = options;

  // 门控：只有「有效」才归档。「结论不足」需显式放行，「无效」永不放行。
  if (!options.force) {
    if (decision.verdict === "ineffective") {
      process.stderr.write(
        `拒绝归档：评估结论为「无效」。\n  ${decision.reason}\n` +
          "  被证伪的 skill 不应进入归档区。可用 --force 强制归档（仅用于诊断）。\n",
      );
      return { ok: false };
    }
    if (decision.verdict === "inconclusive" && !options.allowInconclusive) {
      process.stderr.write(
        `拒绝归档：评估结论为「结论不足」。\n  ${decision.reason}\n` +
          "  如确认 skill 本身可用（如只是重复次数偏小），加 --allow-inconclusive 放行，\n" +
          "  归档后会在 latest.json 中标记 provisional=true。\n",
      );
      return { ok: false };
    }
  }

  const input = collectArchiveInput({
    runDir: options.runDir,
    skillPath: options.skillPath,
    verdict: decision.verdict,
    verdictReason: decision.reason,
    suiteId: options.suiteId,
    suiteVersion: options.suiteVersion,
    skillVersion: options.skillVersion,
  });

  // 增益门槛：光有「有效」结论不够，还要断言层面的改善确实存在。
  //
  // 阴性对照实验证明断言整体灵敏度只有 51.9%——skill 完全无效时通过率仍可达
  // 75.9%。只看结论等级会把「模型本来就能做对」误当成 skill 的功劳。
  const thresholdPp = options.gainThresholdPp ?? DEFAULT_GAIN_THRESHOLD_PP;
  const gainCheck = evaluateGain(input.baselineAssertionRate, input.variantAssertionRate, thresholdPp);
  if (!gainCheck.passed && !options.allowLowGain && !options.force) {
    process.stderr.write(
      `拒绝归档：断言增益未达标。\n  ${gainCheck.reason}\n` +
        `  门槛 ${thresholdPp}pp 来自阴性对照实验——原版 skill +50.0pp，契约剥离后仅 +8.6pp。\n` +
        "  确认 skill 确实带来了改善时，加 --allow-low-gain 放行，\n" +
        "  归档后会在 latest.json 中标记 lowGain=true。\n",
    );
    return { ok: false };
  }

  let result: ArchiveResult;
  try {
    result = archiveSkill({
      input,
      runDir: options.runDir,
      skillPath: options.skillPath,
      archiveRoot: options.archiveRoot,
      repoRoot: options.repoRoot ?? undefined,
      version: options.version,
      allowInconclusive: options.allowInconclusive,
      gainCheck,
    });
  } catch (error) {
    process.stderr.write(`归档失败：${error instanceof Error ? error.message : String(error)}\n`);
    return { ok: false };
  }

  return { ok: true, result, input };
}

/** 打印归档结果。 */
function printArchiveResult(
  result: ArchiveResult,
  input: { skillHash: string; gainCheck?: { passed: boolean; gainPp: number | null; thresholdPp: number } },
  verdict: string,
): void {
  if (result.skipped) {
    process.stdout.write(`已存在同内容版本，跳过：${result.versionDir}\n`);
    return;
  }
  process.stdout.write(`归档完成：${result.versionDir}\n`);
  process.stdout.write(`  版本标识：${result.version}\n`);
  const flags = [result.provisional ? "provisional" : "", result.lowGain ? "low-gain" : ""]
    .filter(Boolean)
    .join(" / ");
  process.stdout.write(`  结论：${verdict}${flags ? `（${flags}）` : ""}\n`);
  if (input.gainCheck) {
    const g = input.gainCheck.gainPp === null ? "不可判定" : `${input.gainCheck.gainPp.toFixed(1)} pp`;
    process.stdout.write(
      `  增益门槛：${g}（门槛 ${input.gainCheck.thresholdPp} pp）${input.gainCheck.passed ? "达标" : "未达标·已放行"}\n`,
    );
  }
  process.stdout.write(`  复制文件：${result.fileCount} 个（跳过噪声 ${result.skippedNoise} 项）\n`);
  process.stdout.write(`  内容哈希：${input.skillHash}\n`);
  process.stdout.write(`  索引：${join(result.archiveRoot, "latest.json")}\n`);
}

/**
 * 归档一次通过的评估。
 *
 * 以 `--run` 为主入口——归档必须绑定某一次评估的产物，只给 skill 路径
 * 无法确定对应的 verdict 与内容哈希。verdict 复用 decideVerdict，
 * 不产生第二套判定逻辑。
 */
async function commandArchive(args: CliArgs): Promise<number> {
  const runDir = flagString(args.flags, "run");
  if (!runDir) {
    process.stderr.write("缺少 --run\n");
    return 1;
  }

  const absoluteRun = resolve(runDir);
  const summaryPath = join(absoluteRun, "summary.json");
  if (!existsSync(summaryPath)) {
    process.stderr.write(`未找到运行摘要：${summaryPath}\n`);
    return 1;
  }

  const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary;

  // 被测 skill 路径：命令行优先，否则从运行产物的 skillPaths 反推。
  const skillFlag = flagString(args.flags, "skill");
  const inferred = summary.results.find((r) => r.variantId !== "baseline")?.skillPaths?.[0];
  const skillPath = skillFlag ? resolve(skillFlag) : inferred ? resolve(inferred) : undefined;

  if (!skillPath) {
    process.stderr.write("无法确定被测 skill 路径：用 --skill 指定\n");
    return 1;
  }
  if (!existsSync(skillPath)) {
    process.stderr.write(`被测 skill 不存在：${skillPath}\n`);
    return 1;
  }

  const decision = decideVerdict(summary);
  const allowInconclusive = args.flags["allow-inconclusive"] === true;
  const force = args.flags["force"] === true;

  // 仓库根目录：显式指定，否则从当前工作目录向上找含 skills/ 的目录。
  const repoFlag = flagString(args.flags, "repo");
  const repoRoot = repoFlag ? resolve(repoFlag) : detectRepoRoot(process.cwd());
  const archiveRoot = flagString(args.flags, "archive-root")
    ? resolve(flagString(args.flags, "archive-root")!)
    : repoRoot
      ? join(repoRoot, "archive")
      : resolve("archive");

  const outcome = performArchive({
    runDir: absoluteRun,
    skillPath,
    summary,
    decision,
    archiveRoot,
    repoRoot,
    version: flagString(args.flags, "version"),
    allowInconclusive,
    force,
    suiteId: flagString(args.flags, "suite"),
    suiteVersion: flagString(args.flags, "suite-version"),
    skillVersion: flagString(args.flags, "skill-version"),
    gainThresholdPp: flagNumber(args.flags, "gain-threshold"),
    allowLowGain: args.flags["allow-low-gain"] === true,
  });

  if (!outcome.ok || !outcome.result || !outcome.input) return 1;

  printArchiveResult(outcome.result, outcome.input, decision.verdict);

  // 归档成功后，把该 skill 从待测评暂存区移出。
  // 暂存区清空则整个目录删除——不留空壳。
  prunePendingAfterArchiveSkill(outcome.result, repoRoot, args);
  return 0;
}

/**
 * 归档成功后，把该 skill 从待测评暂存区移出。
 *
 * 暂存区里的 skill 是「候选池」——测评通过就不再是待测评的了，
 * 该目录被删除，skill 已在 archive/ 里。
 *
 * 暂存区**本身保留**——它是常驻的投放入口，用户随时要往里放新 skill。
 */
function prunePendingAfterArchiveSkill(
  result: ArchiveResult,
  repoRoot: string | null,
  args: CliArgs,
): void {
  if (!repoRoot) return;
  const pendingRoot = flagString(args.flags, "pending-root");
  if (!existsSync(pendingRootFor(repoRoot, pendingRoot))) return;

  // 归档目录名就是 skill 名（archive/<skill名>/<版本>/）。
  const skillName = basename(result.archiveRoot);
  const outcome = prunePendingAfterArchive({
    repoRoot,
    movedSkillNames: [skillName],
    pendingRoot,
  });

  if (outcome.removed.length > 0) {
    process.stdout.write(`已从待测评区移出：${outcome.removed.join(", ")}\n`);
  }
  if (outcome.remaining > 0) {
    process.stdout.write(`待测评区剩余 ${outcome.remaining} 个待测 skill。\n`);
  } else {
    process.stdout.write("待测评区已空，目录保留——可以继续往里放新的待测 skill。\n");
  }
}

/**
 * 待测评暂存区管理。
 *
 * - `pending` / `pending list`  列出待测评的 skill（并确保目录存在）
 * - `pending --skill <路径>`    把 skill 登记进暂存区
 * - `pending init`              只创建目录，用来「先有地方放 skill」
 *
 * 暂存区是**常驻**目录——用户要能直接找到它、把 skill 文件夹拖进去。
 * 所以不只在登记时创建，任何一次 pending 调用都会确保目录存在。
 */
function commandPending(args: CliArgs): number {
  const repoFlag = flagString(args.flags, "repo");
  const repoRoot = repoFlag ? resolve(repoFlag) : detectRepoRoot(process.cwd());

  if (!repoRoot) {
    process.stderr.write("无法确定仓库根目录：用 --repo 指定。\n");
    return 1;
  }

  const pendingRoot = flagString(args.flags, "pending-root");
  const skillFlag = flagString(args.flags, "skill");

  // 只创建目录——用户在 IDE 里翻文件时需要先有个地方可放。
  if (args.flags["init"] === true) {
    const outcome = ensurePendingRoot({ repoRoot, pendingRoot });
    process.stdout.write(
      outcome.created
        ? `已创建待测评区：${outcome.pendingRoot}\n`
        : `待测评区已存在：${outcome.pendingRoot}\n`,
    );
    process.stdout.write(`把待测评的 skill 文件夹直接放进这个目录即可。\n`);
    return 0;
  }

  // 登记模式：--skill <路径>
  if (skillFlag) {
    const skillPath = resolve(expandTilde(skillFlag));
    if (!existsSync(skillPath)) {
      process.stderr.write(`skill 不存在：${skillPath}\n`);
      return 1;
    }
    const outcome = registerPending({
      repoRoot,
      skillPath,
      pendingRoot,
      skillHash: hashFile(skillPath),
    });
    if (outcome.alreadyThere) {
      process.stdout.write(`已在待测评区：${outcome.skillDir}\n`);
    } else {
      process.stdout.write(`已登记到待测评区：${outcome.skillDir}（${outcome.fileCount} 个文件）\n`);
    }
    return 0;
  }

  // 列表模式——同时确保目录存在，用户才知道往哪放。
  ensurePendingRoot({ repoRoot, pendingRoot });
  const state = readPendingState({ repoRoot, pendingRoot });

  // JSON 模式：给 agent 解析用。待测评区的 skill 需要能被自动发现，
  // 人类可读的表格对 agent 来说不如结构化输出可靠。
  if (args.flags["json"] === true) {
    process.stdout.write(`${JSON.stringify(toPendingJson(state), null, 2)}\n`);
    return 0;
  }

  if (!state.exists) {
    process.stdout.write(`待测评区为空（目录不存在）：${state.pendingRoot}\n`);
    return 0;
  }
  if (state.skills.length === 0) {
    process.stdout.write(`待测评区为空：${state.pendingRoot}\n`);
    process.stdout.write("把待测评的 skill 文件夹直接放进这个目录即可。\n");
    return 0;
  }

  process.stdout.write(`待测评 skill（${state.skills.length} 个）：${state.pendingRoot}\n\n`);
  for (const item of state.skills) {
    const source = item.meta?.sourcePath ?? "未登记来源";
    process.stdout.write(`  ${item.name}\n    来源：${source}\n`);
  }
  process.stdout.write("\n测评通过后 skill 会自动移入 archive/，暂存区本身保留常驻。\n");
  return 0;
}

/** 从起始目录向上寻找含 skills/ 的仓库根目录。 */
/**
 * 探测仓库根目录。
 *
 * 逐层兜底，保证「用户在任何目录发起评估」都能找到待测评区：
 * 1. 显式 `--repo`（最高优先级，由调用方处理）
 * 2. 环境变量 `SKILL_EVAL_REPO`
 * 3. 从当前目录向上找含 `skills/` + `package.json` 的目录
 * 4. 从 skill-eval 自身安装位置反推
 *
 * 第 4 层是兜底：agent 的 cwd 常常是会话工作区而不是 skill-eval 仓库，
 * 此时前 3 层都会失败，但待测评区就在 skill-eval 仓库里。
 */
function detectRepoRoot(startDir: string): string | null {
  return detectRepoRootCore({
    startDir,
    env: process.env,
    cliFilePath: fileURLToPath(import.meta.url),
  });
}

/** 查看回归门禁阈值。 */
function commandThreshold(args: CliArgs): number {
  const scoreDrop = flagNumber(args.flags, "score-drop");
  const activationRateDrop = flagNumber(args.flags, "activation-rate-drop");

  if (scoreDrop === undefined && activationRateDrop === undefined) {
    process.stdout.write(
      `默认回归门禁阈值：\n` +
        `  胜率最大下降：${DEFAULT_THRESHOLDS.scoreDrop}\n` +
        `  激活率最大下降：${DEFAULT_THRESHOLDS.activationRateDrop}\n` +
        `  接受门：严格接受（候选必须严格优于当前版本，平局判 reject）\n`,
    );
    return 0;
  }

  const thresholds: RegressionThresholds = parseThresholds({
    scoreDrop: scoreDrop ?? DEFAULT_THRESHOLDS.scoreDrop,
    activationRateDrop: activationRateDrop ?? DEFAULT_THRESHOLDS.activationRateDrop,
  });

  process.stdout.write(
    `自定义回归门禁阈值：\n` +
      `  胜率最大下降：${thresholds.scoreDrop}\n` +
      `  激活率最大下降：${thresholds.activationRateDrop}\n`,
  );
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    process.stderr.write(`执行失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
