import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { freezeSkill } from "../core/provenance.ts";
import { saveRunManifest, hashEvidenceFile, EVALUATION_POLICY_VERSION, type RunManifest } from "../core/run-manifest.ts";
import { recomputeSummary, type RunResult, type EvalTask } from "../core/runner.ts";
import { evaluateAssertions } from "../core/assertions.ts";
import { buildJudgeSchedule, JUDGE_PROTOCOL_VERSION } from "../core/judge.ts";
import { decideVerdict } from "../core/verdict.ts";
import { evaluateNegativeControl } from "../core/verify.ts";
import type { BlindReviewSheet, CalibrationResult } from "../core/calibration.ts";

const mainPath = fileURLToPath(new URL("./main.ts", import.meta.url));
const repoRoot = dirname(dirname(dirname(mainPath)));

/** A local pi stub is always first on PATH, so no test can reach a real Provider. */
function installOfflinePi(root: string): string {
  const bin = join(root, "offline-pi", "bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(root, "offline-pi", "home"));
  writeFileSync(join(root, "offline-pi", "deny-fetch.mjs"), "globalThis.fetch = async () => { throw new Error('OFFLINE_NETWORK_DENIED'); };\n");
  writeFileSync(join(root, "offline-pi", "package.json"), '{"name":"offline-pi-fixture","type":"module"}');
  const command = join(bin, "pi");
  writeFileSync(command, '#!/usr/bin/env node\nimport {writeFileSync} from "node:fs";\nimport {join} from "node:path";\nwriteFileSync(join(process.cwd(),"PI_WAS_STARTED"),"unexpected pi execution");\nprocess.exit(99);\n');
  chmodSync(command, 0o755);
  return bin;
}

function invoke(bin: string, args: string[]) {
  return spawnSync(process.platform === "darwin" ? "/usr/bin/sandbox-exec" : process.execPath,
    [...(process.platform === "darwin" ? ["-p", "(version 1)(allow default)(deny network*)", process.execPath] : []), "--import", join(dirname(bin), "deny-fetch.mjs"), "--experimental-strip-types", mainPath, ...args], {
    cwd: repoRoot, encoding: "utf8", timeout: 20000,
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: join(dirname(bin), "home"), LANG: "en_US.UTF-8" },
  });
}

function containsPiMarker(root: string): boolean {
  return readdirSync(root, { withFileTypes: true }).some(entry => entry.name === "PI_WAS_STARTED" ||
    (entry.isDirectory() && containsPiMarker(join(root, entry.name))));
}

/** Synthetic, complete evidence supports a known effective fixture without model calls. */
async function makeRun(root: string, deliverableTaskIds: string[] = []) {
  const runRoot = join(root, "run");
  const source = join(root, "candidate");
  mkdirSync(source);
  const sourceSkill = join(source, "SKILL.md");
  writeFileSync(sourceSkill, "---\nname: offline-fixture\nversion: 1\n---\n# Original skill");
  mkdirSync(join(source, "scripts"));
  writeFileSync(join(source, "scripts", "calc.py"), "print(1)\n");
  const frozen = freezeSkill(sourceSkill, join(runRoot, ".frozen", "skill"));
  const tasks: EvalTask[] = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, prompt: `Synthetic independent fixture ${i}`,
    assertions: [{ kind: "mustContain", value: "OK" }] }));
  for (const task of tasks) if (deliverableTaskIds.includes(task.id)) task.deliverablePath = "report.md";
  const variants = [{ id: "baseline", label: "Baseline", skillPaths: [] }, { id: "skill", label: "Skill", skillPaths: [frozen.skillPath] }];
  const manifest: RunManifest = {
    schemaVersion: 1, policyVersion: "paired-task-v2", runId: "offline-cli-fixture", model: "offline-model", judgeModel: "offline-judge",
    repeat: 1, judgeRepeat: 2, judgeSeed: "offline-seed", tasks, variants,
    candidate: { identity: frozen.identity, snapshotDir: ".frozen/skill", originalSkillPath: sourceSkill },
    suiteMeta: { suiteId: "offline-suite", suiteVersion: "1", suiteHash: "offline-frozen-suite", skillVersion: "1", skillPath: sourceSkill },
  };
  saveRunManifest(runRoot, manifest);
  const results: RunResult[] = [];
  for (const task of tasks) for (const variant of variants) {
    const dir = join(runRoot, "cases", variant.id, task.id, "1");
    mkdirSync(dir, { recursive: true });
    const output = variant.id === "skill" ? "OK" : "baseline";
    const delivery = task.deliverablePath ? `Frozen deliverable: ${output}` : undefined;
    if (delivery !== undefined) writeFileSync(join(dir, "deliverable.md"), delivery);
    const row: RunResult = {
      id: `${variant.id}-${task.id}-1`, variantId: variant.id, variantLabel: variant.label, taskId: task.id, attempt: 1,
      status: "success", startedAt: 0, endedAt: 1, durationSec: 1, skillPaths: variant.skillPaths,
      totalTokens: 100, totalCost: 0, toolCalls: 0, output,
      activation: { status: variant.id === "skill" ? "activated" : "not_activated", activated: variant.id === "skill", matchedKeywords: [], readSkillPaths: variant.skillPaths, evidence: [] },
      assertions: evaluateAssertions(delivery ?? output, task.assertions!), evidenceDir: join("cases", variant.id, task.id, "1"),
      ...(task.deliverablePath ? { deliverable: { path: task.deliverablePath, status: "present" } } : {}),
      error: null, timedOut: false, isolation: { verified: true, issues: [] },
    };
    writeFileSync(join(dir, "result.json"), JSON.stringify(row));
    writeFileSync(join(dir, "output.md"), output);
    writeFileSync(join(dir, "events.json"), "[]");
    const evidenceFiles = ["result.json", "output.md", "events.json", ...(delivery === undefined ? [] : ["deliverable.md"])];
    row.evidenceHashes = Object.fromEntries(evidenceFiles.map(name => [name, hashEvidenceFile(join(dir, name))]));
    results.push(row);
  }
  for (const task of tasks) {
    const id = `skill-${task.id}-1`;
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
  writeFileSync(join(runRoot, "summary.json"), JSON.stringify({ ...manifest, status: "success", results, suiteMeta: manifest.suiteMeta }));
  const summary = await recomputeSummary(runRoot, { tasks, variants });
  summary.evidenceLevel = "offline-fixture";
  writeFileSync(join(runRoot, "summary.json"), JSON.stringify(summary));
  writeFileSync(join(runRoot, "REPORT.md"), "# Original report\n\nOffline synthetic evidence. Preserve these exact bytes.\n");
  assert.equal(decideVerdict(summary).verdict, "effective", "fixture must reach normal gates so identity rejection is meaningful");
  return { runRoot, sourceSkill, tasks };
}

test("CLI 归档绑定完整冻结包：未测候选和改过的脚本被拒绝，源删除后仍可归档快照", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-cli-archive-regression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = installOfflinePi(root);
  const fixture = await makeRun(root);
  const foreign = join(root, "unrelated");
  mkdirSync(foreign);
  writeFileSync(join(foreign, "SKILL.md"), "Never evaluated");
  const summaryBefore = readFileSync(join(fixture.runRoot, "summary.json"), "utf8");
  const reportBefore = readFileSync(join(fixture.runRoot, "REPORT.md"), "utf8");
  for (const extra of [[], ["--force"]]) {
    const output = invoke(bin, ["archive", "--run", fixture.runRoot, "--skill", join(foreign, "SKILL.md"), "--archive-root", join(root, "archive"), ...extra]);
    assert.equal(output.error, undefined);
    assert.notEqual(output.status, 0, output.stdout + output.stderr);
    assert.match(output.stdout + output.stderr, /候选身份|身份哈希|冻结.*候选/);
  }
  assert.equal(existsSync(join(root, "archive")), false);
  writeFileSync(join(dirname(fixture.sourceSkill), "scripts", "calc.py"), "print(2)\n");
  const changedScript = invoke(bin, ["archive", "--run", fixture.runRoot, "--skill", fixture.sourceSkill,
    "--archive-root", join(root, "archive"), "--repo", root, "--force"]);
  assert.notEqual(changedScript.status, 0, changedScript.stdout + changedScript.stderr);
  assert.match(changedScript.stdout + changedScript.stderr, /候选身份|身份哈希|冻结.*候选/);
  assert.equal(existsSync(join(root, "archive")), false);
  rmSync(dirname(fixture.sourceSkill), { recursive: true });
  const fromFrozen = invoke(bin, ["archive", "--run", fixture.runRoot, "--archive-root", join(root, "archive"), "--repo", root]);
  assert.equal(fromFrozen.error, undefined);
  assert.equal(fromFrozen.status, 0, fromFrozen.stdout + fromFrozen.stderr);
  const index = JSON.parse(readFileSync(join(root, "archive", "candidate", "latest.json"), "utf8"));
  assert.equal(index.verdict, "effective");
  assert.equal(readFileSync(join(root, "archive", index.path, "scripts", "calc.py"), "utf8"), "print(1)\n");
  assert.equal(readFileSync(join(fixture.runRoot, "summary.json"), "utf8"), summaryBefore);
  assert.equal(readFileSync(join(fixture.runRoot, "REPORT.md"), "utf8"), reportBefore);
  assert.equal(containsPiMarker(root), false);
});

test("CLI report 另存派生分析，不覆盖原报告、摘要及已有派生分析", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-cli-report-regression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = installOfflinePi(root);
  const fixture = await makeRun(root);
  const reportBefore = readFileSync(join(fixture.runRoot, "REPORT.md"), "utf8");
  const summaryBefore = readFileSync(join(fixture.runRoot, "summary.json"), "utf8");
  let firstAnalysis: { path: string; report: string; summary: string } | undefined;
  for (let pass = 0; pass < 2; pass++) {
    const output = invoke(bin, ["report", "--run", fixture.runRoot, "--force"]);
    assert.equal(output.error, undefined);
    assert.equal(output.status, 0, output.stdout + output.stderr);
    assert.match(output.stdout, /派生|原记录未覆盖/);
    assert.equal(readFileSync(join(fixture.runRoot, "REPORT.md"), "utf8"), reportBefore);
    assert.equal(readFileSync(join(fixture.runRoot, "summary.json"), "utf8"), summaryBefore);
    const analyses = readdirSync(join(fixture.runRoot, "analyses"));
    assert.equal(analyses.length, pass + 1);
    if (pass === 0) {
      const path = join(fixture.runRoot, "analyses", analyses[0]!);
      firstAnalysis = { path, report: readFileSync(join(path, "REPORT.md"), "utf8"), summary: readFileSync(join(path, "summary.json"), "utf8") };
      const derived = JSON.parse(firstAnalysis.summary);
      assert.equal(derived.evidenceLevel, "replay");
      assert.equal(derived.analysisOf.runId, "offline-cli-fixture");
      assert.equal(derived.policyVersion, EVALUATION_POLICY_VERSION);
      assert.equal(JSON.parse(readFileSync(join(path, "analysis.json"), "utf8")).policyVersion, derived.policyVersion);
      assert.ok(firstAnalysis.report.includes(`；策略 ${derived.policyVersion}；`));
    }
  }
  assert.equal(readFileSync(join(firstAnalysis!.path, "REPORT.md"), "utf8"), firstAnalysis!.report);
  assert.equal(readFileSync(join(firstAnalysis!.path, "summary.json"), "utf8"), firstAnalysis!.summary);
  assert.equal(containsPiMarker(root), false);
});

test("CLI calibrate 复用冻结评分载体，缺失和哈希不符的快照单列为无法校准", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-cli-calibration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = installOfflinePi(root);
  const { runRoot, tasks } = await makeRun(root, ["t1", "t2", "t3"]);
  rmSync(join(runRoot, "cases", "skill", "t2", "1", "deliverable.md"));
  writeFileSync(join(runRoot, "cases", "baseline", "t3", "1", "deliverable.md"), "tampered");
  const sourceFiles = ["REPORT.md", "summary.json", "run-manifest.json"];
  const sourceHashes = sourceFiles.map(name => hashEvidenceFile(join(runRoot, name)));
  const sheetPath = join(root, "sheet.json");
  const args = ["calibrate", "--run", runRoot, "--export", sheetPath, "--limit", "4"];
  const exported = invoke(bin, args);
  assert.equal(exported.status, 0, exported.stdout + exported.stderr);
  const sheetText = readFileSync(sheetPath, "utf8");
  const sheet = JSON.parse(sheetText) as BlindReviewSheet;
  assert.deepEqual(sheet.items.map(item => item.taskId), ["t0", "t1"]);
  assert.deepEqual([sheet.items[0]!.outputA, sheet.items[0]!.outputB].sort(), ["OK", "baseline"]);
  assert.deepEqual([sheet.items[1]!.outputA, sheet.items[1]!.outputB].sort(), ["Frozen deliverable: OK", "Frozen deliverable: baseline"]);
  assert.deepEqual(sheet.unavailable?.map(item => item.taskId), ["t2", "t3"]);
  assert.ok(sheet.unavailable?.every(item => /快照.*无法核验/.test(item.reason)));
  assert.match(exported.stdout, /无法校准 2 对/);

  const changedSuite = join(root, "changed-suite.json");
  writeFileSync(changedSuite, JSON.stringify({ id: "changed", tasks: tasks.map(task => ({ id: task.id, prompt: "changed" })) }));
  const withOverride = invoke(bin, [...args, "--suite-file", changedSuite]);
  assert.equal(withOverride.status, 0, withOverride.stdout + withOverride.stderr);
  assert.equal(readFileSync(sheetPath, "utf8"), sheetText);

  for (const item of sheet.items) item.humanVerdict = "tie";
  writeFileSync(sheetPath, JSON.stringify(sheet));
  const scoreArgs = ["calibrate", "--run", runRoot, "--score", sheetPath];
  const scored = invoke(bin, scoreArgs);
  assert.equal(scored.status, 0, scored.stdout + scored.stderr);
  const result = JSON.parse(readFileSync(join(runRoot, "calibration-result.json"), "utf8")) as CalibrationResult;
  assert.equal(result.reviewedCount, 2);
  assert.equal(result.totalItems, 2);
  assert.equal(result.unavailableCount, 2);
  delete sheet.scoringCarrierVersion;
  writeFileSync(sheetPath, JSON.stringify(sheet));
  const mismatched = invoke(bin, scoreArgs);
  assert.equal(mismatched.status, 1);
  assert.match(mismatched.stderr, /评分载体版本不匹配/);
  assert.deepEqual(sourceFiles.map(name => hashEvidenceFile(join(runRoot, name))), sourceHashes);
  assert.equal(containsPiMarker(root), false);
});

test("CLI eval 非空输出目录立即拒绝，不启动 pi 或改写旧运行", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-cli-output-regression-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = installOfflinePi(root);
  const fixture = await makeRun(root);
  const suitePath = join(root, "suite.json");
  writeFileSync(suitePath, JSON.stringify({ id: "offline-suite", skill: { path: fixture.sourceSkill }, repeat: 1, judgeRepeat: 2, tasks: fixture.tasks }));
  const summaryBefore = readFileSync(join(fixture.runRoot, "summary.json"), "utf8");
  const manifestBefore = readFileSync(join(fixture.runRoot, "run-manifest.json"), "utf8");
  const output = invoke(bin, ["eval", "--suite", suitePath, "--model", "offline-never-invoke", "--out", fixture.runRoot]);
  assert.equal(output.error, undefined);
  assert.notEqual(output.status, 0, output.stdout + output.stderr);
  assert.match(output.stdout + output.stderr, /非空|禁止覆盖历史/);
  assert.equal(readFileSync(join(fixture.runRoot, "summary.json"), "utf8"), summaryBefore);
  assert.equal(readFileSync(join(fixture.runRoot, "run-manifest.json"), "utf8"), manifestBefore);
  assert.equal(containsPiMarker(root), false);
});

test("CLI verify 不能只相信摘要中的核验旗标，缺少原始目录证据必须拒绝通过", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-cli-verify-summary-only-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = installOfflinePi(root);
  const fixture = await makeRun(root);
  const original = JSON.parse(readFileSync(join(fixture.runRoot, "summary.json"), "utf8"));
  const broken = structuredClone(original);
  for (const row of broken.results as RunResult[]) {
    if (row.variantId === "baseline") continue;
    row.assertions = evaluateAssertions("baseline", fixture.tasks.find(task => task.id === row.taskId)!.assertions!);
  }
  // Both in-memory inputs claim complete verified evidence; pure statistics alone would pass.
  const claimed = evaluateNegativeControl(original, broken);
  assert.equal(claimed.passed, true);
  assert.equal(claimed.originalGainPp, 100);
  assert.equal(claimed.brokenGainPp, 0);
  const originalDir = join(root, "summary-only-original");
  const brokenDir = join(root, "summary-only-broken");
  mkdirSync(originalDir);
  mkdirSync(brokenDir);
  const originalText = JSON.stringify(original);
  const brokenText = JSON.stringify(broken);
  writeFileSync(join(originalDir, "summary.json"), originalText);
  writeFileSync(join(brokenDir, "summary.json"), brokenText);
  rmSync(fixture.runRoot, { recursive: true });
  for (const directory of [originalDir, brokenDir]) {
    assert.deepEqual(readdirSync(directory), ["summary.json"]);
  }
  const output = invoke(bin, ["verify", "--original", originalDir, "--broken", brokenDir, "--json"]);
  assert.equal(output.error, undefined);
  assert.notEqual(output.status, 0, output.stdout + output.stderr);
  assert.doesNotMatch(output.stdout, /"passed"\s*:\s*true/);
  assert.match(output.stdout + output.stderr, /清单|未验证|原始|inconclusive/);
  assert.equal(readFileSync(join(originalDir, "summary.json"), "utf8"), originalText);
  assert.equal(readFileSync(join(brokenDir, "summary.json"), "utf8"), brokenText);
  assert.equal(containsPiMarker(root), false);
});
