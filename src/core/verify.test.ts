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

test("evaluateNegativeControl 在真实阴性对照实验产物上判定通过（+50.0pp vs +8.6pp）", () => {
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

  const origSummary = JSON.parse(readFileSync(origPath, "utf8")) as EvaluationSummary;
  const brokenSummary = JSON.parse(readFileSync(brokenPath, "utf8")) as EvaluationSummary;

  const report = evaluateNegativeControl(origSummary, brokenSummary);
  assert.equal(report.passed, true);
  assert.ok((report.originalGainPp ?? 0) >= 49.9);
  assert.ok((report.brokenGainPp ?? 100) < 10);
  assert.equal(report.brokenActivationRate, 1.0);
  assert.equal(report.falsePositiveAssertions.length, 0);
  assert.ok(report.trueContractAssertions.length > 0);

  const formatted = formatNegativeControlReport(report);
  assert.match(formatted, /具备区分能力/);
});

test("evaluateNegativeControl 拦截破坏版增益仍然达标（契约泄漏或无区分断言）的伪区分", () => {
  const makeFakeSummary = (basePass: number, varPass: number, activated = true): EvaluationSummary => ({
    runId: "fake",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
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
  });

  // 破坏版仍然拿到 +30pp 增益 → 失败（契约泄漏或断言失真）
  const leaked = evaluateNegativeControl(makeFakeSummary(3, 8, true), makeFakeSummary(3, 6, true));
  assert.equal(leaked.passed, false);
  assert.ok(leaked.issues.some((x) => x.includes("破坏版增益")));

  // 破坏版激活率掉到 0% → 失败（连触发契约一起破坏了，变量控制不成立）
  const unactivated = evaluateNegativeControl(
    makeFakeSummary(3, 8, true),
    makeFakeSummary(3, 3, false),
  );
  assert.equal(unactivated.passed, false);
  assert.ok(unactivated.issues.some((x) => x.includes("激活率")));
});
