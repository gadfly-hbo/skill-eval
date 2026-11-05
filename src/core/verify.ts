/**
 * 阴性对照元评估（Meta-Evaluation）模块。
 *
 * 把一次性实验脚本固化为标准子命令 `skill-eval verify`：
 * 1. `stripBehavioralContract`：自动保留 YAML frontmatter 触发契约、剥离正文行为契约，生成破坏版 SKILL.md
 * 2. `evaluateNegativeControl`：对比原版跑批与破坏版跑批，检验「触发控制成立 + 原版越过门槛 + 破坏版回落门槛以下 + 0 假阳性」
 */

import { ACTIVATION_THRESHOLD, GAIN_THRESHOLD_PP, INSENSITIVE_BASELINE_PASS_RATE } from "./thresholds.ts";
import { evaluateGainFromResults } from "./gain.ts";
import type { EvaluationSummary } from "./runner.ts";

export interface StrippedSkillResult {
  content: string;
  originalLines: number;
  strippedLines: number;
  preservedFrontmatter: boolean;
}

export interface NegativeControlAssertionLadder {
  taskId: string;
  assertionIndex: number;
  note: string;
  baselineRate: number;
  brokenRate: number;
  originalRate: number;
}

export interface NegativeControlReport {
  passed: boolean;
  thresholdPp: number;
  originalGainPp: number | null;
  brokenGainPp: number | null;
  originalActivationRate: number;
  brokenActivationRate: number;
  originalTimeouts: number;
  brokenTimeouts: number;
  trueContractAssertions: NegativeControlAssertionLadder[];
  insensitiveAssertions: NegativeControlAssertionLadder[];
  falsePositiveAssertions: NegativeControlAssertionLadder[];
  issues: string[];
  reason: string;
}

/**
 * 剥离 SKILL.md 的正文行为契约，仅保留 YAML frontmatter 触发描述与中性桩正文。
 */
export function stripBehavioralContract(skillMdContent: string): StrippedSkillResult {
  const originalLines = skillMdContent.split(/\r?\n/).length;
  const fmMatch = /^(---\r?\n[\s\S]*?\r?\n---)\r?\n?([\s\S]*)$/.exec(skillMdContent);

  if (!fmMatch) {
    const fallback = `# Skill Stub\n\n按用户请求直接完成任务，给出清晰、结构合理的回复。\n`;
    return {
      content: fallback,
      originalLines,
      strippedLines: fallback.split(/\r?\n/).length,
      preservedFrontmatter: false,
    };
  }

  const frontmatter = fmMatch[1]!;
  const body = fmMatch[2] ?? "";
  const headingMatch = /^#\s+(.+)$/m.exec(body);
  const title = headingMatch?.[1]?.trim() ?? "Skill";

  const content =
    `${frontmatter}\n\n` +
    `# ${title}\n\n` +
    `当用户提出相关任务时，结合通用领域常识完成分析与作答，保持条理清晰、表述准确。\n`;

  return {
    content,
    originalLines,
    strippedLines: content.split(/\r?\n/).length,
    preservedFrontmatter: true,
  };
}

function extractVariantStats(summary: EvaluationSummary) {
  const variantId =
    summary.results.find((r) => r.variantId !== "baseline")?.variantId ??
    summary.variantSummaries.find((v) => v.variantId !== "baseline")?.variantId ??
    "skill";

  const variantRows = summary.results.filter((r) => r.variantId === variantId);
  const activatedCount = variantRows.filter((r) => r.activation?.activated).length;
  const activationRate = variantRows.length > 0 ? activatedCount / variantRows.length : 0;
  const timeouts = variantRows.filter(
    (r) => r.timedOut === true || (r.error ?? "").includes("超时"),
  ).length;
  const gain = evaluateGainFromResults(summary.results, variantId);

  // 按 (taskId, assertionIndex) 统计 baseline 与 variant 通过率
  const perAssertion = new Map<
    string,
    {
      taskId: string;
      assertionIndex: number;
      note: string;
      basePassed: number;
      baseTotal: number;
      varPassed: number;
      varTotal: number;
    }
  >();

  for (const row of summary.results) {
    if (row.status === "failed" || !row.assertions) continue;
    const isBase = row.variantId === "baseline";
    row.assertions.outcomes.forEach((outcome, idx) => {
      const key = `${row.taskId}::${idx}`;
      let entry = perAssertion.get(key);
      if (!entry) {
        entry = {
          taskId: row.taskId,
          assertionIndex: idx,
          note: outcome.note ?? `${outcome.kind}#${idx + 1}`,
          basePassed: 0,
          baseTotal: 0,
          varPassed: 0,
          varTotal: 0,
        };
        perAssertion.set(key, entry);
      }
      if (isBase) {
        entry.baseTotal += 1;
        if (outcome.passed) entry.basePassed += 1;
      } else if (row.variantId === variantId) {
        entry.varTotal += 1;
        if (outcome.passed) entry.varPassed += 1;
      }
    });
  }

  return { variantId, activationRate, timeouts, gain, perAssertion };
}

/**
 * 对比原版跑批与破坏版跑批，验证评估套件与评估器是否具备真实区分能力。
 */
export function evaluateNegativeControl(
  originalSummary: EvaluationSummary,
  brokenSummary: EvaluationSummary,
  options: { thresholdPp?: number } = {},
): NegativeControlReport {
  const thresholdPp = options.thresholdPp ?? GAIN_THRESHOLD_PP;
  const orig = extractVariantStats(originalSummary);
  const broken = extractVariantStats(brokenSummary);

  const issues: string[] = [];

  if (orig.timeouts > 0 || broken.timeouts > 0) {
    issues.push(
      `存在运行超时污染（原版超时 ${orig.timeouts} 次 / 破坏版超时 ${broken.timeouts} 次），请提高 --timeout 重跑`,
    );
  }

  if (broken.activationRate < ACTIVATION_THRESHOLD - 1e-9) {
    issues.push(
      `破坏版激活率仅 ${(broken.activationRate * 100).toFixed(1)}%（低于 ${(ACTIVATION_THRESHOLD * 100).toFixed(0)}%），连触发契约也被破坏，阴性对照变量控制不成立`,
    );
  }

  if (orig.gain.gainPp === null || orig.gain.gainPp < thresholdPp - 1e-9) {
    issues.push(
      `原版 skill 断言增益仅 ${orig.gain.gainPp === null ? "不可判定" : `${orig.gain.gainPp.toFixed(1)}pp`}，未达到 +${thresholdPp}pp 门槛`,
    );
  }

  if (broken.gain.gainPp !== null && broken.gain.gainPp >= thresholdPp - 1e-9) {
    issues.push(
      `破坏版增益仍高达 +${broken.gain.gainPp.toFixed(1)}pp（≥ ${thresholdPp}pp 门槛），存在契约泄漏或断言区分度不足`,
    );
  }

  const trueContractAssertions: NegativeControlAssertionLadder[] = [];
  const insensitiveAssertions: NegativeControlAssertionLadder[] = [];
  const falsePositiveAssertions: NegativeControlAssertionLadder[] = [];

  for (const [key, origItem] of orig.perAssertion) {
    const brokenItem = broken.perAssertion.get(key);
    if (!brokenItem || origItem.baseTotal === 0 || origItem.varTotal === 0 || brokenItem.varTotal === 0) {
      continue;
    }

    const baseTotal = origItem.baseTotal + brokenItem.baseTotal;
    const basePassed = origItem.basePassed + brokenItem.basePassed;
    const baselineRate = baseTotal > 0 ? basePassed / baseTotal : 0;
    const originalRate = origItem.varPassed / origItem.varTotal;
    const brokenRate = brokenItem.varPassed / brokenItem.varTotal;

    const ladder: NegativeControlAssertionLadder = {
      taskId: origItem.taskId,
      assertionIndex: origItem.assertionIndex,
      note: origItem.note,
      baselineRate,
      brokenRate,
      originalRate,
    };

    if (brokenRate > 0 && originalRate === 0) {
      falsePositiveAssertions.push(ladder);
    } else if (baselineRate >= INSENSITIVE_BASELINE_PASS_RATE - 1e-9) {
      insensitiveAssertions.push(ladder);
    } else if (originalRate > brokenRate + 1e-9 || (originalRate === 1 && baselineRate < 0.8 && brokenRate <= originalRate)) {
      if (originalRate > baselineRate + 1e-9) {
        trueContractAssertions.push(ladder);
      }
    }
  }

  if (falsePositiveAssertions.length > 0) {
    issues.push(`发现 ${falsePositiveAssertions.length} 条假阳性断言（破坏版通过而原版全部失败）`);
  }

  const passed = issues.length === 0;
  const reason = passed
    ? `工具与套件具备区分能力：原版增益 +${(orig.gain.gainPp ?? 0).toFixed(1)}pp（≥ ${thresholdPp}pp），破坏版激活率 ${(broken.activationRate * 100).toFixed(1)}% 且增益回落至 ${(broken.gain.gainPp ?? 0) >= 0 ? "+" : ""}${(broken.gain.gainPp ?? 0).toFixed(1)}pp（< ${thresholdPp}pp），假阳性 0 条。`
    : `阴性对照验证未通过：${issues.join("；")}。`;

  return {
    passed,
    thresholdPp,
    originalGainPp: orig.gain.gainPp,
    brokenGainPp: broken.gain.gainPp,
    originalActivationRate: orig.activationRate,
    brokenActivationRate: broken.activationRate,
    originalTimeouts: orig.timeouts,
    brokenTimeouts: broken.timeouts,
    trueContractAssertions,
    insensitiveAssertions,
    falsePositiveAssertions,
    issues,
    reason,
  };
}

export function formatNegativeControlReport(report: NegativeControlReport): string {
  const lines: string[] = [];
  lines.push("阴性对照元评估报告（Negative Control Verification）");
  lines.push("=".repeat(64));
  lines.push(`结论：${report.passed ? "✅ 具备区分能力（通过）" : "❌ 未通过"}`);
  lines.push(`说明：${report.reason}`);
  lines.push("");
  lines.push(
    `  原版 skill：激活率 ${(report.originalActivationRate * 100).toFixed(1)}% · 断言增益 ${report.originalGainPp === null ? "—" : `${report.originalGainPp >= 0 ? "+" : ""}${report.originalGainPp.toFixed(1)}pp`} · 超时 ${report.originalTimeouts} 次`,
  );
  lines.push(
    `  破坏版 skill：激活率 ${(report.brokenActivationRate * 100).toFixed(1)}% · 断言增益 ${report.brokenGainPp === null ? "—" : `${report.brokenGainPp >= 0 ? "+" : ""}${report.brokenGainPp.toFixed(1)}pp`} · 超时 ${report.brokenTimeouts} 次`,
  );
  lines.push(
    `  逐断言分层：真契约断言 ${report.trueContractAssertions.length} 条 · 白送无区分断言 ${report.insensitiveAssertions.length} 条 · 假阳性 ${report.falsePositiveAssertions.length} 条`,
  );
  if (report.issues.length > 0) {
    lines.push("");
    lines.push("阻断项：");
    for (const issue of report.issues) {
      lines.push(`  - ${issue}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
