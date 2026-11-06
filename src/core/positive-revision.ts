/** A new external execution revision referencing the immutable v1 preparation and failure. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { POSITIVE_ENVIRONMENT_V2, POSITIVE_ENVIRONMENT_V2_SHA256, POSITIVE_ENVIRONMENT_V2_VERSION } from "./positive-environment.ts";
import type { PositiveProbeDescriptor } from "./positive-probe.ts";

export const POSITIVE_V2_RUN_ID = "da190-20261107-controlled-v2-positive";
const PREVIOUS_RUN_ID = "da190-20261106-frozen-v1-positive";
const PREVIOUS_STATUS_SHA256 = "38f00aced07f5cbb3953b8cb6b0ba2a0edf04fc4c0a24e561ad266f43b5ffaea";
const PREVIOUS_INDEX = ".local/controlled-positive-real-20261106/run-artifact-index.json";
const PREVIOUS_INDEX_SHA256 = "852cb0f2661d5fc6408c76ff53f1adb7cff8777104e7782e50fc071592928922";
const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");

export interface PositiveExecutionRevision {
  id: "controlled-positive-v2";
  environmentInstruction: string;
  environmentSha256: string;
  environmentVersion: string;
  appliesTo: readonly ["baseline", "skill"];
  previousFailure: {
    runId: string; relativeRoot: string; sourceCommit: string;
    controlStatusSha256: string; artifactIndex: string; artifactIndexSha256: string; artifactsVerified: number;
  };
}

/** No execution, authorization, task rewriting or writes are possible here. */
export function applyPositiveV2Revision(original: PositiveProbeDescriptor, repoRoot: string): PositiveProbeDescriptor {
  const root = realpathSync(repoRoot), oldRoot = join(root, "runs", PREVIOUS_RUN_ID);
  assert.equal(original.plan.runId, PREVIOUS_RUN_ID, "V2 must reference the pinned v1 plan");
  assert.equal(original.plan.judgeSeed, PREVIOUS_RUN_ID, "V2 preserves the original judge seed");
  assert.equal(original.plan.runRoot, oldRoot, "Previous run path drift");
  const statusPath = join(oldRoot, "control-status.json");
  assert.equal(sha(statusPath), PREVIOUS_STATUS_SHA256, "Previous failure status changed");
  const indexPath = join(root, PREVIOUS_INDEX);
  assert.equal(sha(indexPath), PREVIOUS_INDEX_SHA256, "Previous artifact index changed");
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as { runId: string; files: Array<{ path: string; sha256: string; mode: string }> };
  assert.equal(index.runId, PREVIOUS_RUN_ID); assert.equal(index.files.length, 23);
  const seen = new Set<string>();
  for (const file of index.files) {
    const path = resolve(root, file.path);
    assert(path.startsWith(oldRoot + sep) && !seen.has(path), "Unsafe/duplicate previous evidence path"); seen.add(path);
    assert.equal(realpathSync(path), path, "Previous evidence symlink drift");
    assert(lstatSync(path).isFile(), "Previous evidence is not a regular file");
    assert.equal(sha(path), file.sha256, "Previous failure artifact changed");
    assert.equal(`0o${(statSync(path).mode & 0o777).toString(8)}`, file.mode, "Previous artifact mode changed");
  }
  const previous = JSON.parse(readFileSync(statusPath, "utf8"));
  assert.equal(previous.status, "STOPPED");
  assert.equal(previous.ledger.sessions.length, 1); assert.equal(previous.ledger.requests.length, 4);
  assert.equal(previous.sessions.filter((row: { status: string }) => row.status === "NOT_RUN").length, 7);
  const runRoot = join(root, "runs", POSITIVE_V2_RUN_ID), candidateRuntimePath = join(runRoot, ".frozen", "skill", "SKILL.md");
  const revision: PositiveExecutionRevision = {
    id: "controlled-positive-v2", environmentInstruction: POSITIVE_ENVIRONMENT_V2,
    environmentSha256: POSITIVE_ENVIRONMENT_V2_SHA256, environmentVersion: POSITIVE_ENVIRONMENT_V2_VERSION,
    appliesTo: ["baseline", "skill"],
    previousFailure: { runId: PREVIOUS_RUN_ID, relativeRoot: `runs/${PREVIOUS_RUN_ID}`, sourceCommit: "d66cad89f8191806e504fa6a4faefd968b7fb63b", controlStatusSha256: PREVIOUS_STATUS_SHA256, artifactIndex: PREVIOUS_INDEX, artifactIndexSha256: PREVIOUS_INDEX_SHA256, artifactsVerified: index.files.length },
  };
  return { ...original, revision,
    plan: { ...original.plan, runId: POSITIVE_V2_RUN_ID, runRoot, candidateRuntimePath },
    manifest: { ...original.manifest, runId: POSITIVE_V2_RUN_ID,
      variants: original.manifest.variants.map(variant => ({ ...variant, skillPaths: variant.id === "skill" ? [candidateRuntimePath] : [] })),
    },
  };
}
