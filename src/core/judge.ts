/**
 * 成对评委（pairwise judge）。
 *
 * 设计要点（源自 pi-xanthil，经本仓库加强）：
 *
 * 1. **相对判断优于绝对打分**。绝对分在不同批次间漂移严重；「A 是否比 B 好」更稳定。
 * 2. **匿名化**。评委不得知道哪份输出来自装了 skill 的一侧。顺序随机化，
 *    提示词中不出现 skill 名称、路径或「这是增强版」等暗示。
 * 3. **反偏置约束**。明确禁止因为更长、格式更复杂或自称使用了 skill 而给高分。
 * 4. **多轮多数票**。重复评判时按多数票聚合，但保留全部单次判定。
 * 5. **失败显式记录**。评委失败记为 `not_judged` 并保留错误，不静默丢弃。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runPi, type PiRunResult } from "./pi.ts";

export type Verdict = "win" | "tie" | "loss" | "not_judged";

export interface JudgeOptions {
  /** 评委运行的工作目录。 */
  judgeDir: string;
  /** 原始任务文本。 */
  task: string;
  /** 预期要点。 */
  expectedPoints?: string[];
  /** 评分标准。 */
  rubric?: string;
  /** 输出 A。 */
  outputA: string;
  /** 输出 B。 */
  outputB: string;
  /** 评委模型。 */
  model?: string | undefined;
  /** 隔离 HOME。 */
  home?: string | undefined;
  /** 运行标识。 */
  runId: string;
}

export interface JudgeResult {
  verdict: Verdict;
  scoreA: number | null;
  scoreB: number | null;
  /** scoreB - scoreA */
  scoreDelta: number | null;
  /** 0-1 */
  confidence: number | null;
  reason: string;
  error: string | null;
}

/**
 * 默认评分标准。
 *
 * 刻意不包含「skill 价值」这类会引导评委偏向某一侧的措辞，
 * 只要求评委基于任务质量判断。
 */
const DEFAULT_RUBRIC = [
  "正确性：回答满足原始任务要求，没有无依据的断言或事实错误。",
  "完整性：覆盖了任务要求的全部范围与预期要点，没有遗漏关键内容。",
  "可执行性：结论具体，用户能据此行动，而不是空泛表态。",
  "格式合规：满足任务明确指定的输出格式要求。",
].join("\n");

/**
 * 构造评委提示词。
 *
 * 注意提示词里只有「输出 A / 输出 B」中性称呼，不含任何来源暗示。
 */
export function buildJudgePrompt(options: JudgeOptions): string {
  const rubric = options.rubric?.trim() || DEFAULT_RUBRIC;
  const expectedPoints =
    options.expectedPoints?.filter((point) => point.trim()).map((point) => `- ${point.trim()}`).join("\n") ||
    "- 未提供显式预期要点，按任务本身的质量标准判断。";

  return `你是严格的输出质量评估员。请比较两份输出对同一任务的完成质量。

评分规则：
- 只根据「原始任务」「预期要点」「评分标准」和两份输出判断，不考虑输出来源。
- 不要因为某份输出更长、格式更复杂、排版更花哨就给它高分。
- 两份都满足或都不满足关键要求且差异很小时，返回 tie。
- 输出 B 遗漏关键要点、引入错误、偏离任务或降低可执行性时，返回 loss。
- scoreA 与 scoreB 必须是 0 到 100 的数字。
- confidence 必须是 0 到 1 的数字，表示你对 verdict 的置信度；证据不足或差异很小时用较低置信度。
- reason 必须引用具体差异点，不要复述任务。

# 原始任务
${options.task}

# 预期要点
${expectedPoints}

# 评分标准
${rubric}

# 输出 A
${options.outputA.slice(0, 12000)}

# 输出 B
${options.outputB.slice(0, 12000)}

只输出 JSON 对象，不要输出 Markdown，不要用代码块包裹：
{"verdict":"win|tie|loss","scoreA":0,"scoreB":0,"confidence":0.8,"reason":"一句话说明关键差异"}`;
}

/**
 * 执行一次成对评判。
 *
 * 失败时返回 `not_judged` 并附错误信息，不抛异常。
 */
export async function runPairwiseJudge(options: JudgeOptions): Promise<JudgeResult> {
  const prompt = buildJudgePrompt(options);
  const run: PiRunResult = await runPi({
    workspaceRoot: options.judgeDir,
    sessionId: `judge-${options.runId}`,
    prompt,
    model: options.model,
    // 评委不需要工具，也不需要任何 skill。
    skillPaths: [],
    home: options.home,
    timeoutMs: 120_000,
  });

  // 评委原始产物落盘，供复核与重算使用。
  mkdirSync(options.judgeDir, { recursive: true });
  writeFileSync(join(options.judgeDir, "output.md"), run.metrics.output, "utf8");
  writeFileSync(join(options.judgeDir, "prompt.md"), prompt, "utf8");
  writeFileSync(join(options.judgeDir, "events.json"), JSON.stringify(run.events, null, 2), "utf8");

  if (run.exitCode !== 0) {
    return {
      verdict: "not_judged",
      scoreA: null,
      scoreB: null,
      scoreDelta: null,
      confidence: null,
      reason: `评委运行失败（退出码 ${String(run.exitCode)}）`,
      error: run.stderr.slice(0, 500) || `exit code ${String(run.exitCode)}`,
    };
  }

  return parseJudgeResponse(run.metrics.output, options);
}

/** 解析评委输出。JSON 解析失败视为评委失败，而非判定为 tie。 */
export function parseJudgeResponse(text: string, options: JudgeOptions): JudgeResult {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const candidate = extractJsonObject(cleaned);

  try {
    const parsed = JSON.parse(candidate) as {
      verdict?: unknown;
      scoreA?: unknown;
      scoreB?: unknown;
      confidence?: unknown;
      reason?: unknown;
    };

    const verdict: Verdict =
      parsed.verdict === "win" || parsed.verdict === "tie" || parsed.verdict === "loss" ? parsed.verdict : "not_judged";
    const scoreA = typeof parsed.scoreA === "number" ? clamp(parsed.scoreA, 0, 100) : null;
    const scoreB = typeof parsed.scoreB === "number" ? clamp(parsed.scoreB, 0, 100) : null;
    const confidence = typeof parsed.confidence === "number" ? clamp(parsed.confidence, 0, 1) : null;

    return {
      verdict,
      scoreA,
      scoreB,
      scoreDelta: scoreA !== null && scoreB !== null ? scoreB - scoreA : null,
      confidence,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      error: verdict === "not_judged" ? "评委返回了非法 verdict（应为 win/tie/loss）" : null,
    };
  } catch {
    return {
      verdict: "not_judged",
      scoreA: null,
      scoreB: null,
      scoreDelta: null,
      confidence: null,
      reason: "评委输出无法解析为 JSON",
      error: text.slice(0, 500),
    };
  }
}

function extractJsonObject(text: string): string {
  if (text.startsWith("{") && text.endsWith("}")) return text;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 多轮评委聚合。
 *
 * 多数票；票数并列时按平均分差绝对值大的方向裁决；全失败则保持 not_judged。
 * 单次判定全部保留在 `judgeRuns`。
 */
export function aggregateJudgeRuns(runs: JudgeResult[]): JudgeResult {
  const judged = runs.filter((run) => run.verdict !== "not_judged");
  if (judged.length === 0) {
    const first = runs[0];
    return {
      verdict: "not_judged",
      scoreA: null,
      scoreB: null,
      scoreDelta: null,
      confidence: null,
      reason: "所有评委轮次均失败",
      error: first?.error ?? "no successful judge runs",
    };
  }

  const counts: Record<Exclude<Verdict, "not_judged">, number> = { win: 0, tie: 0, loss: 0 };
  for (const run of judged) {
    if (run.verdict !== "not_judged") counts[run.verdict] += 1;
  }

  const maxCount = Math.max(counts.win, counts.tie, counts.loss);
  const tied = (["win", "tie", "loss"] as const).filter((verdict) => counts[verdict] === maxCount);

  let verdict: Verdict;
  if (tied.length === 1) {
    verdict = tied[0]!;
  } else {
    const avgDelta = (candidate: "win" | "loss"): number => {
      const deltas = judged
        .filter((run) => run.verdict === candidate)
        .map((run) => run.scoreDelta)
        .filter((value): value is number => typeof value === "number");
      return deltas.length ? deltas.reduce((acc, value) => acc + value, 0) / deltas.length : 0;
    };
    verdict =
      Math.abs(avgDelta("win")) >= Math.abs(avgDelta("loss")) ? "win" : "loss";
  }

  return {
    verdict,
    scoreA: average(judged.map((run) => run.scoreA)),
    scoreB: average(judged.map((run) => run.scoreB)),
    scoreDelta: average(judged.map((run) => run.scoreDelta)),
    confidence: average(judged.map((run) => run.confidence)),
    reason: `聚合 ${judged.length}/${runs.length} 轮（win:${counts.win} tie:${counts.tie} loss:${counts.loss}）`,
    error: null,
  };
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((value): value is number => typeof value === "number");
  if (!valid.length) return null;
  return valid.reduce((acc, value) => acc + value, 0) / valid.length;
}

/**
 * 交换 A/B 顺序再判一次，用于探测评委的位置偏好。
 *
 * 这是本仓库相对 pi-xanthil 的加强项：若正反两次结论系统性相反，
 * 说明评委有位置偏差，其结论可信度需要打折。
 */
export interface BiasProbe {
  forward: Verdict;
  reversed: Verdict;
  /** 是否检测到位置偏好。 */
  biased: boolean;
  note: string;
}

export function detectPositionBias(forward: Verdict, reversed: Verdict): BiasProbe {
  if (forward === "not_judged" || reversed === "not_judged") {
    return { forward, reversed, biased: false, note: "存在未判定轮次，无法检测位置偏好" };
  }
  const flips = (forward === "win" && reversed === "loss") || (forward === "loss" && reversed === "win");
  return {
    forward,
    reversed,
    biased: flips,
    note: flips
      ? "正反两次结论相反，评委存在位置偏好，该判定可信度需打折"
      : "正反两次结论一致或并列，未检测到明显位置偏好",
  };
}
