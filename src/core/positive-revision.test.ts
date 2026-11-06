import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPositiveV2Revision, POSITIVE_V2_RUN_ID } from "./positive-revision.ts";
import { describePositiveProbe, type PositiveProbeDescriptor } from "./positive-probe.ts";

test("v2 cannot attach itself to a different parent run", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "positive-revision-")));
  try {
    const wrong = { plan: { runId: "other" } } as PositiveProbeDescriptor;
    assert.throws(() => applyPositiveV2Revision(wrong, root), /pinned v1/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a plausible but rewritten STOPPED record cannot replace the original failure", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "positive-revision-")));
  try {
    const runId = "da190-20261106-frozen-v1-positive", runRoot = join(root, "runs", runId);
    mkdirSync(runRoot, { recursive: true });
    writeFileSync(join(runRoot, "control-status.json"), JSON.stringify({ status: "STOPPED", sessions: [] }));
    const descriptor = { plan: { runId, runRoot, judgeSeed: runId } } as PositiveProbeDescriptor;
    assert.throws(() => applyPositiveV2Revision(descriptor, root), /failure status changed/);
    assert.equal(existsSync(join(root, "runs", POSITIVE_V2_RUN_ID)), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const prepared = existsSync(".local/retest-data-analysis-1.9.0-20261106/frozen/FREEZE.json") && existsSync(".local/controlled-positive-real-20261106/run-artifact-index.json");
test("local v2 description retains all frozen tasks and seeds while verifying the actual old failure without starting a run", { skip: !prepared }, () => {
  const before = readFileSync("runs/da190-20261106-frozen-v1-positive/control-status.json");
  const old = describePositiveProbe(), v2 = describePositiveProbe(process.cwd(), "v2");
  assert.equal(v2.plan.runId, POSITIVE_V2_RUN_ID);
  assert.notEqual(v2.plan.runRoot, old.plan.runRoot);
  assert.equal(existsSync(v2.plan.runRoot), false);
  assert.equal(v2.plan.model, old.plan.model); assert.equal(v2.plan.judgeModel, old.plan.judgeModel);
  assert.equal(v2.plan.judgeSeed, old.plan.judgeSeed); assert.deepEqual(v2.plan.judgePlans, old.plan.judgePlans);
  assert.deepEqual(v2.manifest.tasks, old.manifest.tasks); assert.equal(v2.manifest.contextPrefix, old.manifest.contextPrefix);
  assert.equal(v2.manifest.candidate.identity.hash, old.manifest.candidate.identity.hash);
  assert.equal(v2.plan.suiteHash, old.plan.suiteHash);
  assert.equal(v2.revision?.previousFailure.artifactsVerified, 23);
  assert.equal(createHash("sha256").update(before).digest("hex"), v2.revision?.previousFailure.controlStatusSha256);
  assert.deepEqual(readFileSync("runs/da190-20261106-frozen-v1-positive/control-status.json"), before);
});
