/**
 * 复算脚本：用同一套断言在「完整可见内容」上重算通过率。
 *
 * 目的：验证 skill-eval 的观测口径偏差——CLI 只评估 output.md（对话输出），
 * 而 skill 被激活后会把完整报告写入工作目录文件，对话里只留摘要。
 *
 * 两种口径：
 *   A. chat  = 仅 output.md（= CLI 现行口径）
 *   B. full  = output.md + 同目录下的落盘交付物（*.md，排除 output.md）
 *
 * 判定为「真实差距」时需同时满足：
 *   - 门禁分（skill 自带 quality_check.py）差异
 *   - full 口径下的断言通过率差异
 */

import fs from "node:fs";
import path from "node:path";
import { evaluateAssertions, type Assertion } from "../src/core/assertions.ts";

const RUN_DIR = process.argv[2] ?? path.join(process.env.HOME ?? ".", ".skill-eval/runs/20261027-234757-data-analysis-r2");

interface Suite {
  tasks: { id: string; assertions: Assertion[] }[];
}

interface ResultRow {
  taskId: string;
  attempt: number;
  variantId: string;
  assertions: { total: number; passed: number; allPassed: boolean };
}

function readOutput(caseDir: string): string {
  const p = path.join(caseDir, "output.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

/** 收集同目录下模型写出的交付物（排除 harness 自己的 output.md） */
function readArtifacts(caseDir: string): { name: string; content: string }[] {
  if (!fs.existsSync(caseDir)) return [];
  return fs
    .readdirSync(caseDir)
    .filter((f) => f.endsWith(".md") && f !== "output.md")
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(caseDir, f), "utf8") }));
}

const suite = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "suite.json"), "utf8")) as Suite;
const summary = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "summary.json"), "utf8")) as {
  results: ResultRow[];
  variantSummaries: { variantId: string; assertionPassRate: number }[];
};

const taskById = new Map(suite.tasks.map((t) => [t.id, t]));

interface Row {
  taskId: string;
  attempt: number;
  variantId: string;
  cliPassed: number;
  chatPassed: number;
  fullPassed: number;
  total: number;
  fullAllPassed: boolean;
  artifact: string;
}

const rows: Row[] = [];

for (const r of summary.results) {
  const task = taskById.get(r.taskId);
  if (!task) continue;
  const caseDir = path.join(RUN_DIR, "cases", r.variantId, r.taskId, String(r.attempt));
  const chat = readOutput(caseDir);
  const arts = readArtifacts(caseDir);
  const full = [chat, ...arts.map((a) => a.content)].join("\n\n");

  const chatRep = evaluateAssertions(chat, task.assertions);
  const fullRep = evaluateAssertions(full, task.assertions);

  rows.push({
    taskId: r.taskId,
    attempt: r.attempt,
    variantId: r.variantId,
    cliPassed: r.assertions.passed,
    chatPassed: chatRep.passed,
    fullPassed: fullRep.passed,
    total: task.assertions.length,
    fullAllPassed: fullRep.allPassed,
    artifact: arts.map((a) => a.name).join(", ") || "—",
  });
}

// 汇总
function passRate(sel: (x: Row) => boolean, key: "chatPassed" | "fullPassed" | "cliPassed"): number {
  const subset = rows.filter(sel);
  if (subset.length === 0) return 0;
  // 与 skill-eval 口径一致：断言全部通过的 run 数 / 有断言的 run 数
  const keyAll = key === "cliPassed" ? "cliPassed" : key;
  return subset.filter((x) => (key === "cliPassed" ? x.cliPassed : x[keyAll]) === x.total).length / subset.length;
}

console.log("=".repeat(108));
console.log("口径对比：CLI 现行(仅 output.md) vs 完整可见内容(output.md + 落盘交付物)");
console.log("=".repeat(108));
console.log(
  `${"用例".padEnd(36)}${"次".padEnd(4)}${"baseline".padEnd(12)}${"skill".padEnd(12)}${"交付物(skill)".padEnd(26)}$"`,
);
console.log("-".repeat(108));

for (const task of suite.tasks) {
  for (const attempt of [1, 2]) {
    const b = rows.find((x) => x.taskId === task.id && x.attempt === attempt && x.variantId === "baseline");
    const k = rows.find((x) => x.taskId === task.id && x.attempt === attempt && x.variantId === "skill");
    if (!b || !k) continue;
    const f = (n: number, t: number) => `${n}/${t}`;
    console.log(
      `${task.id.padEnd(36)}${String(attempt).padEnd(4)}` +
        `${f(b.chatPassed, b.total).padEnd(12)}${f(k.chatPassed, k.total).padEnd(12)}` +
        `${k.artifact.padEnd(26)}`,
    );
  }
}

console.log("\n" + "=".repeat(108));
console.log("汇总（口径一致性核对 + 真实差距）");
console.log("=".repeat(108));

const isBaseline = (x: Row) => x.variantId === "baseline";
const isSkill = (x: Row) => x.variantId === "skill";

// 1) CLI 口径能否从原始产物复算出来（验证 summary 未被污染）
const cliBaseline = passRate(isBaseline, "cliPassed");
const cliSkill = passRate(isSkill, "cliPassed");
const chatBaseline = passRate(isBaseline, "chatPassed");
const chatSkill = passRate(isSkill, "chatPassed");
const fullBaseline = passRate(isBaseline, "fullPassed");
const fullSkill = passRate(isSkill, "fullPassed");

console.log(`CLI summary 记录的通过率        baseline ${(cliBaseline * 100).toFixed(1)}%   skill ${(cliSkill * 100).toFixed(1)}%`);
console.log(`仅 output.md 复算（应等于 CLI）  baseline ${(chatBaseline * 100).toFixed(1)}%   skill ${(chatSkill * 100).toFixed(1)}%`);
console.log(`完整可见内容复算                baseline ${(fullBaseline * 100).toFixed(1)}%   skill ${(fullSkill * 100).toFixed(1)}%`);
console.log();
console.log(`口径差：skill 侧 仅对话 ${(chatSkill * 100).toFixed(1)}% → 完整内容 ${(fullSkill * 100).toFixed(1)}%`);
console.log(`baseline 侧 仅对话 ${(chatBaseline * 100).toFixed(1)}% → 完整内容 ${(fullBaseline * 100).toFixed(1)}%`);

// 2) 逐用例 allPassed 判定翻转（这才是「规则断言 vs 评委」分歧的真正来源）
console.log("\n" + "-".repeat(108));
console.log("规则判定（allPassed）在两种口径下的翻转");
console.log("-".repeat(108));
let flips = 0;
for (const task of suite.tasks) {
  for (const attempt of [1, 2]) {
    const b = rows.find((x) => x.taskId === task.id && x.attempt === attempt && x.variantId === "baseline");
    const k = rows.find((x) => x.taskId === task.id && x.attempt === attempt && x.variantId === "skill");
    if (!b || !k) continue;
    const judge = (summary as any).pairwise.find(
      (p: any) => p.taskId === task.id && p.attempt === attempt,
    )?.verdict;
    const ruleChat = b.cliPassed === b.total ? (k.chatPassed === k.total ? "持平" : "skill改善") : k.chatPassed === k.total ? "skill改善" : "持平";
    const ruleFull = b.cliPassed === b.total ? (k.fullPassed === k.total ? "持平" : "skill改善") : k.fullPassed === k.total ? "skill改善" : "持平";
    const jrule = judge === "win" ? "skill改善" : judge === "tie" ? "持平" : judge === "loss" ? "skill更差" : "?";
    const flip = ruleChat !== ruleFull ? " ★翻转" : "";
    if (flip) flips++;
    console.log(
      `${task.id.padEnd(36)}${String(attempt).padEnd(4)}chat:${ruleChat.padEnd(11)}full:${ruleFull.padEnd(11)}评委:${jrule.padEnd(11)}${flip}`,
    );
  }
}
console.log(`\n口径导致的规则判定翻转：${flips} 处`);

// 3) 评委判 win 但规则判持平的分歧，逐条检查 full 口径下是否仍然分歧
console.log("\n" + "-".repeat(108));
console.log("原 7 条分歧在 full 口径下的状态");
console.log("-".repeat(108));
const disagreements = (summary as any).disagreements as any[];
for (const d of disagreements) {
  const b = rows.find((x) => x.taskId === d.taskId && x.attempt === d.attempt && x.variantId === "baseline");
  const k = rows.find((x) => x.taskId === d.taskId && x.attempt === d.attempt && x.variantId === "skill");
  if (!b || !k) continue;
  const ruleChat = b.cliPassed === b.total ? (k.chatPassed === k.total ? "持平" : "skill改善") : k.chatPassed === k.total ? "skill改善" : "持平";
  const ruleFull = b.cliPassed === b.total ? (k.fullPassed === k.total ? "持平" : "skill改善") : k.fullPassed === k.total ? "skill改善" : "持平";
  const jrule = d.verdict === "win" ? "skill改善" : d.verdict === "tie" ? "持平" : "skill更差";
  console.log(
    `${d.taskId.padEnd(36)}${String(d.attempt).padEnd(4)}chat:${ruleChat.padEnd(11)}full:${ruleFull.padEnd(11)}评委:${jrule.padEnd(11)}` +
      `full口径后:${ruleFull === jrule ? "已消解" : "仍分歧"}`,
  );
}
