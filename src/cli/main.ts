#!/usr/bin/env node
/**
 * skill-eval 命令行入口。
 *
 * 子命令：
 *   eval       执行对照评估（支持单模型或 --models 多模型矩阵）并生成报告
 *   preflight  只读核验 Pi 完整本地目录中的精确模型身份
 *   check      静态校验套件质量（可选结合 --run 做实证灵敏度体检）
 *   report     从已有运行产物重新生成报告
 *   archive    归档通过测评的 skill 快照
 *   verify     阴性对照元评估（生成契约剥离版 skill 或验证原版 vs 破坏版区分度）
 *   calibrate  导出人工匿名盲审表或计算人机评委一致性（Cohen's κ）
 *   pending    管理待测评 skill 暂存区
 *   threshold  查看全局判定门槛与回归门禁阈值
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from "node:fs";
import { dirname, resolve, join, isAbsolute, basename, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runEvaluation,
  recomputeSummary,
  newRunId,
  type EvalTask,
  type Variant,
  type EvaluationSummary,
} from "../core/runner.ts";
import { renderReport, hashFile, type ReportMeta } from "../report/markdown.ts";
import {
  DEFAULT_THRESHOLDS,
  parseThresholds,
  type RegressionThresholds,
} from "../core/regression.ts";
import { expandTilde } from "../core/paths.ts";
import { evaluateGainFromResults, DEFAULT_GAIN_THRESHOLD_PP } from "../core/gain.ts";
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
import { decideVerdict, type VerdictDecision } from "../core/verdict.ts";
import {
  loadSuite,
  checkSuite,
  hashSuite,
  type SuiteFile,
} from "../core/suite.ts";
import {
  evaluateNegativeControl,
  formatNegativeControlReport,
  stripBehavioralContract,
} from "../core/verify.ts";
import {
  exportCalibrationSheet,
  evaluateCalibration,
  type BlindReviewSheet,
  type CalibrationAnswerKey,
  type CalibrationResult,
} from "../core/calibration.ts";
import {
  summarizeModelMatrix,
  renderMatrixMarkdown,
  type ModelMatrixCell,
} from "../core/matrix.ts";
import {
  buildImprovementAdvice,
  generateLlmRewriteAdvice,
  type SkillDocContext,
} from "../core/improve.ts";
import {
  ACTIVATION_THRESHOLD,
  COST_WARN_TOKENS_PER_PP,
  COST_WARN_TOKEN_RATIO,
  DEFAULT_JUDGE_REPEAT,
  DEFAULT_REPEAT,
  GAIN_THRESHOLD_PP,
  GAIN_STRONG_THRESHOLD_PP,
  MAX_FALSE_ACTIVATION_RATE,
  MAX_VARIANT_TIMEOUT_RATE,
  MIN_JUDGED_PAIRS,
  MIN_PAIR_COVERAGE,
  MIN_WIN_RATE_LOWER_BOUND,
  WIN_RATE_RELAXED_THRESHOLD,
  WIN_RATE_THRESHOLD,
} from "../core/thresholds.ts";

import { freezeSkill } from "../core/provenance.ts";
import { assertFreshRunRoot, saveRunManifest, loadRunManifest, frozenSkillPath, relativeSnapshotDir, EVALUATION_POLICY_VERSION, type RunManifest } from "../core/run-manifest.ts";
import { preflightModels } from "../core/model-preflight.ts";

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

/** eval 与只读预检共享选型优先级，不依赖交互式 Pi 的默认模型。 */
function modelSelection(flags: Record<string, string | boolean>) {
  for (const key of ["model", "models", "judge-model", "home"]) {
    if (flags[key] !== undefined && (typeof flags[key] !== "string" || !String(flags[key]).trim())) {
      throw new Error(`参数 --${key} 缺少非空值；不会回退到其他模型或配置`);
    }
  }
  const modelsFlag = flagString(flags, "models");
  const modelList = modelsFlag ? modelsFlag.split(",").map((model) => model.trim()).filter(Boolean) : [];
  if (modelsFlag !== undefined && modelList.length === 0) throw new Error("参数 --models 必须包含模型");
  const singleModel = flagString(flags, "model") ?? process.env.SKILL_EVAL_MODEL;
  return {
    modelList,
    singleModel,
    models: modelList.length ? modelList : singleModel ? [singleModel] : [],
    judgeOverride: flagString(flags, "judge-model") ?? process.env.SKILL_EVAL_JUDGE_MODEL,
    piHome: flagString(flags, "home") ?? process.env.SKILL_EVAL_PI_HOME ?? undefined,
  };
}

function printHelp(): void {
  process.stdout.write(`skill-eval — 独立评估 Agent Skill 的激活率与实际增益

用法：
  skill-eval eval --suite <套件.json> --skill <SKILL.md> [选项]
  skill-eval preflight --model <provider/model> [--judge-model <provider/model>] [--home <dir>]
  skill-eval check --suite <套件.json> [--run <运行目录>] [--strict]
  skill-eval report --run <运行目录> [--suite-file <套件.json>] [--llm-advice]
  skill-eval archive --run <运行目录> --skill <SKILL.md> [选项]
  skill-eval verify --original <原版目录> --broken <破坏版目录>
  skill-eval verify --generate-broken <SKILL.md> --out <输出目录>
  skill-eval calibrate --run <运行目录> --export <盲审表.json>
  skill-eval calibrate --run <运行目录> --score <已填盲审表.json>
  skill-eval pending [--skill <SKILL.md> | --init | --json]
  skill-eval threshold [--score-drop <n>] [--activation-rate-drop <n>]

eval 选项：
  --suite <path>          评估套件定义（必填）
  --skill <path>          被测 SKILL.md 路径（可覆盖套件中的设置）
  --model <id>            被评模型，如 provider/model
  --models <m1,m2,...>    多模型矩阵评估（逗号分隔多个模型，输出 MATRIX_REPORT.md）
  --judge-model <id>      评委模型（默认同被评模型；强烈建议跨模型做评委）
  --repeat <n>            每用例重复次数（默认取套件值或 ${DEFAULT_REPEAT}）
  --judge-repeat <n>      评委轮数，≥2 启用位置偏好探测（默认取套件值或 ${DEFAULT_JUDGE_REPEAT}）
  --out <dir>             输出目录（默认 runs/<run-id>）
  --home <dir>            pi 隔离 HOME，避免污染全局配置
  --context <text>        附加上下文前缀（覆盖套件）
  --no-keyword-signal     关闭关键词弱证据，仅用工具调用取证
  --timeout <ms>          单次运行超时（默认 480000）
  --judge-timeout <ms>    评委单次超时（默认 300000）
  --llm-advice            额外调用模型针对失败根因生成 SKILL.md 段落级改写草案
  --archive-to <dir>      评估后把通过测评的 skill 归档到该仓库（默认归档到 <dir>/archive）
  --archive-root <dir>    覆盖归档根目录（配合 --archive-to 使用）
  --archive-version <id>  指定归档版本标识（默认 <frontmatter版本>__<时间戳>）
  --allow-inconclusive    允许归档「结论不足」的评估（标记 provisional=true）
  --allow-partial         允许归档存在部分超时/失败的跑批（标记 provisional=true）
  --allow-low-gain        允许归档断言增益未达标的评估（标记 lowGain=true）
  --gain-threshold <pp>   增益门槛（百分点，默认 ${GAIN_THRESHOLD_PP}）

preflight 选项：
  --model / --models     被评模型；选型与 eval 相同，要求精确 provider/model
  --judge-model <id>      评委模型；未指定时使用环境变量或被评模型
  --home <dir>            模型配置来源 HOME；只读核验合并目录，输出 JSON，不调用 Provider

check 选项：
  --suite <path>          校验套件结构、正则合法性、恒真断言与负向断言覆盖
  --run <dir>             结合历史跑批结果诊断「白送断言」（baseline ≥ 80%）与零区分度用例
  --strict                存在警告时也返回非零退出码

verify 选项：
  --generate-broken <p>   剥离 SKILL.md 的正文行为契约（保留 frontmatter 触发契约）写入 --out
  --out <dir>             生成的破坏版 skill 目录
  --original <dir>        原版 skill 跑批产物目录
  --broken <dir>          破坏版 skill 跑批产物目录
  --gain-threshold <pp>   区分度增益门槛（默认 ${GAIN_THRESHOLD_PP}）
  --json                  以 JSON 输出验证结果

calibrate 选项：
  --run <dir>             评估运行目录（必填）
  --export <file>         导出打乱 A/B 顺序的匿名盲审表 JSON
  --score <file>          读取人工回填的盲审表，计算一致率、Cohen's κ 与乐观偏置
  --suite-file <path>     可选套件定义（用于在盲审表中附带原始 prompt 与要点）
  --limit <n>             限制导出的抽检对数
`);
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  switch (args.command) {
    case "eval":
      return await commandEval(args);
    case "preflight":
      return await commandPreflight(args);
    case "check":
      return commandCheck(args);
    case "report":
      return await commandReport(args);
    case "archive":
      return await commandArchive(args);
    case "verify":
      return commandVerify(args);
    case "calibrate":
      return commandCalibrate(args);
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

async function commandPreflight(args: CliArgs): Promise<number> {
  const selection = modelSelection(args.flags);
  const result = await preflightModels({ models: selection.models, judgeModel: selection.judgeOverride, home: selection.piHome });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.valid ? 0 : 1;
}

/** 收集 SKILL.md 与包内附属文档内容，供优化建议定位规则是在主文件、未读附属文件还是完全缺失。 */
function buildSkillDocContext(
  skillPath: string | undefined,
  summary: EvaluationSummary,
): SkillDocContext | undefined {
  if (!skillPath || !existsSync(skillPath)) return undefined;
  let skillContent = "";
  try {
    skillContent = readFileSync(skillPath, "utf8");
  } catch {
    return undefined;
  }

  const skillDir = dirname(resolve(skillPath));
  const subFiles: Record<string, string> = {};
  const scanSubDir = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        scanSubDir(full);
      } else if (
        entry.isFile() &&
        full !== resolve(skillPath) &&
        (entry.name.endsWith(".md") || entry.name.endsWith(".txt"))
      ) {
        try {
          const rel = relative(skillDir, full).replace(/\\/g, "/");
          subFiles[rel] = readFileSync(full, "utf8").slice(0, 65536);
        } catch {
          // 忽略不可读文件
        }
      }
    }
  };
  scanSubDir(skillDir);

  const readSubSet = new Set<string>();
  for (const row of summary.results) {
    if (row.variantId === "baseline") continue;
    for (const p of row.activation?.readSubPaths ?? []) {
      readSubSet.add(p);
    }
  }

  return {
    skillContent,
    subFiles,
    readSubPaths: Array.from(readSubSet),
  };
}

function loadCalibrationIfPresent(runDir: string): CalibrationResult | null {
  const p = join(runDir, "calibration-result.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as CalibrationResult;
  } catch {
    return null;
  }
}

function commandCheck(args: CliArgs): number {
  const suitePath = flagString(args.flags, "suite");
  if (!suitePath) {
    process.stderr.write("缺少 --suite\n");
    return 1;
  }

  try {
    const suite = loadSuite(suitePath);
    const runDir = flagString(args.flags, "run");
    let empiricalSummary: EvaluationSummary | undefined;
    if (runDir) {
      const summaryPath = join(resolve(runDir), "summary.json");
      if (!existsSync(summaryPath)) {
        process.stderr.write(`未找到历史运行摘要：${summaryPath}\n`);
        return 1;
      }
      empiricalSummary = JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary;
    }

    const report = checkSuite(suite, empiricalSummary);
    const s = report.stats;

    process.stdout.write(
      `${report.valid ? "套件校验通过" : "套件校验失败"}：${suite.id}（${report.suiteHash}）\n`,
    );
    process.stdout.write(
      `  用例总数：${s.taskCount}（计分 ${s.scoredCount} / 诊断 ${s.diagnosticCount} / 负向误触发 ${s.negativeTriggerCount}）\n`,
    );
    process.stdout.write(
      `  断言条数：${s.assertionCount}（含负向红线断言 ${s.negativeAssertionCount}）\n`,
    );
    process.stdout.write(`  重复次数：${suite.repeat ?? `${DEFAULT_REPEAT}（默认）`}\n`);
    process.stdout.write(`  评委轮数：${suite.judgeRepeat ?? `${DEFAULT_JUDGE_REPEAT}（默认）`}\n`);

    if (report.errors.length > 0) {
      process.stderr.write("\n❌ 错误（必须修复）：\n");
      for (const err of report.errors) {
        process.stderr.write(`  - ${err}\n`);
      }
    }

    if (report.warnings.length > 0) {
      process.stdout.write("\n⚠️ 质量提示：\n");
      for (const warn of report.warnings) {
        process.stdout.write(`  - ${warn}\n`);
      }
    }

    if (!report.valid) return 1;
    if (args.flags["strict"] === true && report.warnings.length > 0) return 1;
    return 0;
  } catch (error) {
    process.stderr.write(`套件校验失败：${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function runSingleModelEval(params: {
  suite: SuiteFile;
  suiteHash: string;
  skillPath: string;
  model: string;
  judgeModel: string;
  repeat: number;
  judgeRepeat: number;
  outDir: string;
  runId: string;
  piHome: string | undefined;
  contextPrefix: string | undefined;
  keywordSignal: boolean;
  timeoutMs: number | undefined;
  judgeTimeoutMs: number | undefined;
  gainThresholdPp: number | undefined;
  wantLlmAdvice: boolean;
}): Promise<{ summary: EvaluationSummary; decision: VerdictDecision; reportPath: string }> {
  const { suite, skillPath, model, judgeModel, repeat, judgeRepeat, outDir, runId } = params;
  assertFreshRunRoot(outDir);
  const frozen = freezeSkill(skillPath, join(outDir, ".frozen", "skill"));
  const effectiveSuiteHash = hashSuite({ ...suite, contextPrefix: params.contextPrefix });
  const variants: Variant[] = [
    { id: "baseline", label: "Baseline（不装 skill）", skillPaths: [] },
    { id: "skill", label: `Skill（${suite.skill?.version ?? "当前版本"}）`, skillPaths: [frozen.skillPath] },
  ];
  const manifest: RunManifest = {
    schemaVersion: 1, policyVersion: EVALUATION_POLICY_VERSION, runId, model, judgeModel, repeat, judgeRepeat, judgeSeed: runId,
    tasks: suite.tasks, variants, contextPrefix: params.contextPrefix,
    settings: { gainThresholdPp: params.gainThresholdPp ?? GAIN_THRESHOLD_PP, timeoutMs: params.timeoutMs, judgeTimeoutMs: params.judgeTimeoutMs, keywordSignal: params.keywordSignal, nodeVersion: process.version },
    candidate: { identity: frozen.identity, snapshotDir: relativeSnapshotDir(outDir, frozen.skillPath), originalSkillPath: skillPath },
    suiteMeta: { suiteId: suite.id, suiteVersion: suite.version ?? "未标注", suiteHash: effectiveSuiteHash, skillVersion: suite.skill?.version ?? "未标注", skillPath },
  };
  saveRunManifest(outDir, manifest);

  const totalRuns = variants.length * suite.tasks.length * repeat;
  process.stderr.write(
    `开始评估：${suite.id}（${params.suiteHash}）\n` +
      `  被测 skill：${skillPath}\n` +
      `  模型：${model}（评委：${judgeModel}）\n` +
      `  用例 ${suite.tasks.length} × 变体 ${variants.length} × 重复 ${repeat} = ${totalRuns} 次运行\n` +
      `  评委轮数：${judgeRepeat}\n` +
      `  输出：${outDir}\n\n`,
  );

  const summary = await runEvaluation({
    runRoot: outDir,
    runId,
    manifest,
    judgeSeed: manifest.judgeSeed,
    model,
    judgeModel,
    variants,
    tasks: suite.tasks,
    repeat,
    judgeRepeat,
    contextPrefix: params.contextPrefix,
    home: params.piHome,
    keywordSignal: params.keywordSignal,
    timeoutMs: params.timeoutMs,
    judgeTimeoutMs: params.judgeTimeoutMs,
    // 污染检测：baseline 侧若自行读到了被测 skill 或含 skill 路径的元数据文件，
    // 对照实验的唯一变量就被破坏了。检测需要知道 skill 的位置。
    skillPathForContamination: skillPath,
    skillDirForContamination: dirname(resolve(skillPath)),
    onProgress: (event) => {
      process.stderr.write(`  [${event.phase}] ${event.message}\n`);
    },
  });

  summary.suiteMeta = manifest.suiteMeta;
  writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

  const decision = decideVerdict(summary, {
    ...(params.gainThresholdPp !== undefined ? { gainThresholdPp: params.gainThresholdPp } : {}),
  });
  const skillContext = buildSkillDocContext(frozen.skillPath, summary);

  let llmAdviceDraft: string | null = null;
  if (params.wantLlmAdvice && skillContext?.skillContent) {
    const variantSummary = summary.variantSummaries.find((v) => v.variantId !== "baseline");
    const advice = buildImprovementAdvice(summary.results, variantSummary?.activationRate ?? 0, {
      verdict: decision.verdict,
      tasks: suite.tasks,
      skillContext,
    });
    llmAdviceDraft = await generateLlmRewriteAdvice({
      skillContent: skillContext.skillContent,
      groupedDiagnoses: advice.groupedDiagnoses,
      workspaceRoot: outDir,
      model: judgeModel,
      home: params.piHome,
    });
  }

  const meta: ReportMeta = {
    skillPath,
    skillHash: frozen.identity.hash,
    skillVersion: suite.skill?.version ?? "未标注",
    suiteId: suite.id,
    suiteVersion: suite.version ?? "未标注",
    suiteHash: effectiveSuiteHash,
    runRoot: outDir,
    piHome: params.piHome ?? null,
    generatedAt: new Date().toISOString(),
  };

  const report = renderReport({
    summary,
    meta,
    tasks: suite.tasks,
    variants,
    verdict: decision.verdict,
    expensive: decision.expensive,
    verdictReason: decision.reason,
    skillContext,
    llmAdviceDraft,
    calibration: loadCalibrationIfPresent(outDir),
  });

  const reportPath = join(outDir, "REPORT.md");
  writeFileSync(reportPath, report, "utf8");
  process.stderr.write(`\n报告已生成：${reportPath}\n`);

  return { summary, decision, reportPath };
}

async function commandEval(args: CliArgs): Promise<number> {
  const suitePath = flagString(args.flags, "suite");
  if (!suitePath) {
    process.stderr.write("缺少 --suite\n");
    return 1;
  }

  const suite = loadSuite(suitePath);
  const suiteCheck = checkSuite(suite);
  if (!suiteCheck.valid) {
    process.stderr.write(`套件存在阻断性错误，无法启动评估：\n  ${suiteCheck.errors.join("\n  ")}\n`);
    return 1;
  }
  const suiteDir = dirname(resolve(suitePath));

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

  const { modelList, singleModel, models, judgeOverride, piHome } = modelSelection(args.flags);

  if (modelList.length === 0 && !singleModel) {
    process.stderr.write("缺少被评模型：用 --model 或 --models 指定，或设置 SKILL_EVAL_MODEL 环境变量\n");
    return 1;
  }

  const repeat = flagNumber(args.flags, "repeat") ?? suite.repeat ?? DEFAULT_REPEAT;
  const judgeRepeat = flagNumber(args.flags, "judge-repeat") ?? suite.judgeRepeat ?? DEFAULT_JUDGE_REPEAT;
  const timeoutMs = flagNumber(args.flags, "timeout");
  const judgeTimeoutMs = flagNumber(args.flags, "judge-timeout");
  const keywordSignal = args.flags["no-keyword-signal"] !== true;
  const contextPrefix = flagString(args.flags, "context") ?? suite.contextPrefix;
  const gainThresholdPp = flagNumber(args.flags, "gain-threshold");
  const wantLlmAdvice = args.flags["llm-advice"] === true;

  // Keep historical-output protection ahead of SDK discovery without creating a directory.
  const requestedOut = flagString(args.flags, "out");
  if (requestedOut && existsSync(resolve(requestedOut)) && readdirSync(resolve(requestedOut)).length > 0) {
    throw new Error("运行目录非空，禁止覆盖历史评测记录；请使用新的 --out");
  }
  // 全部矩阵模型及评委先核验，缺失时不创建运行目录或启动任何模型会话。
  const modelCheck = await preflightModels({ models, judgeModel: judgeOverride, home: piHome });
  if (!modelCheck.valid) {
    process.stderr.write(`模型预检未通过（未调用 Provider）：\n  ${modelCheck.errors.join("\n  ")}\n`);
    return 1;
  }

  // 多模型矩阵模式（--models m1,m2,...）
  if (modelList.length > 1) {
    const matrixRunId = newRunId();
    const matrixRoot = flagString(args.flags, "out")
      ? resolve(flagString(args.flags, "out")!)
      : resolve("runs", `matrix-${matrixRunId}`);
    assertFreshRunRoot(matrixRoot);

    const cells: ModelMatrixCell[] = [];
    for (const m of modelList) {
      const safeName = m.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const subOut = join(matrixRoot, safeName);
      const res = await runSingleModelEval({
        suite,
        suiteHash: suiteCheck.suiteHash,
        skillPath,
        model: m,
        judgeModel: judgeOverride ?? m,
        repeat,
        judgeRepeat,
        outDir: subOut,
        runId: `${matrixRunId}-${safeName}`,
        piHome,
        contextPrefix,
        keywordSignal,
        timeoutMs,
        judgeTimeoutMs,
        gainThresholdPp,
        wantLlmAdvice,
      });
      cells.push({
        model: m,
        runDir: subOut,
        summary: res.summary,
        decision: res.decision,
      });
    }

    const matrixReport = summarizeModelMatrix(cells);
    const matrixMd = renderMatrixMarkdown(matrixReport, {
      suiteId: suite.id,
      skillPath,
      judgeModel: judgeOverride ?? "各模型自评",
      generatedAt: new Date().toISOString(),
    });
    writeFileSync(join(matrixRoot, "MATRIX_REPORT.md"), matrixMd, "utf8");
    writeFileSync(join(matrixRoot, "matrix-summary.json"), JSON.stringify(matrixReport, null, 2), "utf8");
    process.stdout.write(`${matrixReport.classification}\n${matrixReport.summaryText}\n`);
    return 0;
  }

  // 单模型标准模式
  const model = (modelList[0] ?? singleModel)!;
  const judgeModel = judgeOverride ?? model;
  const runId = newRunId();
  const outDir = flagString(args.flags, "out") ? resolve(flagString(args.flags, "out")!) : resolve("runs", runId);

  const { summary, decision } = await runSingleModelEval({
    suite,
    suiteHash: suiteCheck.suiteHash,
    skillPath,
    model,
    judgeModel,
    repeat,
    judgeRepeat,
    outDir,
    runId,
    piHome,
    contextPrefix,
    keywordSignal,
    timeoutMs,
    judgeTimeoutMs,
    gainThresholdPp,
    wantLlmAdvice,
  });

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
      decision,
      archiveRoot,
      repoRoot,
      version: flagString(args.flags, "archive-version"),
      allowInconclusive: args.flags["allow-inconclusive"] === true,
      allowPartial: args.flags["allow-partial"] === true,
      force: false,
      suiteId: suite.id,
      suiteVersion: suite.version,
      suiteHash: suiteCheck.suiteHash,
      skillVersion: suite.skill?.version,
      gainThresholdPp,
      allowLowGain: args.flags["allow-low-gain"] === true,
    });

    if (outcome.ok && outcome.result && outcome.input) {
      printArchiveResult(outcome.result, outcome.input, decision);
      prunePendingAfterArchiveSkill(outcome.result, repoRoot, args);
    } else {
      process.stderr.write("归档未完成，评估结论不受影响。\n");
    }
  }

  process.stdout.write(`${decision.verdict}\n${decision.reason}\n`);
  return summary.status === "failed" ? 1 : 0;
}

/**
 * 从已有运行产物重新生成报告。
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

  const suitePath = flagString(args.flags, "suite-file");
  let tasks: EvalTask[];
  let variants: Variant[];
  let loadedSuite: SuiteFile | undefined;
  let computedSuiteHash: string | undefined;

  if (suitePath) {
    const suite = loadSuite(suitePath);
    loadedSuite = suite;
    computedSuiteHash = hashSuite(suite);
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
    tasks = (stored.taskSummaries ?? []).map(
      (task): EvalTask => ({
        id: task.taskId,
        prompt: "",
        kind: task.kind,
        ...(task.shouldActivate !== undefined ? { shouldActivate: task.shouldActivate } : {}),
      }),
    );
    const manifest = loadRunManifest(absolute);
    tasks = stored.tasks ?? manifest?.tasks ?? tasks;
    variants = manifest?.variants ?? rebuildVariantsForRecompute(stored, stored.suiteMeta?.skillPath ?? "(legacy-unverified)");
  }

  const summary = await recomputeSummary(absolute, { variants, tasks });
  summary.evidenceLevel = "replay";
  summary.analysisOf = { runId: stored.runId, originalSuiteHash: stored.suiteMeta?.suiteHash, suiteHash: computedSuiteHash ?? stored.suiteMeta?.suiteHash, createdAt: new Date().toISOString() };
  if (loadedSuite && computedSuiteHash && summary.suiteMeta) summary.suiteMeta = {
    ...summary.suiteMeta, suiteId: loadedSuite.id, suiteVersion: loadedSuite.version ?? "未标注", suiteHash: computedSuiteHash,
  };
  if (computedSuiteHash && stored.suiteMeta?.suiteHash && computedSuiteHash !== stored.suiteMeta.suiteHash) {
    summary.integrity = { verified: false, issues: [...(summary.integrity?.issues ?? []), "派生复核使用了不同套件判据，旧评委记录不能作为新判据的确认性证据"] };
  }

  const existingReportPath = join(absolute, "REPORT.md");
  const existingReportText = existsSync(existingReportPath)
    ? readFileSync(existingReportPath, "utf8")
    : null;
  const recovered = existingReportText
    ? recoverMetaFromReport(existingReportText)
    : recoverMetaFromReport("");

  const merged = mergeMeta(
    {
      skillPath: flagString(args.flags, "skill") ?? stored.suiteMeta?.skillPath,
      skillHash: flagString(args.flags, "skill-hash"),
      skillVersion: flagString(args.flags, "skill-version") ?? stored.suiteMeta?.skillVersion,
      suiteId: loadedSuite?.id ?? flagString(args.flags, "suite") ?? stored.suiteMeta?.suiteId,
      suiteVersion:
        flagString(args.flags, "suite-version") ??
        loadedSuite?.version ??
        stored.suiteMeta?.suiteVersion,
      suiteHash: computedSuiteHash ?? stored.suiteMeta?.suiteHash ?? null,
      piHome: flagString(args.flags, "home"),
    },
    recovered,
  );

  const resolvedSkillPath =
    merged.skillPath && merged.skillPath !== "（未记录）"
      ? resolve(expandTilde(merged.skillPath))
      : undefined;

  const meta: ReportMeta = {
    skillPath: merged.skillPath ?? "（未记录）",
    skillHash: summary.manifest?.candidate.identity.hash ?? merged.skillHash ?? "（未记录）",
    skillVersion: merged.skillVersion ?? "（未记录）",
    suiteId: merged.suiteId ?? "（未记录）",
    suiteVersion: merged.suiteVersion ?? "（未记录）",
    suiteHash: merged.suiteHash ?? null,
    runRoot: absolute,
    piHome: merged.piHome ?? null,
    generatedAt: new Date().toISOString(),
  };

  const decision = decideVerdict(summary, {
    ...(flagNumber(args.flags, "gain-threshold") !== undefined
      ? { gainThresholdPp: flagNumber(args.flags, "gain-threshold")! }
      : summary.manifest?.settings ? { gainThresholdPp: summary.manifest.settings.gainThresholdPp } : {}),
  });
  const skillContext = buildSkillDocContext(summary.manifest ? frozenSkillPath(absolute, summary.manifest) : resolvedSkillPath, summary);

  let llmAdviceDraft: string | null = null;
  if (args.flags["llm-advice"] === true && skillContext?.skillContent) {
    const variantSummary = summary.variantSummaries.find((v) => v.variantId !== "baseline");
    const advice = buildImprovementAdvice(summary.results, variantSummary?.activationRate ?? 0, {
      verdict: decision.verdict,
      tasks,
      skillContext,
    });
    llmAdviceDraft = await generateLlmRewriteAdvice({
      skillContent: skillContext.skillContent,
      groupedDiagnoses: advice.groupedDiagnoses,
      workspaceRoot: absolute,
      model: summary.judgeModel || summary.model,
    });
  }

  const report = renderReport({
    summary,
    meta,
    tasks,
    variants,
    verdict: decision.verdict,
    expensive: decision.expensive,
    verdictReason: decision.reason,
    skillContext,
    llmAdviceDraft,
    calibration: loadCalibrationIfPresent(absolute),
  });

  const analysisRoot = join(absolute, "analyses", newRunId());
  mkdirSync(analysisRoot, { recursive: true });
  writeFileSync(join(analysisRoot, "REPORT.md"), report, { encoding: "utf8", flag: "wx" });
  writeFileSync(join(analysisRoot, "summary.json"), JSON.stringify(summary, null, 2), { encoding: "utf8", flag: "wx" });
  writeFileSync(join(analysisRoot, "analysis.json"), JSON.stringify({ ...summary.analysisOf, policyVersion: EVALUATION_POLICY_VERSION, sourceRun: absolute }, null, 2), { encoding: "utf8", flag: "wx" });
  process.stdout.write(`派生复核已生成（原记录未覆盖）：${join(analysisRoot, "REPORT.md")}\n`);
  process.stdout.write(`${decision.verdict}${decision.expensive ? " (expensive)" : ""}\n${decision.reason}\n`);
  return 0;
}

function performArchive(options: {
  runDir: string;
  skillPath: string;
  summary: EvaluationSummary;
  decision: VerdictDecision;
  archiveRoot: string;
  repoRoot: string | null;
  version?: string | undefined;
  allowInconclusive: boolean;
  allowPartial: boolean;
  force: boolean;
  suiteId?: string | undefined;
  suiteVersion?: string | undefined;
  suiteHash?: string | undefined;
  skillVersion?: string | undefined;
  gainThresholdPp?: number | undefined;
  allowLowGain?: boolean | undefined;
}): { ok: boolean; result?: ArchiveResult; input?: ReturnType<typeof collectArchiveInput> } {
  const { decision } = options;

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
          "  如确认需要临时留档，加 --allow-inconclusive 放行，归档后会在 latest.json 中标记 provisional=true。\n",
      );
      return { ok: false };
    }
    if (
      options.summary.status === "partial" &&
      !options.allowPartial &&
      !options.allowInconclusive
    ) {
      process.stderr.write(
        "拒绝归档：本次跑批存在失败或超时运行（status=partial），默认禁止归档为干净通过版本。\n" +
          "  建议消除超时后重跑，或显式加 --allow-partial 放行（归档后标记 provisional=true）。\n",
      );
      return { ok: false };
    }
  }

  const input = collectArchiveInput({
    runDir: options.runDir,
    skillPath: options.skillPath,
    verdict: decision.verdict,
    verdictReason: decision.reason,
    expensive: decision.expensive,
    summary: options.summary,
    suiteId: options.suiteId,
    suiteVersion: options.suiteVersion,
    suiteHash: options.suiteHash,
    skillVersion: options.skillVersion,
  });

  const thresholdPp = options.gainThresholdPp ?? DEFAULT_GAIN_THRESHOLD_PP;
  const gainCheck = evaluateGainFromResults(options.summary.results, options.summary.variantSummaries.find((v) => v.variantId !== "baseline")?.variantId ?? "skill", thresholdPp, options.summary.tasks, options.summary.repeat);
  if (!gainCheck.passed && !options.allowLowGain && !options.force) {
    process.stderr.write(
      `拒绝归档：断言增益未达标。\n  ${gainCheck.reason}\n` +
        `  门槛 ${thresholdPp}pp 来自阴性对照实验——原版 skill +50.0pp，契约剥离后仅 +8.6pp。\n` +
        "  确认 skill 确实带来了改善时，加 --allow-low-gain 放行（标记 lowGain=true）。\n",
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

function printArchiveResult(
  result: ArchiveResult,
  input: { skillHash: string; gainCheck?: { passed: boolean; gainPp: number | null; thresholdPp: number } },
  decision: VerdictDecision,
): void {
  if (result.skipped) {
    process.stdout.write(`已存在同内容版本，跳过：${result.versionDir}\n`);
    return;
  }
  process.stdout.write(`归档完成：${result.versionDir}\n`);
  process.stdout.write(`  版本标识：${result.version}\n`);
  const flags = [
    decision.expensive || result.expensive ? "有效但昂贵" : "",
    result.provisional ? "provisional" : "",
    result.lowGain ? "low-gain" : "",
    result.suiteDrift ? "suite-drift" : "",
  ]
    .filter(Boolean)
    .join(" / ");
  process.stdout.write(`  结论：${decision.verdict}${flags ? `（${flags}）` : ""}\n`);
  if (input.gainCheck) {
    const g = input.gainCheck.gainPp === null ? "不可判定" : `${input.gainCheck.gainPp.toFixed(1)} pp`;
    process.stdout.write(
      `  增益门槛：${g}（门槛 ${input.gainCheck.thresholdPp} pp）${input.gainCheck.passed ? "达标" : "未达标·已放行"}\n`,
    );
  }
  if (result.suiteDrift) {
    process.stdout.write("  ⚠️ 检测到与上一归档版本的套件哈希不同，跨版本指标不可直接横向对比。\n");
  }
  process.stdout.write(`  复制文件：${result.fileCount} 个（跳过噪声 ${result.skippedNoise} 项）\n`);
  process.stdout.write(`  内容哈希：${input.skillHash}\n`);
  process.stdout.write(`  索引：${join(result.archiveRoot, "latest.json")}\n`);
}

/**
 * 为 recomputeSummary 重建 variants。
 *
 * 关键不变量：**非 baseline 变体必须带非空 skillPaths**——runner 的
 * `isBaseline = skillPaths.length === 0 || id === "baseline"`，若把 skill 侧
 * 也填成 `[]`，重算会把它当 baseline，pairCoverage / winRateLowerBound 被置
 * null，decideVerdict 误拦为 inconclusive（2026-11-06 归档 run2 时实测踩中）。
 */
export function rebuildVariantsForRecompute(
  stored: EvaluationSummary,
  skillPath: string,
): Variant[] {
  return (stored.variantSummaries ?? []).map((item): Variant => ({
    id: item.variantId,
    label: item.variantLabel,
    skillPaths: item.variantId === "baseline" ? [] : [skillPath],
  }));
}

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

  const storedSummary = JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary;

  // 先解析 skill 路径，再重算：重建 variants 时非 baseline 必须带非空 skillPaths，
  // 否则 runner 的 isBaseline（skillPaths.length === 0）把 skill 侧误判为 baseline，
  // pairCoverage / winRateLowerBound 被置 null → decideVerdict 误拦为 inconclusive。
  const skillFlag = flagString(args.flags, "skill");
  const manifest = loadRunManifest(absoluteRun);
  if (!manifest) {
    process.stderr.write("拒绝归档：历史运行缺少冻结候选身份与运行清单；原始记录保留不变，需新建评估记录。\n");
    return 1;
  }
  const inferred = frozenSkillPath(absoluteRun, manifest);
  const skillPath = skillFlag ? resolve(expandTilde(skillFlag)) : inferred ? resolve(expandTilde(inferred)) : undefined;

  if (!skillPath) {
    process.stderr.write("无法确定被测 skill 路径：用 --skill 指定\n");
    return 1;
  }
  if (!existsSync(skillPath)) {
    process.stderr.write(`被测 skill 不存在：${skillPath}\n`);
    return 1;
  }

  const summary = await recomputeSummary(absoluteRun, {
    variants: manifest.variants,
    tasks: manifest.tasks,
    repeat: manifest.repeat,
  });

  const requestedGainThreshold = flagNumber(args.flags, "gain-threshold");
  const gainThresholdPp = manifest.settings?.gainThresholdPp ?? GAIN_THRESHOLD_PP;
  if (requestedGainThreshold !== undefined && requestedGainThreshold !== gainThresholdPp) {
    process.stderr.write("拒绝归档：归档门槛不得修改运行前冻结的判定配置；请另建派生分析或新运行。\n");
    return 1;
  }
  const decision = decideVerdict(summary, {
    ...(gainThresholdPp !== undefined ? { gainThresholdPp } : {}),
  });

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
    allowInconclusive: args.flags["allow-inconclusive"] === true,
    allowPartial: args.flags["allow-partial"] === true,
    force: args.flags["force"] === true,
    suiteId: flagString(args.flags, "suite") ?? storedSummary.suiteMeta?.suiteId,
    suiteVersion: flagString(args.flags, "suite-version") ?? storedSummary.suiteMeta?.suiteVersion,
    suiteHash: storedSummary.suiteMeta?.suiteHash,
    skillVersion: flagString(args.flags, "skill-version") ?? storedSummary.suiteMeta?.skillVersion,
    gainThresholdPp,
    allowLowGain: args.flags["allow-low-gain"] === true,
  });

  if (!outcome.ok || !outcome.result || !outcome.input) return 1;

  printArchiveResult(outcome.result, outcome.input, decision);
  prunePendingAfterArchiveSkill(outcome.result, repoRoot, args);
  return 0;
}

/** 阴性对照元评估子命令（`skill-eval verify`）。 */
async function commandVerify(args: CliArgs): Promise<number> {
  const genBrokenSource = flagString(args.flags, "generate-broken");
  if (genBrokenSource) {
    const srcPath = resolve(expandTilde(genBrokenSource));
    if (!existsSync(srcPath)) {
      process.stderr.write(`找不到源 SKILL.md：${srcPath}\n`);
      return 1;
    }
    const outDirFlag = flagString(args.flags, "out");
    if (!outDirFlag) {
      process.stderr.write("使用 --generate-broken 时须通过 --out 指定破坏版输出目录\n");
      return 1;
    }
    const outDir = resolve(expandTilde(outDirFlag));
    mkdirSync(outDir, { recursive: true });
    const raw = readFileSync(srcPath, "utf8");
    const stripped = stripBehavioralContract(raw);
    const destFile = join(outDir, "SKILL.md");
    writeFileSync(destFile, stripped.content, "utf8");
    process.stdout.write(
      `已生成行为契约剥离版 SKILL.md：${destFile}\n` +
        `  原版行数：${stripped.originalLines} → 剥离后行数：${stripped.strippedLines}\n` +
        `  保留 YAML frontmatter 触发契约：${stripped.preservedFrontmatter ? "是" : "否"}\n`,
    );
    return 0;
  }

  const origDir = flagString(args.flags, "original");
  const brokenDir = flagString(args.flags, "broken");
  if (!origDir || !brokenDir) {
    process.stderr.write(
      "用法：\n" +
        "  skill-eval verify --original <原版运行目录> --broken <破坏版运行目录>\n" +
        "  skill-eval verify --generate-broken <SKILL.md> --out <破坏版目录>\n",
    );
    return 1;
  }

  const origSummaryPath = join(resolve(origDir), "summary.json");
  const brokenSummaryPath = join(resolve(brokenDir), "summary.json");
  if (!existsSync(origSummaryPath)) {
    process.stderr.write(`找不到原版运行摘要：${origSummaryPath}\n`);
    return 1;
  }
  if (!existsSync(brokenSummaryPath)) {
    process.stderr.write(`找不到破坏版运行摘要：${brokenSummaryPath}\n`);
    return 1;
  }

  const revalidate = async (runDir: string, path: string): Promise<EvaluationSummary> => {
    const stored = JSON.parse(readFileSync(path, "utf8")) as EvaluationSummary;
    try {
      const manifest = loadRunManifest(runDir);
      if (!manifest) return { ...stored, integrity: { verified: false, issues: ["缺少冻结清单与当前原始产物核验，不能信任历史摘要中的已验证旗标"] } };
      return await recomputeSummary(runDir, { variants: manifest.variants, tasks: manifest.tasks, repeat: manifest.repeat });
    } catch {
      return { ...stored, integrity: { verified: false, issues: ["冻结清单或原始产物无法核验"] } };
    }
  };
  const origSummary = await revalidate(resolve(origDir), origSummaryPath);
  const brokenSummary = await revalidate(resolve(brokenDir), brokenSummaryPath);
  const thresholdPp = flagNumber(args.flags, "gain-threshold");
  const report = evaluateNegativeControl(origSummary, brokenSummary, {
    ...(thresholdPp !== undefined ? { thresholdPp } : {}),
  });

  if (args.flags["json"] === true) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatNegativeControlReport(report));
  }

  return report.passed ? 0 : 1;
}

/** 人工盲审抽检与评委校准子命令（`skill-eval calibrate`）。 */
function commandCalibrate(args: CliArgs): number {
  const runDirFlag = flagString(args.flags, "run");
  if (!runDirFlag) {
    process.stderr.write("缺少 --run <运行目录>\n");
    return 1;
  }
  const runDir = resolve(runDirFlag);
  const summaryPath = join(runDir, "summary.json");
  if (!existsSync(summaryPath)) {
    process.stderr.write(`找不到运行摘要：${summaryPath}\n`);
    return 1;
  }

  const exportPathFlag = flagString(args.flags, "export");
  const scorePathFlag = flagString(args.flags, "score");

  if (exportPathFlag) {
    const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary;
    const suiteFileFlag = flagString(args.flags, "suite-file");
    const tasks = suiteFileFlag ? loadSuite(suiteFileFlag).tasks : [];
    const limit = flagNumber(args.flags, "limit");

    const { blindSheet, answerKey } = exportCalibrationSheet(summary, tasks, limit);
    const exportPath = resolve(exportPathFlag);
    const keyPath = join(runDir, "calibration-key.json");
    mkdirSync(dirname(exportPath), { recursive: true });
    writeFileSync(exportPath, JSON.stringify(blindSheet, null, 2), "utf8");
    writeFileSync(keyPath, JSON.stringify(answerKey, null, 2), "utf8");

    process.stdout.write(
      `已导出匿名盲审表（共 ${blindSheet.items.length} 对）：${exportPath}\n` +
        `映射密钥已保存至：${keyPath}\n` +
        "填写每条的 humanVerdict ('A' | 'B' | 'tie') 后执行：\n" +
        `  skill-eval calibrate --run ${runDir} --score ${exportPath}\n`,
    );
    return 0;
  }

  if (scorePathFlag) {
    const keyPath = join(runDir, "calibration-key.json");
    if (!existsSync(keyPath)) {
      process.stderr.write(`未找到映射密钥：${keyPath}（请先执行 --export）\n`);
      return 1;
    }
    const sheetPath = resolve(scorePathFlag);
    if (!existsSync(sheetPath)) {
      process.stderr.write(`未找到已填写的盲审表：${sheetPath}\n`);
      return 1;
    }

    const blindSheet = JSON.parse(readFileSync(sheetPath, "utf8")) as BlindReviewSheet;
    const answerKey = JSON.parse(readFileSync(keyPath, "utf8")) as CalibrationAnswerKey;
    const result = evaluateCalibration(blindSheet, answerKey);
    const outPath = join(runDir, "calibration-result.json");
    writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");

    process.stdout.write(`人工盲审校准完成（已审核 ${result.reviewedCount}/${result.totalItems} 对）：\n`);
    process.stdout.write(
      `  人机一致率：${result.agreementRate === null ? "—" : `${(result.agreementRate * 100).toFixed(1)}%`}\n`,
    );
    process.stdout.write(
      `  Cohen's κ：${result.kappa === null ? "—" : result.kappa.toFixed(3)}\n`,
    );
    process.stdout.write(
      `  评委乐观偏置：${result.optimismBiasPp === null ? "—" : `${result.optimismBiasPp >= 0 ? "+" : ""}${result.optimismBiasPp.toFixed(1)}pp`}\n`,
    );
    process.stdout.write(`  结果已落盘：${outPath}（运行 skill-eval report 可自动写入报告）\n`);
    return 0;
  }

  process.stderr.write("请指定 --export <盲审表.json> 或 --score <已填盲审表.json>\n");
  return 1;
}

function prunePendingAfterArchiveSkill(
  result: ArchiveResult,
  repoRoot: string | null,
  args: CliArgs,
): void {
  if (!repoRoot) return;
  const pendingRoot = flagString(args.flags, "pending-root");
  if (!existsSync(pendingRootFor(repoRoot, pendingRoot))) return;

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

function commandPending(args: CliArgs): number {
  const repoFlag = flagString(args.flags, "repo");
  const repoRoot = repoFlag ? resolve(repoFlag) : detectRepoRoot(process.cwd());

  if (!repoRoot) {
    process.stderr.write("无法确定仓库根目录：用 --repo 指定。\n");
    return 1;
  }

  const pendingRoot = flagString(args.flags, "pending-root");
  const skillFlag = flagString(args.flags, "skill");

  if (args.flags["init"] === true) {
    const outcome = ensurePendingRoot({ repoRoot, pendingRoot });
    process.stdout.write(
      outcome.created
        ? `已创建待测评区：${outcome.pendingRoot}\n`
        : `待测评区已存在：${outcome.pendingRoot}\n`,
    );
    process.stdout.write("把待测评的 skill 文件夹直接放进这个目录即可。\n");
    return 0;
  }

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

  ensurePendingRoot({ repoRoot, pendingRoot });
  const state = readPendingState({ repoRoot, pendingRoot });

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

function detectRepoRoot(startDir: string): string | null {
  return detectRepoRootCore({
    startDir,
    env: process.env,
    cliFilePath: fileURLToPath(import.meta.url),
  });
}

/** 查看全局判定门槛与回归门禁阈值。 */
function commandThreshold(args: CliArgs): number {
  const scoreDrop = flagNumber(args.flags, "score-drop");
  const activationRateDrop = flagNumber(args.flags, "activation-rate-drop");

  if (scoreDrop === undefined && activationRateDrop === undefined) {
    process.stdout.write(
      `全局有效判定门槛（src/core/thresholds.ts）：\n` +
        `  默认重复运行次数（repeat）：${DEFAULT_REPEAT}\n` +
        `  默认评委轮数（judgeRepeat）：${DEFAULT_JUDGE_REPEAT}\n` +
        `  正向激活率门槛：${(ACTIVATION_THRESHOLD * 100).toFixed(0)}%\n` +
        `  负向最大误触发率：${(MAX_FALSE_ACTIVATION_RATE * 100).toFixed(0)}%\n` +
        `  成对评委胜率门槛（含超时惩罚与规则纠偏后）：${(WIN_RATE_THRESHOLD * 100).toFixed(0)}%（断言增益过硬 ≥ +${GAIN_STRONG_THRESHOLD_PP}pp 且 CI 下界 > 0 时降为 ${(WIN_RATE_RELAXED_THRESHOLD * 100).toFixed(0)}% 守门线）\n` +
        `  全样本胜率下界门槛：${(MIN_WIN_RATE_LOWER_BOUND * 100).toFixed(0)}%\n` +
        `  有效评判覆盖率门槛：${(MIN_PAIR_COVERAGE * 100).toFixed(0)}%（且计分对 ≥ ${MIN_JUDGED_PAIRS}）\n` +
        `  skill 侧最大超时率：${(MAX_VARIANT_TIMEOUT_RATE * 100).toFixed(0)}%\n` +
        `  规则断言增益门槛：+${GAIN_THRESHOLD_PP}pp（且 95% Newcombe 置信下界 > 0）\n` +
        `  成本昂贵警告线：token > ${COST_WARN_TOKEN_RATIO}x 或 > ${COST_WARN_TOKENS_PER_PP} tokens/pp\n\n` +
        `默认回归门禁阈值：\n` +
        `  胜率最大下降：${DEFAULT_THRESHOLDS.scoreDrop}\n` +
        `  激活率最大下降：${DEFAULT_THRESHOLDS.activationRateDrop}\n` +
        `  接受门：严格接受（候选必须严格优于当前版本，且套件哈希未漂移）\n`,
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

// 仅在直接作为 CLI 脚本执行时触发 main()，方便单测直接 import parseArgs 等辅助函数。
const isMainModule =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(
        `执行失败：${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    });
}
