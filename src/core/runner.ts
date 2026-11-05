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
 * - 失败计入分母，不做选择性重跑。
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { runPi } from "./pi.ts";
import { detectActivation, summarizeActivation, type ActivationResult } from "./activation.ts";
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
import { scoreEfcRuns, type EfcScore, type EfcValidity } from "./efc.ts";

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
   * - `diagnostic` 仅诊断不计入胜率（用于无区分度的用例）
   */
  kind?: "scored" | "diagnostic";
  /** 难度画像，用于 EFC 归一化。 */
  difficulty?: {
    minSteps: number;
    toolAmbiguity: number;
    stateTracking: number;
    observationNoise: number;
    oracleVisibility: number;
  };
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
  /** 证据目录（相对 runRoot）。 */
  evidenceDir: string;
  error: string | null;
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
  activationRate: number;
  weakActivationRate: number;
  assertionPassRate: number | null;
  /** win / (win + tie + loss) */
  winRate: number | null;
  win: number;
  tie: number;
  loss: number;
  notJudged: number;
  avgTokens: number;
  avgCost: number;
  avgDurationSec: number;
  avgToolCalls: number;
  efc: EfcScore | null;
}

export interface TaskSummary {
  taskId: string;
  kind: "scored" | "diagnostic";
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
   * 但归档等下游动作需要知道「这次测的是哪套断言」。
   */
  suiteMeta?: {
    suiteId: string;
    suiteVersion: string;
    skillVersion: string;
    /** 被测 skill 路径。 */
    skillPath: string;
  };
}

export interface Disagreement {
  taskId: string;
  attempt: number;
  variantId: string;
  /** 规则断言对该次运行的判定。 */
  assertionPassed: boolean;
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

  const activation = detectActivation({
    skillPaths: variant.skillPaths,
    readPaths: run.metrics.readPaths,
    output,
    keywordSignal: options.keywordSignal,
  });

  const assertions = task.assertions?.length ? evaluateAssertions(output, task.assertions) : null;

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
        status: run.exitCode === 0 && output ? "success" : "failed",
        durationSec: (endedAt - startedAt) / 1000,
        totalTokens: run.metrics.totalTokens,
        totalCost: run.metrics.totalCost,
        toolCalls: run.metrics.toolCalls,
        readPaths: run.metrics.readPaths,
        activation,
        assertions,
        stderr: run.stderr.slice(0, 2000),
        timedOut: run.timedOut,
      },
      null,
      2,
    ),
    "utf8",
  );

  const failed = run.exitCode !== 0 || !output;
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
    evidenceDir: join("cases", variant.id, task.id, String(attempt)),
    error: failed
      ? run.timedOut
        ? "运行超时"
        : `退出码 ${String(run.exitCode)}，${run.stderr.slice(0, 300)}`
      : null,
  };
}

/**
 * 对每个 (task, attempt) 做 baseline vs variant 的成对评判。
 *
 * 顺序随机化以消除位置偏好；judgeRepeat ≥ 2 时额外跑一次反向顺序，
 * 用于探测评委的位置偏差。
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

    const runs: JudgeResult[] = [];
    // 位置偏好探测：第 2 轮起交换顺序。
    const forward = await runPairwiseJudge({
      judgeDir: join(judgeDir, "forward"),
      runId: `${options.runId}-${result.id}-fwd`,
      task: task.prompt,
      expectedPoints: task.expectedPoints,
      rubric: task.rubric,
      outputA: base.output,
      outputB: result.output,
      model: options.judgeModel,
      home: options.home,
      timeoutMs: options.judgeTimeoutMs,
    });
    runs.push(reconcileJudgeRun(forward, false));

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
        model: options.judgeModel,
        home: options.home,
        timeoutMs: options.judgeTimeoutMs,
      });
      // 反向轮次只用于位置偏好探测，**不参与主判定聚合**。
      // 否则同一份评委输出会被计成两票（reversed 与 flipped 是同一次判定的两种解读），
      // 人为放大票权，且把「位置偏差」混进「质量差异」。
      //
      // 反向轮的 A/B 与正轮相反（A=skill、B=baseline），必须换算回正轮口径
      // 再做标签校验——否则会把「顺序不同」误判成「评委自相矛盾」。
      const flipped: JudgeResult = reconcileJudgeRun(reversed, true);
      flippedRun = flipped;
      biasProbe = detectPositionBias(forward.verdict, flipped.verdict);
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

/** 汇总每个 variant 的表现。 */
export function summarizeVariants(
  options: RunnerOptions,
  results: RunResult[],
  pairwise: PairwiseResult[],
): VariantSummary[] {
  return options.variants.map((variant) => {
    const rows = results.filter((result) => result.variantId === variant.id);
    const activation = summarizeActivation(rows);
    const successful = rows.filter((result) => result.status === "success");

    const judged = pairwise.filter(
      (item) => item.variantId === variant.id && item.verdict !== "not_judged",
    );
    const win = judged.filter((item) => item.verdict === "win").length;
    const tie = judged.filter((item) => item.verdict === "tie").length;
    const loss = judged.filter((item) => item.verdict === "loss").length;
    const notJudged = pairwise.filter(
      (item) => item.variantId === variant.id && item.verdict === "not_judged",
    ).length;
    const decided = win + tie + loss;

    // 只统计可判定用例，避免诊断用例污染胜率。
    const scoredTaskIds = new Set(
      options.tasks.filter((task) => (task.kind ?? "scored") === "scored").map((task) => task.id),
    );
    const scoredJudged = judged.filter((item) => scoredTaskIds.has(item.taskId));
    const scoredWin = scoredJudged.filter((item) => item.verdict === "win").length;
    const scoredTie = scoredJudged.filter((item) => item.verdict === "tie").length;
    const scoredLoss = scoredJudged.filter((item) => item.verdict === "loss").length;
    const scoredDecided = scoredWin + scoredTie + scoredLoss;

    const assertionRows = rows.filter((row) => row.assertions && row.assertions.total > 0);
    const assertionPassRate = assertionRows.length
      ? assertionRows.reduce((acc, row) => acc + (row.assertions?.allPassed ? 1 : 0), 0) / assertionRows.length
      : null;

    return {
      variantId: variant.id,
      variantLabel: variant.label,
      total: rows.length,
      success: successful.length,
      failed: rows.length - successful.length,
      activationRate: activation.activationRate,
      weakActivationRate: activation.weakRate,
      assertionPassRate,
      winRate: scoredDecided > 0 ? scoredWin / scoredDecided : null,
      win,
      tie,
      loss,
      notJudged,
      avgTokens: average(successful.map((row) => row.totalTokens)),
      avgCost: average(successful.map((row) => row.totalCost)),
      avgDurationSec: average(successful.map((row) => row.durationSec)),
      avgToolCalls: average(successful.map((row) => row.toolCalls)),
      efc:
        rows.length > 0
          ? scoreEfcRuns(
              rows.map((row) => ({
                status: row.status,
                validity: efcValidity(row),
                hasOutput: row.output.length > 0,
                toolCalls: row.toolCalls,
                memorySignal: row.activation.activated ? "changed_plan" : "unknown",
                signature: `${row.taskId}:${row.status}:${row.output.slice(0, 80)}`,
                totalTokens: row.totalTokens,
              })),
            )
          : null,
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
    const assertionRows = rows.filter((row) => row.assertions && row.assertions.total > 0);
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

    // 只有双方都设了断言时才可比。
    if (!variantResult.assertions || !baselineResult.assertions) continue;
    if (variantResult.assertions.total === 0 || baselineResult.assertions.total === 0) continue;

    const assertionPassed = variantResult.assertions.allPassed;
    const baselinePassed = baselineResult.assertions.allPassed;

    // 规则断言给出的**相对**结论：skill 相对 baseline 是改善、倒退还是无差异。
    const objectiveVerdict: "win" | "loss" | "tie" =
      assertionPassed && !baselinePassed ? "win" : !assertionPassed && baselinePassed ? "loss" : "tie";

    // 与评委结论冲突时才算分歧。
    // 评委的 tie 表示「没看出相对差异」，与规则的 tie 对齐。
    const judgeVerdict: "win" | "loss" | "tie" =
      item.verdict === "win" ? "win" : item.verdict === "loss" ? "loss" : "tie";

    if (objectiveVerdict !== judgeVerdict) {
      disagreements.push({
        taskId: item.taskId,
        attempt: item.attempt,
        variantId: item.variantId,
        assertionPassed,
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

function efcValidity(result: RunResult): EfcValidity {
  if (result.status === "failed") return "runtime";
  if (result.assertions && result.assertions.total > 0) {
    return result.assertions.allPassed ? "passing" : "assertion";
  }
  return "passing";
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
 *
 * 用于 `report` 子命令：summary.json 里存的是当时算出的汇总，
 * 若汇总逻辑后来修正过，直接复用旧摘要会让报告继续显示已知错误。
 * 这里从 cases/ 下的原始 result.json 重新聚合，得到与当前代码一致的汇总。
 *
 * pairwise 判定来自评委产物（pairwise/），不重跑模型，只做结构化归集。
 *
 * 运行元信息（模型、repeat 次数、时间戳等）从原 summary.json 继承——
 * 重算的是汇总，不是运行环境，继承丢失会让报告把模型写成「（未记录）」。
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
          // 用**当前套件**重新评估断言，而不是沿用跑批时的旧结果。
          //
          // 理由：重算的目的就是「拿新套件重新看这批产物」——
          // 断言修订（放宽过严断言、补等价写法）只有这样才能生效。
          // 沿用旧结果会让「改套件后重算」看起来没反应，白白浪费一轮评估。
          //
          // 跑批失败（status=failed）时不重新评估——那不是「输出不合规」，
          // 而是「压根没拿到输出」，重算出来的断言结论会误导人。
          const taskAssertions = options.tasks.find((t) => t.id === raw.taskId)?.assertions;
          const assertions =
            raw.status === "success" && taskAssertions?.length
              ? evaluateAssertions(output, taskAssertions)
              : raw.assertions;

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
            error: raw.status === "failed" ? (raw.timedOut ? "运行超时" : raw.stderr?.slice(0, 300) ?? "未知错误") : null,
          });
        }
      }
    }
  }

  const pairwise = recomputePairwise(runRoot, options);

  // 运行元信息从原摘要继承：重算的是汇总，不是运行环境。
  const summaryPath = join(runRoot, "summary.json");
  const stored = existsSync(summaryPath)
    ? (JSON.parse(readFileSync(summaryPath, "utf8")) as EvaluationSummary)
    : undefined;

  return {
    runId: stored?.runId ?? basename(runRoot),
    model: stored?.model ?? "（未记录）",
    judgeModel: stored?.judgeModel ?? "（未记录）",
    repeat: stored?.repeat ?? 0,
    judgeRepeat: stored?.judgeRepeat ?? 0,
    startedAt: stored?.startedAt ?? 0,
    endedAt: stored?.endedAt ?? 0,
    durationSec: stored?.durationSec ?? 0,
    status: results.some((r) => r.status === "failed") ? "partial" : "success",
    results,
    pairwise,
    variantSummaries: summarizeVariants(options as never, results, pairwise),
    taskSummaries: summarizeTasks(options as never, results, pairwise),
    disagreements: findDisagreements(options as never, results, pairwise),
    totalCost: results.reduce((acc, result) => acc + result.totalCost, 0),
    totalTokens: results.reduce((acc, result) => acc + result.totalTokens, 0),
  };
}

/**
 * 从 pairwise/ 目录归集评委判定。
 *
 * 评委产物目录名形如 `pairwise/<variantResultId>/forward`、`.../reversed`，
 * 其中 reversed 需要对调分数才能与 forward 可比。
 */
function recomputePairwise(runRoot: string, options: { variants: Variant[]; tasks: EvalTask[] }): PairwiseResult[] {
  const pairwiseDir = join(runRoot, "pairwise");
  if (!existsSync(pairwiseDir)) return [];

  const output: PairwiseResult[] = [];

  // 结果 ID 形如 `<variantId>-<taskId>-<attempt>`。
  // taskId 本身可能含连字符（如 simple-answer），因此按已知 variantId 前缀切分，
  // 不能用贪婪正则——那会把 taskId 截断。
  const variantIds = options.variants.map((variant) => variant.id).sort((a, b) => b.length - a.length);

  for (const entry of readdirSync(pairwiseDir)) {
    const caseDir = join(pairwiseDir, entry);
    if (!existsSync(caseDir)) continue;

    const parsedId = parseResultId(entry, variantIds);
    if (!parsedId) continue;
    const { variantId, taskId, attempt } = parsedId;

    const judged = readJudgeDirs(caseDir);
    if (judged.length === 0) continue;

    const aggregated = aggregateJudgeRuns(judged);
    const baselineId = `baseline-${taskId}-${attempt}`;

    output.push({
      baselineResultId: baselineId,
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
      biasProbe: null,
    });
  }

  return output;
}

/**
 * 解析 `<variantId>-<taskId>-<attempt>` 形式的运行 ID。
 *
 * variantId 用已知前缀匹配，避免 taskId 含连字符时被截断。
 */
export function parseResultId(
  id: string,
  variantIds: string[],
): { variantId: string; taskId: string; attempt: number } | null {
  // 按长度降序匹配，保证更具体的 variantId 先命中（skill-expert 优先于 skill）。
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
 * 读取一个 pairwise case 目录下的评委轮次。
 *
 * 主判定轮为 forward 与 round-N；reversed 轮是位置偏好探测，不计入主判定。
 * 若所有主判定轮都失败，则降级使用 reversed 轮，避免因单轮故障丢失整条判定。
 */
function readJudgeDirs(caseDir: string): JudgeResult[] {
  const forwardRuns: JudgeResult[] = [];
  const reversedRuns: JudgeResult[] = [];

  for (const roundDir of readdirSync(caseDir)) {
    const roundPath = join(caseDir, roundDir);
    if (!existsSync(roundPath)) continue;

    // 评委输出保存在该目录的 output.md 中（pi 运行产物）。
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
      // 反向轮次的 A/B 是对调的，换回来才能与正向可比。
      // 走 reconcileJudgeRun：换算口径 + 标签校验，与跑批路径完全一致。
      reversedRuns.push(reconcileJudgeRun(parsed, true));
    } else {
      forwardRuns.push(reconcileJudgeRun(parsed, false));
    }
  }

  const usableForward = forwardRuns.filter((run) => run.verdict !== "not_judged");
  if (usableForward.length > 0) return forwardRuns;

  // 主判定轮全部失败，降级使用反向轮并标注来源。
  return reversedRuns.map((run) => ({ ...run, reason: `${run.reason}（主判定轮失败，降级采用反向轮）` }));
}

function readOutput(path: string): string {
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}
