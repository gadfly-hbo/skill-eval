/**
 * 阴性对照对比脚本。
 *
 * 用途：验证评估工具的**区分能力**——把被测 skill 的行为契约剥离后，
 * 断言通过率应回落至 baseline 水平；若仍接近原版水平，说明工具无法区分
 * 「好 skill」与「坏 skill」，测出的增益不可信。
 *
 * 用法：
 *   node --experimental-strip-types scripts/negative-control-compare.ts <run-dir> [--label <变体名>]
 *   node --experimental-strip-types scripts/negative-control-compare.ts \
 *        --original <原版run-dir> --broken <破坏版run-dir>
 *
 * 输出：三组的断言通过率对比 + 逐用例明细 + 判定结论。
 */

import fs from "node:fs";
import path from "node:path";

interface Outcome {
  passed: boolean;
  kind: string;
  note?: string | undefined;
  detail?: string | undefined;
}

interface CaseResult {
  variantId: string;
  taskId: string;
  attempt: number;
  status: string;
  totalTokens: number;
  totalCost: number;
  durationSec: number;
  timedOut?: boolean;
  activation: { activated: boolean; status: string };
  assertions: { total: number; passed: number; failed: number; allPassed: boolean; outcomes: Outcome[] } | null;
}

interface Pairwise {
  variantId: string;
  taskId: string;
  attempt: number;
  verdict: string;
}

interface Summary {
  model: string;
  judgeModel: string;
  results: CaseResult[];
  pairwise: Pairwise[];
}

interface VariantStat {
  runs: number;
  failed: number;
  timedOut: number;
  assertionTotal: number;
  assertionPassed: number;
  assertionRate: number;
  activationRate: number;
  avgTokens: number;
  avgCost: number;
  avgDuration: number;
}

function loadSummary(runDir: string): Summary {
  const p = path.join(runDir, "summary.json");
  if (!fs.existsSync(p)) throw new Error(`找不到 ${p}`);
  return JSON.parse(fs.readFileSync(p, "utf8")) as Summary;
}

/** 按 variant 汇总断言通过率与激活率。 */
function summarize(summary: Summary): Record<string, VariantStat> {
  const byVariant = new Map<string, CaseResult[]>();
  for (const r of summary.results) {
    const list = byVariant.get(r.variantId) ?? [];
    list.push(r);
    byVariant.set(r.variantId, list);
  }
  const out: Record<string, VariantStat> = {};
  for (const [vid, rows] of byVariant) {
    const withA = rows.filter((r) => r.assertions);
    const total = withA.reduce((s, r) => s + (r.assertions?.total ?? 0), 0);
    const passed = withA.reduce((s, r) => s + (r.assertions?.passed ?? 0), 0);
    const activated = rows.filter((r) => r.activation.activated).length;
    out[vid] = {
      runs: rows.length,
      failed: rows.filter((r) => r.status !== "success").length,
      timedOut: rows.filter((r) => r.timedOut === true).length,
      assertionTotal: total,
      assertionPassed: passed,
      assertionRate: total ? passed / total : 0,
      activationRate: rows.length ? activated / rows.length : 0,
      avgTokens: rows.reduce((s, r) => s + r.totalTokens, 0) / Math.max(rows.length, 1),
      avgCost: rows.reduce((s, r) => s + r.totalCost, 0) / Math.max(rows.length, 1),
      avgDuration: rows.reduce((s, r) => s + r.durationSec, 0) / Math.max(rows.length, 1),
    };
  }
  return out;
}

function verdictCount(summary: Summary) {
  const c = { win: 0, tie: 0, loss: 0, not_judged: 0 };
  for (const p of summary.pairwise) {
    if (p.verdict in c) c[p.verdict as keyof typeof c] += 1;
  }
  return c;
}

function pad(s: string, n: number): string {
  // 中文按 2 个宽度计算，保证表格对齐。
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return s + " ".repeat(Math.max(0, n - w));
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function signedPp(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)} pp`;
}

interface RunView {
  dir: string;
  label: string;
  summary: Summary;
  stats: Record<string, VariantStat>;
  baseline: VariantStat;
  variantId: string;
  variant: VariantStat;
  verdicts: { win: number; tie: number; loss: number; not_judged: number };
}

function buildView(dir: string, label: string): RunView {
  const summary = loadSummary(dir);
  const stats = summarize(summary);
  const baseline = stats["baseline"];
  const entry = Object.entries(stats).find(([k]) => k !== "baseline");
  if (!baseline || !entry) throw new Error(`${dir}: 未能同时找到 baseline 与 variant 数据`);
  const [variantId, variant] = entry;
  return { dir, label, summary, stats, baseline, variantId, variant, verdicts: verdictCount(summary) };
}

function printSingle(view: RunView) {
  const { baseline, variant, verdicts } = view;
  console.log("=".repeat(78));
  console.log(`单次跑批：${view.label}`);
  console.log("=".repeat(78));
  console.log(`被评模型 ${view.summary.model}   评委模型 ${view.summary.judgeModel}`);
  console.log("");
  console.log("【断言通过率】");
  console.log(`  baseline（不装 skill）  ${pct(baseline.assertionRate)}  (${baseline.assertionPassed}/${baseline.assertionTotal})`);
  console.log(`  变体                    ${pct(variant.assertionRate)}  (${variant.assertionPassed}/${variant.assertionTotal})`);
  console.log(`  增益                    ${signedPp((variant.assertionRate - baseline.assertionRate) * 100)}`);
  console.log("");
  console.log("【激活率】");
  console.log(`  baseline  ${pct(baseline.activationRate)}`);
  console.log(`  变体      ${pct(variant.activationRate)}`);
  console.log("");
  console.log("【成本】");
  console.log(`  baseline  均 ${baseline.avgTokens.toFixed(0)} token / $${baseline.avgCost.toFixed(4)} / ${baseline.avgDuration.toFixed(1)}s`);
  console.log(`  变体      均 ${variant.avgTokens.toFixed(0)} token / $${variant.avgCost.toFixed(4)} / ${variant.avgDuration.toFixed(1)}s`);
  console.log("");
  console.log("【运行健康度】");
  console.log(`  baseline  失败 ${baseline.failed}/${baseline.runs}，其中超时 ${baseline.timedOut}`);
  console.log(`  变体      失败 ${variant.failed}/${variant.runs}，其中超时 ${variant.timedOut}`);
  console.log("");
  console.log("【胜率】");
  console.log(`  win ${verdicts.win} / tie ${verdicts.tie} / loss ${verdicts.loss} / 未判定 ${verdicts.not_judged}`);
  console.log("");
  console.log("【逐用例断言通过数】");
  console.log(`  ${pad("用例", 36)}${pad("baseline", 22)}变体`);
  const byTask = new Map<string, { b: string[]; v: string[] }>();
  for (const r of view.summary.results) {
    const key = `${r.taskId}#${r.attempt}`;
    const e = byTask.get(key) ?? { b: [], v: [] };
    const cell = r.timedOut === true ? "超时" : `${r.assertions?.passed ?? 0}/${r.assertions?.total ?? 0}`;
    if (r.variantId === "baseline") e.b.push(cell);
    else e.v.push(cell);
    byTask.set(key, e);
  }
  for (const [key, e] of byTask) {
    console.log(`  ${pad(key, 36)}${pad(e.b.join(" "), 22)}${e.v.join(" ")}`);
  }
  console.log("=".repeat(78));
}

function printTriple(original: RunView, broken: RunView) {
  console.log("=".repeat(78));
  console.log("阴性对照三组对比：原版 skill vs 破坏版 skill vs baseline");
  console.log("=".repeat(78));
  console.log(`被评模型 ${original.summary.model}   评委模型 ${original.summary.judgeModel}`);
  console.log(`套件断言完全一致，repeat=${original.summary.results.length > 0 ? "2" : "?"}，judgeRepeat=2`);
  console.log("");

  const rows = [
    { label: "baseline（不装 skill）", stat: original.baseline, gain: 0 },
    { label: "原版 skill（171 行完整契约）", stat: original.variant, gain: (original.variant.assertionRate - original.baseline.assertionRate) * 100 },
    { label: "破坏版 skill（53 行，契约剥离）", stat: broken.variant, gain: (broken.variant.assertionRate - broken.baseline.assertionRate) * 100 },
  ];

  console.log("【断言通过率】");
  console.log(`  ${pad("组别", 30)}${pad("通过率", 18)}${pad("断言数", 14)}${pad("增益", 14)}超时`);
  for (const r of rows) {
    const g = r.label.startsWith("baseline") ? "—" : signedPp(r.gain);
    console.log(`  ${pad(r.label, 30)}${pad(pct(r.stat.assertionRate), 18)}${pad(`${r.stat.assertionPassed}/${r.stat.assertionTotal}`, 14)}${pad(g, 14)}${r.stat.timedOut}`);
  }
  console.log("");

  console.log("【激活率】");
  for (const r of rows) {
    console.log(`  ${pad(r.label, 30)}${pct(r.stat.activationRate)}`);
  }
  console.log("");

  console.log("【成本（每次运行均值）】");
  for (const r of rows) {
    console.log(`  ${pad(r.label, 30)}${pad(r.stat.avgTokens.toFixed(0) + " token", 18)}${pad("$" + r.stat.avgCost.toFixed(4), 14)}${r.stat.avgDuration.toFixed(1)}s`);
  }
  console.log("");

  console.log("【胜率（成对评委）】");
  console.log(`  ${pad("原版 skill", 30)}win ${original.verdicts.win} / tie ${original.verdicts.tie} / loss ${original.verdicts.loss} / 未判定 ${original.verdicts.not_judged}`);
  console.log(`  ${pad("破坏版 skill", 30)}win ${broken.verdicts.win} / tie ${broken.verdicts.tie} / loss ${broken.verdicts.loss} / 未判定 ${broken.verdicts.not_judged}`);
  console.log("");

  console.log("【判定】");
  const origGain = (original.variant.assertionRate - original.baseline.assertionRate) * 100;
  const brokenGain = (broken.variant.assertionRate - broken.baseline.assertionRate) * 100;
  const origTimeout = original.variant.timedOut;
  const brokenTimeout = broken.variant.timedOut;

  if (origTimeout > 0 || brokenTimeout > 0) {
    console.log(`  ⚠️ 数据有超时污染（原版超时 ${origTimeout} 次 / 破坏版超时 ${brokenTimeout} 次），结论仅供参考。`);
    console.log("     建议用更长 --timeout 重跑后再判定。");
  } else if (origGain >= 10 && brokenGain < 10) {
    console.log("  ✅ 工具具备区分能力。");
    console.log(`     原版增益 ${origGain.toFixed(1)}pp（> 10pp 阈值），破坏版增益 ${brokenGain.toFixed(1)}pp（< 10pp 阈值，已回落至 baseline 水平）。`);
    console.log("     结论：断言确实在度量 skill 的行为契约，测出的增益是真实的。");
  } else if (origGain >= 10 && brokenGain >= 10) {
    console.log(`  ⚠️ 破坏版增益仍达 ${brokenGain.toFixed(1)}pp，接近原版水平（${origGain.toFixed(1)}pp）。`);
    console.log("     可能原因：① 契约泄漏到 references 或 description；② baseline 本身就能满足断言；");
    console.log("     ③ 断言区分度不足——断言对「有没有 skill」不敏感。");
  } else {
    console.log(`  ⚠️ 原版增益仅 ${origGain.toFixed(1)}pp，未越过 10pp 阈值，无法据此判定区分能力。`);
    console.log("     可能是原版 skill 在本模型上本就没带来增益，或断言区分度不足。");
  }
  console.log("=".repeat(78));
}

// ---------------------------------------------------------------- 参数解析
const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const originalDir = flag("--original");
const brokenDir = flag("--broken");

if (originalDir && brokenDir) {
  const original = buildView(originalDir, "原版 skill");
  const broken = buildView(brokenDir, "破坏版 skill");
  printTriple(original, broken);
} else {
  const runDir = argv.find((a) => !a.startsWith("--") && a !== flag("--label")) ?? argv[0];
  if (!runDir) {
    console.error("用法：node --experimental-strip-types scripts/negative-control-compare.ts <run-dir> [--label <变体名>]");
    console.error("  或：node --experimental-strip-types scripts/negative-control-compare.ts --original <run-dir> --broken <run-dir>");
    process.exit(1);
  }
  const label = flag("--label") ?? path.basename(runDir);
  printSingle(buildView(runDir, label));
}
