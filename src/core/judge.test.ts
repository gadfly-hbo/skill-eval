import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateJudgeRuns,
  parseJudgeResponse,
  detectPositionBias,
  buildJudgePrompt,
  reconcileVerdictWithScores,
  reconcileJudgeRun,
  LABEL_CONFLICT_MIN_DELTA,
  DEFAULT_JUDGE_TIMEOUT_MS,
} from "./judge.ts";

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

// ---------------------------------------------------------------------------
// 标签与分差一致性校验（2026-11-05 实测缺陷的回归测试）
//
// 实测出现：{"verdict":"loss","scoreA":65,"scoreB":90}
// 分差 +25 方向应为 win，reason 文字也支持 win，标签却写 loss。
// 这一条就是 verdict 的唯一变量：按标签 5/10=50%（inconclusive），
// 按分差 6/10=60%（effective）。
//
// 设计要点：解析层只忠实记录评委说了什么，校验在统一口径
// （reconcileJudgeRun）下做——否则正反轮会得出互相矛盾的结论。
// ---------------------------------------------------------------------------

test("解析层不做标签校验，只忠实记录评委原话", () => {
  const result = parseJudgeResponse(
    '{"verdict":"loss","scoreA":65,"scoreB":90,"confidence":0.85,"reason":"B 更好"}',
    baseOptions,
  );
  assert.equal(result.verdict, "loss");
  assert.equal(result.labelConflict, null);
});

test("正轮口径下标签与分差矛盾时以分差方向纠正", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"loss","scoreA":65,"scoreB":90,"confidence":0.85,"reason":"B 更好"}',
    baseOptions,
  );
  const result = reconcileJudgeRun(parsed, false);
  assert.equal(result.verdict, "win");
  assert.equal(result.scoreDelta, 25);
  assert.ok(result.labelConflict);
  assert.equal(result.labelConflict!.originalVerdict, "loss");
  assert.equal(result.labelConflict!.correctedVerdict, "win");
  assert.equal(result.labelConflict!.scoreDelta, 25);
});

test("正轮口径下 loss 且分差为负时不纠正", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"loss","scoreA":90,"scoreB":65,"confidence":0.8,"reason":"A 更好"}',
    baseOptions,
  );
  const result = reconcileJudgeRun(parsed, false);
  assert.equal(result.verdict, "loss");
  assert.equal(result.labelConflict, null);
});

test("正轮口径下 win 且分差为正时不纠正", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"win","scoreA":58,"scoreB":90,"confidence":0.85,"reason":"B 更好"}',
    baseOptions,
  );
  const result = reconcileJudgeRun(parsed, false);
  assert.equal(result.verdict, "win");
  assert.equal(result.labelConflict, null);
});

test("tie 且分差在容差内不纠正（实测有 4 条分差 ±1~2 的 tie）", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"tie","scoreA":88,"scoreB":90,"confidence":0.7,"reason":"差异很小"}',
    baseOptions,
  );
  const result = reconcileJudgeRun(parsed, false);
  assert.equal(result.verdict, "tie");
  assert.equal(result.labelConflict, null);
});

test("tie 但分差超过阈值时按分差方向纠正", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"tie","scoreA":50,"scoreB":75,"confidence":0.7,"reason":"差不多"}',
    baseOptions,
  );
  const result = reconcileJudgeRun(parsed, false);
  assert.equal(result.verdict, "win");
  assert.ok(result.labelConflict);
  assert.equal(result.labelConflict!.originalVerdict, "tie");
});

test("分差缺失时不做校验", () => {
  const parsed = parseJudgeResponse('{"verdict":"loss","scoreA":65}', baseOptions);
  const result = reconcileJudgeRun(parsed, false);
  assert.equal(result.verdict, "loss");
  assert.equal(result.labelConflict, null);
});

test("not_judged 不做校验", () => {
  const result = reconcileVerdictWithScores("not_judged", 50);
  assert.equal(result.verdict, "not_judged");
  assert.equal(result.conflict, null);
});

test("阈值边界：分差恰好等于阈值时纠正", () => {
  const result = reconcileVerdictWithScores("loss", LABEL_CONFLICT_MIN_DELTA);
  assert.equal(result.verdict, "win");
  assert.ok(result.conflict);
});

test("阈值边界：分差略小于阈值时不纠正", () => {
  const result = reconcileVerdictWithScores("loss", LABEL_CONFLICT_MIN_DELTA - 1);
  assert.equal(result.verdict, "loss");
  assert.equal(result.conflict, null);
});

test("聚合结果保留标签冲突计数", () => {
  const runs = [
    {
      verdict: "win" as const,
      scoreA: 65,
      scoreB: 90,
      scoreDelta: 25,
      confidence: 0.85,
      reason: "",
      error: null,
      labelConflict: {
        originalVerdict: "loss" as const,
        correctedVerdict: "win" as const,
        scoreDelta: 25,
        note: "矛盾",
      },
    },
  ];
  const aggregated = aggregateJudgeRuns(runs);
  assert.equal(aggregated.verdict, "win");
  assert.ok(aggregated.labelConflict);
  assert.match(aggregated.labelConflict!.note, /1 条/);
});

// ---------------------------------------------------------------------------
// 反向轮 A/B 换算：分数与标签的口径
//
// 评委的标签实际语义是「分数更高的那份更好」，而非提示词字面写的「B 更好」。
// 实测反轮 A=skill(95)、B=baseline(58) 返回 win——按字面语义应是 loss，
// 按「谁分高谁赢」则是 win。
// 因此换算必须先翻分数、再按分差判方向，两步合起来才不会误判。
// ---------------------------------------------------------------------------

test("反向轮换算后分差方向代表 skill 相对 baseline 的优势", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"win","scoreA":95,"scoreB":58,"confidence":0.8,"reason":"A 更好"}',
    baseOptions,
  );
  const flipped = reconcileJudgeRun(parsed, true);
  // 换算后 A=baseline(58)、B=skill(95) → skill 更好 → win
  assert.equal(flipped.scoreA, 58);
  assert.equal(flipped.scoreB, 95);
  assert.equal(flipped.scoreDelta, 37);
  assert.equal(flipped.verdict, "win");
  assert.equal(flipped.labelConflict, null);
});

test("反向轮标签方向写反时纠正为 loss（换算后 skill 更差）", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"win","scoreA":58,"scoreB":95,"confidence":0.8,"reason":"A 更好"}',
    baseOptions,
  );
  const flipped = reconcileJudgeRun(parsed, true);
  // 换算后 A=skill(95)、B=baseline(58) → skill 更差 → loss
  assert.equal(flipped.scoreDelta, -37);
  assert.equal(flipped.verdict, "loss");
  assert.ok(flipped.labelConflict);
  assert.equal(flipped.labelConflict!.originalVerdict, "win");
  assert.equal(flipped.labelConflict!.correctedVerdict, "loss");
});

test("反向轮 tie 保持 tie", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"tie","scoreA":94,"scoreB":91,"confidence":0.7,"reason":"差异很小"}',
    baseOptions,
  );
  const flipped = reconcileJudgeRun(parsed, true);
  assert.equal(flipped.verdict, "tie");
  // 换算后 A=baseline(91)、B=skill(94) → skill 高 3 分，落在 tie 容差内
  assert.equal(flipped.scoreA, 91);
  assert.equal(flipped.scoreB, 94);
  assert.equal(flipped.scoreDelta, 3);
  assert.equal(flipped.labelConflict, null);
});

test("反向轮 not_judged 保持不变", () => {
  const parsed = parseJudgeResponse("", baseOptions);
  const flipped = reconcileJudgeRun(parsed, true);
  assert.equal(flipped.verdict, "not_judged");
  assert.equal(flipped.scoreDelta, null);
});

test("正反轮一致时不被误判为位置偏好（实测 trap-incomplete-period-2）", () => {
  // 正轮：A=baseline(88) B=skill(90) → tie（分差 2，容差内）
  // 反轮：A=skill(95) B=baseline(84) → win（换算后 skill 更好）
  // 修复前：反轮标签未翻 → 误判为位置偏好
  const forwardParsed = parseJudgeResponse(
    '{"verdict":"tie","scoreA":88,"scoreB":90,"confidence":0.65,"reason":"差异很小"}',
    baseOptions,
  );
  const reversedParsed = parseJudgeResponse(
    '{"verdict":"win","scoreA":95,"scoreB":84,"confidence":0.72,"reason":"A 更好"}',
    baseOptions,
  );
  const forward = reconcileJudgeRun(forwardParsed, false);
  const flipped = reconcileJudgeRun(reversedParsed, true);
  // 正轮 tie、反轮换算后 win —— 分差都在容差附近，不是位置偏好
  const probe = detectPositionBias(forward.verdict, flipped.verdict);
  assert.equal(probe.biased, false);
});

test("评委默认超时宽于 120 秒（实测 120s 会导致反轮空输出）", () => {
  assert.ok(DEFAULT_JUDGE_TIMEOUT_MS >= 240_000);
});

test("超长输出（> 24000 字符）采用头尾保留窗口，不截断报告末尾的结论与免责声明", () => {
  const longOutput =
    "【报告开头核心摘要】\n" +
    "正文填充".repeat(7000) +
    "\n【末尾参考文献与免责声明：本报告仅供参考】";

  const prompt = buildJudgePrompt({
    ...baseOptions,
    outputA: longOutput,
    outputB: "短输出",
  });

  assert.match(prompt, /报告开头核心摘要/);
  assert.match(prompt, /末尾参考文献与免责声明/);
  assert.match(prompt, /中间省略/);
});

