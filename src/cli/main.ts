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
import { dirname, resolve, join, isAbsolute } from "node:path";
import { runEvaluation, recomputeSummary, newRunId, type EvalTask, type Variant, type EvaluationSummary } from "../core/runner.ts";
import { renderReport, hashFile, type ReportMeta } from "../report/markdown.ts";
import { DEFAULT_THRESHOLDS, parseThresholds, type RegressionThresholds } from "../core/regression.ts";

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

check 选项：
  --suite <path>          仅校验套件结构，不调用模型

report 选项：
  --run <dir>             从已有运行产物重新生成报告
  --suite-file <path>     提供套件定义，从原始产物重算汇总（推荐）
  --suite <id>            套件标识（仅写入报告元信息）
  --skill <path>          被测 skill 路径（仅写入报告元信息）

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
    ? isAbsolute(suite.skill.path)
      ? suite.skill.path
      : resolve(suiteDir, suite.skill.path)
    : undefined;
  const skillPath = skillFlag ? resolve(skillFlag) : skillFromSuite;

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
    onProgress: (event) => {
      process.stderr.write(`  [${event.phase}] ${event.message}\n`);
    },
  });

  // 落盘运行摘要，便于重新生成报告。
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

  if (suitePath) {
    const suite = loadSuite(suitePath);
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

  const meta: ReportMeta = {
    skillPath: flagString(args.flags, "skill") ?? "（未记录）",
    skillHash: flagString(args.flags, "skill-hash") ?? "（未记录）",
    skillVersion: flagString(args.flags, "skill-version") ?? "（未记录）",
    suiteId: flagString(args.flags, "suite") ?? "（未记录）",
    suiteVersion: flagString(args.flags, "suite-version") ?? "（未记录）",
    runRoot: absolute,
    piHome: flagString(args.flags, "home") ?? null,
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
