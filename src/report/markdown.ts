/**
 * Markdown 报告生成。
 *
 * 报告要求（见 AGENTS.md）：
 * 1. 候选身份  2. 运行配置  3. 证据层级  4. 激活表  5. 判定表
 * 6. 分歧记录  7. 未验证项与限制  8. 结论
 *
 * 每个数字都必须能追溯到具体证据路径。
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import type { EvaluationSummary, VariantSummary, TaskSummary } from "../core/runner.ts";
import type { EvalTask, Variant } from "../core/runner.ts";
import { buildImprovementAdvice, MODE_LABEL, type FailureMode } from "../core/improve.ts";
import { computeAssertionItemRate } from "../core/gain.ts";

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
  /** 结论说明。 */
  verdictReason: string;
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
  lines.push(`**判定：${verdictLabel(options.verdict)}** — ${options.verdictReason}`);
  lines.push("");

  const baseline = summary.variantSummaries.find((v) => v.variantId === "baseline");
  const variant = summary.variantSummaries.find((v) => v.variantId !== "baseline");

  if (variant) {
    lines.push("| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(
      `| 激活率 | — | ${percent(variant.activationRate)} | ${judgeActivation(variant.activationRate)} |`,
    );
    lines.push(
      `| 胜率 | — | ${variant.winRate === null ? "不可判定" : percent(variant.winRate)} | ${judgeWinRate(variant.winRate)} |`,
    );
    // 断言通过率用「条目累计」口径，与归档门控（evaluateGain）保持一致。
    //
    // 此前这里用的是 variantSummaries.assertionPassRate（整轮全过率），
    // 两侧都常为 0.0%，报告首屏会显示「无差异」，而同一次运行的归档门控
    // 用条目累计口径算出 +13.2pp 并判定达标——同一份数据自相矛盾。
    // 判读与门控口径必须一致，否则读者无法从报告推出归档结论。
    const baselineItemRate = computeAssertionItemRate(summary.results, "baseline");
    const variantItemRate = computeAssertionItemRate(summary.results, variant.variantId);
    lines.push(
      `| 断言通过率（条目累计） | ${percent(baselineItemRate)} | ${percent(variantItemRate)} | ${judgeAssertion(baselineItemRate, variantItemRate)} |`,
    );
    lines.push(
      `| 平均耗时 | ${baseline ? `${baseline.avgDurationSec.toFixed(1)}s` : "—"} | ${variant.avgDurationSec.toFixed(1)}s | ${variant.avgDurationSec > (baseline?.avgDurationSec ?? 0) ? "变慢，需关注成本" : "未变慢"} |`,
    );
    lines.push(
      `| 平均 token | ${baseline ? String(Math.round(baseline.avgTokens)) : "—"} | ${String(Math.round(variant.avgTokens))} | ${variant.avgTokens > (baseline?.avgTokens ?? 0) ? "增加" : "未增加"} |`,
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
  lines.push("- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对。");
  lines.push("- **规则断言**：由代码判定，客观可复算，优先级高于模型评委。");
  lines.push("- **成对评委**：模型评委判定相对优劣；已匿名化（A/B 无来源暗示）。");
  lines.push("");
  if (summary.judgeModel === summary.model) {
    lines.push("> ⚠️ 评委模型与被评模型相同，存在自我偏好风险，相关判定可信度需打折。");
    lines.push("");
  }

  // ---- 4. 激活表 ----
  lines.push("## 4. 激活情况");
  lines.push("");
  lines.push("| Variant | 激活率 | 弱激活率 | 未激活 | 运行数 | 说明 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const item of summary.variantSummaries) {
    const isBaseline = item.variantId === "baseline";
    lines.push(
      `| ${item.variantLabel} | ${isBaseline ? "—" : percent(item.activationRate)} | ${isBaseline ? "—" : percent(item.weakActivationRate)} | ${isBaseline ? "—" : percent(1 - item.activationRate - item.weakActivationRate)} | ${item.total} | ${isBaseline ? "对照组，按设计不加载 skill" : "以工具调用读取 skill 文件为强证据"} |`,
    );
  }
  lines.push("");
  lines.push("> 激活判定以「模型实际读取了 skill 文件」为强证据。弱激活指输出中出现 skill 关键词但模型从未读取该文件，不计入激活率分子。");
  lines.push("");

  // ---- 5. 判定表 ----
  lines.push("## 5. 判定结果");
  lines.push("");
  lines.push("### 5.1 Variant 汇总");
  lines.push("");
  lines.push("| Variant | win | tie | loss | 未判定 | 胜率 | 断言通过率 | EFC |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const item of summary.variantSummaries) {
    lines.push(
      `| ${item.variantLabel} | ${item.win} | ${item.tie} | ${item.loss} | ${item.notJudged} | ${item.winRate === null ? "—" : percent(item.winRate)} | ${percent(item.assertionPassRate)} | ${item.efc ? item.efc.efc.toFixed(3) : "—"} |`,
    );
  }
  lines.push("");

  lines.push("### 5.2 用例明细");
  lines.push("");
  lines.push("| 用例 | 类型 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const task of summary.taskSummaries) {
    lines.push(
      `| ${task.taskId} | ${task.kind === "scored" ? "计分" : "诊断"} | ${percent(task.total ? task.success / task.total : 0)} | ${percent(task.activationRate)} | ${percent(task.assertionPassRate)} | ${task.win} | ${task.tie} | ${task.loss} | ${task.notJudged} |`,
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
  }

  // 评委标签与分差冲突的纠正记录。
  // 静默纠正等于偷偷改结论——必须让读者看见工具替评委做了什么判断。
  const conflicts = summary.pairwise.flatMap((item) =>
    (item.judgeRuns ?? [])
      .filter((run) => run.labelConflict)
      .map((run) => ({ item, conflict: run.labelConflict! })),
  );
  if (conflicts.length > 0) {
    lines.push("### 5.4 评委标签纠正记录");
    lines.push("");
    lines.push(
      `评委返回的标签与它自己给出的分差方向矛盾时，工具以分差方向为准并在此记录。` +
        `本轮共纠正 ${conflicts.length} 条。`,
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

  // ---- 6. 分歧记录 ----
  lines.push("## 6. 规则与评委的分歧");
  lines.push("");
  if (summary.disagreements.length === 0) {
    lines.push("无分歧。规则断言与成对评委结论一致。");
  } else {
    lines.push("| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const item of summary.disagreements) {
      lines.push(
        `| ${item.taskId} | ${item.attempt} | ${item.variantId} | ${item.assertionPassed ? "通过" : "违反"} | ${item.verdict} | ${item.note} |`,
      );
    }
    lines.push("");
    lines.push("> 规则断言优先级高于模型评委，上表以规则为准。分歧本身提示任务设计或 skill 声明存在偏差。");
  }
  lines.push("");

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
  //
  // 通过（effective）时也要出这一节：断言失败代表「还有可加固的契约」，
  // 不是「skill 无效」。措辞由 advice.summary 依据 verdict 区分。
  const advice = buildImprovementAdvice(
    summary.results,
    variant?.activationRate ?? 0,
    options.verdict,
  );
  const hasAdvice = advice.diagnoses.length > 0 || advice.activationIssue !== null;
  if (hasAdvice) {
    lines.push(options.verdict === "effective" ? "## 8. 优化建议（已通过，以下为可加固项）" : "## 8. 优化建议");
    lines.push("");
    lines.push(advice.summary);
    lines.push("");

    if (advice.activationIssue) {
      lines.push("### 8.1 优先处理：激活率不足");
      lines.push("");
      lines.push(advice.activationIssue);
      lines.push("");
    }

    if (advice.byMode.length > 0) {
      lines.push(`### ${advice.activationIssue ? "8.2" : "8.1"} 按失败模式归类`);
      lines.push("");
      lines.push("| 失败模式 | 条数 | 说明 |");
      lines.push("| --- | --- | --- |");
      for (const item of advice.byMode) {
        lines.push(`| ${modeLabel(item.mode)} | ${item.count} | ${item.advice} |`);
      }
      lines.push("");
    }

    if (advice.diagnoses.length > 0) {
      lines.push(`### ${advice.activationIssue ? "8.3" : "8.2"} 逐条失败明细`);
      lines.push("");
      lines.push("| 用例 | 断言 | 失败模式 | 失败原因 |");
      lines.push("| --- | --- | --- | --- |");
      for (const d of advice.diagnoses) {
        const label = d.note ? `${d.kind}（${d.note}）` : d.kind;
        lines.push(`| ${d.taskId} | ${label} | ${modeLabel(d.mode)} | ${d.detail} |`);
      }
      lines.push("");
      lines.push(
        "> 「契约未落地」= baseline 能做到、装 skill 后反而做不到，是 skill 的真问题；",
      );
      lines.push(
        "> 「契约无效」= baseline 也做不到，说明 skill 没把这条约束写清楚。",
      );
      lines.push(
        "> 「断言过严」= 输出内容其实做到了，只是用了断言没覆盖的措辞——**要改的是套件，不是 skill**。",
      );
      lines.push(
        "> baseline 本来就能过的断言不算 skill 的问题，不列入建议。",
      );
      lines.push("");
    }

    // 断言过严要单独成节：它指向套件而非 skill，混在明细里容易被忽略，
    // 导致用户去改本来正确的地方。
    const falseFailures = advice.diagnoses.filter((d) => d.mode === "assertion-too-strict");
    if (falseFailures.length > 0) {
      lines.push(`### ${advice.activationIssue ? "8.4" : "8.3"} 断言过严（要改套件，不是 skill）`);
      lines.push("");
      lines.push(
        `以下 ${falseFailures.length} 条失败**不是 skill 的问题**——输出内容做到了，` +
          `只是断言的正则没覆盖 skill 契约里允许的其他措辞。`,
      );
      lines.push("");
      lines.push("| 用例 | 断言 | 建议 |");
      lines.push("| --- | --- | --- |");
      for (const d of falseFailures) {
        const label = d.note ? `${d.kind}（${d.note}）` : d.kind;
        lines.push(`| ${d.taskId} | ${label} | 放宽该断言的 pattern，或补 equivalentPatterns 声明等价写法 |`);
      }
      lines.push("");
      lines.push(
        "> 放宽后**必须复验 baseline 仍不命中**——放宽到 baseline 也能过，" +
          "测出来的增益就是假的。",
      );
      lines.push("");
    }

    lines.push("### 下一步");
    lines.push("");
    if (options.verdict === "effective") {
      lines.push("本 skill 已通过测评并归档。上述失败项是**可选的加固项**，不影响本次结论：");
      lines.push("");
      if (advice.skillIssueCount > 0) {
        lines.push(
          `1. skill 侧要改的 ${advice.skillIssueCount} 条：按上表「约束不稳」等模式的建议逐条改 SKILL.md。`,
        );
      } else {
        lines.push("1. skill 侧没有要改的地方——本轮失败全部来自断言写得过严。");
      }
      if (advice.falseFailureCount > 0) {
        lines.push(
          `2. 套件侧要改的 ${advice.falseFailureCount} 条：放宽对应断言的 pattern（或补 equivalentPatterns），` +
            "放宽后**复验 baseline 仍不命中**。",
        );
      }
      lines.push(
        `${advice.falseFailureCount > 0 ? "3" : "2"}. 若要改 skill，请**保持同一套件与模型**重新评估，只改 skill 内容——否则无法归因。`,
      );
      lines.push(
        `${advice.falseFailureCount > 0 ? "4" : "3"}. 修改后的 skill 版本号递增，归档区会保留上一版快照便于对比。`,
      );
      lines.push("");
    } else {
      lines.push("按上述建议修改 SKILL.md 后，可进入二次测评准备：");
      lines.push("");
      if (advice.skillIssueCount > 0) {
        lines.push(`1. 按建议逐条修改 skill 内容（优先处理上表第一条失败模式，共 ${advice.skillIssueCount} 条）。`);
      } else {
        lines.push("1. skill 侧没有要改的地方——本轮失败全部来自断言写得过严，改套件即可。");
      }
      if (advice.falseFailureCount > 0) {
        lines.push(
          `2. 套件侧要改的 ${advice.falseFailureCount} 条：放宽对应断言，放宽后**复验 baseline 仍不命中**。`,
        );
      }
      lines.push(
        `${advice.falseFailureCount > 0 ? "3" : "2"}. 重新评估时**保持同一套件与模型**，只改 skill 内容——否则无法归因。`,
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
  lines.push(`**${verdictLabel(options.verdict)}** — ${options.verdictReason}`);
  lines.push("");
  lines.push("### 结论边界");
  lines.push("");
  lines.push("- 本结论仅覆盖上述运行配置下的用例集，不外推到未测任务。");
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
      `**${failed.length}/${summary.results.length} 次运行失败**，已计入分母，未做选择性重跑：${failed
        .slice(0, 5)
        .map((r) => `${r.variantId}/${r.taskId}#${r.attempt}`)
        .join("、")}${failed.length > 5 ? " 等" : ""}`,
    );
  }

  const notJudged = summary.pairwise.filter((item) => item.verdict === "not_judged");
  if (notJudged.length > 0) {
    items.push(`${notJudged.length} 对比较未能判定（运行失败或评委失败），未计入胜率分子分母之外的断言结论需谨慎解读`);
  }

  if (summary.judgeRepeat < 2) {
    items.push("评委仅运行 1 轮，未检测位置偏好；建议用 `--judge-repeat 3` 复核关键结论");
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

/** 失败模式的中文名。复用 improve.ts 的唯一实现，避免两处各写一份而漂移。 */
function modeLabel(mode: FailureMode): string {
  return MODE_LABEL[mode];
}

function verdictLabel(verdict: ReportOptions["verdict"]): string {  switch (verdict) {
    case "effective":
      return "有效";
    case "ineffective":
      return "无效";
    case "inconclusive":
      return "结论不足";
  }
}

function judgeActivation(rate: number): string {
  if (rate >= 0.8) return "触发充分";
  if (rate >= 0.5) return "触发不稳定";
  if (rate > 0) return "几乎不触发";
  return "从未触发";
}

function judgeWinRate(rate: number | null): string {
  if (rate === null) return "无法判定";
  if (rate >= 0.6) return "有实质提升";
  if (rate >= 0.45) return "提升不显著";
  if (rate > 0) return "无提升甚至倒退";
  return "完全无提升";
}

function judgeAssertion(baseline: number | null, variant: number | null): string {
  if (baseline === null || variant === null) return "未设断言";
  const delta = variant - baseline;
  if (delta > 0.1) return "明显改善";
  if (delta > 0) return "略有改善";
  if (delta === 0) return "无差异";
  return "反而变差";
}

function percent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
