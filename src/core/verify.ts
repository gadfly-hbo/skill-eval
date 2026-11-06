/**
 * 阴性对照元评估（Meta-Evaluation）模块。
 *
 * 把一次性实验脚本固化为标准子命令 `skill-eval verify`：
 * 1. `stripBehavioralContract`：自动保留 YAML frontmatter 触发契约、剥离正文行为契约，生成破坏版 SKILL.md
 * 2. `evaluateNegativeControl`：对比原版跑批与破坏版跑批，检验「触发控制成立 + 原版越过门槛 + 破坏版回落门槛以下 + 0 假阳性」
 */

import { ACTIVATION_THRESHOLD, GAIN_THRESHOLD_PP, INSENSITIVE_BASELINE_PASS_RATE } from "./thresholds.ts";
import { evaluateGainFromResults, isScoredTask } from "./gain.ts";
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
  status: "passed" | "failed" | "inconclusive";
  thresholdPp: number;
  originalGainPp: number | null;
  brokenGainPp: number | null;
  originalActivationRate: number | null;
  brokenActivationRate: number | null;
  originalTimeouts: number | null;
  brokenTimeouts: number | null;
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

function extractVariantStats(summary: EvaluationSummary, thresholdPp: number) {
  const variantId =
    summary.results.find((r) => r.variantId !== "baseline")?.variantId ??
    summary.variantSummaries.find((v) => v.variantId !== "baseline")?.variantId ??
    "skill";

  const variantRows = summary.results.filter((r) => r.variantId === variantId);
  const positiveIds = new Set(summary.tasks?.filter(t => t.shouldActivate !== false).map(t => t.id));
  const positiveRows = variantRows.filter(r => positiveIds.has(r.taskId));
  const activatedCount = positiveRows.filter((r) => r.activation?.activated).length;
  const activationRate = positiveRows.length > 0 ? activatedCount / positiveRows.length : null;
  const timeouts = variantRows.length === 0 ? null : variantRows.filter(
    (r) => r.timedOut === true || (r.error ?? "").includes("超时"),
  ).length;
  const gain = evaluateGainFromResults(summary.results, variantId, thresholdPp, summary.tasks, summary.repeat);
  const scoredIds = new Set(summary.tasks?.filter(isScoredTask).map(t => t.id));

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
    if (row.status === "failed" || !row.assertions || !scoredIds.has(row.taskId) ||
        (row.variantId !== "baseline" && row.variantId !== variantId)) continue;
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

/** 未知和不可比的运行不能成为「破坏版已经测得低增益」的证据。 */
function comparabilityIssues(original: EvaluationSummary, broken: EvaluationSummary): string[] {
  const issues: string[] = [];
  for (const key of ["model", "judgeModel", "repeat", "judgeRepeat"] as const) {
    const left = original[key];
    const right = broken[key];
    const valid = (v: unknown) => typeof v === "string" ? v.trim().length > 0 : Number.isInteger(v) && Number(v) > 0;
    if (!valid(left) || !valid(right) || left !== right) issues.push(`${key} 缺失或不一致，实验不可比较`);
  }
  const leftHash = original.suiteMeta?.suiteHash;
  const rightHash = broken.suiteMeta?.suiteHash;
  if (!leftHash || !rightHash || leftHash !== rightHash) issues.push("冻结套件 suiteHash 缺失或不一致");
  const taskIds = (s: EvaluationSummary) => s.tasks?.map(t => [t.id, t.kind ?? "scored", t.shouldActivate ?? true]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (!original.tasks?.length || !broken.tasks?.length || JSON.stringify(taskIds(original)) !== JSON.stringify(taskIds(broken))) {
    issues.push("冻结任务 ID/计分范围缺失或不一致");
  }
  for (const [name, summary] of [["原版", original], ["破坏版", broken]] as const) {
    if (!summary.integrity?.verified || summary.integrity.issues.length) issues.push(`${name}身份完整性未通过核验`);
    if (!summary.isolation?.verified || summary.isolation.issues.length) issues.push(`${name}实验隔离未通过核验`);
    if (summary.results.some(r => r.contamination?.contaminated)) issues.push(`${name}存在实验污染`);
    if (summary.status !== "success" || summary.results.some(r => r.status !== "success" || !r.output?.trim())) {
      issues.push(`${name}存在失败/空输出或跑批未完整成功`);
    }
    if (summary.tasks && Number.isInteger(summary.repeat) && summary.repeat > 0) {
      const variantIds = new Set(summary.results.filter(r => r.variantId !== "baseline").map(r => r.variantId));
      if (variantIds.size !== 1) issues.push(`${name}缺少唯一被测 variant`);
      const variantId = [...variantIds][0];
      const validIds = new Set(summary.tasks.map(t => t.id));
      if (summary.results.some(r => !validIds.has(r.taskId) || !Number.isInteger(r.attempt) || r.attempt < 1 || r.attempt > summary.repeat)) {
        issues.push(`${name}存在冻结任务/重复范围外的运行`);
      }
      for (const task of summary.tasks) for (let attempt = 1; attempt <= summary.repeat; attempt++) {
        for (const id of ["baseline", variantId]) {
          const rows = summary.results.filter(r => r.taskId === task.id && r.attempt === attempt && r.variantId === id);
          if (rows.length !== 1) issues.push(`${name} ${task.id}/${attempt} 配对缺失或重复`);
          else if (task.assertions?.length && (rows[0]!.assertions?.total !== task.assertions.length || rows[0]!.assertions?.outcomes.length !== task.assertions.length)) {
            issues.push(`${name} ${task.id}/${attempt} 断言覆盖不完整`);
          }
        }
      }
    }
  }
  return issues;
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
  const orig = extractVariantStats(originalSummary, thresholdPp);
  const broken = extractVariantStats(brokenSummary, thresholdPp);

  const evidenceIssues = comparabilityIssues(originalSummary, brokenSummary);
  if (!orig.gain.complete || orig.gain.gainPp === null) evidenceIssues.push(`原版配对增益未验证：${orig.gain.issues.join("；")}`);
  if (!broken.gain.complete || broken.gain.gainPp === null) evidenceIssues.push(`破坏版配对增益未验证：${broken.gain.issues.join("；")}`);
  if (orig.activationRate === null || broken.activationRate === null) evidenceIssues.push("缺少正向触发运行，激活率未验证");
  const issues: string[] = [...evidenceIssues];

  if ((orig.timeouts ?? 0) > 0 || (broken.timeouts ?? 0) > 0) {
    issues.push(
      `存在运行超时（原版 ${orig.timeouts ?? "未验证"} 次 / 破坏版 ${broken.timeouts ?? "未验证"} 次），当前批次不能证明区分能力`,
    );
  }

  if (broken.activationRate !== null && broken.activationRate < ACTIVATION_THRESHOLD - 1e-9) {
    issues.push(
      `破坏版激活率仅 ${(broken.activationRate * 100).toFixed(1)}%（低于 ${(ACTIVATION_THRESHOLD * 100).toFixed(0)}%），连触发契约也被破坏，阴性对照变量控制不成立`,
    );
  }
  if (orig.activationRate !== null && orig.activationRate < ACTIVATION_THRESHOLD - 1e-9) issues.push("原版激活率未达触发门槛");

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

  // 不完整覆盖时不生成貌似完整的逐断言层级，更不能把缺失项计为假阳性 0。
  for (const [key, origItem] of evidenceIssues.length ? [] : orig.perAssertion) {
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

  const status = evidenceIssues.length > 0 ? "inconclusive" : issues.length > 0 ? "failed" : "passed";
  const passed = status === "passed";
  const reason = passed
    ? `当前可比完整样本中具备区分能力：原版任务等权增益 +${orig.gain.gainPp!.toFixed(1)}pp（≥ ${thresholdPp}pp），破坏版激活率 ${(broken.activationRate! * 100).toFixed(1)}% 且增益 ${broken.gain.gainPp! >= 0 ? "+" : ""}${broken.gain.gainPp!.toFixed(1)}pp（< ${thresholdPp}pp），未检出假阳性。此为冻结套件内的描述性对照检验，不替代独立任务区间的有效性判定。`
    : `阴性对照${status === "inconclusive" ? "未验证（证据不足）" : "验证未通过"}：${issues.join("；")}。`;

  return {
    passed,
    status,
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
  lines.push(`结论：${report.passed ? "✅ 具备区分能力（通过）" : report.status === "inconclusive" ? "— 未验证（证据不足）" : "❌ 未通过"}`);
  lines.push(`说明：${report.reason}`);
  lines.push("");
  lines.push(
    `  原版 skill：激活率 ${report.originalActivationRate === null ? "未验证" : `${(report.originalActivationRate * 100).toFixed(1)}%`} · 任务等权增益 ${report.originalGainPp === null ? "未验证" : `${report.originalGainPp >= 0 ? "+" : ""}${report.originalGainPp.toFixed(1)}pp`} · 超时 ${report.originalTimeouts ?? "未验证"} 次`,
  );
  lines.push(
    `  破坏版 skill：激活率 ${report.brokenActivationRate === null ? "未验证" : `${(report.brokenActivationRate * 100).toFixed(1)}%`} · 任务等权增益 ${report.brokenGainPp === null ? "未验证" : `${report.brokenGainPp >= 0 ? "+" : ""}${report.brokenGainPp.toFixed(1)}pp`} · 超时 ${report.brokenTimeouts ?? "未验证"} 次`,
  );
  lines.push(
    report.status === "inconclusive" ? "  逐断言分层：未验证（覆盖或可比性不足）" : `  逐断言分层：真契约断言 ${report.trueContractAssertions.length} 条 · 白送无区分断言 ${report.insensitiveAssertions.length} 条 · 假阳性 ${report.falsePositiveAssertions.length} 条`,
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
