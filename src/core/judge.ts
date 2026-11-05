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
  /** 评委单次超时。默认 `DEFAULT_JUDGE_TIMEOUT_MS`。 */
  timeoutMs?: number;
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
  /**
   * 标签与分差方向冲突时的纠正记录。
   *
   * 评委偶尔会给出自相矛盾的输出：标签说 A 更好，分数却说 B 更高。
   * 实测（2026-11-05 data-analysis）出现
   * `{"verdict":"loss","scoreA":65,"scoreB":90}`——分差 +25 方向应为 win，
   * 且 reason 文字也明确说 B 更好，标签却写 loss。
   *
   * 这一条就能翻转整轮 verdict（5/10=50% inconclusive ↔ 6/10=60% effective），
   * 因此工具必须自己校验，不能全盘采信模型标签。
   */
  labelConflict?: LabelConflict | null;
}

export interface LabelConflict {
  /** 评委原始返回的标签。 */
  originalVerdict: Verdict;
  /** 以分差方向为准纠正后的标签。 */
  correctedVerdict: Verdict;
  /** 触发纠正的分差绝对值。 */
  scoreDelta: number;
  /** 纠正说明。 */
  note: string;
}

/**
 * 触发纠正的最小分差阈值。
 *
 * 实测数据里的边界情况：4 条 tie 的分差在 ±1~2 之间——那是评委在表达
 * 「差异很小」，属于合理容差，不是矛盾。因此阈值取 10：
 * 分差 ≥ 10 分（0-100 尺度）时，「B 分数明显更高」与「判 A 胜」不可能同时成立。
 */
export const LABEL_CONFLICT_MIN_DELTA = 10;

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

/** 评委提示词单份输出最大保留字符数（头尾保留窗口，防止静默截断末尾结论/出处/免责声明）。 */
export const JUDGE_MAX_OUTPUT_CHARS = 24_000;
export const JUDGE_HEAD_CHARS = 18_000;
export const JUDGE_TAIL_CHARS = 6_000;

/**
 * 对超长输出做头尾保留采样，避免 `.slice(0, 12000)` 静默截断报告末尾的结论、参考文献与免责声明。
 */
export function formatJudgeOutputWindow(
  text: string,
  maxChars: number = JUDGE_MAX_OUTPUT_CHARS,
  headChars: number = JUDGE_HEAD_CHARS,
  tailChars: number = JUDGE_TAIL_CHARS,
): string {
  if (text.length <= maxChars) return text;
  const safeHead = Math.min(headChars, Math.floor(maxChars * 0.75));
  const safeTail = Math.min(tailChars, maxChars - safeHead);
  const omitted = text.length - safeHead - safeTail;
  if (omitted <= 0) return text;
  return (
    text.slice(0, safeHead) +
    `\n\n[...中间省略 ${omitted.toLocaleString()} 字符，以下保留输出末尾段落（结论/出处/声明）...]\n\n` +
    text.slice(text.length - safeTail)
  );
}

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
${formatJudgeOutputWindow(options.outputA)}

# 输出 B
${formatJudgeOutputWindow(options.outputB)}

只输出 JSON 对象，不要输出 Markdown，不要用代码块包裹：
{"verdict":"win|tie|loss","scoreA":0,"scoreB":0,"confidence":0.8,"reason":"一句话说明关键差异"}`;
}

/**
 * 评委单次运行的默认超时。
 *
 * 原为 120s，实测（2026-11-05 data-analysis）偏短：
 * 两条 adversarial 判定的反向轮思考了 1338 个 event 后仍未输出 JSON，
 * 产出 0 字节 output.md，被判 `not_judged`，
 * 导致位置偏好探测在 10 条里有 2 条失效（「存在未判定轮次，无法检测位置偏好」）。
 *
 * 被评模型本身要 156–317s，评委要在两份长输出之间做比较，思考链比被评模型更长，
 * 超时应当比被评模型更宽。此处取 300s。
 */
export const DEFAULT_JUDGE_TIMEOUT_MS = 300_000;

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
    timeoutMs: options.timeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS,
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

    // 这里**不做**标签与分差的一致性校验——解析层只负责忠实记录评委说了什么。
    //
    // 校验必须在「统一口径」下进行，否则正反轮会得出互相矛盾的结论：
    // 评委的标签实际语义是「分数更高的那份更好」，而不是提示词字面写的
    // 「B 更好」。前向轮恰好 A=baseline、B=skill 两者重合；
    // 反向轮 A=skill、B=baseline 就分道扬镳——若在解析层按字面语义校验，
    // 反向轮会被误判成「评委自相矛盾」。
    //
    // 正确做法见 reconcileJudgeRun()：先把 A/B 换算回正轮口径，再校验。
    return {
      verdict,
      scoreA,
      scoreB,
      scoreDelta: scoreA !== null && scoreB !== null ? scoreB - scoreA : null,
      confidence,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
      error: verdict === "not_judged" ? "评委返回了非法 verdict（应为 win/tie/loss）" : null,
      labelConflict: null,
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

/**
 * 用分差方向校验评委标签，必要时纠正。
 *
 * **为什么必须做**：评委是模型，会自相矛盾。实测（2026-11-05）出现
 * `{"verdict":"loss","scoreA":65,"scoreB":90}`——分数说 B 高出 25 分，
 * 标签却说 A 胜，reason 文字也明确支持 B。
 * 这类矛盾在多轮聚合里会被当成一票实票，直接决定最终 verdict。
 *
 * **校验锚点是「分差方向」，不是提示词字面语义**：
 * 提示词写「输出 B 遗漏关键要点…时返回 loss」（字面即 win=B 更好），
 * 但实测评委实际按「分数更高的那份更好」打标签。两种语义在前向轮
 * （A=baseline、B=skill）恰好重合，在反向轮就分道扬镳。
 * 因此校验必须在**统一口径**下做——见 reconcileJudgeRun()。
 *
 * **纠正规则**：
 * - 分差绝对值 < `LABEL_CONFLICT_MIN_DELTA` → 不动。评委说 tie 而分差只差 1~2 分
 *   是「差异很小」的合理表达，不是矛盾。
 * - 标签为 tie 但分差超过阈值 → 视为矛盾，按分差方向纠正。
 * - 标签与分差方向相反（如 loss 但分差为正）→ 按分差方向纠正。
 * - 分差缺失 → 不动，无法校验。
 *
 * 返回纠正后的标签与冲突记录（无冲突时 conflict 为 null）。
 */
export function reconcileVerdictWithScores(
  verdict: Verdict,
  scoreDelta: number | null,
): { verdict: Verdict; conflict: LabelConflict | null } {
  if (verdict === "not_judged" || scoreDelta === null) return { verdict, conflict: null };
  if (Math.abs(scoreDelta) < LABEL_CONFLICT_MIN_DELTA) return { verdict, conflict: null };

  const deltaVerdict: Verdict = scoreDelta > 0 ? "win" : "loss";
  // 标签与分差方向一致。
  if (verdict === deltaVerdict) return { verdict, conflict: null };

  // 到这里只剩两种矛盾：方向相反，或标签是 tie 而分差够大。
  const note =
    verdict === "tie"
      ? `评委标签为 tie，但分差 ${scoreDelta > 0 ? "+" : ""}${scoreDelta} 已超过 ` +
        `${LABEL_CONFLICT_MIN_DELTA} 分阈值，按分差方向纠正为 ${deltaVerdict}`
      : `评委标签 ${verdict} 与分差 ${scoreDelta > 0 ? "+" : ""}${scoreDelta} 方向矛盾，按分差方向纠正为 ${deltaVerdict}`;

  return {
    verdict: deltaVerdict,
    conflict: {
      originalVerdict: verdict,
      correctedVerdict: deltaVerdict,
      scoreDelta,
      note,
    },
  };
}

/**
 * 把一次判定换算到「A=baseline、B=skill」的正轮口径，并做标签一致性校验。
 *
 * 这是判定链路上唯一做标签校验的地方——正反轮都走它，口径统一。
 *
 * **为什么校验必须放在换算之后**：
 * 评委的标签实际语义是「分数更高的那份更好」（实测反轮 A=skill(95) B=baseline(58)
 * 返回 `win` 可证），而非提示词字面写的「B 更好」。
 * 前向轮 A=baseline、B=skill 时两种语义重合；
 * 反向轮 A=skill、B=baseline 时分道扬镳——
 * 若在换算前按字面语义校验，反向轮会被误判成「评委自相矛盾」，
 * 位置偏好探测也会跟着误报。
 *
 * 换算后 `scoreDelta` 恒为「skill 相对 baseline 的优势」，
 * 标签方向与它一致即自洽，不一致才是真矛盾。
 *
 * @param run 解析出的原始判定
 * @param swapped 该判定是否来自反向轮（A/B 与正轮相反）
 */
export function reconcileJudgeRun(run: JudgeResult, swapped: boolean): JudgeResult {
  // 1) 先换算 A/B 口径。
  const oriented: JudgeResult = swapped ? flipScores(run) : run;

  // 2) 再用换算后的分差校验标签方向。
  const { verdict, conflict } = reconcileVerdictWithScores(oriented.verdict, oriented.scoreDelta);

  return {
    ...oriented,
    verdict,
    labelConflict: conflict,
  };
}

/** 只翻转 A/B 分数，不动标签（标签方向由后续校验决定）。 */
function flipScores(run: JudgeResult): JudgeResult {
  return {
    ...run,
    scoreA: run.scoreB,
    scoreB: run.scoreA,
    scoreDelta: run.scoreDelta !== null ? -run.scoreDelta : null,
  };
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

  const conflicted = judged.filter((run) => run.labelConflict);

  return {
    verdict,
    scoreA: average(judged.map((run) => run.scoreA)),
    scoreB: average(judged.map((run) => run.scoreB)),
    scoreDelta: average(judged.map((run) => run.scoreDelta)),
    confidence: average(judged.map((run) => run.confidence)),
    reason: `聚合 ${judged.length}/${runs.length} 轮（win:${counts.win} tie:${counts.tie} loss:${counts.loss}）`,
    error: null,
    // 聚合结果保留冲突条数——单次判定的冲突明细在 judgeRuns 里，
    // 这里只留计数，避免同一个冲突被重复渲染。
    labelConflict: conflicted.length
      ? {
          originalVerdict: conflicted[0]!.labelConflict!.originalVerdict,
          correctedVerdict: conflicted[0]!.labelConflict!.correctedVerdict,
          scoreDelta: conflicted[0]!.labelConflict!.scoreDelta,
          note: `本轮 ${conflicted.length} 条单次判定存在标签与分差方向矛盾，已按分差方向纠正`,
        }
      : null,
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

/**
 * 比较正反两次判定，检测评委是否存在位置偏好。
 *
 * 传入的两个 verdict 必须已在同一口径下（正轮：A=baseline、B=skill）。
 */
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
