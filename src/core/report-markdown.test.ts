import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "../report/markdown.ts";
import { evaluateAssertions } from "./assertions.ts";
import {
  summarizeTasks, summarizeVariants,
  type EvaluationSummary, type PairwiseResult, type RunnerOptions, type RunResult,
} from "./runner.ts";

test("报告区分诊断对、计分分母与规则纠偏，并保留负向题的断言明细", () => {
  const options: RunnerOptions = {
    runRoot: "/fixture", runId: "fixture", model: "subject", judgeModel: "judge", repeat: 2,
    variants: [
      { id: "baseline", label: "Baseline", skillPaths: [] },
      { id: "skill", label: "Skill", skillPaths: ["/fixture/SKILL.md"] },
    ],
    tasks: [
      { id: "scored", prompt: "Evaluate options", assertions: [{ kind: "mustContain", value: "evidence" }] },
      { id: "pure-data-query", prompt: "Calculate the average order value", shouldActivate: false,
        assertions: [{ kind: "numeric", pattern: "客单价\\s*=\\s*(\\d+)", expected: 300, note: "客单价提取" }] },
    ],
  };
  const results: RunResult[] = [];
  const pairwise: PairwiseResult[] = [];
  for (const task of options.tasks) {
    for (const attempt of [1, 2]) {
      for (const variant of options.variants) {
        const activated = task.shouldActivate !== false && variant.id === "skill";
        const output = task.shouldActivate === false
          ? variant.id === "baseline" ? "客单价 = 300 元/单" : "客单价 = 126,000 ÷ 420 = 300 元/单"
          : "recommendation";
        results.push({
          id: `${variant.id}-${task.id}-${attempt}`, variantId: variant.id, variantLabel: variant.label,
          taskId: task.id, attempt, status: "success", startedAt: 0, endedAt: 1, durationSec: 1,
          skillPaths: variant.skillPaths, totalTokens: 10, totalCost: 0, toolCalls: 0, output,
          activation: { status: activated ? "activated" : "not_activated", activated,
            readSkillPaths: [], matchedKeywords: [], evidence: [] },
          assertions: evaluateAssertions(output, task.assertions!), evidenceDir: "/fixture", error: null,
        });
      }
      pairwise.push({
        baselineResultId: `baseline-${task.id}-${attempt}`, variantResultId: `skill-${task.id}-${attempt}`,
        variantId: "skill", taskId: task.id, attempt,
        verdict: task.id === "scored" ? "win" : attempt === 1 ? "tie" : "not_judged",
        scoreDelta: null, baselineScore: null, variantScore: null, confidence: null, reason: "", error: null,
        judgeRuns: [], biasProbe: null,
      });
    }
  }
  const summary: EvaluationSummary = {
    runId: options.runId, model: options.model, judgeModel: "judge", repeat: 2, judgeRepeat: 1,
    tasks: options.tasks, results, pairwise, status: "success", evidenceLevel: "offline-fixture",
    startedAt: 0, endedAt: 1, durationSec: 1, totalCost: 0, totalTokens: 80, disagreements: [],
    variantSummaries: summarizeVariants(options, results, pairwise),
    taskSummaries: summarizeTasks(options, results, pairwise),
  };
  const report = renderReport({
    summary, tasks: options.tasks, variants: options.variants, verdict: "inconclusive", verdictReason: "证据不足",
    meta: { skillPath: "/fixture/SKILL.md", skillHash: "fixture", skillVersion: "1", suiteId: "fixture",
      suiteVersion: "1", runRoot: "/fixture", piHome: null, generatedAt: "offline" },
  });
  assert.match(report, /全部配对胜 \/ 平 \/ 负 \/ 未判 \| 计分对已判 \/ 计划/);
  assert.match(report, /\| Skill \| 2 \/ 1 \/ 0 \/ 1 \| 2 \/ 2 \| 100\.0% \| 100\.0% \| 100\.0% \| 0\.0% \|/);
  assert.match(report, /原始评委胜率（已判计分对）[^\n]*100\.0%[^\n]*描述性统计/);
  assert.match(report, /规则纠偏胜率（已判计分对）[^\n]*0\.0%/);
  assert.match(report, /1 对比较未能完成评判，其中 0 个计分对/);
  assert.match(report, /\| pure-data-query \| 诊断 \| 否（误触发测试） \|/);
  assert.match(report, /pure-data-query[^\n]*客单价提取[^\n]*数值 126/);
  assert.doesNotMatch(report, /P\d[^\n]*pure-data-query|零区分度计分用例[^\n]*pure-data-query|有实质提升|头尾保留采样|--models/);
  assert.match(report, /\| Pi SDK \| 未记录 \|/);
});
