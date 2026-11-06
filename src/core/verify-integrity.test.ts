import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateNegativeControl, formatNegativeControlReport, stripBehavioralContract } from "./verify.ts";
import type { EvaluationSummary, RunResult } from "./runner.ts";

function makeSummary(passed: number, activated = true): EvaluationSummary {
  const tasks = Array.from({ length: 16 }, (_, i) => ({ id: `task-${i}`, prompt: `Independent case ${i}`,
    assertions: Array.from({ length: 10 }, (_, j) => ({ kind: "mustContain" as const, value: `condition-${j}` })) }));
  const results: RunResult[] = tasks.flatMap(t => ["baseline", "skill"].map(variantId => {
    const p = variantId === "baseline" ? 0 : passed;
    return { id: `${variantId}-${t.id}-1`, variantId, variantLabel: variantId, taskId: t.id, attempt: 1,
      status: "success", startedAt: 0, endedAt: 1, durationSec: 1, skillPaths: variantId === "baseline" ? [] : ["/tmp/SKILL.md"],
      totalTokens: 100, totalCost: 0, toolCalls: 1, output: "non-empty output",
      activation: { status: activated ? "activated" : "not_activated", activated: variantId !== "baseline" && activated,
        readSkillPaths: [], matchedKeywords: [], evidence: [] },
      assertions: { total: 10, passed: p, failed: 10 - p, allPassed: p === 10,
        outcomes: Array.from({ length: 10 }, (_, i) => ({ kind: "mustContain" as const, passed: i < p, detail: "test" })) },
      evidenceDir: "", error: null };
  }));
  return { runId: "synthetic", model: "model", judgeModel: "judge", repeat: 1, judgeRepeat: 2,
    startedAt: 0, endedAt: 1, durationSec: 1, status: "success", tasks, results, pairwise: [], variantSummaries: [],
    taskSummaries: [], disagreements: [], totalCost: 0, totalTokens: 0,
    suiteMeta: { suiteId: "suite", suiteVersion: "1", suiteHash: "same-frozen-suite", skillVersion: "1", skillPath: "/tmp/SKILL.md" },
    integrity: { verified: true, issues: [] }, isolation: { verified: true, issues: [] } };
}

test("正文剥离保留触发 frontmatter，不保留行为契约", () => {
  const raw = "---\nname: analysis\ndescription: 分析数据时使用\n---\n\n# 数据分析\n\n必须复算、必须给出责任人与截止时间。\n";
  const stripped = stripBehavioralContract(raw);
  assert.equal(stripped.preservedFrontmatter, true);
  assert.match(stripped.content, /description: 分析数据时使用/);
  assert.doesNotMatch(stripped.content, /复算|责任人|截止时间/);
});

test("配置可比、完整覆盖且双方增益已测量时，阴性对照可通过", () => {
  const report = evaluateNegativeControl(makeSummary(10), makeSummary(0));
  assert.equal(report.status, "passed");
  assert.equal(report.passed, true);
  assert.equal(report.originalGainPp, 100);
  assert.equal(report.brokenGainPp, 0);
  assert.ok(report.trueContractAssertions.length > 0);
  assert.match(formatNegativeControlReport(report), /具备区分能力/);
});

test("破坏版缺失样本/断言不再被写成0增益通过", () => {
  for (const mutate of [
    (s: EvaluationSummary) => { s.results = []; },
    (s: EvaluationSummary) => { s.results = s.results.filter(r => r.variantId === "baseline"); },
    (s: EvaluationSummary) => { s.results.forEach(r => { if (r.variantId === "skill") r.assertions = null; }); },
    (s: EvaluationSummary) => { s.results.pop(); },
    (s: EvaluationSummary) => { s.results.push(s.results[0]!); },
    (s: EvaluationSummary) => { s.results[0]!.assertions!.outcomes.pop(); },
  ]) {
    const broken = makeSummary(0); mutate(broken);
    const report = evaluateNegativeControl(makeSummary(10), broken);
    assert.equal(report.passed, false);
    assert.equal(report.status, "inconclusive");
    assert.equal(report.brokenGainPp, null);
    assert.ok(report.issues.some(i => /配对|覆盖|增益/.test(i)));
  }
  const empty = makeSummary(0); empty.results = [];
  const report = evaluateNegativeControl(makeSummary(10), empty);
  assert.equal(report.brokenActivationRate, null);
  assert.equal(report.brokenTimeouts, null);
  assert.match(formatNegativeControlReport(report), /未验证/);
});

test("模型/评委/重复次数/任务集/套件指纹漂移或缺失均不能比较", () => {
  for (const mutate of [
    (s: EvaluationSummary) => { s.model = "other"; },
    (s: EvaluationSummary) => { s.judgeModel = "other"; },
    (s: EvaluationSummary) => { s.repeat = 2; },
    (s: EvaluationSummary) => { s.judgeRepeat = 3; },
    (s: EvaluationSummary) => { s.tasks![0]!.id = "other-task"; },
    (s: EvaluationSummary) => { s.suiteMeta!.suiteHash = "changed"; },
    (s: EvaluationSummary) => { s.suiteMeta!.suiteHash = undefined; },
    (s: EvaluationSummary) => { s.tasks = undefined; },
    (s: EvaluationSummary) => { s.model = ""; },
  ]) {
    const broken = makeSummary(0); mutate(broken);
    const report = evaluateNegativeControl(makeSummary(10), broken);
    assert.equal(report.passed, false);
    assert.equal(report.status, "inconclusive");
    assert.ok(report.issues.length > 0);
  }
});

test("变量可比但破坏版增益过高/触发失败，结论为failed", () => {
  const leaking = evaluateNegativeControl(makeSummary(10), makeSummary(5));
  assert.equal(leaking.status, "failed");
  assert.ok(leaking.issues.some(i => i.includes("破坏版增益")));
  const notTriggered = evaluateNegativeControl(makeSummary(10), makeSummary(0, false));
  assert.equal(notTriggered.status, "failed");
  assert.ok(notTriggered.issues.some(i => i.includes("激活率")));
});

test("失败空输出/超时或污染使阴性对照证据不足", () => {
  for (const mutate of [
    (s: EvaluationSummary) => { Object.assign(s.results[1]!, { status: "failed", output: "", assertions: null, timedOut: true }); },
    (s: EvaluationSummary) => { s.results[0]!.contamination = { contaminated: true, hits: ["private"], reasons: ["metadata-file-read"] }; },
    (s: EvaluationSummary) => { s.integrity = undefined; },
    (s: EvaluationSummary) => { s.isolation = { verified: false, issues: ["未隔离"] }; },
  ]) {
    const broken = makeSummary(0); mutate(broken);
    const report = evaluateNegativeControl(makeSummary(10), broken);
    assert.equal(report.passed, false);
    assert.equal(report.status, "inconclusive");
  }
});

test("旧阴性对照产物缺少冻结和核验证据时标未验证，保留历史文件", () => {
  const originalPath = new URL("../../experiments/negative-control-2026-11-01/run-original/summary.json", import.meta.url);
  const brokenPath = new URL("../../experiments/negative-control-2026-11-01/run-broken/summary.json", import.meta.url);
  const originalRaw = readFileSync(originalPath, "utf8");
  const brokenRaw = readFileSync(brokenPath, "utf8");
  const report = evaluateNegativeControl(JSON.parse(originalRaw), JSON.parse(brokenRaw));
  assert.equal(report.passed, false);
  assert.equal(report.status, "inconclusive");
  assert.ok(report.issues.some(i => /冻结|核验|套件/.test(i)));
  assert.equal(readFileSync(originalPath, "utf8"), originalRaw);
  assert.equal(readFileSync(brokenPath, "utf8"), brokenRaw);
});
