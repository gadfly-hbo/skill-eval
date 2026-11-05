/**
 * 对比两轮评估：旧工具 vs 新工具（同一 skill / 同一套件 / 同一模型）。
 *
 * 用途：本轮修了 5 个工具缺陷（含评委执行证据注入），
 * 需要确认**判定稳定性**——新工具跑出来的结论是否与旧工具一致。
 *
 * 用法：
 *   node --experimental-strip-types scripts/compare-runs.ts <旧运行目录> <新运行目录>
 *
 * 输出：逐项对比 verdict / 激活率 / 胜率 / 断言通过率 / 分歧条数，
 * 以及逐条成对判定的差异明细。
 */

import fs from "node:fs";
import path from "node:path";

interface PairRow {
  taskId: string;
  attempt: number;
  verdict: string;
  scoreDelta: number | null;
}

interface Summary {
  runId: string;
  model: string;
  judgeModel: string;
  repeat: number;
  judgeRepeat: number;
  durationSec: number;
  totalTokens: number;
  totalCost: number;
  pairwise: PairRow[];
  variantSummaries: { variantId: string; assertionPassRate: number; win: number; tie: number; loss: number }[];
  disagreements?: unknown[];
}

function load(runDir: string): Summary {
  const p = path.join(runDir, "summary.json");
  if (!fs.existsSync(p)) {
    process.stderr.write(`未找到 ${p}\n`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8")) as Summary;
}

function winRate(pairs: PairRow[]): { win: number; tie: number; loss: number; judged: number; rate: number } {
  const win = pairs.filter((p) => p.verdict === "win").length;
  const tie = pairs.filter((p) => p.verdict === "tie").length;
  const loss = pairs.filter((p) => p.verdict === "loss").length;
  const judged = win + tie + loss;
  return { win, tie, loss, judged, rate: judged ? win / judged : 0 };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

const OLD_DIR = process.argv[2];
const NEW_DIR = process.argv[3];
if (!OLD_DIR || !NEW_DIR) {
  process.stderr.write("用法: compare-runs.ts <旧运行目录> <新运行目录>\n");
  process.exit(1);
}

const oldS = load(OLD_DIR);
const newS = load(NEW_DIR);

const oRate = winRate(oldS.pairwise);
const nRate = winRate(newS.pairwise);

const oAssert = oldS.variantSummaries.find((v) => v.variantId === "skill")?.assertionPassRate;
const nAssert = newS.variantSummaries.find((v) => v.variantId === "skill")?.assertionPassRate;

process.stdout.write(`\n=== 两轮评估对比 ===\n\n`);
process.stdout.write(`旧工具: ${oldS.runId}\n`);
process.stdout.write(`新工具: ${newS.runId}\n\n`);

process.stdout.write(`| 指标 | 旧工具 | 新工具 | 差异 |\n`);
process.stdout.write(`| --- | --- | --- | --- |\n`);
process.stdout.write(`| 被评模型 | ${oldS.model} | ${newS.model} | ${oldS.model === newS.model ? "同" : "**不同**"} |\n`);
process.stdout.write(`| 评委模型 | ${oldS.judgeModel} | ${newS.judgeModel} | ${oldS.judgeModel === newS.judgeModel ? "同" : "**不同**"} |\n`);
process.stdout.write(`| repeat / judgeRepeat | ${oldS.repeat}/${oldS.judgeRepeat} | ${newS.repeat}/${newS.judgeRepeat} | ${oldS.repeat === newS.repeat && oldS.judgeRepeat === newS.judgeRepeat ? "同" : "**不同**"} |\n`);
process.stdout.write(`| 成对判定 win/tie/loss | ${oRate.win}/${oRate.tie}/${oRate.loss} | ${nRate.win}/${nRate.tie}/${nRate.loss} | |\n`);
process.stdout.write(`| 胜率 | ${pct(oRate.rate)} | ${pct(nRate.rate)} | ${(nRate.rate - oRate.rate >= 0 ? "+" : "")}${((nRate.rate - oRate.rate) * 100).toFixed(1)}pp |\n`);
process.stdout.write(`| skill 断言通过率 | ${oAssert === undefined ? "—" : pct(oAssert)} | ${nAssert === undefined ? "—" : pct(nAssert)} | |\n`);
process.stdout.write(`| 分歧条数 | ${oldS.disagreements?.length ?? 0} | ${newS.disagreements?.length ?? 0} | |\n`);
process.stdout.write(`| 总耗时 | ${oldS.durationSec.toFixed(0)}s | ${newS.durationSec.toFixed(0)}s | |\n`);
process.stdout.write(`| 总 token | ${oldS.totalTokens} | ${newS.totalTokens} | |\n`);
process.stdout.write(`| 总成本 | $${oldS.totalCost.toFixed(4)} | $${newS.totalCost.toFixed(4)} | |\n`);

const THRESHOLD = 0.6;
const oldPass = oRate.rate >= THRESHOLD;
const newPass = nRate.rate >= THRESHOLD;
process.stdout.write(`\n**胜率门槛 60%：旧 ${oldPass ? "过" : "未过"}，新 ${newPass ? "过" : "未过"}**\n`);
process.stdout.write(
  `**verdict 稳定性：${oldPass === newPass ? "✅ 两轮一致——判定稳定" : "⚠️ 两轮不同——需人工复核"}**\n`,
);

// 逐条判定差异
const key = (p: PairRow) => `${p.taskId}-${p.attempt}`;
const oldMap = new Map(oldS.pairwise.map((p) => [key(p), p]));
const newMap = new Map(newS.pairwise.map((p) => [key(p), p]));

const diffs: string[] = [];
for (const [k, op] of oldMap) {
  const np = newMap.get(k);
  if (!np) {
    diffs.push(`- \`${k}\`: 旧 ${op.verdict} → 新 **缺失**`);
    continue;
  }
  if (op.verdict !== np.verdict) {
    diffs.push(`- \`${k}\`: ${op.verdict} → **${np.verdict}** (Δ ${op.scoreDelta ?? "?"} → ${np.scoreDelta ?? "?"})`);
  }
}
for (const k of newMap.keys()) {
  if (!oldMap.has(k)) diffs.push(`- \`${k}\`: 旧 **缺失** → 新 ${newMap.get(k)!.verdict}`);
}

process.stdout.write(`\n### 逐条判定差异（共 ${diffs.length} 条）\n\n`);
process.stdout.write(diffs.length ? diffs.join("\n") : "无差异——两轮逐条判定完全一致。\n");
process.stdout.write("\n");
