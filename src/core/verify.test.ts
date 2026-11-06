import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateNegativeControl,
  formatNegativeControlReport,
  stripBehavioralContract,
} from "./verify.ts";
import type { EvaluationSummary } from "./runner.ts";
import { computeAssertionItemRate, computeGainPp } from "./gain.ts";

test("stripBehavioralContract 保留 YAML frontmatter 触发契约并剥离正文行为契约", () => {
  const rawSkill = `---
name: data-analysis
description: 当用户需要分析数据、看趋势、找异常、做归因时使用本技能。
version: 1.8.0
---

# 数据分析专家

## 六段输出契约
1. 结论先行
2. 样本量声明（必须标注 N=）
3. 严禁未做因果检验时下因果结论
4. 明确责任人与截止时间
`;

  const stripped = stripBehavioralContract(rawSkill);
  assert.equal(stripped.preservedFrontmatter, true);
  assert.match(stripped.content, /name: data-analysis/);
  assert.match(stripped.content, /分析数据、看趋势/);
  assert.doesNotMatch(stripped.content, /样本量声明/);
  assert.doesNotMatch(stripped.content, /因果检验/);
  assert.ok(stripped.strippedLines < stripped.originalLines);
});

test("历史阴性对照保留条目描述增益（+50.0pp vs +8.6pp），缺冻结核验则新版结论inconclusive", () => {
  const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "../..");
  const origPath = join(
    repoRoot,
    "experiments/negative-control-2026-11-01/run-original/summary.json",
  );
  const brokenPath = join(
    repoRoot,
    "experiments/negative-control-2026-11-01/run-broken/summary.json",
  );

  assert.ok(existsSync(origPath), "缺少实验原版产物");
  assert.ok(existsSync(brokenPath), "缺少实验破坏版产物");

  const origRaw = readFileSync(origPath, "utf8");
  const brokenRaw = readFileSync(brokenPath, "utf8");
  const origSummary = JSON.parse(origRaw) as EvaluationSummary;
  const brokenSummary = JSON.parse(brokenRaw) as EvaluationSummary;

  // 旧样本仍支持原先的描述性数字；这些数字不再冒充完整配对推断或新版验证通过。
  const descriptiveGain = (s: EvaluationSummary) => {
    const variantId = s.results.find(r => r.variantId !== "baseline")!.variantId;
    return computeGainPp(computeAssertionItemRate(s.results, "baseline"), computeAssertionItemRate(s.results, variantId));
  };
  assert.ok((descriptiveGain(origSummary) ?? 0) >= 49.9);
  assert.ok((descriptiveGain(brokenSummary) ?? 100) < 10);
  assert.ok(Math.abs(descriptiveGain(brokenSummary)! - 8.620689655) < 1e-6);
  const brokenVariantRows = brokenSummary.results.filter(r => r.variantId !== "baseline");
  assert.equal(brokenVariantRows.filter(r => r.activation.activated).length / brokenVariantRows.length, 1.0);

  const report = evaluateNegativeControl(origSummary, brokenSummary);
  assert.equal(report.passed, false);
  assert.equal(report.status, "inconclusive");
  assert.equal(report.originalGainPp, null);
  assert.equal(report.brokenGainPp, null);
  assert.equal(report.brokenActivationRate, null);
  assert.equal(report.falsePositiveAssertions.length, 0);
  assert.equal(report.trueContractAssertions.length, 0, "缺覆盖时不推断逐断言层级；新完整夹具另有真契约与0假阳性回归");

  const formatted = formatNegativeControlReport(report);
  assert.match(formatted, /未验证/);
  assert.doesNotMatch(formatted, /具备区分能力（通过）/);
  assert.equal(readFileSync(origPath, "utf8"), origRaw);
  assert.equal(readFileSync(brokenPath, "utf8"), brokenRaw);
});

test("evaluateNegativeControl 拦截破坏版增益仍然达标（契约泄漏或无区分断言）的伪区分", () => {
  const makeFakeSummary = (basePass: number, varPass: number, activated = true): EvaluationSummary => ({
    runId: "fake",
    model: "m1",
    judgeModel: "m2",
    repeat: 1,
    judgeRepeat: 1,
    startedAt: 0,
    endedAt: 1000,
    durationSec: 10,
    status: "success",
    results: [
      {
        id: "baseline-t1-1",
        variantId: "baseline",
        variantLabel: "Baseline",
        taskId: "t1",
        attempt: 1,
        status: "success",
        startedAt: 0,
        endedAt: 1000,
        durationSec: 1,
        skillPaths: [],
        totalTokens: 100,
        totalCost: 0.001,
        toolCalls: 0,
        output: "out",
        activation: {
          status: "not_activated",
          activated: false,
          readSkillPaths: [],
          matchedKeywords: [],
          evidence: [],
        },
        assertions: {
          total: 10,
          passed: basePass,
          failed: 10 - basePass,
          allPassed: basePass === 10,
          outcomes: Array.from({ length: 10 }, (_, i) => ({
            kind: "mustMatch" as const,
            passed: i < basePass,
            detail: "d",
          })),
        },
        evidenceDir: "e",
        error: null,
      },
      {
        id: "skill-t1-1",
        variantId: "skill",
        variantLabel: "Skill",
        taskId: "t1",
        attempt: 1,
        status: "success",
        startedAt: 0,
        endedAt: 1000,
        durationSec: 1,
        skillPaths: ["/tmp/SKILL.md"],
        totalTokens: 100,
        totalCost: 0.001,
        toolCalls: 1,
        output: "out",
        activation: {
          status: activated ? "activated" : "not_activated",
          activated,
          readSkillPaths: activated ? ["/tmp/SKILL.md"] : [],
          matchedKeywords: [],
          evidence: [],
        },
        assertions: {
          total: 10,
          passed: varPass,
          failed: 10 - varPass,
          allPassed: varPass === 10,
          outcomes: Array.from({ length: 10 }, (_, i) => ({
            kind: "mustMatch" as const,
            passed: i < varPass,
            detail: "d",
          })),
        },
        evidenceDir: "e",
        error: null,
      },
    ],
    pairwise: [],
    variantSummaries: [],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0,
    totalTokens: 0,
    tasks: [{ id: "t1", prompt: "合成阴性对照任务", assertions: Array.from({ length: 10 }, () => ({ kind: "mustMatch", pattern: ".+" })) }],
    suiteMeta: { suiteId: "fake-suite", suiteVersion: "1", suiteHash: "same-frozen-suite", skillVersion: "1", skillPath: "/tmp/SKILL.md" },
    integrity: { verified: true, issues: [] },
    isolation: { verified: true, issues: [] },
  });

  // 破坏版仍然拿到 +30pp 增益 → 失败（契约泄漏或断言失真）
  const leaked = evaluateNegativeControl(makeFakeSummary(3, 8, true), makeFakeSummary(3, 6, true));
  assert.equal(leaked.passed, false);
  assert.equal(leaked.status, "failed");
  assert.ok(leaked.issues.some((x) => x.includes("破坏版增益")));

  // 破坏版激活率掉到 0% → 失败（连触发契约一起破坏了，变量控制不成立）
  const unactivated = evaluateNegativeControl(
    makeFakeSummary(3, 8, true),
    makeFakeSummary(3, 3, false),
  );
  assert.equal(unactivated.passed, false);
  assert.equal(unactivated.status, "failed");
  assert.ok(unactivated.issues.some((x) => x.includes("激活率")));
});
