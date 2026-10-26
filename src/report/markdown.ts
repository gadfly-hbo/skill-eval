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
    lines.push(
      `| 断言通过率 | ${percent(baseline?.assertionPassRate ?? null)} | ${percent(variant.assertionPassRate ?? null)} | ${judgeAssertion(baseline?.assertionPassRate ?? null, variant.assertionPassRate ?? null)} |`,
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

  // 断言逐项明细
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

  // ---- 8. 结论 ----
  lines.push("## 8. 结论");
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

function verdictLabel(verdict: ReportOptions["verdict"]): string {
  switch (verdict) {
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
