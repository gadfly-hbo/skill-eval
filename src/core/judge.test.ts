import { test } from "node:test";
import assert from "node:assert/strict";
import { aggregateJudgeRuns, parseJudgeResponse, detectPositionBias, buildJudgePrompt } from "./judge.ts";

const baseOptions = {
  judgeDir: "/tmp/judge",
  task: "写一份 JSON",
  outputA: "A 输出",
  outputB: "B 输出",
  runId: "r1",
};

test("解析合法的 win 判定", () => {
  const result = parseJudgeResponse(
    '{"verdict":"win","scoreA":60,"scoreB":85,"confidence":0.9,"reason":"B 更完整"}',
    baseOptions,
  );
  assert.equal(result.verdict, "win");
  assert.equal(result.scoreA, 60);
  assert.equal(result.scoreB, 85);
  assert.equal(result.scoreDelta, 25);
  assert.equal(result.confidence, 0.9);
});

test("解析非法 verdict 时判为 not_judged 而非默认 tie", () => {
  const result = parseJudgeResponse('{"verdict":"maybe","scoreA":50,"scoreB":50}', baseOptions);
  assert.equal(result.verdict, "not_judged");
  assert.ok(result.error);
});

test("非法 JSON 判为 not_judged 而非抛异常", () => {
  const result = parseJudgeResponse("这不是 JSON", baseOptions);
  assert.equal(result.verdict, "not_judged");
  assert.equal(result.reason, "评委输出无法解析为 JSON");
});

test("分数被钳制在 0-100 区间", () => {
  const result = parseJudgeResponse('{"verdict":"win","scoreA":-20,"scoreB":150,"confidence":5}', baseOptions);
  assert.equal(result.scoreA, 0);
  assert.equal(result.scoreB, 100);
  assert.equal(result.confidence, 1);
});

test("多数票聚合 win 多数", () => {
  const runs = [
    { verdict: "win" as const, scoreA: 50, scoreB: 80, scoreDelta: 30, confidence: 0.8, reason: "", error: null },
    { verdict: "win" as const, scoreA: 50, scoreB: 75, scoreDelta: 25, confidence: 0.7, reason: "", error: null },
    { verdict: "tie" as const, scoreA: 50, scoreB: 52, scoreDelta: 2, confidence: 0.6, reason: "", error: null },
  ];
  const aggregated = aggregateJudgeRuns(runs);
  assert.equal(aggregated.verdict, "win");
  assert.equal(aggregated.scoreA, 50);
});

test("票数并列时按平均分差裁决", () => {
  const runs = [
    { verdict: "win" as const, scoreA: 50, scoreB: 90, scoreDelta: 40, confidence: 0.8, reason: "", error: null },
    { verdict: "loss" as const, scoreA: 90, scoreB: 50, scoreDelta: -40, confidence: 0.8, reason: "", error: null },
  ];
  const aggregated = aggregateJudgeRuns(runs);
  assert.equal(aggregated.verdict, "win");
});

test("全部轮次失败时保持 not_judged", () => {
  const runs = [
    { verdict: "not_judged" as const, scoreA: null, scoreB: null, scoreDelta: null, confidence: null, reason: "", error: "boom" },
  ];
  const aggregated = aggregateJudgeRuns(runs);
  assert.equal(aggregated.verdict, "not_judged");
  assert.equal(aggregated.error, "boom");
});

test("位置偏好检测识别正反翻转", () => {
  const probe = detectPositionBias("win", "loss");
  assert.equal(probe.biased, true);
});

test("位置偏好检测对一致结论不报警", () => {
  const probe = detectPositionBias("win", "win");
  assert.equal(probe.biased, false);
});

test("位置偏好检测在存在未判定时保持中性", () => {
  const probe = detectPositionBias("win", "not_judged");
  assert.equal(probe.biased, false);
});

test("评委提示词不含 skill 来源暗示", () => {
  const prompt = buildJudgePrompt({
    ...baseOptions,
    expectedPoints: ["要点一"],
  });
  // 提示词里不能出现会暗示 A/B 来源的词。
  assert.doesNotMatch(prompt, /装了 ?skill/i);
  assert.doesNotMatch(prompt, /baseline/i);
  assert.doesNotMatch(prompt, /variant/i);
  assert.match(prompt, /输出 A/);
  assert.match(prompt, /输出 B/);
});

test("评委提示词包含任务与预期要点", () => {
  const prompt = buildJudgePrompt({
    ...baseOptions,
    task: "写一份 JSON",
    expectedPoints: ["要点一", "要点二"],
  });
  assert.match(prompt, /写一份 JSON/);
  assert.match(prompt, /要点一/);
  assert.match(prompt, /要点二/);
});
