/**
 * Markdown 报告生成。
 *
 * 报告要求（见 AGENTS.md）：
 * 1. 候选身份  2. 运行配置  3. 证据层级  4. 激活表  5. 判定表与断言灵敏度
 * 6. 分歧与人工盲审校准  7. 未验证项与限制  8. 优化建议  9. 结论
 *
 * 每个数字都必须能追溯到具体证据路径。
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { EvaluationSummary, EvalTask, RunResult, Variant } from "../core/runner.ts";
import { summarizeActivation } from "../core/activation.ts";
import {
  buildImprovementAdvice,
  isSkillIssue,
  MODE_LABEL,
  type FailureMode,
  type SkillDocContext,
} from "../core/improve.ts";
import { evaluateGainFromResults, isScoredTask } from "../core/gain.ts";
import { analyzeAssertionSensitivity } from "../core/sensitivity.ts";
import type { CalibrationResult } from "../core/calibration.ts";
import {
  ACTIVATION_STRONG_THRESHOLD,
  ACTIVATION_THRESHOLD,
  MAX_FALSE_ACTIVATION_RATE,
  MAX_VARIANT_TIMEOUT_RATE,
  MIN_PAIR_COVERAGE,
} from "../core/thresholds.ts";

export interface ReportMeta {
  /** 被测 skill 路径。 */
  skillPath: string;
  /** skill 内容哈希。 */
  skillHash: string;
  /** skill 版本标识。 */
  skillVersion: string;
  /** 套件标识与版本。 */
  suiteId: string;
  suiteVersion: string;
  /** 套件判据哈希（用于检测跨轮次套件漂移；旧产物缺失时传 null，渲染为「—」）。 */
  suiteHash?: string | null;
  /** 运行目录。 */
  runRoot: string;
  /** 隔离 HOME（pi 配置隔离）。 */
  piHome: string | null;
  /** 生成时间。 */
  generatedAt: string;
}

export interface ReportOptions {
  summary: EvaluationSummary;
  meta: ReportMeta;
  tasks: EvalTask[];
  variants: Variant[];
  /** 结论等级。 */
  verdict: "effective" | "ineffective" | "inconclusive";
  /** 是否属于「有效但昂贵」。 */
  expensive?: boolean;
  /** 结论说明。 */
  verdictReason: string;
  /** 可选的 SKILL.md 与附属文件上下文，用于优化建议精准定位。 */
  skillContext?: SkillDocContext;
  /** 可选的 `--llm-advice` 具体段落改写草案。 */
  llmAdviceDraft?: string | null;
  /** 可选的人工盲审校准结果（若存在 calibration-result.json）。 */
  calibration?: CalibrationResult | null;
}

/** 计算文件内容哈希，用于锚定候选身份。 */
export function hashFile(path: string): string {
  if (!existsSync(path)) return "missing";
  const content = readFileSync(path);
  return `sha256:${createHash("sha256").update(content).digest("hex").slice(0, 16)}`;
}

export function renderReport(options: ReportOptions): string {
  const { summary, meta } = options;
  const lines: string[] = [];

  lines.push(`# Skill 评估报告：${meta.suiteId}`);
  lines.push("");
  lines.push(`> 运行标识 \`${summary.runId}\` · 生成于 ${meta.generatedAt}`);
  lines.push("");

  // ---- 结论摘要（首屏）----
  lines.push("## 结论摘要");
  lines.push("");
  lines.push(`**判定：${verdictLabel(options.verdict, options.expensive)}** — ${options.verdictReason}`);
  lines.push("");

  const baseline = summary.variantSummaries.find((v) => v.variantId === "baseline");
  const variant = summary.variantSummaries.find((v) => v.variantId !== "baseline");
  const tasks = summary.tasks ?? options.tasks;
  const plannedTasks = summary.manifest?.tasks ?? tasks;
  const plannedRepeat = summary.manifest?.repeat ?? summary.repeat;
  const plannedRuns = plannedTasks.length > 0 && plannedRepeat > 0 ? plannedTasks.length * plannedRepeat : "—";
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const scoredTaskIds = new Set(tasks.filter(isScoredTask).map((task) => task.id));
  const activationByVariant = new Map(summary.variantSummaries.map((item) => {
    const rows = summary.results.filter((row) => row.variantId === item.variantId);
    const positiveRows = tasks.length === 0 ? rows : rows.filter((row) => {
      const task = taskById.get(row.taskId);
      return task && task.shouldActivate !== false;
    });
    const negativeRows = rows.filter((row) => taskById.get(row.taskId)?.shouldActivate === false);
    return [item.variantId, {
      recorded: rows.length,
      positive: summarizeActivation(positiveRows),
      negative: summarizeActivation(negativeRows),
    }] as const;
  }));

  // ---- 污染告警（对照实验有效性前提）----
  // baseline 侧若自行读到了被测 skill 或含 skill 路径的元数据文件，
  // 对照实验的唯一变量就被破坏，增益会被系统性压低，结论不再可信。
  // 这类问题必须出现在首屏，不能只埋在明细里。
  const contaminatedResults = summary.results.filter((r) => r.contamination?.contaminated);
  if (contaminatedResults.length > 0) {
    lines.push("> ⚠️ **对照实验污染告警**");
    lines.push(">");
    lines.push(
      `> 有 ${contaminatedResults.length} 次 baseline 运行自行读到了被测 skill 或含 skill 路径的元数据文件，` +
        "该次输出**不代表「不装 skill」的水平**，增益会被系统性压低。",
    );
    lines.push(">");
    lines.push("> 受影响的运行：");
    for (const r of contaminatedResults) {
      const reason =
        r.contamination?.reasons.includes("skill-file-read") === true
          ? "读到了 skill 目录内文件"
          : "读到了含 skill 路径的元数据文件";
      lines.push(`> - \`${r.id}\`（${reason}）`);
    }
    lines.push(">");
    lines.push(
      "> 常见成因：运行目录里存在 `suite.json`（内含 `skill.path` 绝对路径），模型 `find` 到后顺着路径读取 skill。",
    );
    lines.push(">");
    lines.push("> 修法：把套件放在运行目录**之外**，并重新跑批；不要选择性剔除受影响样本。");
    lines.push("");
  }

  if (variant) {
    const gainFromResults = evaluateGainFromResults(summary.results, variant.variantId, undefined, tasks, summary.repeat);
    const { baselineCounts, variantCounts } = gainFromResults;
    const { positive, negative } = activationByVariant.get(variant.variantId)!;
    const gainCiText = gainFromResults.ciPp
      ? `（95% CI [${signedPp(gainFromResults.ciPp.lowPp)}, ${signedPp(gainFromResults.ciPp.highPp)}]）`
      : "";
    const winCiText = variant.winRateCi
      ? `（95% Wilson 区间 [${percent(variant.winRateCi.low)}, ${percent(variant.winRateCi.high)}]）`
      : "";

    lines.push("| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(
      `| 激活率（正向召回） | — | ${percentOf(positive.activated, positive.total)} | ${positive.total > 0 ? judgeActivation(positive.activationRate) : "无正向运行记录"} |`,
    );
    if (negative.total > 0) {
      lines.push(
        `| 负向用例误触发率 | — | ${percentOf(negative.activated, negative.total)} | ${negative.activationRate <= MAX_FALSE_ACTIVATION_RATE ? "边界清晰" : "⚠️ 误触发超标"} |`,
      );
    }
    lines.push(
      `| 原始评委胜率（已判计分对） | — | ${variant.winRate === null ? "不可判定" : `${percent(variant.winRate)}${winCiText}`} | 描述性统计 |`,
    );
    if (variant.pairCoverage !== undefined || variant.winRateLowerBound !== undefined) {
      const cov = variant.pairCoverage ?? null;
      const lb = variant.winRateLowerBound ?? null;
      lines.push(
        `| 计分对评判覆盖率 / 全计分对胜率下界 | — | 覆盖 ${percent(cov)} · 下界 ${percent(lb)} | ${cov === null ? "覆盖率未验证" : cov < MIN_PAIR_COVERAGE ? "⚠️ 缺失样本过多" : "覆盖充分"} |`,
      );
    }
    lines.push(`| 规则纠偏胜率（已判计分对） | — | ${percent(variant.ruleAdjustedWinRate ?? null)} | 用于正式判定 |`);
    if (variant.timeoutRate !== undefined && variant.timeoutRate > 0) {
      lines.push(
        `| 运行超时率 | — | ${(variant.missing ?? 0) > 0 ? "未知（产物缺失）" : percent(variant.timeoutRate)}（已知 ${variant.timedOut ?? 0}/${variant.total} 次） | ${variant.timeoutRate > MAX_VARIANT_TIMEOUT_RATE ? "⚠️ 超时率超标" : "偶发超时"} |`,
      );
    }
    lines.push(`| 断言条目通过率（仅计分题） | ${percentOf(baselineCounts.passed, baselineCounts.total)} | ${percentOf(variantCounts.passed, variantCounts.total)} | 分母为成功输出记录的断言条目，仅作描述 |`);
    lines.push(`| 任务等权配对增益 | — | ${gainFromResults.gainPp === null ? "不可判定" : signedPp(gainFromResults.gainPp)}${gainCiText} | ${gainFromResults.pairedTaskCount} 个任务簇；${gainFromResults.complete ? "完整配对" : "配对证据不足"} |`);
    lines.push(
      `| 平均耗时 | ${baseline ? `${baseline.avgDurationSec.toFixed(1)}s` : "—"} | ${variant.avgDurationSec.toFixed(1)}s | ${variant.avgDurationSec > (baseline?.avgDurationSec ?? 0) * 1.1 ? "变慢，需关注延迟" : "未明显变慢"} |`,
    );
    const costInfo = variant.costEfficiency;
    const costDesc = costInfo ? `${costInfo.grade}（${costInfo.reason}）` : variant.avgTokens > (baseline?.avgTokens ?? 0) ? "增加" : "未增加";
    lines.push(
      `| 平均 token | ${baseline ? String(Math.round(baseline.avgTokens)) : "—"} | ${String(Math.round(variant.avgTokens))} | ${costDesc} |`,
    );
    lines.push("");
  }

  for (const [label, state] of [["原始证据完整性", summary.integrity], ["文件访问隔离", summary.isolation]] as const) {
    if (state?.verified !== true || state.issues.length > 0) {
      lines.push(`> ${label}：未验证。${state?.issues.join("；") || "缺少验证记录"}`);
      lines.push("");
    }
  }

  // ---- 1. 候选身份 ----
  lines.push("## 1. 候选身份");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("| --- | --- |");
  lines.push(`| 被测 skill | \`${meta.skillPath}\` |`);
  lines.push(`| 内容哈希 | \`${meta.skillHash}\` |`);
  lines.push(`| 版本标识 | ${meta.skillVersion} |`);
  lines.push(`| 套件 | ${meta.suiteId}${meta.suiteVersion ? ` (v${meta.suiteVersion})` : ""} |`);
  lines.push(`| 套件哈希 | ${meta.suiteHash ? `\`${meta.suiteHash}\`` : "—"} |`);
  lines.push("");

  // ---- 2. 运行配置 ----
  lines.push("## 2. 运行配置");
  lines.push("");
  lines.push("| 项 | 值 |");
  lines.push("| --- | --- |");
  lines.push(`| 被评模型 | \`${summary.model}\` |`);
  lines.push(`| 评委模型 | \`${summary.judgeModel}\` |`);
  const runtime = summary.manifest?.runtimeIdentity;
  lines.push(`| 测评器检出提交 | ${runtime?.evaluator.gitCommit ? `\`${runtime.evaluator.gitCommit}\`` : "未记录"} |`);
  lines.push(`| 测评器源码指纹 | ${runtime ? `\`sha256:${runtime.evaluator.sourceSha256}\`` : "未记录"} |`);
  lines.push(`| Pi SDK | ${runtime ? `\`${runtime.piSdk.package}@${runtime.piSdk.version}\`` : "未记录"} |`);
  lines.push(`| 每用例重复 | ${summary.repeat} 次 |`);
  lines.push(`| 评委轮数 | ${summary.judgeRepeat} 轮${summary.judgeRepeat >= 2 ? "（含位置偏好探测）" : ""} |`);
  lines.push(`| 用例数 | ${options.tasks.length} |`);
  lines.push(`| 已有运行记录 / 预定运行数 | ${summary.results.length} / ${summary.manifest ? summary.manifest.tasks.length * summary.manifest.variants.length * summary.manifest.repeat : summary.variantSummaries.reduce((total, row) => total + row.total, 0)} |`);
  if (summary.analysisOf) lines.push(`| 派生复核 | 来源 ${summary.analysisOf.runId}；策略 ${summary.policyVersion ?? "未记录"}；原报告保留 |`);
  lines.push(`| 总耗时 | ${summary.durationSec.toFixed(1)}s |`);
  const hasMissing = summary.variantSummaries.some((row) => (row.missing ?? 0) > 0);
  lines.push(`| ${summary.execution ? "被评会话 token" : "总 token"} | ${hasMissing ? "未知（部分运行产物缺失）" : summary.totalTokens.toLocaleString()} |`);
  lines.push(`| ${summary.execution ? "被评会话 SDK 估计成本" : "总成本"} | ${hasMissing ? "未知（部分运行产物缺失）" : `$${summary.totalCost.toFixed(4)}`} |`);
  if (summary.execution) {
    lines.push(`| 整批执行 | ${summary.execution.stopped ? "STOPPED" : summary.status}；计划 ${summary.execution.plannedSessions}，已尝试 ${summary.execution.attemptedSessions}，NOT_RUN ${summary.execution.notRunSessions} |`);
    const cap = summary.execution.budgetCapNanoUsd;
    const budget = cap === null ? "不设预算上限" : typeof cap === "number" ? `保守等价上限 US$${(cap / 1e9).toFixed(2)}` : "历史限额见原账本";
    lines.push(`| 共享费用账本 | \`budget-ledger.json\` 为收尾快照，\`budget-ledger.jsonl\` 为增量记录（subject + judge，${budget}，实际账单未知） |`);
    lines.push(`| 逐会话状态 | \`${summary.execution.statusFile}\`；未执行项不填零 usage 或费用 |`);
    if (summary.execution.reason) lines.push(`| 停止原因 | ${summary.execution.reason.replace(/[\r\n|]/g, " ")} |`);
  }
  if (meta.piHome) lines.push(`| pi 隔离 HOME | \`${meta.piHome}\` |`);
  lines.push(`| 证据目录 | \`${meta.runRoot}\` |`);
  lines.push("");

  // ---- 3. 证据层级 ----
  lines.push("## 3. 证据层级");
  lines.push("");
  lines.push(summary.evidenceLevel === "real-model"
    ? "- **真实模型运行记录**：来源为本次 pi 调用；原始产物完整性与隔离验证单列。"
    : summary.evidenceLevel === "offline-fixture"
      ? "- **离线夹具验证**：仅验证评估器代码行为，不代表真实模型能力。"
      : "- **已有产物复核/回放**：未进行新的模型调用；历史记录未追溯覆盖，缺少的证据保持未验证。");
  lines.push("- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对（含附属文件读取取证）。");
  lines.push("- **规则断言**：条目累计率只描述成功输出；推断使用完整计分配对，失败或缺失不产生负向断言假通过。95% 区间以任务为独立簇，采用保守 Hoeffding 界；增加断言或重复次数不会增加独立任务数。");
  lines.push("- **成对评委**比较匿名 A/B 输出。实际输入见评委提示词记录。");
  lines.push("- **计分范围**：增益、显著性与成本门禁仅使用 scored 且应触发的任务；diagnostic 与负向触发任务单列，不参与这些门禁。执行摘要只提供匿名状态计数，不向评委泄露脚本或 skill 身份。");
  lines.push("");
  if (summary.judgeModel === summary.model) {
    lines.push("> ⚠️ 评委模型与被评模型相同，存在自我偏好风险，相关判定可信度需打折。");
    lines.push("");
  }

  // ---- 4. 激活情况 ----
  lines.push("## 4. 激活情况");
  lines.push("");
  lines.push("| Variant | 正向激活率 | 正向弱激活率 | 正向未激活率 | 负向误触发率 | 已记录 / 计划运行 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const item of summary.variantSummaries) {
    const { recorded, positive, negative } = activationByVariant.get(item.variantId)!;
    const rates = item.variantId === "baseline"
      ? ["—", "—", "—", "—"]
      : [percentOf(positive.activated, positive.total), percentOf(positive.weak, positive.total),
        percentOf(positive.notActivated, positive.total), percentOf(negative.activated, negative.total)];
    lines.push(`| ${item.variantLabel} | ${rates.join(" | ")} | ${recorded} / ${plannedRuns} |`);
  }
  lines.push("");
  if (variant?.zeroActivationTasks && variant.zeroActivationTasks.length > 0) {
    lines.push(
      `> ⚠️ **局部盲区告警**：以下正向用例激活率为 0.0%（模型完全未读取 skill）：\`${variant.zeroActivationTasks.join("`、`")}\`。`,
    );
    lines.push("");
  }
  lines.push("> 正向各列以应触发的已记录运行为分母，误触发率以不应触发的已记录运行为分母。baseline 按设计不加载 skill。实际读取 skill 文件是强证据，弱激活单列。");
  lines.push("");

  // ---- 5. 判定结果 ----
  lines.push("## 5. 判定结果");
  lines.push("");
  lines.push("### 5.1 Variant 汇总");
  lines.push("");
  lines.push("全部配对包含诊断题。覆盖率、原始评委胜率、下界和规则纠偏胜率只使用计分对。原始评委结果已从匿名 A/B 顺序还原为候选视角。断言全过率按成功且执行了断言的运行计数，包含诊断题。");
  lines.push("");
  lines.push("| Variant | 全部配对胜 / 平 / 负 / 未判 | 计分对已判 / 计划 | 计分对覆盖率 | 原始评委胜率（已判计分对） | 全计分对胜率下界 | 规则纠偏胜率（已判计分对） | 断言全过率 | 成本评级 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const item of summary.variantSummaries) {
    const isBaseline = item.variantId === "baseline";
    const allPairs = isBaseline ? "—" : `${item.win} / ${item.tie} / ${item.loss} / ${item.notJudged}`;
    const scoredPairs = !isBaseline && item.scoredJudged !== undefined && item.totalScoredPairs !== undefined
      ? `${item.scoredJudged} / ${item.totalScoredPairs}` : "—";
    lines.push(
      `| ${item.variantLabel} | ${allPairs} | ${scoredPairs} | ${isBaseline ? "—" : percent(item.pairCoverage ?? null)} | ${percent(item.winRate)} | ${isBaseline ? "—" : percent(item.winRateLowerBound ?? null)} | ${isBaseline ? "—" : percent(item.ruleAdjustedWinRate ?? null)} | ${assertionRunRate(summary.results.filter((row) => row.variantId === item.variantId))} | ${item.costEfficiency ? item.costEfficiency.grade : "—"} |`,
    );
  }
  lines.push("");

  lines.push("### 5.2 用例明细");
  lines.push("");
  lines.push("| 用例 | 类型 | 期望触发 | 成功率 | 激活率（有 Skill 侧） | 断言全过率（两侧运行） | win | tie | loss | 未判定 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  const skillVariantIds = new Set(options.variants.filter((item) => item.skillPaths.length > 0).map((item) => item.id));
  for (const task of summary.taskSummaries) {
    const expectTrig = task.shouldActivate === false ? "否（误触发测试）" : "是";
    const rows = summary.results.filter((row) => row.taskId === task.taskId);
    const activation = summarizeActivation(rows.filter((row) => skillVariantIds.has(row.variantId)));
    lines.push(
      `| ${task.taskId} | ${scoredTaskIds.has(task.taskId) ? "计分" : "诊断"} | ${expectTrig} | ${percentOf(task.success, task.total)} | ${percentOf(activation.activated, activation.total)} | ${assertionRunRate(rows)} | ${task.win} | ${task.tie} | ${task.loss} | ${task.notJudged} |`,
    );
  }
  lines.push("");

  const assertionRows = summary.results.filter((result) => result.assertions && result.assertions.total > 0);
  if (assertionRows.length > 0) {
    lines.push("### 5.3 规则断言明细");
    lines.push("");
    if (options.tasks.some((task) => task.shouldActivate === false)) {
      lines.push("不应触发用例的断言结果用于诊断输出，误触发以实际读取证据判定。");
      lines.push("");
    }
    lines.push("| Variant | 用例 | 次数 | 断言 | 结果 |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const result of assertionRows) {
      for (const outcome of result.assertions!.outcomes) {
        lines.push(
          `| ${result.variantLabel} | ${result.taskId} | ${result.attempt} | ${outcome.kind}${outcome.note ? ` (${outcome.note})` : ""} | ${outcome.passed ? "✅" : "❌"} ${outcome.detail} |`,
        );
      }
    }
    lines.push("");

    const sensitivity = analyzeAssertionSensitivity({
      ...summary, results: assertionRows.filter((row) => scoredTaskIds.has(row.taskId)),
    }, tasks);
    if (sensitivity.totalAssertions > 0) {
      lines.push("### 5.4 断言灵敏度体检（白送断言筛查）");
      lines.push("");
      const missingBaseline = sensitivity.items.filter((item) => item.baselineTotal === 0).length;
      lines.push(
        `计分用例共记录 ${sensitivity.totalAssertions} 条断言，其中 baseline 通过率 ≥ 80% 的有 **${sensitivity.insensitiveCount}** 条，` +
          `缺少 baseline 记录的有 **${missingBaseline}** 条。`,
      );
      lines.push("");
      const zeroScoredTasks = sensitivity.zeroDiscriminationTasks;
      if (zeroScoredTasks.length > 0) {
        lines.push(
          `> ⚠️ **零区分度计分用例** \`${zeroScoredTasks.join("`、`")}\` 的全部断言在 baseline 下均已 ≥ 80% 通过，建议收紧断言或改为 \`diagnostic\`。`,
        );
        lines.push("");
      }
      const insensitiveItems = sensitivity.items.filter((i) => i.insensitive);
      if (insensitiveItems.length > 0) {
        lines.push("| 用例 | 断言 | baseline 通过率 | skill 通过率 | 诊断 |");
        lines.push("| --- | --- | --- | --- | --- |");
        for (const item of insensitiveItems) {
          lines.push(
            `| ${item.taskId} | ${item.kind} (${item.note}) | ${percent(item.baselinePassRate)} (${item.baselinePassed}/${item.baselineTotal}) | ${percent(item.variantPassRate)} (${item.variantPassed}/${item.variantTotal}) | 白送断言（模型自带能力即可满足） |`,
          );
        }
        lines.push("");
      }
    }
  }

  const conflicts = summary.pairwise.flatMap((item) =>
    (item.judgeRuns ?? [])
      .filter((run) => run.labelConflict)
      .map((run) => ({ item, conflict: run.labelConflict! })),
  );
  if (conflicts.length > 0) {
    lines.push("### 5.5 评委标签纠正记录");
    lines.push("");
    lines.push(`这里记录评委标签与分差方向冲突（\`labelConflict\`）。本轮共纠正 ${conflicts.length} 条。A/B 换位在还原候选身份时处理。`);
    lines.push("");
    lines.push("| 用例 | 次数 | 候选视角标签 | 纠正后 | 分差 | 说明 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const { item, conflict } of conflicts) {
      lines.push(
        `| ${item.taskId} | ${item.attempt} | ${conflict.originalVerdict} | ${conflict.correctedVerdict} | ${conflict.scoreDelta > 0 ? "+" : ""}${conflict.scoreDelta} | ${conflict.note} |`,
      );
    }
    lines.push("");
  }

  // ---- 6. 分歧记录 & 人工盲审校准 ----
  lines.push("## 6. 规则与评委的分歧");
  lines.push("");
  if (summary.disagreements.length === 0) {
    lines.push("无分歧。规则断言与成对评委结论一致。");
  } else {
    lines.push("| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const item of summary.disagreements) {
      lines.push(
        `| ${item.taskId} | ${item.attempt} | ${item.variantId} | ${item.assertionPassed ? "全过" : "未全过"} | ${item.verdict} | ${item.note} |`,
      );
    }
    lines.push("");
    lines.push("> 规则断言优先级高于模型评委，当评委判 win 但规则断言出现倒退或零改善时，有效判定以规则纠偏胜率为准。");
  }
  lines.push("");

  if (options.calibration && options.calibration.reviewedCount > 0) {
    const cal = options.calibration;
    lines.push("### 6.1 人工盲审校准结果");
    lines.push("");
    lines.push(
      `已完成 **${cal.reviewedCount}/${cal.totalItems}** 对盲审复核：人机一致率 **${percent(cal.agreementRate)}**，` +
        `Cohen's κ = **${cal.kappa === null ? "—" : cal.kappa.toFixed(3)}**，` +
        `评委乐观偏置 **${cal.optimismBiasPp === null ? "—" : signedPp(cal.optimismBiasPp)}**（评委胜率 ${percent(cal.judgeWinRate)} vs 人工胜率 ${percent(cal.humanWinRate)}）。`,
    );
    lines.push("");
  }

  // ---- 7. 未验证项与限制 ----
  lines.push("## 7. 未验证项与限制");
  lines.push("");
  const limitations = buildLimitations(options);
  if (limitations.length === 0) {
    lines.push("无特别限制。");
  } else {
    for (const item of limitations) lines.push(`- ${item}`);
  }
  lines.push("");

  // ---- 8. 优化建议 ----
  const advice = buildImprovementAdvice(summary.results, variant?.activationRate ?? 0, {
    verdict: options.verdict,
    tasks: options.tasks,
    skillContext: options.skillContext,
  });
  const hasAdvice = advice.diagnoses.length > 0 || advice.activationIssue !== null;
  if (hasAdvice) {
    lines.push(
      options.verdict === "effective"
        ? "## 8. 优化建议（已通过，以下为可加固项）"
        : "## 8. 优化建议",
    );
    lines.push("");
    lines.push(advice.summary);
    lines.push("");

    let subIdx = 1;
    if (advice.activationIssue) {
      lines.push(`### 8.${subIdx++} 优先处理：激活率不足`);
      lines.push("");
      lines.push(advice.activationIssue);
      lines.push("");
    }

    const actionableGroups = advice.groupedDiagnoses.filter((g) => isSkillIssue(g.mode));
    if (actionableGroups.length > 0) {
      lines.push(`### 8.${subIdx++} Skill 侧待核查项（跨用例去重）`);
      lines.push("");
      lines.push("| 优先级 | 失败模式 | 待核对契约 | 影响用例 | 条目通过率增量估计 | 核对建议与定位 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      actionableGroups.forEach((g, i) => {
        const locText = g.skillLocationHint ? `（${g.skillLocationHint}）` : "";
        const gainText = g.expectedGainPp > 0 ? `+${g.expectedGainPp.toFixed(1)}pp` : "触发边界";
        lines.push(
          `| P${i + 1} | ${modeLabel(g.mode)} | ${g.note || g.kind} | ${g.tasks.join(", ")} | ${gainText} | ${g.advice}${locText} |`,
        );
      });
      lines.push("");
    }

    if (options.llmAdviceDraft) {
      lines.push(`### 8.${subIdx++} SKILL.md 段落级改写草案（--llm-advice）`);
      lines.push("");
      lines.push(options.llmAdviceDraft);
      lines.push("");
    }

    if (advice.byMode.length > 0) {
      lines.push(`### 8.${subIdx++} 按失败模式归类`);
      lines.push("");
      lines.push("| 失败模式 | 条数 | 说明 |");
      lines.push("| --- | --- | --- |");
      for (const item of advice.byMode) {
        lines.push(`| ${modeLabel(item.mode)} | ${item.count} | ${item.advice} |`);
      }
      lines.push("");
    }

    if (advice.diagnoses.length > 0) {
      lines.push(`### 8.${subIdx++} 逐条失败明细`);
      lines.push("");
      lines.push("| 用例 | 断言 | 失败模式 | 失败原因 |");
      lines.push("| --- | --- | --- | --- |");
      for (const d of advice.diagnoses) {
        const label = d.note ? `${d.kind}（${d.note}）` : d.kind;
        lines.push(`| ${d.taskId} | ${label} | ${modeLabel(d.mode)} | ${d.detail} |`);
      }
      lines.push("");
      lines.push("> 失败模式按可观察结果归类。归因前对照冻结判据、原始输出和实际加载内容。正则命中结果可能受反例引用或措辞影响，待复核项不进入 Skill 修改优先级。");
      lines.push("");
    }

    const falseFailures = advice.diagnoses.filter((d) => d.mode === "assertion-too-strict");
    if (falseFailures.length > 0) {
      lines.push(`### 8.${subIdx++} 断言过严（命中已声明的等价写法）`);
      lines.push("");
      lines.push(
        `以下 ${falseFailures.length} 条断言命中了已声明的等价写法。正式计分沿用冻结判据。`,
      );
      lines.push("");
      lines.push("| 用例 | 断言 | 建议 |");
      lines.push("| --- | --- | --- |");
      for (const d of falseFailures) {
        const label = d.note ? `${d.kind}（${d.note}）` : d.kind;
        lines.push(
          `| ${d.taskId} | ${label} | 放宽该断言的 pattern，或补 equivalentPatterns 声明等价写法 |`,
        );
      }
      lines.push("");
      lines.push("> 题集修订另存版本，并用正反例复核判据的区分度。");
      lines.push("");
    }

    lines.push("### 下一步");
    lines.push("");
    lines.push("- 按明细核对失败项归属。题集判据或交付口径问题在各自层处理，已确认的 Skill 问题再修改 SKILL.md。");
    lines.push("- 修订题集时另存新版本。比较 Skill 改动时保持题集哈希、模型和执行配置一致。历史报告沿用原冻结口径。");
    lines.push("");
  }

  // ---- 9. 结论 ----
  lines.push("## 9. 结论");
  lines.push("");
  lines.push(`**${verdictLabel(options.verdict, options.expensive)}** — ${options.verdictReason}`);
  lines.push("");
  lines.push("### 结论边界");
  lines.push("");
  lines.push("- 本结论仅覆盖上述用例集、被评模型和运行配置。");
  lines.push("- 判定基于模型输出质量，不是业务真实效果。");
  if (summary.judgeModel === summary.model) {
    lines.push("- 评委与被评同模型，存在自我偏好风险。");
  }
  if (summary.judgeRepeat < 2) {
    lines.push("- 评委仅 1 轮，未做位置偏好探测，评委结论稳定性未经验证。");
  }
  lines.push("");

  lines.push("---");
  lines.push("");
  lines.push(`报告由 skill-eval 生成 · 运行 \`${summary.runId}\` · 证据目录 \`${meta.runRoot}\``);

  return lines.join("\n");
}

/** 构造限制与未验证项清单。 */
function buildLimitations(options: ReportOptions): string[] {
  const { summary } = options;
  const items: string[] = [];

  const failed = summary.results.filter((result) => result.status === "failed");
  if (failed.length > 0) {
    items.push(
      `**${failed.length}/${summary.results.length} 次运行失败**，已计入分母且已从负向断言分母剔除（防空输出假通过）：${failed
        .slice(0, 5)
        .map((r) => `${r.variantId}/${r.taskId}#${r.attempt}`)
        .join("、")}${failed.length > 5 ? " 等" : ""}`,
    );
  }

  const notJudged = summary.pairwise.filter((item) => item.verdict === "not_judged");
  if (notJudged.length > 0) {
    const scoredTaskIds = new Set(options.tasks.filter(isScoredTask).map((task) => task.id));
    const scoredNotJudged = notJudged.filter((item) => scoredTaskIds.has(item.taskId)).length;
    items.push(`${notJudged.length} 对比较未能完成评判，其中 ${scoredNotJudged} 个计分对纳入胜率下界和覆盖率的分母`);
  }

  if (summary.judgeRepeat < 2) {
    items.push("评委仅运行 1 轮，未检测位置偏好；建议用 `--judge-repeat 2` 或以上复核关键结论");
  }

  if (summary.judgeModel === summary.model) {
    items.push("评委与被评使用同一模型，自我偏好风险未消除");
  }

  const diagnosticCount = options.tasks.filter((task) => (task.kind ?? "scored") === "diagnostic").length;
  if (diagnosticCount > 0) {
    items.push(`${diagnosticCount} 个用例标记为 diagnostic，不计入胜率`);
  }

  const weakActivation = summary.variantSummaries.filter((item) => item.weakActivationRate > 0);
  if (weakActivation.length > 0) {
    items.push(
      "检测到正向弱激活（输出含关键词但无实际读取记录），各侧分母见激活表。",
    );
  }

  return items;
}

function modeLabel(mode: FailureMode): string {
  return MODE_LABEL[mode];
}

function verdictLabel(verdict: ReportOptions["verdict"], expensive?: boolean): string {
  switch (verdict) {
    case "effective":
      return expensive ? "有效（但昂贵）" : "有效";
    case "ineffective":
      return "无效";
    case "inconclusive":
      return "结论不足";
  }
}

function judgeActivation(rate: number): string {
  if (rate >= ACTIVATION_STRONG_THRESHOLD - 1e-9) return "触发充分";
  if (rate >= ACTIVATION_THRESHOLD - 1e-9) return "压线达标（偶有漏触发）";
  if (rate > 0) return "触发不足（未达 60% 门槛）";
  return "从未触发";
}

function signedPp(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp`;
}

function percent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function percentOf(passed: number, total: number): string {
  return total > 0 ? `${percent(passed / total)}（${passed}/${total}）` : "—";
}

function assertionRunRate(rows: RunResult[]): string {
  const assessed = rows.filter((row) => row.status === "success" && (row.assertions?.total ?? 0) > 0);
  return percentOf(assessed.filter((row) => row.assertions?.allPassed).length, assessed.length);
}
