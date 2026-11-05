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
import type { EvaluationSummary, EvalTask, Variant } from "../core/runner.ts";
import {
  buildImprovementAdvice,
  isSkillIssue,
  MODE_LABEL,
  type FailureMode,
  type SkillDocContext,
} from "../core/improve.ts";
import { evaluateGainFromResults } from "../core/gain.ts";
import { analyzeAssertionSensitivity } from "../core/sensitivity.ts";
import type { CalibrationResult } from "../core/calibration.ts";
import {
  ACTIVATION_STRONG_THRESHOLD,
  ACTIVATION_THRESHOLD,
  GAIN_STRONG_THRESHOLD_PP,
  GAIN_THRESHOLD_PP,
  MAX_FALSE_ACTIVATION_RATE,
  MAX_VARIANT_TIMEOUT_RATE,
  MIN_PAIR_COVERAGE,
  WIN_RATE_MARGINAL_THRESHOLD,
  WIN_RATE_STRONG_THRESHOLD,
  WIN_RATE_THRESHOLD,
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

  if (variant) {
    const gainFromResults = evaluateGainFromResults(summary.results, variant.variantId);
    const baselineItemRate = gainFromResults.baselineCounts.rate;
    const variantItemRate = gainFromResults.variantCounts.rate;
    const gainCiText = gainFromResults.ciPp
      ? `（95% CI [${signedPp(gainFromResults.ciPp.lowPp)}, ${signedPp(gainFromResults.ciPp.highPp)}]）`
      : "";
    const winCiText = variant.winRateCi
      ? `（95% CI [${percent(variant.winRateCi.low)}, ${percent(variant.winRateCi.high)}]）`
      : "";

    lines.push("| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(
      `| 激活率（正向召回） | — | ${percent(variant.activationRate)} | ${judgeActivation(variant.activationRate)} |`,
    );
    if (variant.falseActivationRate !== null && variant.falseActivationRate !== undefined) {
      lines.push(
        `| 负向用例误触发率 | — | ${percent(variant.falseActivationRate)} | ${variant.falseActivationRate <= MAX_FALSE_ACTIVATION_RATE ? "边界清晰" : "⚠️ 误触发超标"} |`,
      );
    }
    lines.push(
      `| 成对评委胜率（已判对） | — | ${variant.winRate === null ? "不可判定" : `${percent(variant.winRate)}${winCiText}`} | ${judgeWinRate(variant.winRate)} |`,
    );
    if (variant.pairCoverage !== undefined || variant.winRateLowerBound !== undefined) {
      const cov = variant.pairCoverage ?? null;
      const lb = variant.winRateLowerBound ?? null;
      const ruleAdj = variant.ruleAdjustedWinRate ?? variant.winRate;
      lines.push(
        `| 评判覆盖率 / 全样本胜率下界 | — | 覆盖 ${percent(cov)} · 下界 ${percent(lb)} · 规则纠偏 ${percent(ruleAdj)} | ${cov !== null && cov < MIN_PAIR_COVERAGE ? "⚠️ 缺失样本过多" : "覆盖充分"} |`,
      );
    }
    if (variant.timeoutRate !== undefined && variant.timeoutRate > 0) {
      lines.push(
        `| 运行超时率 | — | ${percent(variant.timeoutRate)}（${variant.timedOut ?? 0}/${variant.total} 次） | ${variant.timeoutRate > MAX_VARIANT_TIMEOUT_RATE ? "⚠️ 超时率超标" : "偶发超时"} |`,
      );
    }
    lines.push(
      `| 断言通过率（条目累计） | ${percent(baselineItemRate)} | ${percent(variantItemRate)}${gainFromResults.gainPp !== null ? `（${signedPp(gainFromResults.gainPp)}）${gainCiText}` : ""} | ${judgeAssertion(baselineItemRate, variantItemRate, gainFromResults.ciPp?.lowPp ?? null)} |`,
    );
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
  lines.push(`| 每用例重复 | ${summary.repeat} 次 |`);
  lines.push(`| 评委轮数 | ${summary.judgeRepeat} 轮${summary.judgeRepeat >= 2 ? "（含位置偏好探测）" : ""} |`);
  lines.push(`| 用例数 | ${options.tasks.length} |`);
  lines.push(`| 总运行次数 | ${summary.results.length} |`);
  lines.push(`| 总耗时 | ${summary.durationSec.toFixed(1)}s |`);
  lines.push(`| 总 token | ${summary.totalTokens.toLocaleString()} |`);
  lines.push(`| 总成本 | $${summary.totalCost.toFixed(4)} |`);
  if (meta.piHome) lines.push(`| pi 隔离 HOME | \`${meta.piHome}\` |`);
  lines.push(`| 证据目录 | \`${meta.runRoot}\` |`);
  lines.push("");

  // ---- 3. 证据层级 ----
  lines.push("## 3. 证据层级");
  lines.push("");
  lines.push("- **真实模型运行**：本报告全部数字来自真实 pi 模型调用，非回放、非静态检查。");
  lines.push("- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对（含附属文件读取取证）。");
  lines.push("- **规则断言**：由代码判定，客观可复算，优先级高于模型评委；失败或超时的空输出运行不计入断言分母。");
  lines.push("- **成对评委**：模型评委判定相对优劣；已匿名化（A/B 无来源暗示），长输出采用头尾保留采样。");
  lines.push("");
  if (summary.judgeModel === summary.model) {
    lines.push("> ⚠️ 评委模型与被评模型相同，存在自我偏好风险，相关判定可信度需打折。");
    lines.push("");
  }

  // ---- 4. 激活情况 ----
  lines.push("## 4. 激活情况");
  lines.push("");
  lines.push("| Variant | 正向激活率 | 负向误触发率 | 弱激活率 | 未激活 | 运行数 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const item of summary.variantSummaries) {
    const isBaseline = item.variantId === "baseline";
    const unactivated = Math.max(0, 1 - item.activationRate - item.weakActivationRate);
    lines.push(
      `| ${item.variantLabel} | ${isBaseline ? "—" : percent(item.activationRate)} | ${isBaseline || item.falseActivationRate == null ? "—" : percent(item.falseActivationRate)} | ${isBaseline ? "—" : percent(item.weakActivationRate)} | ${isBaseline ? "—" : percent(unactivated)} | ${item.total} | ${isBaseline ? "对照组，按设计不加载 skill" : "以工具调用读取 SKILL.md 或包内附属文件为强证据"} |`,
    );
  }
  lines.push("");
  if (variant?.zeroActivationTasks && variant.zeroActivationTasks.length > 0) {
    lines.push(
      `> ⚠️ **局部盲区告警**：以下正向用例激活率为 0.0%（模型完全未读取 skill）：\`${variant.zeroActivationTasks.join("`、`")}\`。`,
    );
    lines.push("");
  }
  lines.push("> 激活判定以「模型实际读取了 skill 文件或包内附属文件」为强证据。弱激活指输出中出现关键词但从未读取文件，不计入激活率分子。");
  lines.push("");

  // ---- 5. 判定结果 ----
  lines.push("## 5. 判定结果");
  lines.push("");
  lines.push("### 5.1 Variant 汇总");
  lines.push("");
  lines.push("| Variant | win | tie | loss | 未判定 | 评判覆盖率 | 已判胜率 | 全样本下界 | 规则纠偏胜率 | 断言全过率 | 成本评级 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const item of summary.variantSummaries) {
    const isBaseline = item.variantId === "baseline";
    lines.push(
      `| ${item.variantLabel} | ${item.win} | ${item.tie} | ${item.loss} | ${item.notJudged} | ${isBaseline ? "—" : percent(item.pairCoverage ?? null)} | ${item.winRate === null ? "—" : percent(item.winRate)} | ${isBaseline ? "—" : percent(item.winRateLowerBound ?? null)} | ${isBaseline ? "—" : percent(item.ruleAdjustedWinRate ?? item.winRate)} | ${percent(item.assertionPassRate)} | ${item.costEfficiency ? item.costEfficiency.grade : "—"} |`,
    );
  }
  lines.push("");

  lines.push("### 5.2 用例明细");
  lines.push("");
  lines.push("| 用例 | 类型 | 期望触发 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const task of summary.taskSummaries) {
    const expectTrig = task.shouldActivate === false ? "否（误触发测试）" : "是";
    lines.push(
      `| ${task.taskId} | ${task.kind === "scored" ? "计分" : "诊断"} | ${expectTrig} | ${percent(task.total ? task.success / task.total : 0)} | ${percent(task.activationRate)} | ${percent(task.assertionPassRate)} | ${task.win} | ${task.tie} | ${task.loss} | ${task.notJudged} |`,
    );
  }
  lines.push("");

  const assertionRows = summary.results.filter((result) => result.assertions && result.assertions.total > 0);
  if (assertionRows.length > 0) {
    lines.push("### 5.3 规则断言明细");
    lines.push("");
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

    const sensitivity = analyzeAssertionSensitivity(summary, options.tasks);
    if (sensitivity.totalAssertions > 0) {
      lines.push("### 5.4 断言灵敏度体检（白送断言筛查）");
      lines.push("");
      lines.push(
        `共评估 ${sensitivity.totalAssertions} 条断言：有区分度 **${sensitivity.sensitiveCount}** 条（${percent(sensitivity.sensitivityRate)}），` +
          `无区分度（baseline 通过率 ≥ 80%）**${sensitivity.insensitiveCount}** 条。`,
      );
      lines.push("");
      if (sensitivity.zeroDiscriminationTasks.length > 0) {
        lines.push(
          `> ⚠️ **零区分度用例**：\`${sensitivity.zeroDiscriminationTasks.join("`、`")}\` 的全部断言在 baseline 下均已 ≥ 80% 通过，无法检验 skill 的契约价值，建议收紧断言或改为 \`diagnostic\`。`,
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
    lines.push(
      `评委返回的标签与它自己给出的分差方向矛盾时，工具以分差方向为准并在此记录。本轮共纠正 ${conflicts.length} 条。`,
    );
    lines.push("");
    lines.push("| 用例 | 次数 | 原始标签 | 纠正后 | 分差 | 说明 |");
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
      lines.push(`### 8.${subIdx++} 核心待改根因（跨用例去重 · 按优先级与预计增益排序）`);
      lines.push("");
      lines.push("| 优先级 | 失败模式 | 待修契约 | 影响用例 | 预计增益 | 修改建议与定位 |");
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
      lines.push("> 「漏触发」= 模型未读取 skill 导致的下游断言失败，应改 frontmatter description 而非正文；");
      lines.push("> 「契约未落地」= baseline 能做到、装 skill 后反而做不到，是 skill 的真问题；");
      lines.push("> 「契约无效」= baseline 也做不到，说明 skill 没把这条约束写清楚（或写在未读附属文件里）；");
      lines.push("> 「断言过严」= 输出内容其实做到了，只是用了断言没覆盖的措辞——**要改的是套件，不是 skill**。");
      lines.push("");
    }

    const falseFailures = advice.diagnoses.filter((d) => d.mode === "assertion-too-strict");
    if (falseFailures.length > 0) {
      lines.push(`### 8.${subIdx++} 断言过严（要改套件，不是 skill）`);
      lines.push("");
      lines.push(
        `以下 ${falseFailures.length} 条失败**不是 skill 的问题**——输出内容做到了，只是断言的正则没覆盖 skill 契约里允许的其他措辞。`,
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
      lines.push("> 放宽后**必须复验 baseline 仍不命中**——放宽到 baseline 也能过，测出来的增益就是假的。");
      lines.push("");
    }

    lines.push("### 下一步");
    lines.push("");
    if (options.verdict === "effective") {
      lines.push("本 skill 已通过测评。上述失败项是**可选的加固项**，不影响本次结论：");
      lines.push("");
      if (advice.skillIssueCount > 0) {
        lines.push(
          `1. skill 侧可加固 ${actionableGroups.length} 项根因（共涉及 ${advice.skillIssueCount} 条用例断言）：按「核心待改根因」表修改 SKILL.md。`,
        );
      } else {
        lines.push("1. skill 侧没有要改的地方——本轮失败全部来自断言写得过严。");
      }
      if (advice.falseFailureCount > 0) {
        lines.push(
          `2. 套件侧要改的 ${advice.falseFailureCount} 条：放宽对应断言的 pattern（或补 equivalentPatterns），放宽后**复验 baseline 仍不命中**。`,
        );
      }
      lines.push(
        `${advice.falseFailureCount > 0 ? "3" : "2"}. 若要改 skill，请**保持同一套件（核对套件哈希）与同一模型**重新评估，只改 skill 内容——否则无法归因。`,
      );
      lines.push(
        `${advice.falseFailureCount > 0 ? "4" : "3"}. 修改后的 skill 版本号递增，归档区会保留上一版快照便于对比。`,
      );
      lines.push("");
    } else {
      lines.push("按上述建议修改 SKILL.md 后，可进入二次测评准备：");
      lines.push("");
      if (advice.skillIssueCount > 0) {
        lines.push(
          `1. 按「核心待改根因」表从 P1 开始修改 SKILL.md（共 ${actionableGroups.length} 项核心根因，覆盖 ${advice.skillIssueCount} 条失败断言）。`,
        );
      } else {
        lines.push("1. skill 侧没有要改的地方——本轮失败全部来自断言写得过严，改套件即可。");
      }
      if (advice.falseFailureCount > 0) {
        lines.push(
          `2. 套件侧要改的 ${advice.falseFailureCount} 条：放宽对应断言，放宽后**复验 baseline 仍不命中**。`,
        );
      }
      lines.push(
        `${advice.falseFailureCount > 0 ? "3" : "2"}. 重新评估时**保持同一套件（核对套件哈希）与同一模型**，只改 skill 内容——否则无法归因。`,
      );
      lines.push(
        `${advice.falseFailureCount > 0 ? "4" : "3"}. 修改后的 skill 版本号递增，归档区会保留上一版快照便于对比。`,
      );
      lines.push("");
    }
  }

  // ---- 9. 结论 ----
  lines.push("## 9. 结论");
  lines.push("");
  lines.push(`**${verdictLabel(options.verdict, options.expensive)}** — ${options.verdictReason}`);
  lines.push("");
  lines.push("### 结论边界");
  lines.push("");
  lines.push("- 本结论仅覆盖上述运行配置与被评模型下的用例集，不同能力层级的模型建议用 `--models` 跑跨模型矩阵验证。");
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
    items.push(`${notJudged.length} 对比较未能完成评判，已在全样本胜率下界与有效评判覆盖率中显式计入分母`);
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
      `检测到弱激活（输出含关键词但模型未读取 skill）：${weakActivation.map((v) => `${v.variantLabel} ${percent(v.weakActivationRate)}`).join("、")}`,
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

function judgeWinRate(rate: number | null): string {
  if (rate === null) return "无法判定";
  if (rate >= WIN_RATE_STRONG_THRESHOLD - 1e-9) return "有实质提升";
  if (rate >= WIN_RATE_THRESHOLD - 1e-9) return "压线达标（60%–70% 边界区间）";
  if (rate >= WIN_RATE_MARGINAL_THRESHOLD - 1e-9) return "提升不显著";
  if (rate > 0) return "无提升甚至倒退";
  return "完全无提升";
}

function judgeAssertion(
  baseline: number | null,
  variant: number | null,
  ciLowPp: number | null,
): string {
  if (baseline === null || variant === null) return "未设断言";
  const deltaPp = (variant - baseline) * 100;
  if (deltaPp >= GAIN_STRONG_THRESHOLD_PP - 1e-9) {
    return ciLowPp !== null && ciLowPp <= 0 ? "点估计改善但置信区间跨零" : "显著改善";
  }
  if (deltaPp >= GAIN_THRESHOLD_PP - 1e-9) {
    return ciLowPp !== null && ciLowPp <= 0 ? "压线改善但统计不显著（CI 跨零）" : "压线改善（10pp–20pp）";
  }
  if (deltaPp > 0) return "微弱改善（未达 10pp 门槛）";
  if (deltaPp === 0) return "无差异";
  return "反而变差";
}

function signedPp(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}pp`;
}

function percent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
