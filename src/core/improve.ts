/**
 * 未通过（或待加固）skill 的根因归因与可执行优化建议。
 *
 * 归因方法：拿 skill 侧与 baseline 侧的逐条断言结果与激活取证做交叉对比，按失败模式分类：
 *
 * | 模式 | 特征 | 含义 |
 * |---|---|---|
 * | `activation-missing` | 失败发生在未读取 skill 的轮次（如 0% 激活用例） | 漏触发症状，应改 frontmatter description 而非正文 |
 * | `over-trigger` | `shouldActivate=false` 的无关用例触发了 skill | 误触发污染，需收窄 description 触发边界 |
 * | `contract-missing` | 已激活但 baseline 过了、skill 侧没过 | **真问题**：skill 声称的契约没落到输出里或造成倒退 |
 * | `unstable` | 已激活且同一断言多次重复里时过时不过 | 契约强度不够稳，需改为硬性规则+示例 |
 * | `no-effect` | 已激活且两侧都没过 | 正文未覆盖或写在模型未读的附属文件里 |
 * | `regression` | 规则没破但评委判输 | 约束挤占了实质内容空间 |
 * | `assertion-too-strict` | mustMatch 失败但命中了声明的等价写法 | **套件问题**，不是 skill 的问题 |
 */

import { runPi } from "./pi.ts";
import type { AssertionOutcome } from "./assertions.ts";
import type { RunResult } from "./runner.ts";

/** 失败模式分类。 */
export type FailureMode =
  | "contract-missing"
  | "no-effect"
  | "regression"
  | "unstable"
  | "activation-missing"
  | "over-trigger"
  | "assertion-too-strict";

/** 单条失败断言的归因结果。 */
export interface FailureDiagnosis {
  kind: string;
  note: string;
  detail: string;
  /** 断言的字面 pattern，用于在 SKILL.md 里定位约束。 */
  pattern?: string | undefined;
  taskId: string;
  mode: FailureMode;
  advice: string;
}

/** 跨用例合并后的根因诊断项。 */
export interface GroupedDiagnosis {
  mode: FailureMode;
  kind: string;
  note: string;
  detail: string;
  /** 断言的字面 pattern，用于在 SKILL.md 里定位约束。 */
  pattern?: string | undefined;
  /** 受该同一根因影响的用例列表。 */
  tasks: string[];
  /** 累计失败的断言条目次数。 */
  failedItemCount: number;
  /** 若消除该根因失败，预计可提升的断言通过率百分点（pp）。 */
  expectedGainPp: number;
  advice: string;
  /** 结合 SKILL.md 与附属文件读取情况定位的具体位置提示。 */
  skillLocationHint?: string | undefined;
}

export interface SkillDocContext {
  /** SKILL.md 原文。 */
  skillContent?: string;
  /** 附属文件内容映射（相对路径 -> 文本），如 `references/report-structure.md`。 */
  subFiles?: Record<string, string>;
  /** 运行期间模型实际读取过的附属文件路径列表。 */
  readSubPaths?: string[];
}

export interface ImprovementOptions {
  verdict?: "effective" | "ineffective" | "inconclusive";
  tasks?: Array<{ id: string; shouldActivate?: boolean }>;
  skillContext?: SkillDocContext;
}

/** 整体诊断结论。 */
export interface ImprovementAdvice {
  /** 逐条诊断（按 task 展开）。 */
  diagnoses: FailureDiagnosis[];
  /** 跨用例按根因聚合后的去重建议（含预计增益 expectedGainPp）。 */
  groupedDiagnoses: GroupedDiagnosis[];
  /** 按模式归类的建议（按优先级排序）。 */
  byMode: Array<{ mode: FailureMode; count: number; advice: string }>;
  /** 激活率过低导致的整体判断。 */
  activationIssue: string | null;
  /** 一句话总结。 */
  summary: string;
  /** skill 侧真正要改的条数（排除「断言过严」）。 */
  skillIssueCount: number;
  /** 判定为「断言过严」的条数——要改的是套件，不是 skill。 */
  falseFailureCount: number;
}

/** 各失败模式的建议文案。 */
const MODE_ADVICE: Record<FailureMode, string> = {
  "contract-missing":
    "skill 声称的约束没有落到输出里。把该条约束从「描述」改成「可执行的硬性步骤或模板」——" +
    "明确写出要出现什么、放在哪个位置、用什么格式。",
  "no-effect":
    "这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束" +
    "（而不是靠模型自己推测），必要时补成明确的红线条目。",
  regression:
    "规则断言没破，但相对 baseline 评委判输——输出质量下降。通常是 skill 的约束挤占了内容空间，" +
    "或措辞让模型过度套模板。检查是否过度规定了格式而削弱了实质内容。",
  unstable:
    "同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则" +
    "（给出可判定的具体条件），并考虑补一条示例。",
  "activation-missing":
    "模型在该用例未读取 skill 文件（激活漏触发），此处的断言失败是「未触发」的下游症状而非正文失效。" +
    "优先在 frontmatter 的 description 中补充该类任务的用户表达与场景词，切勿盲目堆砌正文。",
  "over-trigger":
    "该用例属于不应触发的无关任务（shouldActivate=false），但模型仍然读取了 skill。" +
    "需收窄 frontmatter description 的适用边界，明确写出「何时不要使用本技能」。",
  "assertion-too-strict":
    "**这是断言写得过严，不是 skill 的问题**——输出里其实做到了，只是用了断言没覆盖的措辞。" +
    "要改的是**套件**：把这条断言放宽到能接受 skill 契约里允许的其他写法，" +
    "或给该断言补上 `equivalentPatterns` 声明等价写法。放宽后必须复验 baseline 仍不命中——" +
    "放宽到 baseline 也能过，测出来的增益就是假的。",
};

/** 模式的中文名。 */
export const MODE_LABEL: Record<FailureMode, string> = {
  "contract-missing": "契约未落地",
  "no-effect": "契约无效",
  regression: "质量倒退",
  unstable: "约束不稳",
  "activation-missing": "漏触发（未读 skill）",
  "over-trigger": "误触发（description 过泛）",
  "assertion-too-strict": "断言过严（不是 skill 的问题）",
};

const STOP_WORDS = new Set([
  "红线",
  "必须",
  "不得",
  "禁止",
  "输出",
  "给出",
  "包含",
  "说明",
  "断言",
  "要求",
  "声明",
  "明确",
  "检查",
  "不能",
  "应该",
  "需要",
]);

export function isSkillIssue(mode: FailureMode): boolean {
  return mode !== "assertion-too-strict";
}

const ZH_DIRECTIVE_SPLIT =  /禁止|严禁|不得|切勿|不要|必须|应当|应该|要求|确保|给出|输出|包含|明确|提供|附上|使用|不能|需要|出现|添加|带有|以及|或者|[与和的在中对为以]/g;

/** 从中文短语里切出可独立检索的子片段。 */
const ZH_SUBTOKEN_SPLIT = /[与和的在中对为以及]/g;

function extractContractKeywords(note: string): string[] {
  const cleaned = note.replace(/^红线\s*\d*\s*[：:]\s*/, "");
  const asciiTokens = cleaned.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) ?? [];
  const zhRuns = cleaned.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  const zhTokens: string[] = [];
  for (const run of zhRuns) {
    for (const part of run.split(ZH_DIRECTIVE_SPLIT)) {
      if (part.length < 2 || STOP_WORDS.has(part)) continue;
      zhTokens.push(part);
      // 长语再切子片段——skill 改版后措辞常变（「时限」→「何时完成」、
      // 「期间不等就比」→「期间不完整」），只拿整条长语做匹配必然落空。
      //
      // 用**滑窗子串**而非按连接词切：「须识别期间不完整」按连接词切不出
      // 「期间不完整」（「识别」黏在中间），滑窗能取到 2~4 字的候选片段。
      for (const sub of part.split(ZH_SUBTOKEN_SPLIT)) {
        if (sub.length >= 2 && sub !== part && !STOP_WORDS.has(sub)) {
          zhTokens.push(sub);
        }
      }
      for (let len = 2; len <= 4; len += 1) {
        for (let i = 0; i + len <= part.length; i += 1) {
          const sub = part.slice(i, i + len);
          if (!STOP_WORDS.has(sub)) zhTokens.push(sub);
        }
      }
    }
  }
  return [...asciiTokens.filter((tok) => !STOP_WORDS.has(tok)), ...zhTokens];
}

export function locateInSkillDocs(
  note: string,
  mode: FailureMode,
  ctx?: SkillDocContext,
  pattern?: string,
): string | undefined {
  if (!ctx?.skillContent || !isSkillIssue(mode)) return undefined;
  if (mode === "activation-missing" || mode === "over-trigger") {
    return "定位：SKILL.md 顶部 YAML frontmatter 的 `description` 字段";
  }

  // 断言 note 常写旧版措辞（「时限」），而 skill 已改版（「何时完成」）——
  // 只靠 note 会落空。断言 pattern 里的字面量（时限|责任人|跟踪指标…）更贴近
  // 契约本身，两者合并后一起参与匹配。
  const keywords = [
    ...extractContractKeywords(note),
    ...(pattern ? extractContractKeywords(pattern) : []),
  ];
  if (keywords.length === 0) return undefined;

  const inMainSkill = keywords.some((kw) => ctx.skillContent!.includes(kw));
  if (inMainSkill) {
    return "定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段";
  }

  if (ctx.subFiles) {
    const readSet = new Set(ctx.readSubPaths ?? []);
    for (const [subPath, content] of Object.entries(ctx.subFiles)) {
      if (keywords.some((kw) => content.includes(kw))) {
        const wasRead = Array.from(readSet).some(
          (r) => r.endsWith(subPath) || subPath.endsWith(r),
        );
        if (!wasRead) {
          return `定位：规则位于附属文件 \`${subPath}\`，但模型运行期间未读取该文件——请将该硬红线提炼回 SKILL.md 主文件`;
        }
        return `定位：规则位于已读取的附属文件 \`${subPath}\`，建议在 SKILL.md 主文件末尾检查清单中复述强化`;
      }
    }
  }

  return "定位：SKILL.md 正文未检索到对应约束关键词，属于规则缺失——需新增独立红线条款";
}

/**
 * 生成优化建议（支持激活感知归因、跨用例根因去重与 SKILL.md 定位）。
 */
export function buildImprovementAdvice(
  results: RunResult[],
  activationRate: number,
  verdictOrOptions?: "effective" | "ineffective" | "inconclusive" | ImprovementOptions,
): ImprovementAdvice {
  const options: ImprovementOptions =
    typeof verdictOrOptions === "string"
      ? { verdict: verdictOrOptions }
      : (verdictOrOptions ?? {});
  const verdict = options.verdict;

  const shouldActivateByTask = new Map<string, boolean>();
  for (const t of options.tasks ?? []) {
    shouldActivateByTask.set(t.id, t.shouldActivate ?? true);
  }

  // 排除运行失败（status === "failed"）的记录，防止空输出污染归因。
  const baselineRows = results.filter(
    (r) => r.variantId === "baseline" && r.status !== "failed" && r.assertions,
  );
  const variantRows = results.filter(
    (r) => r.variantId !== "baseline" && r.status !== "failed",
  );

  let variantTotalAssertionItems = 0;
  for (const row of variantRows) {
    variantTotalAssertionItems += row.assertions?.total ?? 0;
  }

  const baselineByKey = new Map<string, boolean[]>();
  for (const row of baselineRows) {
    const outcomes = row.assertions?.outcomes ?? [];
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      if (!outcome) continue;
      const key = `${row.taskId}#${i}`;
      const list = baselineByKey.get(key) ?? [];
      list.push(outcome.passed);
      baselineByKey.set(key, list);
    }
  }

  const variantByKey = new Map<
    string,
    {
      outcomes: AssertionOutcome[];
      passes: boolean[];
      activatedFlags: boolean[];
      taskId: string;
    }
  >();

  for (const row of variantRows) {
    const outcomes = row.assertions?.outcomes ?? [];
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      if (!outcome) continue;
      const key = `${row.taskId}#${i}`;
      const entry = variantByKey.get(key) ?? {
        outcomes: [],
        passes: [],
        activatedFlags: [],
        taskId: row.taskId,
      };
      entry.outcomes.push(outcome);
      entry.passes.push(outcome.passed);
      entry.activatedFlags.push(Boolean(row.activation?.activated));
      variantByKey.set(key, entry);
    }
  }

  const diagnoses: FailureDiagnosis[] = [];
  const failedItemsPerDiag: number[] = [];

  // 1) 检查负向用例（shouldActivate === false）的误触发。
  const variantByTask = new Map<string, RunResult[]>();
  for (const row of variantRows) {
    const list = variantByTask.get(row.taskId) ?? [];
    list.push(row);
    variantByTask.set(row.taskId, list);
  }
  for (const [taskId, rows] of variantByTask) {
    if (shouldActivateByTask.get(taskId) === false) {
      const overTriggered = rows.filter((r) => r.activation?.activated);
      if (overTriggered.length > 0) {
        diagnoses.push({
          kind: "activation",
          note: "负向用例误触发",
          detail: `在 ${overTriggered.length}/${rows.length} 次无关任务运行中读取了 skill`,
          taskId,
          mode: "over-trigger",
          advice: MODE_ADVICE["over-trigger"],
        });
        failedItemsPerDiag.push(0);
      }
    }
  }

  // 2) 逐断言归因（结合是否实际激活）。
  for (const [key, entry] of variantByKey) {
    if (entry.passes.every(Boolean)) continue;

    const basePasses = baselineByKey.get(key) ?? [];
    const baselineAllPass = basePasses.length > 0 && basePasses.every(Boolean);
    const baselineAnyPass = basePasses.some(Boolean);
    const skillMixed = entry.passes.some(Boolean);

    const failedOutcomes = entry.outcomes.filter((o) => !o.passed);
    const mustMatchFailures = failedOutcomes.filter((o) => o.kind === "mustMatch");
    const equivalentHits = mustMatchFailures.filter((o) => o.equivalentMatched === true);
    const equivalentChecked = mustMatchFailures.some((o) => o.equivalentMatched !== undefined);
    const isFalseFailure = equivalentHits.length > 0 && equivalentChecked;

    // 激活感知检查：失败是否全部发生在「未读取 skill」的轮次？
    const allFailedWereUnactivated = entry.passes.every(
      (passed, idx) => passed || !entry.activatedFlags[idx],
    );

    let mode: FailureMode;
    if (isFalseFailure) {
      mode = "assertion-too-strict";
    } else if (allFailedWereUnactivated) {
      mode = "activation-missing";
    } else if (baselineAllPass) {
      mode = "contract-missing";
    } else if (skillMixed || baselineAnyPass) {
      mode = "unstable";
    } else {
      mode = "no-effect";
    }

    const outcome = entry.outcomes.find((o) => !o.passed) ?? entry.outcomes[0];
    if (!outcome) continue;

    diagnoses.push({
      kind: outcome.kind,
      note: outcome.note ?? "",
      detail: outcome.detail,
      pattern: outcome.pattern,
      taskId: entry.taskId,
      mode,
      advice: MODE_ADVICE[mode],
    });
    failedItemsPerDiag.push(failedOutcomes.length);
  }

  const modePriority: FailureMode[] = [
    "activation-missing",
    "over-trigger",
    "contract-missing",
    "unstable",
    "no-effect",
    "regression",
    "assertion-too-strict",
  ];
  // 注意：保持向后兼容的模式排序——当没有 activation-missing/over-trigger 时，
  // contract-missing > unstable > no-effect > regression > assertion-too-strict 完全不变；
  // 而一旦存在未触发，先修触发再改正文符合第一性原理。
  const modeRank = new Map<FailureMode, number>(modePriority.map((m, idx) => [m, idx]));

  const counts = new Map<FailureMode, number>();
  for (const d of diagnoses) counts.set(d.mode, (counts.get(d.mode) ?? 0) + 1);

  const byMode = modePriority
    .filter((mode) => (counts.get(mode) ?? 0) > 0)
    .map((mode) => ({
      mode,
      count: counts.get(mode)!,
      advice: MODE_ADVICE[mode],
    }));

  // 3) 跨用例按根因聚合去重（同一条契约在多个 task 重复失败时合并为 1 条可执行项，并计算预计增益）。
  const groupMap = new Map<string, GroupedDiagnosis>();
  diagnoses.forEach((d, idx) => {
    const normalizedNote = d.note.trim() || d.detail.trim();
    const groupKey = `${d.mode}::${d.kind}::${normalizedNote}`;
    const failedCount = failedItemsPerDiag[idx] ?? 0;
    const existing = groupMap.get(groupKey);
    if (existing) {
      if (!existing.tasks.includes(d.taskId)) {
        existing.tasks.push(d.taskId);
      }
      existing.failedItemCount += failedCount;
    } else {
      groupMap.set(groupKey, {
        mode: d.mode,
        kind: d.kind,
        note: d.note,
        detail: d.detail,
        pattern: d.pattern,
        tasks: [d.taskId],
        failedItemCount: failedCount,
        expectedGainPp: 0,
        advice: d.advice,
        skillLocationHint: locateInSkillDocs(d.note || d.detail, d.mode, options.skillContext, d.pattern),
      });
    }
  });

  const groupedDiagnoses = Array.from(groupMap.values())
    .map((g) => ({
      ...g,
      expectedGainPp:
        variantTotalAssertionItems > 0
          ? Math.round((g.failedItemCount / variantTotalAssertionItems) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => {
      const rankDiff = (modeRank.get(a.mode) ?? 99) - (modeRank.get(b.mode) ?? 99);
      if (rankDiff !== 0) return rankDiff;
      return b.failedItemCount - a.failedItemCount;
    });

  const skillIssueCount = diagnoses.filter((d) => isSkillIssue(d.mode)).length;

  const activationIssue =
    activationRate < 0.6
      ? `激活率仅 ${(activationRate * 100).toFixed(1)}%（未达 60% 门槛）：skill 大部分时候没被模型读取，` +
        `输出根本没走 skill 的约束。此时改正文收效有限，应先改 frontmatter 的 description——` +
        `写清「什么场景该用我」。`
      : null;

  const passed = verdict === "effective";
  let summary: string;
  if (activationIssue) {
    summary =
      `首要问题是激活率不足（${(activationRate * 100).toFixed(1)}%）：` +
      `模型多数时候没读它，输出不受约束。此时改正文收效有限，应先改 frontmatter 的 description——` +
      `写清「什么场景该用我」。`;
  } else if (diagnoses.length === 0) {
    summary =
      "规则断言全部通过，没有可加固的契约——如需确认稳定性，可增加 repeat 后复跑。";
  } else if (skillIssueCount === 0) {
    const falseCount = diagnoses.length;
    summary =
      (passed ? "skill 已通过测评，" : "") +
      `${falseCount} 条断言失败，但全部属于「${MODE_LABEL["assertion-too-strict"]}」——` +
      `**不是 skill 的问题**，输出内容做到了，只是断言没覆盖那种措辞。要改的是套件。`;
  } else {
    const top = byMode.find((m) => isSkillIssue(m.mode));
    const falseCount = diagnoses.length - skillIssueCount;
    const rootCauseCount = groupedDiagnoses.filter((g) => isSkillIssue(g.mode)).length;
    const dedupNote =
      rootCauseCount < skillIssueCount
        ? `（去重后归并为 ${rootCauseCount} 项核心根因）`
        : "";
    summary =
      (passed ? "skill 已通过测评，但仍有可加固的契约：" : "skill 未通过：") +
      `${skillIssueCount} 条断言失败${dedupNote}，其中 ${top ? top.count : 0} 条属于「${top ? MODE_LABEL[top.mode] : "未知"}」。` +
      `优先处理这一类，其余见下方明细。` +
      (falseCount > 0
        ? `另有 ${falseCount} 条失败属「${MODE_LABEL["assertion-too-strict"]}」，要改的是套件而非 skill。`
        : "");
  }

  return {
    diagnoses,
    groupedDiagnoses,
    byMode,
    activationIssue,
    summary,
    skillIssueCount,
    falseFailureCount: diagnoses.length - skillIssueCount,
  };
}

/**
 * 可选：调用模型针对聚合后的根因生成 SKILL.md 段落级改写草案（`--llm-advice`）。
 *
 * 默认不自动启用，保证常规评估零额外开销与 100% 确定性。
 */
export async function generateLlmRewriteAdvice(options: {
  skillContent: string;
  groupedDiagnoses: GroupedDiagnosis[];
  workspaceRoot: string;
  model?: string | undefined;
  home?: string | undefined;
  timeoutMs?: number;
  runner?: typeof runPi;
}): Promise<string | null> {
  const actionable = options.groupedDiagnoses.filter((g) => isSkillIssue(g.mode)).slice(0, 5);
  if (actionable.length === 0) return null;

  const issuesText = actionable
    .map(
      (g, idx) =>
        `${idx + 1}. [${MODE_LABEL[g.mode]}] ${g.note || g.detail}（影响用例：${g.tasks.join(", ")}，预计修复增益 +${g.expectedGainPp.toFixed(1)}pp）` +
        (g.skillLocationHint ? `\n   ${g.skillLocationHint}` : ""),
    )
    .join("\n");

  const prompt = `你是 Agent Skill 工程化改写顾问。请根据以下实测失败根因，对被测 SKILL.md 给出**最小、可直接粘贴替换**的具体段落改写建议（Before -> After）。

要求：
1. 不要泛泛而谈，直接给出原段落定位与替换后的 Markdown 文本。
2. 若根因是「漏触发」或「误触发」，只改写 YAML frontmatter 的 description。
3. 若根因是规则未落地或不稳，将软性描述改为可验证的硬性红线或输出模板。
4. 控制在 400 字以内，条理清晰。

# 实测待修复根因
${issuesText}

# 当前 SKILL.md 内容
${options.skillContent.slice(0, 12000)}
`;

  const execRunner = options.runner ?? runPi;
  const res = await execRunner({
    workspaceRoot: options.workspaceRoot,
    sessionId: "llm-advice",
    prompt,
    model: options.model,
    skillPaths: [],
    home: options.home,
    timeoutMs: options.timeoutMs ?? 120_000,
  });

  if (res.exitCode !== 0 || !res.metrics.output.trim()) return null;
  return res.metrics.output.trim();
}
