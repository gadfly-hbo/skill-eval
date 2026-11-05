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
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { runPi } from "./pi.ts";
import { detectActivation, summarizeActivation, type ActivationResult } from "./activation.ts";
import { detectContamination, type ContaminationReport } from "./contamination.ts";
import { evaluateAssertions, type Assertion, type AssertionReport } from "./assertions.ts";
import {
  runPairwiseJudge,
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
import { computeAssertionItemRate, computeGainPp } from "./gain.ts";
import { wilsonInterval } from "./stats.ts";

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
  const judgeRepeat = options.judgeRepeat ?? 1;

  mkdirSync(options.runRoot, { recursive: true });

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
  };
}

/**
 * 对每个 (task, attempt) 做 baseline vs variant 的成对评判。
 *
 * judgeRepeat ≥ 2 时额外跑一次反向顺序，用于探测评委的位置偏差。
 */
async function judgeAll(
  options: RunnerOptions,
  results: RunResult[],
  judgeRepeat: number,
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
        reason: "baseline 或 variant 运行失败，未评判",
        error: null,
        judgeRuns: [],
        biasProbe: null,
      });
      continue;
    }

    const judgeDir = join(options.runRoot, "pairwise", result.id);
    mkdirSync(judgeDir, { recursive: true });

    // 执行证据：评委只看到两份输出，看不到工具调用记录，
    // 于是把「确实跑过脚本」误判成「无依据断言」（实测 2026-11-05 data-analysis）。
    // 这里从两端的 events.json 提取摘要注入评委提示词。
    const evidenceA = loadEvidenceFromDir(join(options.runRoot, base.evidenceDir));
    const evidenceB = loadEvidenceFromDir(join(options.runRoot, result.evidenceDir));

    const runs: JudgeResult[] = [];
    const forward = await runPairwiseJudge({
      judgeDir: join(judgeDir, "forward"),
      runId: `${options.runId}-${result.id}-fwd`,
      task: task.prompt,
      expectedPoints: task.expectedPoints,
      rubric: task.rubric,
      outputA: base.output,
      outputB: result.output,
      evidenceA,
      evidenceB,
      model: options.judgeModel,
      home: options.home,
      timeoutMs: options.judgeTimeoutMs,
    });
    const reconciledForward = reconcileJudgeRun(forward, false);
    runs.push(reconciledForward);

    let biasProbe: BiasProbe | null = null;
    let flippedRun: JudgeResult | null = null;
    if (judgeRepeat >= 2) {
      const reversed = await runPairwiseJudge({
        judgeDir: join(judgeDir, "reversed"),
        runId: `${options.runId}-${result.id}-rev`,
        task: task.prompt,
        expectedPoints: task.expectedPoints,
        rubric: task.rubric,
        outputA: result.output,
        outputB: base.output,
        evidenceA: evidenceB,
        evidenceB: evidenceA,
        model: options.judgeModel,
        home: options.home,
        timeoutMs: options.judgeTimeoutMs,
      });
      const flipped: JudgeResult = reconcileJudgeRun(reversed, true);
      flippedRun = flipped;
      biasProbe = detectPositionBias(reconciledForward.verdict, flipped.verdict);
    }

    // 补齐剩余轮次（正向）。
    for (let round = 2; round < judgeRepeat; round += 1) {
      const extra = await runPairwiseJudge({
        judgeDir: join(judgeDir, `round-${round}`),
        runId: `${options.runId}-${result.id}-r${round}`,
        task: task.prompt,
        expectedPoints: task.expectedPoints,
        rubric: task.rubric,
        outputA: base.output,
        outputB: result.output,
        evidenceA,
        evidenceB,
        model: options.judgeModel,
        home: options.home,
        timeoutMs: options.judgeTimeoutMs,
      });
      runs.push(reconcileJudgeRun(extra, false));
    }

    // 主判定轮（forward + round-N）全部失败时，降级使用反向轮，避免丢失整条判定。
    const usableForward = runs.filter((run) => run.verdict !== "not_judged");
    const aggregated = aggregateJudgeRuns(
      usableForward.length > 0 || !flippedRun
        ? runs
        : [
            ...runs,
            {
              ...flippedRun,
              reason: `${flippedRun.reason}（主判定轮失败，降级采用反向轮）`,
            },
          ],
    );

    outputs.push({
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
      judgeRuns: runs,
      biasProbe,
    });

    options.onProgress?.({
      phase: "judge",
      variantId: result.variantId,
      taskId: result.taskId,
      attempt: result.attempt,
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
  const baselineSuccessful = baselineRows.filter((r) => r.status === "success");
  const baselineAvgTokens = average(baselineSuccessful.map((r) => r.totalTokens));
  const baselineAvgDurationSec = average(baselineSuccessful.map((r) => r.durationSec));
  const baselineItemRate = baselineVariant ? computeAssertionItemRate(results, baselineVariant.id) : null;

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

    const variantItemRate = !isBaseline ? computeAssertionItemRate(results, variant.id) : null;
    const gainPp = !isBaseline ? computeGainPp(baselineItemRate, variantItemRate) : null;
    const costEfficiency =
      !isBaseline && successful.length > 0 && baselineSuccessful.length > 0
        ? evaluateCostEfficiency({
            baselineAvgTokens,
            variantAvgTokens: avgTokens,
            baselineAvgDurationSec,
            variantAvgDurationSec: avgDurationSec,
            gainPp,
          })
        : null;

    return {
      variantId: variant.id,
      variantLabel: variant.label,
      total: rows.length,
      success: successful.length,
      failed: rows.length - successful.length,
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
  options: { variants: Variant[]; tasks: EvalTask[] },
): Promise<EvaluationSummary> {
  const casesDir = join(runRoot, "cases");
  const results: RunResult[] = [];

  if (existsSync(casesDir)) {
    for (const variant of options.variants) {
      const variantDir = join(casesDir, variant.id);
      if (!existsSync(variantDir)) continue;

      for (const task of options.tasks) {
        const taskDir = join(variantDir, task.id);
        if (!existsSync(taskDir)) continue;

        for (const attemptDir of readdirSync(taskDir)) {
          const resultPath = join(taskDir, attemptDir, "result.json");
          if (!existsSync(resultPath)) continue;

          const raw = JSON.parse(readFileSync(resultPath, "utf8")) as {
            id: string;
            variantId: string;
            taskId: string;
            attempt: number;
            status: "success" | "failed";
            durationSec: number;
            totalTokens: number;
            totalCost: number;
            toolCalls: number;
            activation: ActivationResult;
            assertions: AssertionReport | null;
            stderr?: string;
            timedOut?: boolean;
          };

          const output = readOutput(join(taskDir, attemptDir, "output.md"));
          const isFailed = raw.status === "failed";
          const taskAssertions = options.tasks.find((t) => t.id === raw.taskId)?.assertions;
          // 失败用例一律清空断言（含清除旧版本在空输出上残留的 mustNotMatch 假通过）。
          const assertions = isFailed
            ? null
            : taskAssertions?.length
              ? evaluateAssertions(output, taskAssertions)
              : raw.assertions;

          const timedOut =
            raw.timedOut === true ||
            Boolean(isFailed && raw.stderr && /timeout|超时/i.test(raw.stderr));

          results.push({
            id: raw.id,
            variantId: raw.variantId,
            variantLabel: options.variants.find((v) => v.id === raw.variantId)?.label ?? raw.variantId,
            taskId: raw.taskId,
            attempt: raw.attempt,
            status: raw.status,
            startedAt: 0,
            endedAt: 0,
            durationSec: raw.durationSec,
            skillPaths: options.variants.find((v) => v.id === raw.variantId)?.skillPaths ?? [],
            totalTokens: raw.totalTokens,
            totalCost: raw.totalCost,
            toolCalls: raw.toolCalls,
            output,
            activation: raw.activation,
            assertions,
            evidenceDir: join("cases", raw.variantId, raw.taskId, String(raw.attempt)),
            error: isFailed ? (timedOut ? "运行超时" : raw.stderr?.slice(0, 300) ?? "未知错误") : null,
            timedOut,
          });
        }
      }
    }
  }

  const pairwise = recomputePairwise(runRoot, options, results);

  const summaryPath = join(runRoot, "summary.json");
  const stored = existsSync(summaryPath)
    ? (JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary)
    : undefined;

  const failedCount = results.filter((r) => r.status === "failed").length;
  const computedStatus: EvaluationSummary["status"] =
    results.length === 0
      ? (stored?.status ?? "failed")
      : failedCount === 0
        ? "success"
        : failedCount === results.length
          ? "failed"
          : "partial";

  return {
    runId: stored?.runId ?? basename(runRoot),
    model: stored?.model ?? "（未记录）",
    judgeModel: stored?.judgeModel ?? "（未记录）",
    repeat: stored?.repeat ?? 0,
    judgeRepeat: stored?.judgeRepeat ?? 0,
    startedAt: stored?.startedAt ?? 0,
    endedAt: stored?.endedAt ?? 0,
    durationSec: stored?.durationSec ?? 0,
    status: computedStatus,
    results,
    pairwise,
    variantSummaries: summarizeVariants(options as never, results, pairwise),
    taskSummaries: summarizeTasks(options as never, results, pairwise),
    disagreements: findDisagreements(options as never, results, pairwise),
    totalCost: results.reduce((acc, result) => acc + result.totalCost, 0),
    totalTokens: results.reduce((acc, result) => acc + result.totalTokens, 0),
    suiteMeta: stored?.suiteMeta,
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
  options: { variants: Variant[]; tasks: EvalTask[] },
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

      const { judged, biasProbe } = readJudgeDirs(caseDir);
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

      const { judged, biasProbe } = readJudgeDirs(caseDir);
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
function readJudgeDirs(caseDir: string): { judged: JudgeResult[]; biasProbe: BiasProbe | null } {
  const forwardRuns: JudgeResult[] = [];
  const reversedRuns: JudgeResult[] = [];

  for (const roundDir of readdirSync(caseDir)) {
    const roundPath = join(caseDir, roundDir);
    if (!existsSync(roundPath)) continue;

    const outputPath = join(roundPath, "output.md");
    if (!existsSync(outputPath)) continue;

    const text = readFileSync(outputPath, "utf8");
    const parsed = parseJudgeResponse(text, {
      judgeDir: roundPath,
      task: "",
      outputA: "",
      outputB: "",
      runId: basename(caseDir),
    });

    if (roundDir === "reversed") {
      reversedRuns.push(reconcileJudgeRun(parsed, true));
    } else {
      forwardRuns.push(reconcileJudgeRun(parsed, false));
    }
  }

  const biasProbe =
    forwardRuns[0] && reversedRuns[0]
      ? detectPositionBias(forwardRuns[0].verdict, reversedRuns[0].verdict)
      : null;

  const usableForward = forwardRuns.filter((run) => run.verdict !== "not_judged");
  if (usableForward.length > 0) return { judged: forwardRuns, biasProbe };

  return {
    judged: reversedRuns.map((run) => ({ ...run, reason: `${run.reason}（主判定轮失败，降级采用反向轮）` })),
    biasProbe,
  };
}

function readOutput(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}
