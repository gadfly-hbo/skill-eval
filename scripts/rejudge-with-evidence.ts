/**
 * 重跑评委（复用已有被评产物），验证「执行证据注入」是否修正误判。
 *
 * 用途：本轮 data-analysis 测评中，评委因看不到工具执行记录，
 * 把「确实跑过 scripts/calc.py」的输出判成「无依据断言」。
 * 修法是给评委提示词注入执行证据摘要——本脚本用于**验证**该修法有效：
 * 不重跑被评模型（成本高、且会引入新的随机差异），只重跑评委。
 *
 * 用法：
 *   node --experimental-strip-types scripts/rejudge-with-evidence.ts <运行目录> [caseId...]
 *   node --experimental-strip-types scripts/rejudge-with-evidence.ts <运行目录> --no-evidence [caseId...]
 *
 * `--no-evidence` 跑对照组：条件与原始 forward 轮完全相同（无证据注入），
 * 两次结果的差异即为**评委随机波动**。有证据组 vs 对照组的差异才是
 * 证据注入的净效果——两者不可混为一谈。
 *
 * 不传 caseId 则重跑全部成对评判。
 *
 * 产出：
 *   <运行目录>/rejudge-with-evidence.json   新旧判定对照
 *   stdout                                 汇总
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runPairwiseJudge, reconcileJudgeRun, type JudgeResult } from "../src/core/judge.ts";
import { loadEvidenceFromDir } from "../src/core/evidence.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const RUN_DIR = process.argv[2];
const ARGS = process.argv.slice(3);
const WITH_EVIDENCE = !ARGS.includes("--no-evidence");
const CASE_FILTER = ARGS.filter((a) => !a.startsWith("--"));

if (!RUN_DIR) {
  process.stderr.write(
    "用法: rejudge-with-evidence.ts <运行目录> [--no-evidence] [caseId...]\n",
  );
  process.exit(1);
}

const GROUP = WITH_EVIDENCE ? "with-evidence" : "no-evidence";

const DEFAULT_JUDGE_MODEL = "xiaomi-token-plan-cn/mimo-v2.6-flash";
const DEFAULT_HOME = path.join(process.env.HOME ?? ".", ".skill-eval/pi-home");
const JUDGE_TIMEOUT_MS = 300_000;

interface SummaryRow {
  baselineResultId: string;
  variantResultId: string;
  variantId: string;
  taskId: string;
  attempt: number;
  verdict: string;
  scoreDelta: number | null;
  judgeRuns: { verdict: string; scoreA: number | null; scoreB: number | null; reason: string; labelConflict?: unknown }[];
}

interface SuiteTask {
  id: string;
  prompt: string;
  expectedPoints?: string[];
  rubric?: string;
}

const summary = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "summary.json"), "utf8")) as {
  results: { id: string; variantId: string; taskId: string; attempt: number; output: string; evidenceDir: string; status: string }[];
  pairwise: SummaryRow[];
  judgeModel?: string;
};

const suitePath = path.join(REPO, "suites", "data-analysis-v2.json");
const suite = JSON.parse(fs.readFileSync(suitePath, "utf8")) as { tasks: SuiteTask[] };
const taskById = new Map(suite.tasks.map((t) => [t.id, t]));

const judgeModel = summary.judgeModel ?? DEFAULT_JUDGE_MODEL;
const home = DEFAULT_HOME;

const resultById = new Map(summary.results.map((r) => [r.id, r]));

interface RejudgeRow {
  caseId: string;
  taskId: string;
  attempt: number;
  oldVerdict: string;
  oldScoreDelta: number | null;
  oldReason: string;
  newVerdict: string;
  newScoreDelta: number | null;
  newReason: string;
  labelConflict: unknown;
  changed: boolean;
}

const rows: RejudgeRow[] = [];

for (const row of summary.pairwise) {
  const caseId = row.variantResultId;
  if (CASE_FILTER.length && !CASE_FILTER.includes(caseId)) continue;

  const base = resultById.get(row.baselineResultId);
  const variant = resultById.get(row.variantResultId);
  const task = taskById.get(row.taskId);
  if (!base || !variant || !task) continue;
  if (base.status !== "success" || variant.status !== "success") continue;

  const evidenceA = WITH_EVIDENCE ? loadEvidenceFromDir(path.join(RUN_DIR, base.evidenceDir)) : undefined;
  const evidenceB = WITH_EVIDENCE ? loadEvidenceFromDir(path.join(RUN_DIR, variant.evidenceDir)) : undefined;

  const judgeDir = path.join(RUN_DIR, "rejudge", GROUP, caseId, "forward");
  fs.mkdirSync(judgeDir, { recursive: true });

  const forward: JudgeResult = await runPairwiseJudge({
    judgeDir,
    runId: `rejudge-${caseId}-fwd`,
    task: task.prompt,
    expectedPoints: task.expectedPoints,
    rubric: task.rubric,
    outputA: base.output,
    outputB: variant.output,
    evidenceA,
    evidenceB,
    model: judgeModel,
    home,
    timeoutMs: JUDGE_TIMEOUT_MS,
  });
  const reconciled = reconcileJudgeRun(forward, false);

  const oldRun = row.judgeRuns[0];
  rows.push({
    caseId,
    taskId: row.taskId,
    attempt: row.attempt,
    oldVerdict: row.verdict,
    oldScoreDelta: row.scoreDelta,
    oldReason: oldRun?.reason ?? "",
    newVerdict: reconciled.verdict,
    newScoreDelta: reconciled.scoreDelta,
    newReason: reconciled.reason ?? "",
    labelConflict: reconciled.labelConflict ?? null,
    changed: row.verdict !== reconciled.verdict,
  });

  process.stdout.write(
    `${rows[rows.length - 1]!.changed ? "★" : " "} ${caseId}: ${row.verdict} → ${reconciled.verdict}` +
      ` (Δ ${row.scoreDelta ?? "?"} → ${reconciled.scoreDelta ?? "?"})\n`,
  );
}

const outFile = path.join(RUN_DIR, `rejudge-${GROUP}.json`);
fs.writeFileSync(outFile, JSON.stringify(rows, null, 2), "utf8");

function tally(list: RejudgeRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of list) out[r.newVerdict] = (out[r.newVerdict] ?? 0) + 1;
  return out;
}

const changed = rows.filter((r) => r.changed);
process.stdout.write(`\n组别：${GROUP}\n`);
process.stdout.write(`总计 ${rows.length} 条，判定变化 ${changed.length} 条\n`);
process.stdout.write(`旧判定: ${JSON.stringify(tallyOld(rows))}\n`);
process.stdout.write(`新判定: ${JSON.stringify(tally(rows))}\n`);
process.stdout.write(`对照表: ${outFile}\n`);

function tallyOld(list: RejudgeRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of list) out[r.oldVerdict] = (out[r.oldVerdict] ?? 0) + 1;
  return out;
}
