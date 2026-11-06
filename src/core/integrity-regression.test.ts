import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { freezeSkill } from "./provenance.ts";
import { saveRunManifest, hashEvidenceFile, type RunManifest } from "./run-manifest.ts";
import { recomputeSummary, type EvalTask, type RunResult } from "./runner.ts";
import { evaluateAssertions } from "./assertions.ts";
import { buildJudgeSchedule, JUDGE_PROTOCOL_VERSION } from "./judge.ts";
import { decideVerdict } from "./verdict.ts";

/** All outputs and judgments below are synthetic offline fixtures, never model runs. */
async function makeFixture(root: string, assertions: EvalTask["assertions"] = [{ kind: "mustContain", value: "OK" }]) {
  const runRoot = join(root, "run");
  const source = join(root, "candidate");
  mkdirSync(source);
  writeFileSync(join(source, "SKILL.md"), "---\nname: offline-candidate\n---\n# Candidate");
  const frozen = freezeSkill(join(source, "SKILL.md"), join(runRoot, ".frozen", "skill"));
  const tasks: EvalTask[] = [{ id: "t1", prompt: "Offline fixture", assertions }];
  const variants = [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Skill", skillPaths: [frozen.skillPath] }];
  const manifest: RunManifest = {
    schemaVersion: 1, policyVersion: "paired-task-v2", runId: "offline-integrity-fixture", model: "offline", judgeModel: "offline-judge",
    repeat: 6, judgeRepeat: 2, judgeSeed: "offline-seed", tasks, variants,
    candidate: { identity: frozen.identity, snapshotDir: ".frozen/skill", originalSkillPath: join(source, "SKILL.md") },
    suiteMeta: { suiteId: "offline-suite", suiteVersion: "1", suiteHash: "offline-suite-hash", skillVersion: "1", skillPath: join(source, "SKILL.md") },
  };
  saveRunManifest(runRoot, manifest);
  const results: RunResult[] = [];
  for (const variant of variants) for (let attempt = 1; attempt <= manifest.repeat; attempt++) {
    const failed = variant.id === "skill" && attempt > 4;
    const dir = join(runRoot, "cases", variant.id, "t1", String(attempt));
    mkdirSync(dir, { recursive: true });
    const output = failed ? "" : variant.id === "skill" ? "OK" : "baseline";
    const row: RunResult = {
      id: `${variant.id}-t1-${attempt}`, variantId: variant.id, variantLabel: variant.label, taskId: "t1", attempt,
      status: failed ? "failed" : "success", startedAt: 0, endedAt: 1, durationSec: 1, skillPaths: variant.skillPaths,
      totalTokens: 100, totalCost: 0, toolCalls: 0, output,
      activation: { status: variant.id === "skill" ? "activated" : "not_activated", activated: variant.id === "skill", matchedKeywords: [], readSkillPaths: variant.skillPaths, evidence: [] },
      assertions: failed ? null : evaluateAssertions(output, assertions ?? []), evidenceDir: join("cases", variant.id, "t1", String(attempt)),
      error: failed ? "运行超时" : null, timedOut: failed, isolation: { verified: true, issues: [] },
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(row));
    writeFileSync(join(dir, "output.md"), output);
    writeFileSync(join(dir, "events.json"), "[]");
    row.evidenceHashes = Object.fromEntries(["result.json", "output.md", "events.json"].map(name => [name, hashEvidenceFile(join(dir, name))]));
    results.push(row);
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    const id = `skill-t1-${attempt}`;
    const dir = join(runRoot, "pairwise", id);
    const rounds = buildJudgeSchedule(manifest.judgeSeed, id, manifest.judgeRepeat);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "judge-plan.json"), JSON.stringify({ protocolVersion: JUDGE_PROTOCOL_VERSION, seed: manifest.judgeSeed, taskKey: id, rounds }));
    for (const round of rounds) {
      const roundDir = join(dir, round.dirName);
      mkdirSync(roundDir);
      writeFileSync(join(roundDir, "judgment.json"), JSON.stringify({ protocolVersion: JUDGE_PROTOCOL_VERSION, semanticsStatus: "explicit",
        swapped: round.swapped, roundIndex: round.roundIndex, verdict: round.swapped ? "loss" : "win",
        scoreA: round.swapped ? 90 : 20, scoreB: round.swapped ? 20 : 90, scoreDelta: round.swapped ? -70 : 70,
        confidence: 1, reason: "Synthetic offline comparison", error: null }));
    }
  }
  writeFileSync(join(runRoot, "summary.json"), JSON.stringify({ runId: manifest.runId, model: manifest.model, judgeModel: manifest.judgeModel,
    repeat: manifest.repeat, judgeRepeat: manifest.judgeRepeat, tasks, results, status: "partial", suiteMeta: manifest.suiteMeta }));
  return { runRoot, tasks, variants };
}

test("删除两条超时记录不能缩小六对分母，也不能把 partial 重算成有效", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-missing-regression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = await makeFixture(root);
  const before = await recomputeSummary(fixture.runRoot, fixture);
  assert.equal(before.status, "partial");
  assert.equal(before.variantSummaries.find(v => v.variantId === "skill")!.totalScoredPairs, 6);
  assert.equal(before.variantSummaries.find(v => v.variantId === "skill")!.pairCoverage, 4 / 6);
  const sourceSummary = readFileSync(join(fixture.runRoot, "summary.json"), "utf8");
  for (const attempt of [5, 6]) rmSync(join(fixture.runRoot, "cases", "skill", "t1", String(attempt), "result.json"));
  const after = await recomputeSummary(fixture.runRoot, fixture);
  const skill = after.variantSummaries.find(v => v.variantId === "skill")!;
  assert.equal(after.status, "partial");
  assert.equal(skill.totalScoredPairs, 6);
  assert.equal(skill.missing, 2);
  assert.ok(skill.pairCoverage !== null && skill.pairCoverage! <= 4 / 6);
  assert.equal(after.pairwise.length, 6);
  assert.equal(after.pairwise.filter(pair => pair.verdict === "not_judged").length, 2);
  assert.equal(after.integrity?.verified, false);
  assert.notEqual(decideVerdict(after).verdict, "effective");
  assert.equal(readFileSync(join(fixture.runRoot, "summary.json"), "utf8"), sourceSummary);
});

test("重算保留已经记录的污染，不改写原始证据", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-contamination-regression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = await makeFixture(root);
  const path = join(fixture.runRoot, "cases", "baseline", "t1", "1", "result.json");
  const raw = JSON.parse(readFileSync(path, "utf8"));
  raw.contamination = { contaminated: true, hits: ["private-answer.json"], reasons: ["metadata-file-read"] };
  const evidence = JSON.stringify(raw);
  writeFileSync(path, evidence);
  const summary = await recomputeSummary(fixture.runRoot, fixture);
  assert.deepEqual(summary.results.find(row => row.id === "baseline-t1-1")!.contamination, raw.contamination);
  assert.equal(decideVerdict(summary).verdict, "inconclusive");
  assert.equal(readFileSync(path, "utf8"), evidence);
});

test("成功记录的输出缺失时不执行负向断言，不能产生空输出假通过", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-output-regression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = await makeFixture(root, [{ kind: "mustNotMatch", pattern: "FORBIDDEN" }]);
  rmSync(join(fixture.runRoot, "cases", "skill", "t1", "1", "output.md"));
  const summary = await recomputeSummary(fixture.runRoot, fixture);
  const missingOutput = summary.results.find(row => row.id === "skill-t1-1")!;
  assert.equal(missingOutput.status, "failed");
  assert.equal(missingOutput.assertions, null);
  assert.equal(summary.integrity?.verified, false);
  assert.equal(summary.pairwise.length, 6);
  assert.equal(summary.pairwise.find(pair => pair.attempt === 1)!.verdict, "not_judged");
  assert.notEqual(decideVerdict(summary).verdict, "effective");
});
