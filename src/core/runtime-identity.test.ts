import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { assertSessionRuntimeIdentity, captureEvaluatorIdentity, readPiRuntimeIdentity } from "./runtime-identity.ts";

test("运行身份绑定当前生产源码、实际 worker 字节和 Pi SDK 版本及入口", t => {
  const root = mkdtempSync(join(tmpdir(), "eval-runtime-identity-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const worker = Buffer.from("// worker bytes\n");
  const judgeDecoder = Buffer.from("// judge decoder bytes\n");
  for (const directory of ["bin", "src/core", "pi/dist"]) mkdirSync(join(root, directory), { recursive: true });
  writeFileSync(join(root, "bin/skill-eval.mjs"), "// launcher\n");
  writeFileSync(join(root, "package.json"), "{}");
  writeFileSync(join(root, "src/core/controlled-worker.ts"), worker);
  writeFileSync(join(root, "src/core/judge-json.mts"), judgeDecoder);
  writeFileSync(join(root, "src/core/runner.ts"), "// initial\n");
  const sdkRoot = join(root, "pi");
  const pkg = join(sdkRoot, "package.json"), sdkEntry = join(sdkRoot, "dist/index.js");
  const cliEntry = join(sdkRoot, "dist/cli.js");
  writeFileSync(pkg, JSON.stringify({ name: "offline-pi", version: "1.0.0" }));
  writeFileSync(cliEntry, "// cli\n");
  writeFileSync(sdkEntry, "// sdk\n");
  const runtime = { command: process.execPath, args: [cliEntry], readOnlyRoots: [sdkRoot] };
  const expected = { evaluator: captureEvaluatorIdentity(root), piSdk: readPiRuntimeIdentity(runtime) };
  assert.equal(expected.evaluator.gitCommit, null);
  assert.equal(expected.piSdk.version, "1.0.0");
  assert.doesNotThrow(() => assertSessionRuntimeIdentity(expected, runtime, worker));
  assert.doesNotThrow(() => assertSessionRuntimeIdentity(expected, runtime, worker, judgeDecoder));
  assert.throws(() => assertSessionRuntimeIdentity(expected, runtime, Buffer.from("different worker")), /EVALUATOR_WORKER_DRIFT/);
  assert.throws(() => assertSessionRuntimeIdentity(expected, runtime, worker, Buffer.from("different judge decoder")), /EVALUATOR_WORKER_DRIFT/);

  writeFileSync(join(root, "src/core/runner.test.ts"), "// test-only edits\n");
  assert.equal(captureEvaluatorIdentity(root).sourceSha256, expected.evaluator.sourceSha256);
  writeFileSync(join(root, "src/core/runner.ts"), "// production change\n");
  assert.notEqual(captureEvaluatorIdentity(root).sourceSha256, expected.evaluator.sourceSha256);

  writeFileSync(pkg, JSON.stringify({ name: "offline-pi", version: "2.0.0" }));
  assert.throws(() => assertSessionRuntimeIdentity(expected, runtime, worker), /PI_SDK_DRIFT/);
  writeFileSync(pkg, JSON.stringify({ name: "offline-pi", version: "1.0.0" }));
  writeFileSync(sdkEntry, "// sdk changed without version bump\n");
  assert.throws(() => assertSessionRuntimeIdentity(expected, runtime, worker), /PI_SDK_DRIFT/);
});
