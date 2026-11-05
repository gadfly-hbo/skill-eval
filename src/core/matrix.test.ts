import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMatrixMarkdown, summarizeModelMatrix } from "./matrix.ts";
import type { EvaluationSummary } from "./runner.ts";
import type { VerdictDecision } from "./verdict.ts";

function makeCell(model: string, verdict: "effective" | "ineffective" | "inconclusive", expensive = false) {
  const summary = {
    variantSummaries: [{ variantId: "skill", avgTokens: 12000 }],
  } as unknown as EvaluationSummary;
  const decision = {
    verdict,
    costGrade: expensive ? "expensive" : "moderate",
    expensive,
    reason: "r",
    blockers: [],
    warnings: [],
    metrics: {
      activationRate: 1,
      falseActivationRate: null,
      winRate: verdict === "effective" ? 0.8 : 0.3,
      effectiveWinRate: verdict === "effective" ? 0.8 : 0.3,
      ruleAdjustedWinRate: verdict === "effective" ? 0.8 : 0.3,
      winRateLowerBound: verdict === "effective" ? 0.8 : 0.3,
      winRateCi: null,
      pairCoverage: 1,
      scoredJudged: 6,
      totalScoredPairs: 6,
      timeoutRate: 0,
      hasAssertions: true,
      gainPp: verdict === "effective" ? 40 : 2,
      gainCiPp: null,
    },
  } as VerdictDecision;

  return { model, runDir: `/tmp/${model}`, summary, decision };
}

test("summarizeModelMatrix 识别跨模型能力分化（弱模型有效、强模型无效 → model_dependent）", () => {
  const report = summarizeModelMatrix([
    makeCell("minimax/flash", "effective", true),
    makeCell("frontier/pro", "ineffective", false),
  ]);
  assert.equal(report.classification, "model_dependent");
  const md = renderMatrixMarkdown(report, {
    suiteId: "demo",
    skillPath: "skills/demo/SKILL.md",
    judgeModel: "judge-1",
    generatedAt: "2026-11-05T00:00:00Z",
  });
  assert.match(md, /模型依赖/);
  assert.match(md, /有效（但昂贵）/);
});

test("summarizeModelMatrix 在全部模型均达标时评为 universal_effective", () => {
  const report = summarizeModelMatrix([
    makeCell("m1", "effective"),
    makeCell("m2", "effective"),
  ]);
  assert.equal(report.classification, "universal_effective");
});
