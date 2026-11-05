import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCalibration, exportCalibrationSheet } from "./calibration.ts";
import type { EvaluationSummary } from "./runner.ts";

test("盲审导出隐藏来源身份，回填标注后正确计算一致率、Kappa 与评委乐观偏置", () => {
  const summary: EvaluationSummary = {
    runId: "cal-run-1",
    model: "m1",
    judgeModel: "m2",
    repeat: 2,
    judgeRepeat: 2,
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
        endedAt: 1,
        durationSec: 1,
        skillPaths: [],
        totalTokens: 10,
        totalCost: 0,
        toolCalls: 0,
        output: "baseline output 1",
        activation: { status: "not_activated", activated: false, matchedKeywords: [], readSkillPaths: [], evidence: [] },
        assertions: null,
        evidenceDir: "",
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
        endedAt: 1,
        durationSec: 1,
        skillPaths: ["/tmp/SKILL.md"],
        totalTokens: 10,
        totalCost: 0,
        toolCalls: 1,
        output: "skill output 1",
        activation: { status: "activated", activated: true, matchedKeywords: [], readSkillPaths: ["/tmp/SKILL.md"], evidence: [] },
        assertions: null,
        evidenceDir: "",
        error: null,
      },
      {
        id: "baseline-t2-1",
        variantId: "baseline",
        variantLabel: "Baseline",
        taskId: "t2",
        attempt: 1,
        status: "success",
        startedAt: 0,
        endedAt: 1,
        durationSec: 1,
        skillPaths: [],
        totalTokens: 10,
        totalCost: 0,
        toolCalls: 0,
        output: "baseline output 2",
        activation: { status: "not_activated", activated: false, matchedKeywords: [], readSkillPaths: [], evidence: [] },
        assertions: null,
        evidenceDir: "",
        error: null,
      },
      {
        id: "skill-t2-1",
        variantId: "skill",
        variantLabel: "Skill",
        taskId: "t2",
        attempt: 1,
        status: "success",
        startedAt: 0,
        endedAt: 1,
        durationSec: 1,
        skillPaths: ["/tmp/SKILL.md"],
        totalTokens: 10,
        totalCost: 0,
        toolCalls: 1,
        output: "skill output 2",
        activation: { status: "activated", activated: true, matchedKeywords: [], readSkillPaths: ["/tmp/SKILL.md"], evidence: [] },
        assertions: null,
        evidenceDir: "",
        error: null,
      },
    ],
    pairwise: [
      {
        baselineResultId: "baseline-t1-1",
        variantResultId: "skill-t1-1",
        variantId: "skill",
        taskId: "t1",
        attempt: 1,
        verdict: "win",
        scoreDelta: 20,
        baselineScore: 60,
        variantScore: 80,
        confidence: 0.9,
        reason: "ok",
        error: null,
        judgeRuns: [],
        biasProbe: null,
      },
      {
        baselineResultId: "baseline-t2-1",
        variantResultId: "skill-t2-1",
        variantId: "skill",
        taskId: "t2",
        attempt: 1,
        verdict: "win",
        scoreDelta: 15,
        baselineScore: 65,
        variantScore: 80,
        confidence: 0.8,
        reason: "ok",
        error: null,
        judgeRuns: [],
        biasProbe: null,
      },
    ],
    variantSummaries: [],
    taskSummaries: [],
    disagreements: [],
    totalCost: 0,
    totalTokens: 0,
  };

  const { blindSheet, answerKey } = exportCalibrationSheet(summary, [
    { id: "t1", prompt: "问题1" },
    { id: "t2", prompt: "问题2" },
  ]);

  assert.equal(blindSheet.items.length, 2);
  // 第 1 题人工同样选 skill 侧赢；第 2 题人工认为 tie（评委乐观判 win）
  const key1 = answerKey.entries[0]!;
  blindSheet.items[0]!.humanVerdict = key1.aIsVariant ? "A" : "B";
  blindSheet.items[1]!.humanVerdict = "tie";

  const cal = evaluateCalibration(blindSheet, answerKey);
  assert.equal(cal.reviewedCount, 2);
  assert.equal(cal.agreementRate, 0.5);
  assert.equal(cal.judgeWinRate, 1.0);
  assert.equal(cal.humanWinRate, 0.5);
  assert.equal(cal.optimismBiasPp, 50);
  assert.equal(cal.disagreements.length, 1);
});
