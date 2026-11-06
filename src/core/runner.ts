/**
 * 对照实验编排器。
 *
 * 核心结构：
 *   for 每个 variant:
 *     for 每个 task:
 *       for attempt in 1..repeat:
 *         运行一次 → 采集激活取证 + 断言判定
 *   然后对每个 (task, attempt) 做成对评判（baseline vs 每个其他 variant）
 *
 * 关键约束：
 * - 两侧唯一差异是是否加载 skill（由 variant.skillPaths 决定）。
 * - 每个运行用独立工作目录与独立会话，互不污染。
 * - 失败计入分母，不做选择性重跑；失败运行不参与负向断言通过率（防空输出假通过）。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runPi } from "./pi.ts";
import { detectActivation, summarizeActivation, parseFrontmatter, type ActivationResult } from "./activation.ts";
import { detectContamination, type ContaminationReport } from "./contamination.ts";
import { evaluateAssertions, type Assertion, type AssertionReport } from "./assertions.ts";
import {
  runPairwiseJudge,
  buildJudgeSchedule,
  JUDGE_PROTOCOL_VERSION,
  type JudgeRoundPlan,
  aggregateJudgeRuns,
  detectPositionBias,
  parseJudgeResponse,
  reconcileJudgeRun,
  type JudgeResult,
  type Verdict,
  type BiasProbe,
} from "./judge.ts";
import { evaluateCostEfficiency, type CostEfficiency } from "./cost.ts";
import { loadEvidenceFromDir } from "./evidence.ts";
import { evaluateGainFromResults } from "./gain.ts";
import { wilsonInterval } from "./stats.ts";
import { DEFAULT_JUDGE_REPEAT } from "./thresholds.ts";
import { checkRunIntegrity, loadRunManifest, hashEvidenceFile, type VerificationState, type RunManifest } from "./run-manifest.ts";

export interface EvalTask {
  id: string;
  prompt: string;
  /** 预期要点，同时用于评委提示词。 */
  expectedPoints?: string[];
  /** 评分标准，覆盖默认。 */
  rubric?: string;
  /** 规则断言，在观察结果前冻结。 */
  assertions?: Assertion[];
  /**
   * 用例性质：
   * - `scored` 计入胜率（默认）
   * - `diagnostic` 仅诊断不计入胜率（用于无区分度或负向触发诊断用例）
   */
  kind?: "scored" | "diagnostic";
  /**
   * 该用例是否应当触发被测 skill（默认 true）。
   * 设为 false 时作为「负向误触发测试」，单独统计误触发率而不计入召回率分母。
   */
  shouldActivate?: boolean;
  /** 兼容历史套件中的 difficulty 字段（已废弃，不再参与计算）。 */
  difficulty?: Record<string, number>;
}

export interface Variant {
  id: string;
  label: string;
  /** 加载的 skill 路径。空数组 = baseline。 */
  skillPaths: string[];
}

export interface RunnerOptions {
  /** 运行根目录，所有产物落在这里。 */
  runRoot: string;
  /** 运行标识。 */
  runId: string;
  /** 被评模型。 */
  model: string;
  /** 评委模型。 */
  judgeModel?: string | undefined;
  variants: Variant[];
  tasks: EvalTask[];
  /** 每用例重复次数。 */
  repeat: number;
  /** 评委重复轮数。默认 1。 */
  judgeRepeat?: number;
  judgeSeed?: string;
  manifest?: RunManifest;
  /** 每次运行附加的上下文前缀。 */
  contextPrefix?: string;
  /** 隔离 HOME。 */
  home?: string | undefined;
  /** 是否启用关键词弱证据。默认 true。 */
  keywordSignal?: boolean;
  /** 单次运行超时。 */
  timeoutMs?: number;
  /** 评委单次超时。默认 `DEFAULT_JUDGE_TIMEOUT_MS`。 */
  judgeTimeoutMs?: number;
  /**
   * 被测 skill 的 SKILL.md 路径，仅用于污染检测。
   * baseline 侧若自行读到了它，说明对照实验被污染。
   */
  skillPathForContamination?: string;
  /** 被测 skill 所在目录，仅用于污染检测。 */
  skillDirForContamination?: string;
  /** 进度回调。 */
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: "run" | "judge";
  variantId: string;
  taskId: string;
  attempt: number;
  message: string;
}

export interface RunResult {
  id: string;
  variantId: string;
  variantLabel: string;
  taskId: string;
  attempt: number;
  status: "success" | "failed";
  startedAt: number;
  endedAt: number;
  durationSec: number;
  skillPaths: string[];
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  output: string;
  activation: ActivationResult;
  assertions: AssertionReport | null;
  /**
   * 污染判定（仅 baseline 侧有值）。
   * 非 null 表示该次 baseline 运行自行读到了被测 skill 或会泄漏 skill 路径的
   * 元数据文件——对照实验的唯一变量被破坏，该次输出不代表「不装 skill」的水平。
   */
  contamination?: ContaminationReport | null;
  /** 证据目录（相对 runRoot）。 */
  evidenceDir: string;
  error: string | null;
  /** 是否因运行超时而失败。 */
  timedOut?: boolean;
  isolation?: VerificationState;
  evidenceHashes?: Record<string, string>;
}

export interface PairwiseResult {
  baselineResultId: string;
  variantResultId: string;
  /** 便于按 variant 聚合（对应 variantResultId 所属的 variant）。 */
  variantId: string;
  taskId: string;
  attempt: number;
  verdict: Verdict;
  scoreDelta: number | null;
  baselineScore: number | null;
  variantScore: number | null;
  confidence: number | null;
  reason: string;
  error: string | null;
  /** 全部单次判定，保留供复核。 */
  judgeRuns: JudgeResult[];
  /** 位置偏好探测结果。 */
  biasProbe: BiasProbe | null;
}

export interface VariantSummary {
  variantId: string;
  variantLabel: string;
  total: number;
  success: number;
  failed: number;
  missing?: number;
  /** 超时次数与超时率。 */
  timedOut?: number;
  timeoutRate?: number;
  /** 正向用例（shouldActivate !== false）的激活召回率。 */
  activationRate: number;
  weakActivationRate: number;
  /** 负向用例（shouldActivate === false）的误触发率；无负向用例时为 null。 */
  falseActivationRate?: number | null;
  /** 激活率为 0% 的正向用例列表（防均值掩盖局部盲区）。 */
  zeroActivationTasks?: string[];
  assertionPassRate: number | null;
  /** 已判定计分对胜率：scoredWin / (scoredWin + scoredTie + scoredLoss) */
  winRate: number | null;
  /** 已判定胜率的 95% Wilson 置信区间。 */
  winRateCi?: { low: number; high: number } | null;
  /** 全样本计分对胜率下界：scoredWin / totalScoredPairs（未评判/超时对全部计入分母）。 */
  winRateLowerBound?: number | null;
  /** 惩罚不对称超时后的有效胜率：baseline 成功而 variant 失败/超时的对计入分母作为失败。 */
  effectiveWinRate?: number | null;
  /** 规则优先纠偏后的胜率：当规则断言显示倒退或零改善且未全过时，覆盖评委的乐观 win。 */
  ruleAdjustedWinRate?: number | null;
  /** 计分对总数与有效评判覆盖率。 */
  totalScoredPairs?: number;
  scoredJudged?: number;
  pairCoverage?: number | null;
  win: number;
  tie: number;
  loss: number;
  notJudged: number;
  avgTokens: number;
  avgCost: number;
  avgDurationSec: number;
  avgToolCalls: number;
  /** 成本效率评估（替代旧 EFC）。 */
  costEfficiency?: CostEfficiency | null;
}

export interface TaskSummary {
  taskId: string;
  kind: "scored" | "diagnostic";
  shouldActivate?: boolean;
  total: number;
  success: number;
  activationRate: number;
  assertionPassRate: number | null;
  win: number;
  tie: number;
  loss: number;
  notJudged: number;
}

export interface EvaluationSummary {
  runId: string;
  model: string;
  judgeModel: string;
  repeat: number;
  tasks?: EvalTask[];
  integrity?: VerificationState;
  isolation?: VerificationState;
  policyVersion?: string;
  evidenceLevel?: "real-model" | "replay" | "offline-fixture";
  manifest?: RunManifest;
  analysisOf?: { runId: string; originalSuiteHash?: string; suiteHash?: string; createdAt: string };
  judgeRepeat: number;
  startedAt: number;
  endedAt: number;
  durationSec: number;
  status: "success" | "failed" | "partial";
  results: RunResult[];
  pairwise: PairwiseResult[];
  variantSummaries: VariantSummary[];
  taskSummaries: TaskSummary[];
  /** 规则断言与评委的分歧。 */
  disagreements: Disagreement[];
  totalCost: number;
  totalTokens: number;
  /**
   * 套件元信息。
   *
   * 由 CLI 在落盘时补充——套件定义不在 runner 的职责范围内，
   * 但归档等下游动作需要知道「这次测的是哪套断言」及其内容哈希。
   */
  suiteMeta?: {
    suiteId: string;
    suiteVersion: string;
    suiteHash?: string;
    skillVersion: string;
    /** 被测 skill 路径。 */
    skillPath: string;
  };
}

export interface Disagreement {
  taskId: string;
  attempt: number;
  variantId: string;
  /** 规则断言对该次运行的整轮判定。 */
  assertionPassed: boolean;
  /** 规则断言给出的相对结论（基于通过条数对比）。 */
  objectiveVerdict?: "win" | "loss" | "tie";
  /** 评委对 variant 相对 baseline 的判定。 */
  verdict: Verdict;
  note: string;
}

/**
 * 执行一次完整对照评估。
 */
export async function runEvaluation(options: RunnerOptions): Promise<EvaluationSummary> {
  const startedAt = Date.now();
  const judgeRepeat = options.judgeRepeat ?? DEFAULT_JUDGE_REPEAT;

  mkdirSync(options.runRoot, { recursive: true });
  for (const variant of options.variants) for (const task of options.tasks) for (let attempt = 1; attempt <= options.repeat; attempt++) {
    const path = join(options.runRoot, "cases", variant.id, task.id, String(attempt));
    if (existsSync(path) && readdirSync(path).length > 0) throw new Error("运行产物已存在，禁止覆盖历史记录；请新建运行目录");
  }

  const results: RunResult[] = [];

  // 阶段一：运行所有 variant × task × attempt。
  for (const variant of options.variants) {
    for (const task of options.tasks) {
      for (let attempt = 1; attempt <= options.repeat; attempt += 1) {
        const result = await runCase(options, variant, task, attempt);
        results.push(result);
        options.onProgress?.({
          phase: "run",
          variantId: variant.id,
          taskId: task.id,
          attempt,
          message: `${variant.label} / ${task.id} / 第 ${attempt} 次：${result.status}（${result.durationSec.toFixed(1)}s）`,
        });
      }
    }
  }

  // 阶段二：成对评判。
  const pairwise = await judgeAll(options, results, judgeRepeat);

  const endedAt = Date.now();
  const failedCount = results.filter((result) => result.status === "failed").length;
  const status: EvaluationSummary["status"] =
    failedCount === 0 ? "success" : failedCount === results.length ? "failed" : "partial";

  return {
    runId: options.runId,
    model: options.model,
    judgeModel: options.judgeModel ?? options.model,
    repeat: options.repeat,
    tasks: options.tasks,
    manifest: options.manifest,
    policyVersion: options.manifest?.policyVersion,
    evidenceLevel: "real-model",
    integrity: checkRunIntegrity(options.runRoot, options.manifest ?? null, results),
    isolation: {
      verified: results.length > 0 && results.every((result) => result.isolation?.verified === true),
      issues: [...new Set(results.flatMap((result) => result.isolation?.issues ?? ["运行缺少访问隔离验证记录"]))],
    },
    judgeRepeat,
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    status,
    results,
    pairwise,
    variantSummaries: summarizeVariants(options, results, pairwise),
    taskSummaries: summarizeTasks(options, results, pairwise),
    disagreements: findDisagreements(options, results, pairwise),
    totalCost: results.reduce((acc, result) => acc + result.totalCost, 0),
    totalTokens: results.reduce((acc, result) => acc + result.totalTokens, 0),
  };
}

/** 运行单个用例的单个 attempt。 */
async function runCase(
  options: RunnerOptions,
  variant: Variant,
  task: EvalTask,
  attempt: number,
): Promise<RunResult> {
  const id = `${sanitizeId(variant.id)}-${sanitizeId(task.id)}-${attempt}`;
  const caseDir = join(options.runRoot, "cases", variant.id, task.id, String(attempt));
  mkdirSync(caseDir, { recursive: true });

  const prompt = [options.contextPrefix, task.prompt].filter((part) => part && part.trim()).join("\n\n");
  const startedAt = Date.now();

  const run = await runPi({
    workspaceRoot: caseDir,
    sessionId: `${options.runId}-${id}`,
    prompt,
    model: options.model,
    skillPaths: variant.skillPaths,
    home: options.home,
    timeoutMs: options.timeoutMs,
    isolation: { skillRoots: variant.skillPaths.map((path) => dirname(resolve(path))) },
  });

  const endedAt = Date.now();
  const output = run.metrics.output;
  const failed = run.exitCode !== 0 || !output.trim();

  const activation = detectActivation({
    skillPaths: variant.skillPaths,
    readPaths: run.metrics.readPaths,
    output,
    keywordSignal: options.keywordSignal,
  });

  // 污染检测：baseline 侧若自行读到了被测 skill 或会泄漏 skill 路径的元数据文件，
  // 对照实验的唯一变量就被破坏了——该次运行的输出不能代表「不装 skill」的水平。
  // 只有 variant 侧显式加载 skill 才是合法的，因此只对 baseline 侧判定。
  const contamination =
    variant.skillPaths.length === 0
      ? detectContamination(
          run.metrics.readPaths,
          options.skillPathForContamination ?? "",
          options.skillDirForContamination ?? "",
        )
      : null;

  // 失败/超时的运行没有有效输出，禁止执行断言（否则 mustNotMatch 会在空输出上假阳性通过）。
  const assertions = !failed && task.assertions?.length ? evaluateAssertions(output, task.assertions) : null;

  // 证据落盘：事件流、输出、判定结果。
  writeFileSync(join(caseDir, "events.json"), JSON.stringify(run.events, null, 2), "utf8");
  writeFileSync(join(caseDir, "output.md"), output, "utf8");
  writeFileSync(
    join(caseDir, "result.json"),
    JSON.stringify(
      {
        id,
        variantId: variant.id,
        taskId: task.id,
        attempt,
        status: failed ? "failed" : "success",
        durationSec: (endedAt - startedAt) / 1000,
        totalTokens: run.metrics.totalTokens,
        totalCost: run.metrics.totalCost,
        toolCalls: run.metrics.toolCalls,
        readPaths: run.metrics.readPaths,
        activation,
        assertions,
        contamination,
        stderr: run.stderr.slice(0, 2000),
        timedOut: run.timedOut,
        isolation: run.isolation,
      },
      null,
      2,
    ),
    "utf8",
  );

  return {
    id,
    variantId: variant.id,
    variantLabel: variant.label,
    taskId: task.id,
    attempt,
    status: failed ? "failed" : "success",
    startedAt,
    endedAt,
    durationSec: (endedAt - startedAt) / 1000,
    skillPaths: variant.skillPaths,
    totalTokens: run.metrics.totalTokens,
    totalCost: run.metrics.totalCost,
    toolCalls: run.metrics.toolCalls,
    output,
    activation,
    assertions,
    contamination,
    evidenceDir: join("cases", variant.id, task.id, String(attempt)),
    error: failed
      ? run.timedOut
        ? "运行超时"
        : `退出码 ${String(run.exitCode)}，${run.stderr.slice(0, 300)}`
      : null,
    timedOut: run.timedOut,
    isolation: run.isolation,
    evidenceHashes: Object.fromEntries(["events.json", "output.md", "result.json"].map((name) => [name, hashEvidenceFile(join(caseDir, name))])),
  };
}

/**
 * 对每个 (task, attempt) 做 baseline vs variant 的成对评判。
 *
 * judgeRepeat ≥ 2 时额外跑一次反向顺序，用于探测评委的位置偏差。
 */
export async function judgeAll(
  options: RunnerOptions,
  results: RunResult[],
  judgeRepeat: number = DEFAULT_JUDGE_REPEAT,
  runJudge: typeof runPairwiseJudge = runPairwiseJudge,
): Promise<PairwiseResult[]> {
  const baseline = options.variants.find((variant) => variant.skillPaths.length === 0);
  if (!baseline) return [];
  const outputs: PairwiseResult[] = [];
  const baselineByKey = new Map(results.filter((r) => r.variantId === baseline.id).map((r) => [pairwiseKey(r.taskId, r.attempt), r]));

  for (const result of results) {
    if (result.variantId === baseline.id) continue;
    const base = baselineByKey.get(pairwiseKey(result.taskId, result.attempt));
    const task = options.tasks.find((t) => t.id === result.taskId);
    if (!base || !task) continue;
    if (base.status !== "success" || result.status !== "success") {
      outputs.push({
        baselineResultId: base.id, variantResultId: result.id, variantId: result.variantId,
        taskId: result.taskId, attempt: result.attempt, verdict: "not_judged",
        scoreDelta: null, baselineScore: null, variantScore: null, confidence: null,
        reason: "baseline 或 variant 运行失败，未评判", error: null, judgeRuns: [], biasProbe: null,
      });
      continue;
    }

    const judgeDir = join(options.runRoot, "pairwise", result.id);
    mkdirSync(judgeDir, { recursive: true });
    const seed = options.judgeSeed ?? options.runId;
    const taskKey = result.id;
    const rounds = buildJudgeSchedule(seed, taskKey, judgeRepeat);
    // 在任何评委调用前冻结全部轮次；重算按计划补缺失，不按落盘数缩减轮次。
    writeFileSync(join(judgeDir, "judge-plan.json"), JSON.stringify({
      protocolVersion: JUDGE_PROTOCOL_VERSION, seed, taskKey, rounds,
    }, null, 2), { encoding: "utf8", flag: "wx" });
    const baseEvidence = loadEvidenceFromDir(join(options.runRoot, base.evidenceDir));
    const candidateEvidence = loadEvidenceFromDir(join(options.runRoot, result.evidenceDir));
    const runs: JudgeResult[] = [];
    for (const round of rounds) {
      const raw = await runJudge({
        judgeDir: join(judgeDir, round.dirName),
        runId: `${options.runId}-${result.id}-${round.roundIndex}`,
        task: task.prompt, expectedPoints: task.expectedPoints, rubric: task.rubric,
        outputA: round.swapped ? result.output : base.output,
        outputB: round.swapped ? base.output : result.output,
        evidenceA: round.swapped ? candidateEvidence : baseEvidence,
        evidenceB: round.swapped ? baseEvidence : candidateEvidence,
        model: options.judgeModel, home: options.home, timeoutMs: options.judgeTimeoutMs,
        swapped: round.swapped, roundIndex: round.roundIndex,
        sourceIdentifiers: [
          options.skillPathForContamination ?? "",
          options.skillDirForContamination ?? "",
          ...(options.manifest ? [
            basename(dirname(options.manifest.candidate.originalSkillPath)),
            ...options.manifest.candidate.identity.files.map((file) => basename(file.path)),
          ] : []),
          ...result.skillPaths,
          ...result.skillPaths.map((path) => dirname(path)),
          ...(result.skillPaths.flatMap((path) => {
            try { return [parseFrontmatter(readFileSync(path, "utf8")).name ?? ""]; } catch { return []; }
          })),
          base.variantLabel, result.variantLabel,
        ].filter((value) => value.length >= 4),
      });
      runs.push(reconcileJudgeRun(raw, round.swapped));
    }
    const forward = runs.find((run) => run.swapped === false);
    const reversed = runs.find((run) => run.swapped === true);
    const biasProbe = forward && reversed ? detectPositionBias(forward.verdict, reversed.verdict) : null;
    const aggregated = aggregateJudgeRuns(runs);
    outputs.push({
      baselineResultId: base.id, variantResultId: result.id, variantId: result.variantId,
      taskId: result.taskId, attempt: result.attempt, verdict: aggregated.verdict,
      scoreDelta: aggregated.scoreDelta, baselineScore: aggregated.scoreA,
      variantScore: aggregated.scoreB, confidence: aggregated.confidence,
      reason: aggregated.reason, error: aggregated.error, judgeRuns: runs, biasProbe,
    });
    options.onProgress?.({
      phase: "judge", variantId: result.variantId, taskId: result.taskId, attempt: result.attempt,
      message: `${result.variantLabel} / ${result.taskId} / 第 ${result.attempt} 次评判：${aggregated.verdict}`,
    });
  }
  return outputs;
}

/** 比较单对运行的规则断言客观优劣（按通过条数对比）。 */
export function compareObjectiveAssertions(
  baselineResult: RunResult | undefined,
  variantResult: RunResult | undefined,
): "win" | "loss" | "tie" | null {
  if (!baselineResult || !variantResult) return null;
  if (baselineResult.status === "failed" || variantResult.status === "failed") return null;
  const baseA = baselineResult.assertions;
  const varA = variantResult.assertions;
  if (!baseA || !varA || baseA.total === 0 || varA.total === 0) return null;

  if (varA.passed > baseA.passed) return "win";
  if (varA.passed < baseA.passed) return "loss";
  return "tie";
}

/** 汇总每个 variant 的表现。 */
export function summarizeVariants(
  options: RunnerOptions,
  results: RunResult[],
  pairwise: PairwiseResult[],
): VariantSummary[] {
  const positiveTaskIds = new Set(
    options.tasks.filter((task) => task.shouldActivate !== false).map((task) => task.id),
  );
  const negativeTaskIds = new Set(
    options.tasks.filter((task) => task.shouldActivate === false).map((task) => task.id),
  );
  const scoredTaskIds = new Set(
    options.tasks
      .filter((task) => (task.kind ?? "scored") === "scored" && task.shouldActivate !== false)
      .map((task) => task.id),
  );

  const resultById = new Map(results.map((r) => [r.id, r]));
  const baselineVariant = options.variants.find((v) => v.skillPaths.length === 0 || v.id === "baseline");
  const baselineRows = baselineVariant ? results.filter((r) => r.variantId === baselineVariant.id) : [];
  const baselineSuccessful = baselineRows.filter((r) => r.status === "success" && scoredTaskIds.has(r.taskId));
  const baselineAvgTokens = average(baselineSuccessful.map((r) => r.totalTokens));
  const baselineAvgDurationSec = average(baselineSuccessful.map((r) => r.durationSec));

  return options.variants.map((variant) => {
    const isBaseline = variant.skillPaths.length === 0 || variant.id === "baseline";
    const rows = results.filter((result) => result.variantId === variant.id);
    const successful = rows.filter((result) => result.status === "success");

    const positiveRows =
      options.tasks.length > 0 ? rows.filter((row) => positiveTaskIds.has(row.taskId)) : rows;
    const negativeRows = rows.filter((row) => negativeTaskIds.has(row.taskId));
    const activation = summarizeActivation(positiveRows);
    const falseActivationRate =
      !isBaseline && negativeRows.length > 0 ? summarizeActivation(negativeRows).activationRate : null;

    const zeroActivationTasks: string[] = [];
    if (!isBaseline) {
      for (const task of options.tasks) {
        if (task.shouldActivate === false) continue;
        const taskRows = rows.filter((r) => r.taskId === task.id);
        if (taskRows.length > 0 && summarizeActivation(taskRows).activated === 0) {
          zeroActivationTasks.push(task.id);
        }
      }
    }

    const timedOutCount = rows.filter(
      (r) => r.timedOut === true || r.error === "运行超时",
    ).length;
    const timeoutRate = rows.length > 0 ? timedOutCount / rows.length : 0;

    const variantPairwise = pairwise.filter((item) => item.variantId === variant.id);
    const judged = variantPairwise.filter((item) => item.verdict !== "not_judged");
    const win = judged.filter((item) => item.verdict === "win").length;
    const tie = judged.filter((item) => item.verdict === "tie").length;
    const loss = judged.filter((item) => item.verdict === "loss").length;
    const notJudged = variantPairwise.filter((item) => item.verdict === "not_judged").length;

    // 只统计可判定计分用例，避免诊断用例与负向触发用例污染胜率。
    const scoredPairs = variantPairwise.filter((item) => scoredTaskIds.has(item.taskId));
    const scoredJudged = scoredPairs.filter((item) => item.verdict !== "not_judged");
    const scoredWin = scoredJudged.filter((item) => item.verdict === "win").length;
    const scoredTie = scoredJudged.filter((item) => item.verdict === "tie").length;
    const scoredLoss = scoredJudged.filter((item) => item.verdict === "loss").length;
    const scoredDecided = scoredWin + scoredTie + scoredLoss;

    const expectedScoredPairs =
      !isBaseline && options.repeat > 0 ? scoredTaskIds.size * options.repeat :
      scoredPairs.length > 0
        ? scoredPairs.length
        : !isBaseline
          ? rows.filter((r) => scoredTaskIds.has(r.taskId)).length
          : 0;

    // 不对称运行失败（baseline 成功而 skill 崩溃/超时）：计入有效胜率分母作为失败。
    let asymmetricFailures = 0;
    if (!isBaseline) {
      for (const row of rows) {
        if (!scoredTaskIds.has(row.taskId) || row.status !== "failed") continue;
        const baseMatch = baselineRows.find(
          (b) => b.taskId === row.taskId && b.attempt === row.attempt,
        );
        if (baseMatch && baseMatch.status === "success") {
          asymmetricFailures += 1;
        }
      }
    }

    // 规则优先纠偏后的胜率：若客观断言显示倒退（loss），或双方均未全过且无任何条目改善（tie + !allPassed），
    // 则评委给出的乐观 win 不能算数。
    let ruleAdjustedWins = 0;
    for (const item of scoredJudged) {
      if (item.verdict !== "win") continue;
      const baseRes = resultById.get(item.baselineResultId);
      const varRes = resultById.get(item.variantResultId);
      const obj = compareObjectiveAssertions(baseRes, varRes);
      const overridden =
        obj === "loss" ||
        (obj === "tie" && Boolean(varRes?.assertions && !varRes.assertions.allPassed));
      if (!overridden) {
        ruleAdjustedWins += 1;
      }
    }

    const assertionRows = successful.filter((row) => row.assertions && row.assertions.total > 0);
    const assertionPassRate = assertionRows.length
      ? assertionRows.reduce((acc, row) => acc + (row.assertions?.allPassed ? 1 : 0), 0) / assertionRows.length
      : null;

    const winRate = scoredDecided > 0 ? scoredWin / scoredDecided : null;
    const ci = scoredDecided > 0 ? wilsonInterval(scoredWin, scoredDecided) : null;
    const effectiveDenom = scoredDecided + asymmetricFailures;
    const effectiveWinRate = effectiveDenom > 0 ? scoredWin / effectiveDenom : null;
    const winRateLowerBound =
      !isBaseline && expectedScoredPairs > 0 ? scoredWin / expectedScoredPairs : null;
    const pairCoverage =
      !isBaseline && expectedScoredPairs > 0 ? scoredDecided / expectedScoredPairs : null;
    const ruleAdjustedWinRate = scoredDecided > 0 ? ruleAdjustedWins / scoredDecided : null;

    const avgTokens = average(successful.map((row) => row.totalTokens));
    const avgCost = average(successful.map((row) => row.totalCost));
    const avgDurationSec = average(successful.map((row) => row.durationSec));
    const avgToolCalls = average(successful.map((row) => row.toolCalls));

    const scoredSuccessful = successful.filter((row) => scoredTaskIds.has(row.taskId));
    const gainPp = !isBaseline ? evaluateGainFromResults(results, variant.id, undefined, options.tasks, options.repeat).gainPp : null;
    const costEfficiency =
      !isBaseline && scoredSuccessful.length > 0 && baselineSuccessful.length > 0
        ? evaluateCostEfficiency({
            baselineAvgTokens,
            variantAvgTokens: average(scoredSuccessful.map((row) => row.totalTokens)),
            baselineAvgDurationSec,
            variantAvgDurationSec: average(scoredSuccessful.map((row) => row.durationSec)),
            gainPp,
          })
        : null;

    return {
      variantId: variant.id,
      variantLabel: variant.label,
      total: options.repeat > 0 ? Math.max(rows.length, options.tasks.length * options.repeat) : rows.length,
      success: successful.length,
      failed: rows.length - successful.length,
      missing: options.repeat > 0 ? Math.max(0, options.tasks.length * options.repeat - rows.length) : 0,
      timedOut: timedOutCount,
      timeoutRate,
      activationRate: activation.activationRate,
      weakActivationRate: activation.weakRate,
      falseActivationRate,
      zeroActivationTasks,
      assertionPassRate,
      winRate,
      winRateCi: ci ? { low: ci.low, high: ci.high } : null,
      winRateLowerBound,
      effectiveWinRate,
      ruleAdjustedWinRate,
      totalScoredPairs: expectedScoredPairs,
      scoredJudged: scoredDecided,
      pairCoverage,
      win,
      tie,
      loss,
      notJudged,
      avgTokens,
      avgCost,
      avgDurationSec,
      avgToolCalls,
      costEfficiency,
    };
  });
}

/** 汇总每个用例的表现。 */
export function summarizeTasks(
  options: RunnerOptions,
  results: RunResult[],
  pairwise: PairwiseResult[],
): TaskSummary[] {
  // 激活率只统计装了 skill 的 variant——baseline 按设计不加载 skill，
  // 把它算进分母会人为稀释激活率。
  const skillVariantIds = new Set(
    options.variants.filter((variant) => variant.skillPaths.length > 0).map((variant) => variant.id),
  );

  return options.tasks.map((task) => {
    const rows = results.filter((result) => result.taskId === task.id);
    const skillRows = rows.filter((row) => skillVariantIds.has(row.variantId));
    const activation = summarizeActivation(skillRows);
    const assertionRows = rows.filter(
      (row) => row.status === "success" && row.assertions && row.assertions.total > 0,
    );
    const assertionPassRate = assertionRows.length
      ? assertionRows.reduce((acc, row) => acc + (row.assertions?.allPassed ? 1 : 0), 0) / assertionRows.length
      : null;

    const judged = pairwise.filter((item) => item.taskId === task.id && item.verdict !== "not_judged");
    const win = judged.filter((item) => item.verdict === "win").length;
    const tie = judged.filter((item) => item.verdict === "tie").length;
    const loss = judged.filter((item) => item.verdict === "loss").length;
    const notJudged = pairwise.filter((item) => item.taskId === task.id && item.verdict === "not_judged").length;

    return {
      taskId: task.id,
      kind: task.kind ?? "scored",
      shouldActivate: task.shouldActivate !== false,
      total: rows.length,
      success: rows.filter((row) => row.status === "success").length,
      activationRate: activation.activationRate,
      assertionPassRate,
      win,
      tie,
      loss,
      notJudged,
    };
  });
}

/**
 * 找出规则断言与评委的分歧。
 *
 * 规则断言是客观判据，与评委冲突时以规则为准——但分歧必须记录，
 * 因为分歧本身说明任务设计或 skill 声明有问题。
 */
export function findDisagreements(
  options: RunnerOptions,
  results: RunResult[],
  pairwise: PairwiseResult[],
): Disagreement[] {
  const disagreements: Disagreement[] = [];

  for (const item of pairwise) {
    if (item.verdict === "not_judged") continue;

    const variantResult = results.find((result) => result.id === item.variantResultId);
    const baselineResult = results.find((result) => result.id === item.baselineResultId);
    const task = options.tasks.find((t) => t.id === item.taskId);
    if (!variantResult || !baselineResult || !task) continue;

    const objectiveVerdict = compareObjectiveAssertions(baselineResult, variantResult);
    if (!objectiveVerdict) continue;

    const assertionPassed = Boolean(variantResult.assertions?.allPassed);

    const judgeVerdict: "win" | "loss" | "tie" =
      item.verdict === "win" ? "win" : item.verdict === "loss" ? "loss" : "tie";

    if (objectiveVerdict !== judgeVerdict) {
      disagreements.push({
        taskId: item.taskId,
        attempt: item.attempt,
        variantId: item.variantId,
        assertionPassed,
        objectiveVerdict,
        verdict: item.verdict,
        note: disagreementNote(objectiveVerdict, judgeVerdict),
      });
    }
  }

  return disagreements;
}

/** 生成分歧说明。规则断言优先于评委。 */
function disagreementNote(objective: "win" | "loss" | "tie", judge: "win" | "loss" | "tie"): string {
  const objectiveText =
    objective === "win"
      ? "规则断言判定 skill 相对 baseline 满足更多约束（改善）"
      : objective === "loss"
        ? "规则断言判定 skill 相对 baseline 违反更多约束（倒退）"
        : "规则断言判定 skill 与 baseline 表现相当";
  const judgeText =
    judge === "win" ? "评委认为改善" : judge === "loss" ? "评委认为倒退" : "评委未看出相对差异";

  return `${objectiveText}，但${judgeText}；以规则断言为准`;
}

function pairwiseKey(taskId: string, attempt: number): string {
  return `${taskId}#${attempt}`;
}

function average(values: number[]): number {
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : 0;
}

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 80) || "item";
}

/** 生成运行 ID。 */
export function newRunId(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
  return `run-${stamp}-${randomUUID().slice(0, 8)}`;
}

/**
 * 从已有运行产物重算汇总。
 */
export async function recomputeSummary(
  runRoot: string,
  options: { variants: Variant[]; tasks: EvalTask[]; repeat?: number },
): Promise<EvaluationSummary> {
  const summaryPath = join(runRoot, "summary.json");
  const stored = existsSync(summaryPath)
    ? JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary : undefined;
  const manifest = loadRunManifest(runRoot);
  const frozen = manifest ?? stored?.manifest;
  const repeat = frozen?.repeat ?? options.repeat ?? stored?.repeat ?? 0;
  const variants = frozen?.variants ?? options.variants;
  const collectionTasks = [...new Map([
    ...(frozen?.tasks ?? stored?.tasks ?? []), ...options.tasks,
  ].map((task) => [task.id, task])).values()];
  const results: RunResult[] = [];
  const issues: string[] = [];
  for (const variant of variants) for (const task of collectionTasks) {
    const taskDir = join(runRoot, "cases", variant.id, task.id);
    const attempts = repeat > 0 ? Array.from({ length: repeat }, (_, i) => String(i + 1))
      : existsSync(taskDir) ? readdirSync(taskDir).filter((name) => /^\d+$/.test(name)) : [];
    for (const attemptDir of attempts) {
      const resultPath = join(taskDir, attemptDir, "result.json");
      if (!existsSync(resultPath)) { issues.push(`缺失运行记录：cases/${variant.id}/${task.id}/${attemptDir}/result.json`); continue; }
      let raw: RunResult & { stderr?: string; readPaths?: string[] };
      try { raw = JSON.parse(readFileSync(resultPath, "utf8")); }
      catch { issues.push(`运行记录无法解析：cases/${variant.id}/${task.id}/${attemptDir}/result.json`); continue; }
      if (raw.variantId !== variant.id || raw.taskId !== task.id || raw.attempt !== Number(attemptDir)) {
        issues.push(`运行记录身份与冻结矩阵不匹配：${variant.id}/${task.id}/${attemptDir}`); continue;
      }
      const outputPath = join(taskDir, attemptDir, "output.md");
      const output = readOutput(outputPath);
      const isFailed = raw.status !== "success" || !existsSync(outputPath) || !output.trim();
      if (raw.status === "success" && isFailed) issues.push(`成功运行缺少有效输出：${raw.id}`);
      const taskAssertions = options.tasks.find((t) => t.id === raw.taskId)?.assertions;
      const assertions = isFailed ? null : taskAssertions !== undefined
        ? taskAssertions.length ? evaluateAssertions(output, taskAssertions) : null : raw.assertions;
      const timedOut = raw.timedOut === true || Boolean(isFailed && /timeout|超时/i.test(raw.stderr ?? ""));
      const prior = stored?.results.find((r) => r.variantId === variant.id && r.taskId === task.id && r.attempt === raw.attempt);
      results.push({
        ...raw,
        variantLabel: variant.label,
        status: isFailed ? "failed" : "success",
        startedAt: raw.startedAt ?? prior?.startedAt ?? 0,
        endedAt: raw.endedAt ?? prior?.endedAt ?? 0,
        skillPaths: variant.skillPaths,
        output, assertions, timedOut,
        contamination: raw.contamination ?? prior?.contamination ?? (variant.id === "baseline"
          ? detectContamination(raw.readPaths ?? [], frozen?.candidate.originalSkillPath ?? "", frozen ? dirname(frozen.candidate.originalSkillPath) : "") : null),
        isolation: raw.isolation ?? prior?.isolation,
        evidenceHashes: prior?.evidenceHashes,
        evidenceDir: join("cases", variant.id, task.id, attemptDir),
        error: isFailed ? (timedOut ? "运行超时" : raw.stderr?.slice(0, 300) || "运行失败或输出缺失") : null,
      });
    }
  }
  const effectiveOptions = { variants, tasks: options.tasks, repeat, judgeRepeat: frozen?.judgeRepeat ?? stored?.judgeRepeat, judgeSeed: frozen?.judgeSeed, runId: stored?.runId ?? frozen?.runId };
  const pairwise = recomputePairwise(runRoot, effectiveOptions, results);
  // 预定 pair 从冻结矩阵恢复，不能通过删除失败运行来缩小分母。
  const baseline = variants.find((variant) => variant.id === "baseline" || variant.skillPaths.length === 0);
  if (baseline && repeat > 0) for (const variant of variants) {
    if (variant.id === baseline.id) continue;
    for (const task of collectionTasks) for (let attempt = 1; attempt <= repeat; attempt++) {
      if (pairwise.some((pair) => pair.variantId === variant.id && pair.taskId === task.id && pair.attempt === attempt)) continue;
      pairwise.push({
        baselineResultId: `${sanitizeId(baseline.id)}-${sanitizeId(task.id)}-${attempt}`,
        variantResultId: `${sanitizeId(variant.id)}-${sanitizeId(task.id)}-${attempt}`,
        variantId: variant.id, taskId: task.id, attempt, verdict: "not_judged",
        scoreDelta: null, baselineScore: null, variantScore: null, confidence: null,
        reason: "冻结矩阵中的运行或评委产物缺失，保留为未评判", error: null, judgeRuns: [], biasProbe: null,
      });
    }
  }
  const actualResults = new Map(results.map((result) => [result.id, result]));
  for (const pair of pairwise) {
    const base = actualResults.get(pair.baselineResultId);
    const candidate = actualResults.get(pair.variantResultId);
    if (!base || !candidate || base.status !== "success" || candidate.status !== "success") {
      pair.verdict = "not_judged";
      pair.scoreDelta = null;
      pair.baselineScore = null;
      pair.variantScore = null;
      pair.confidence = null;
      pair.reason = "配对原始运行缺失或失败；旧评委轮次仅作诊断保留";
    }
  }
  const integrity = checkRunIntegrity(runRoot, manifest, stored?.results ?? []);
  integrity.issues.push(...issues);
  integrity.verified = integrity.verified && issues.length === 0;
  const missing = repeat > 0 && results.length < variants.length * collectionTasks.length * repeat;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const status: EvaluationSummary["status"] = missing || issues.length > 0 ? "partial"
    : results.length === 0 ? stored?.status ?? "failed"
    : failedCount === 0 ? "success" : failedCount === results.length ? "failed" : "partial";
  return {
    runId: stored?.runId ?? frozen?.runId ?? basename(runRoot),
    model: frozen?.model ?? stored?.model ?? "（未记录）",
    judgeModel: frozen?.judgeModel ?? stored?.judgeModel ?? "（未记录）",
    repeat, judgeRepeat: frozen?.judgeRepeat ?? stored?.judgeRepeat ?? 0,
    tasks: options.tasks, manifest: frozen,
    policyVersion: "paired-task-v2", integrity,
    isolation: {
      verified: !missing && results.length > 0 && results.every((r) => r.isolation?.verified === true),
      issues: [...new Set(results.flatMap((r) => r.isolation?.issues ?? ["历史运行缺少访问隔离验证记录"]).concat(missing ? ["存在未验证的缺失运行"] : []))],
    },
    startedAt: stored?.startedAt ?? 0, endedAt: stored?.endedAt ?? 0, durationSec: stored?.durationSec ?? 0,
    status, results, pairwise,
    variantSummaries: summarizeVariants(effectiveOptions as RunnerOptions, results, pairwise),
    taskSummaries: summarizeTasks(effectiveOptions as RunnerOptions, results, pairwise),
    disagreements: findDisagreements(effectiveOptions as RunnerOptions, results, pairwise),
    totalCost: results.reduce((acc, r) => acc + r.totalCost, 0),
    totalTokens: results.reduce((acc, r) => acc + r.totalTokens, 0),
    suiteMeta: stored?.suiteMeta ?? frozen?.suiteMeta,
  };
}

/**
 * 从运行记录与 pairwise/ 目录归集全部成对评判（包含因崩溃/超时未评判的 not_judged 对）。
 *
 * 此前仅扫描 pairwise/ 目录，导致运行失败而未建立 pairwise 子目录的样本在重算时静默消失，
 * notJudged 归零、分母缩小。现在与 judgeAll 保持完全一致的分母语义。
 */
function recomputePairwise(
  runRoot: string,
  options: { variants: Variant[]; tasks: EvalTask[]; judgeRepeat?: number; judgeSeed?: string; runId?: string },
  results: RunResult[],
): PairwiseResult[] {
  const pairwiseDir = join(runRoot, "pairwise");
  const output: PairwiseResult[] = [];
  const seenVariantResultIds = new Set<string>();

  const baseline = options.variants.find((v) => v.skillPaths.length === 0 || v.id === "baseline");
  if (baseline && results.length > 0) {
    const baselineByKey = new Map(
      results
        .filter((r) => r.variantId === baseline.id)
        .map((r) => [pairwiseKey(r.taskId, r.attempt), r]),
    );

    for (const result of results) {
      if (result.variantId === baseline.id) continue;
      const base = baselineByKey.get(pairwiseKey(result.taskId, result.attempt));
      if (!base) continue;

      seenVariantResultIds.add(result.id);
      const caseDir = join(pairwiseDir, result.id);

      if (base.status !== "success" || result.status !== "success" || !existsSync(caseDir)) {
        output.push({
          baselineResultId: base.id,
          variantResultId: result.id,
          variantId: result.variantId,
          taskId: result.taskId,
          attempt: result.attempt,
          verdict: "not_judged",
          scoreDelta: null,
          baselineScore: null,
          variantScore: null,
          confidence: null,
          reason:
            base.status !== "success" || result.status !== "success"
              ? "baseline 或 variant 运行失败，未评判"
              : "未找到评委产物，未评判",
          error: null,
          judgeRuns: [],
          biasProbe: null,
        });
        continue;
      }

      const { judged, biasProbe } = readJudgeDirs(caseDir, options.judgeSeed && options.judgeRepeat ? { seed: options.judgeSeed, taskKey: basename(caseDir), repeat: options.judgeRepeat } : undefined);
      if (judged.length === 0) {
        output.push({
          baselineResultId: base.id,
          variantResultId: result.id,
          variantId: result.variantId,
          taskId: result.taskId,
          attempt: result.attempt,
          verdict: "not_judged",
          scoreDelta: null,
          baselineScore: null,
          variantScore: null,
          confidence: null,
          reason: "评委轮次为空，未评判",
          error: null,
          judgeRuns: [],
          biasProbe: null,
        });
        continue;
      }

      const aggregated = aggregateJudgeRuns(judged);
      output.push({
        baselineResultId: base.id,
        variantResultId: result.id,
        variantId: result.variantId,
        taskId: result.taskId,
        attempt: result.attempt,
        verdict: aggregated.verdict,
        scoreDelta: aggregated.scoreDelta,
        baselineScore: aggregated.scoreA,
        variantScore: aggregated.scoreB,
        confidence: aggregated.confidence,
        reason: aggregated.reason,
        error: aggregated.error,
        judgeRuns: judged,
        biasProbe,
      });
    }
  }

  // 兜底：若 cases/ 已被清理、仅保留了 pairwise/，仍从目录读取剩余评判记录。
  if (existsSync(pairwiseDir)) {
    const variantIds = options.variants.map((variant) => variant.id).sort((a, b) => b.length - a.length);
    for (const entry of readdirSync(pairwiseDir)) {
      if (seenVariantResultIds.has(entry)) continue;
      const caseDir = join(pairwiseDir, entry);
      if (!existsSync(caseDir)) continue;

      const parsedId = parseResultId(entry, variantIds);
      if (!parsedId) continue;
      const { variantId, taskId, attempt } = parsedId;

      const { judged, biasProbe } = readJudgeDirs(caseDir, options.judgeSeed && options.judgeRepeat ? { seed: options.judgeSeed, taskKey: basename(caseDir), repeat: options.judgeRepeat } : undefined);
      if (judged.length === 0) continue;

      const aggregated = aggregateJudgeRuns(judged);
      output.push({
        baselineResultId: `baseline-${taskId}-${attempt}`,
        variantResultId: entry,
        variantId,
        taskId,
        attempt,
        verdict: aggregated.verdict,
        scoreDelta: aggregated.scoreDelta,
        baselineScore: aggregated.scoreA,
        variantScore: aggregated.scoreB,
        confidence: aggregated.confidence,
        reason: aggregated.reason,
        error: aggregated.error,
        judgeRuns: judged,
        biasProbe,
      });
    }
  }

  return output;
}

/**
 * 解析 `<variantId>-<taskId>-<attempt>` 形式的运行 ID。
 */
export function parseResultId(
  id: string,
  variantIds: string[],
): { variantId: string; taskId: string; attempt: number } | null {
  const sorted = [...variantIds].sort((a, b) => b.length - a.length);

  for (const variantId of sorted) {
    const prefix = `${variantId}-`;
    if (!id.startsWith(prefix)) continue;

    const rest = id.slice(prefix.length);
    const dashIndex = rest.lastIndexOf("-");
    if (dashIndex <= 0) continue;

    const taskId = rest.slice(0, dashIndex);
    const attempt = Number(rest.slice(dashIndex + 1));
    if (!taskId || !Number.isInteger(attempt)) continue;

    return { variantId, taskId, attempt };
  }
  return null;
}

/**
 * 读取一个 pairwise case 目录下的评委轮次，同时恢复位置偏好探测结果。
 */
export function readJudgeDirs(caseDir: string, frozen?: { seed: string; taskKey: string; repeat: number }): { judged: JudgeResult[]; biasProbe: BiasProbe | null } {
  const unknown = (reason: string, round?: JudgeRoundPlan): JudgeResult => ({
    verdict: "not_judged", scoreA: null, scoreB: null, scoreDelta: null, confidence: null,
    reason, error: reason,
    ...(round ? { roundIndex: round.roundIndex, swapped: round.swapped } : {}),
  });
  const frozenRounds = frozen ? buildJudgeSchedule(frozen.seed, frozen.taskKey, frozen.repeat) : null;
  const invalidPlan = (reason: string) => ({ judged: frozenRounds ? frozenRounds.map((round) => unknown(reason, round)) : [unknown(reason)], biasProbe: null });
  const planPath = join(caseDir, "judge-plan.json");
  if (frozenRounds && !existsSync(planPath)) return invalidPlan("冻结的评委计划缺失");
  let rounds: JudgeRoundPlan[] | null = null;
  if (existsSync(planPath)) {
    try {
      const plan = JSON.parse(readFileSync(planPath, "utf8")) as {
        protocolVersion?: string; seed?: string; taskKey?: string; rounds?: JudgeRoundPlan[];
      };
      const expected = frozenRounds ?? (typeof plan.seed === "string" && typeof plan.taskKey === "string" && plan.rounds?.length
        ? buildJudgeSchedule(plan.seed, plan.taskKey, plan.rounds.length) : null);
      if (plan.protocolVersion !== JUDGE_PROTOCOL_VERSION || !expected ||
          (frozen && (plan.seed !== frozen.seed || plan.taskKey !== frozen.taskKey)) || JSON.stringify(expected) !== JSON.stringify(plan.rounds)) {
        return invalidPlan("评委计划无效或与独立冻结的轮数、种子和顺序不一致");
      }
      rounds = expected;
    } catch {
      return invalidPlan("评委计划无法读取");
    }
  }
  const judged: JudgeResult[] = [];
  if (rounds) {
    for (const round of rounds) {
      const resultPath = join(caseDir, round.dirName, "judgment.json");
      if (!existsSync(resultPath)) {
        judged.push(unknown("冻结的评委轮次产物缺失", round));
        continue;
      }
      try {
        const raw = JSON.parse(readFileSync(resultPath, "utf8")) as JudgeResult;
        if (raw.protocolVersion !== JUDGE_PROTOCOL_VERSION || raw.swapped !== round.swapped || raw.roundIndex !== round.roundIndex) {
          judged.push(unknown("评委轮次协议或方向与冻结计划不一致", round));
          continue;
        }
        judged.push(reconcileJudgeRun(raw, round.swapped));
      } catch {
        judged.push(unknown("评委轮次产物无法读取", round));
      }
    }
  } else {
    // 历史轮次没有明确语义/顺序协议，保留原始证据供诊断，不猜标签方向并重写旧结论。
    for (const roundDir of readdirSync(caseDir).sort()) {
      const outputPath = join(caseDir, roundDir, "output.md");
      if (!existsSync(outputPath)) continue;
      const parsed = parseJudgeResponse(readFileSync(outputPath, "utf8"), {
        judgeDir: join(caseDir, roundDir), task: "", outputA: "", outputB: "", runId: basename(caseDir),
      });
      judged.push({
        ...parsed, verdict: "not_judged", semanticsStatus: "legacy_ambiguous",
        reason: `旧评委协议未冻结标签方向，仅作诊断：${parsed.reason}`,
        error: "legacy judge semantics are ambiguous",
      });
    }
  }
  const forward = judged.find((run) => run.swapped === false);
  const reversed = judged.find((run) => run.swapped === true);
  return { judged, biasProbe: forward && reversed ? detectPositionBias(forward.verdict, reversed.verdict) : null };
}

function readOutput(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}
