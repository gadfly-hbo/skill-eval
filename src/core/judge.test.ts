import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judgeAll, readJudgeDirs, type RunnerOptions, type RunResult } from "./runner.ts";
import {
  aggregateJudgeRuns,
  parseJudgeResponse,
  detectPositionBias,
  buildJudgePrompt,
  reconcileVerdictWithScores,
  reconcileJudgeRun,
  LABEL_CONFLICT_MIN_DELTA,
  DEFAULT_JUDGE_TIMEOUT_MS,
  buildJudgeSchedule,
  JUDGE_PROTOCOL_VERSION,
  type JudgeOptions,
  type JudgeResult,
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

test("票数并列时保持 tie，不按分差或固定方向选 win", () => {
  const runs = [
    { verdict: "win" as const, scoreA: 50, scoreB: 90, scoreDelta: 40, confidence: 0.8, reason: "", error: null },
    { verdict: "loss" as const, scoreA: 90, scoreB: 50, scoreDelta: -40, confidence: 0.8, reason: "", error: null },
  ];
  const aggregated = aggregateJudgeRuns(runs);
  assert.equal(aggregated.verdict, "tie");
});

test("win/tie 或 loss/tie 并列时不会选出零票方向", () => {
  const makeRun = (verdict: "win" | "tie" | "loss") => ({
    verdict, scoreA: null, scoreB: null, scoreDelta: null,
    confidence: null, reason: "", error: null,
  });
  for (const direction of ["win", "loss"] as const) {
    assert.equal(aggregateJudgeRuns([makeRun(direction), makeRun("tie")]).verdict, "tie");
    assert.equal(aggregateJudgeRuns([makeRun("tie"), makeRun(direction)]).verdict, "tie");
  }
});

test("反向轮小分差 +5 同时翻转标签和分数", () => {
  const parsed = parseJudgeResponse('{"verdict":"win","scoreA":70,"scoreB":75}', baseOptions);
  const reversed = reconcileJudgeRun(parsed, true);
  assert.equal(reversed.verdict, "loss");
  assert.equal(reversed.scoreDelta, -5);
  assert.equal(reversed.labelConflict, null);
});

test("正向轮 +5 维持 win，反向轮 -5 换算成同一个 win", () => {
  const forward = reconcileJudgeRun(parseJudgeResponse('{"verdict":"win","scoreA":70,"scoreB":75}', baseOptions), false);
  const reversed = reconcileJudgeRun(parseJudgeResponse('{"verdict":"loss","scoreA":75,"scoreB":70}', baseOptions), true);
  assert.equal(forward.verdict, "win");
  assert.equal(reversed.verdict, "win");
  assert.equal(reversed.scoreDelta, 5);
});

test("全部轮次失败时保持 not_judged", () => {
  const runs = [
    { verdict: "not_judged" as const, scoreA: null, scoreB: null, scoreDelta: null, confidence: null, reason: "", error: "boom" },
  ];
  const aggregated = aggregateJudgeRuns(runs);
  assert.equal(aggregated.verdict, "not_judged");
  assert.equal(aggregated.error, "boom");
});

test("双轮缺一票不得恢复单票胜出；缺失票保留在聚合法定人数中", () => {
  const vote = (verdict: JudgeResult["verdict"]): JudgeResult => ({ verdict, scoreA: 50, scoreB: 55, scoreDelta: 5, confidence: 1, reason: "fixture", error: verdict === "not_judged" ? "missing" : null });
  assert.equal(aggregateJudgeRuns([vote("win"), vote("not_judged")]).verdict, "not_judged");
  assert.equal(aggregateJudgeRuns([vote("not_judged"), vote("loss")]).verdict, "not_judged");
  assert.equal(aggregateJudgeRuns([vote("win"), vote("win"), vote("not_judged")]).verdict, "win");
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
// 反向轮遵守显式的 B 相对 A 协议；旧协议只在独立的历史诊断路径读取。
// ---------------------------------------------------------------------------

test("反向轮换算后分差方向代表 skill 相对 baseline 的优势", () => {
  const parsed = parseJudgeResponse(
    '{"verdict":"loss","scoreA":95,"scoreB":58,"confidence":0.8,"reason":"A 更好"}',
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
    '{"verdict":"loss","scoreA":58,"scoreB":95,"confidence":0.8,"reason":"A 更好"}',
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


test("评委顺序由冻结 seed/taskKey 可复算且两方向平衡", () => {
  const first = buildJudgeSchedule("frozen-run", "task-1", 5);
  assert.deepEqual(first, buildJudgeSchedule("frozen-run", "task-1", 5));
  assert.equal(first.length, 5);
  assert.ok(Math.abs(first.filter((r) => r.swapped).length - first.filter((r) => !r.swapped).length) <= 1);
  assert.ok(new Set(Array.from({ length: 20 }, (_, i) => buildJudgeSchedule("frozen-run", `task-${i}`, 2)[0]!.swapped)).size === 2);
});

test("提示词明确 B 相对 A，并拒绝未匿名的执行证据", () => {
  const prompt = buildJudgePrompt({ ...baseOptions,
    evidenceA: "read /Users/person/pending/data-analysis/SKILL.md",
    evidenceB: "variant data-analysis python scripts/calc.py",
  });
  assert.match(prompt, /B 相对输出 A/);
  assert.doesNotMatch(prompt, /data-analysis|calc\.py|SKILL\.md|pending|variant/);
});

test("默认双轮分歧全部保存并投票，重算和原判一致", async () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-judge-rounds-"));
  try {
    const base: RunResult = { id: "baseline-t1-1", variantId: "baseline", taskId: "t1", attempt: 1,
      status: "success", output: "base output", evidenceDir: "base", skillPaths: [], variantLabel: "Baseline",
      startedAt: 0, endedAt: 1, durationSec: 0.001, totalTokens: 0, totalCost: 0, toolCalls: 0,
      assertions: null, error: null,
      activation: { status: "not_activated", activated: false, matchedKeywords: [], readSkillPaths: [], evidence: [] } };
    const candidate = { ...base, id: "skill-t1-1", variantId: "skill", skillPaths: ["/private/data-analysis/SKILL.md"],
      variantLabel: "Skill(data-analysis)", output: "candidate output", evidenceDir: "candidate" };
    const options: RunnerOptions = { runRoot: root, runId: "frozen-seed", repeat: 1, model: "offline", tasks: [{ id: "t1", prompt: "compare" }],
      variants: [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Skill(data-analysis)", skillPaths: candidate.skillPaths }] };
    const called: JudgeOptions[] = [];
    const offlineJudge = async (input: JudgeOptions): Promise<JudgeResult> => {
      // 计划必须在第一个调用之前存在，不能观察结果后决定展示顺序。
      assert.ok(readFileSync(join(root, "pairwise", candidate.id, "judge-plan.json"), "utf8"));
      called.push(input);
      const canonicalVerdict = input.roundIndex === 0 ? "win" : "loss";
      const canonicalA = canonicalVerdict === "win" ? 70 : 75;
      const canonicalB = canonicalVerdict === "win" ? 75 : 70;
      const raw: JudgeResult = { verdict: input.swapped ? (canonicalVerdict === "win" ? "loss" : "win") : canonicalVerdict,
        scoreA: input.swapped ? canonicalB : canonicalA, scoreB: input.swapped ? canonicalA : canonicalB,
        scoreDelta: input.swapped ? canonicalA - canonicalB : canonicalB - canonicalA,
        confidence: 0.8, reason: "offline comparison", error: null, labelConflict: null,
        protocolVersion: JUDGE_PROTOCOL_VERSION, semanticsStatus: "explicit", swapped: input.swapped!, roundIndex: input.roundIndex! };
      mkdirSync(input.judgeDir, { recursive: true });
      writeFileSync(join(input.judgeDir, "judgment.json"), JSON.stringify(raw));
      return raw;
    };
    const pairs = await judgeAll(options, [base, candidate], undefined, offlineJudge);
    assert.equal(called.length, 2);
    assert.notEqual(called[0]!.swapped, called[1]!.swapped);
    assert.equal(pairs[0]!.verdict, "tie");
    assert.equal(pairs[0]!.judgeRuns.length, 2);
    assert.deepEqual(pairs[0]!.judgeRuns.map((r) => r.verdict), ["win", "loss"]);
    const loaded = readJudgeDirs(join(root, "pairwise", candidate.id));
    assert.deepEqual(loaded.judged, pairs[0]!.judgeRuns);
    assert.equal(aggregateJudgeRuns(loaded.judged).verdict, "tie");
    assert.equal(loaded.biasProbe?.biased, true);
    const planPath = join(root, "pairwise", candidate.id, "judge-plan.json");
    const originalPlan = readFileSync(planPath, "utf8");
    const truncatedPlan = JSON.parse(originalPlan);
    truncatedPlan.rounds = truncatedPlan.rounds.slice(0, 1);
    writeFileSync(planPath, JSON.stringify(truncatedPlan));
    const truncated = readJudgeDirs(join(root, "pairwise", candidate.id), { seed: options.runId, taskKey: candidate.id, repeat: 2 });
    assert.equal(truncated.judged.length, 2, "本地计划不能自行缩减冻结轮数");
    assert.equal(aggregateJudgeRuns(truncated.judged).verdict, "not_judged");
    writeFileSync(planPath, originalPlan);
    // 删除任何一轮也必须保留冻结轮数；缺失的那一票显式为未判定。
    rmSync(join(called[1]!.judgeDir, "judgment.json"));
    const missing = readJudgeDirs(join(root, "pairwise", candidate.id));
    assert.equal(missing.judged.length, 2);
    assert.equal(missing.judged[1]!.verdict, "not_judged");
    assert.match(missing.judged[1]!.error!, /缺失/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("历史无协议评委仅作诊断且不修改原始判定文件", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-judge-legacy-"));
  try {
    mkdirSync(join(root, "reversed"));
    const path = join(root, "reversed", "output.md");
    const original = '{"verdict":"win","scoreA":75,"scoreB":70,"reason":"old ambiguous label"}';
    writeFileSync(path, original);
    const loaded = readJudgeDirs(root);
    assert.equal(loaded.judged.length, 1);
    assert.equal(loaded.judged[0]!.verdict, "not_judged");
    assert.equal(loaded.judged[0]!.semanticsStatus, "legacy_ambiguous");
    assert.match(loaded.judged[0]!.reason, /旧评委协议/);
    assert.equal(readFileSync(path, "utf8"), original);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("任务、要点、评分规则与两份输出共享稳定匿名身份映射", () => {
  const name = "data-analysis";
  const script = "calc(v2)[x]+.py";
  const sourcePath = `/private/pending/${name}/SKILL.md`;
  const sourceIdentifiers = [sourcePath, name, script, "Skill(data-analysis)"];
  const options = { ...baseOptions, sourceIdentifiers,
    task: `必须使用 ${script} 验证 ${name}`,
    expectedPoints: [`必须使用 ${script}`], rubric: `检查 ${script}`,
    outputA: `使用 ${script}`, outputB: `Skill(data-analysis) 使用 ${script}，来自 ${sourcePath}`,
  };
  const prompt = buildJudgePrompt(options);
  assert.doesNotMatch(prompt, /data-analysis|calc\(v2\)|SKILL\.md|\/private|Skill\(/);
  const matches = prompt.match(/\[匿名材料\d+\]/g)!;
  assert.ok(matches);
  const mostUsed = matches.reduce<Record<string, number>>((counts, value) => { counts[value] = (counts[value] ?? 0) + 1; return counts; }, {});
  assert.ok(Object.values(mostUsed).some((count) => count === 5), "脚本在任务、要点、规则和两份输出中应使用同一个标识");
  assert.equal(prompt, buildJudgePrompt({ ...options, sourceIdentifiers: [...sourceIdentifiers].reverse() }));
  assert.equal(options.outputB, `Skill(data-analysis) 使用 ${script}，来自 ${sourcePath}`);
});
