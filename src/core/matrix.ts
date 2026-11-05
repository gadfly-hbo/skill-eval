/**
 * 多模型矩阵评估聚合与渲染（`--models <m1,m2,...>`）。
 *
 * 解决单一弱模型（如 Flash 级模型）外推失效的问题：
 * 同一个 skill 对弱模型可能是 +50pp 救命拐杖，对前沿强模型可能是零增益甚至冗余模板负累。
 */

import type { EvaluationSummary } from "./runner.ts";
import type { VerdictDecision, VerdictOutcome } from "./verdict.ts";

export type MatrixClassification =
  | "universal_effective"
  | "model_dependent"
  | "universal_ineffective"
  | "inconclusive";

export interface ModelMatrixCell {
  model: string;
  runDir: string;
  summary: EvaluationSummary;
  decision: VerdictDecision;
}

export interface ModelMatrixRow {
  model: string;
  runDir: string;
  verdict: VerdictOutcome;
  expensive: boolean;
  activationRate: number;
  winRate: number | null;
  ruleAdjustedWinRate: number | null;
  gainPp: number | null;
  pairCoverage: number | null;
  timeoutRate: number;
  avgTokens: number;
}

export interface ModelMatrixReport {
  classification: MatrixClassification;
  summaryText: string;
  rows: ModelMatrixRow[];
}

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

export function summarizeModelMatrix(cells: ModelMatrixCell[]): ModelMatrixReport {
  const rows: ModelMatrixRow[] = cells.map((cell) => {
    const variant = cell.summary.variantSummaries.find((v) => v.variantId !== "baseline");
    return {
      model: cell.model,
      runDir: cell.runDir,
      verdict: cell.decision.verdict,
      expensive: cell.decision.expensive,
      activationRate: cell.decision.metrics.activationRate,
      winRate: cell.decision.metrics.winRate,
      ruleAdjustedWinRate: cell.decision.metrics.ruleAdjustedWinRate,
      gainPp: cell.decision.metrics.gainPp,
      pairCoverage: cell.decision.metrics.pairCoverage,
      timeoutRate: cell.decision.metrics.timeoutRate,
      avgTokens: variant?.avgTokens ?? 0,
    };
  });

  const effectiveModels = rows.filter((r) => r.verdict === "effective").map((r) => r.model);
  const ineffectiveModels = rows.filter((r) => r.verdict === "ineffective").map((r) => r.model);

  let classification: MatrixClassification;
  let summaryText: string;

  if (rows.length > 0 && effectiveModels.length === rows.length) {
    classification = "universal_effective";
    summaryText = `跨模型普适有效：全部 ${rows.length} 个被评模型均通过有效门禁。`;
  } else if (effectiveModels.length > 0 && effectiveModels.length < rows.length) {
    classification = "model_dependent";
    summaryText =
      `模型依赖（分化）：在 ${effectiveModels.join(", ")} 上有效，但在其余模型上未达标——` +
      `建议按模型能力分级挂载该 skill，避免对已内化该能力的强模型造成冗余 token 开销。`;
  } else if (rows.length > 0 && ineffectiveModels.length === rows.length) {
    classification = "universal_ineffective";
    summaryText = `跨模型均无效：全部 ${rows.length} 个被评模型均未观测到实质正向价值。`;
  } else {
    classification = "inconclusive";
    summaryText = `多模型矩阵尚无稳定有效结论，请检查超时率、样本覆盖率或契约设计。`;
  }

  return { classification, summaryText, rows };
}

export function renderMatrixMarkdown(
  report: ModelMatrixReport,
  meta: { suiteId: string; skillPath: string; judgeModel: string; generatedAt: string },
): string {
  const labelMap: Record<MatrixClassification, string> = {
    universal_effective: "普适有效",
    model_dependent: "模型依赖（能力分化）",
    universal_ineffective: "普适无效",
    inconclusive: "结论不足",
  };

  const lines: string[] = [];
  lines.push(`# 多模型矩阵评估报告：${meta.suiteId}`);
  lines.push("");
  lines.push(`> 生成于 ${meta.generatedAt} · 被测 skill \`${meta.skillPath}\` · 评委模型 \`${meta.judgeModel}\``);
  lines.push("");
  lines.push(`## 综合判定：${labelMap[report.classification]}`);
  lines.push("");
  lines.push(report.summaryText);
  lines.push("");
  lines.push("| 被评模型 | 结论 | 激活率 | 胜率 | 规则纠偏胜率 | 断言增益 | 覆盖率 | 超时率 | 平均 token |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  for (const r of report.rows) {
    const verdictText =
      r.verdict === "effective"
        ? r.expensive
          ? "有效（但昂贵）"
          : "有效"
        : r.verdict === "ineffective"
          ? "无效"
          : "结论不足";
    const gainText = r.gainPp === null ? "—" : `${r.gainPp >= 0 ? "+" : ""}${r.gainPp.toFixed(1)}pp`;
    lines.push(
      `| \`${r.model}\` | ${verdictText} | ${pct(r.activationRate)} | ${pct(r.winRate)} | ${pct(r.ruleAdjustedWinRate)} | ${gainText} | ${pct(r.pairCoverage)} | ${pct(r.timeoutRate)} | ${Math.round(r.avgTokens).toLocaleString()} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
