import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { resolvePiRuntime } from "./isolation.ts";

export interface PiRuntimeIdentity {
  package: string;
  version: string;
  entrySha256: string;
  sdkEntrySha256: string | null;
}

export interface EvaluationRuntimeIdentity {
  evaluator: { gitCommit: string | null; sourceSha256: string; workerSha256: string; judgeDecoderSha256: string };
  piSdk: PiRuntimeIdentity;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function readPiRuntimeIdentity(runtime: ReturnType<typeof resolvePiRuntime>): PiRuntimeIdentity {
  const packageRoot = runtime.readOnlyRoots[0]!;
  const { name, version } = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  if (typeof name !== "string" || !name || typeof version !== "string" || !version) throw new Error("PI_SDK_IDENTITY_MISSING");
  const sdkEntry = join(packageRoot, "dist", "index.js");
  return {
    package: name, version,
    entrySha256: sha256(readFileSync(runtime.args[0] ?? runtime.command)),
    sdkEntrySha256: existsSync(sdkEntry) ? sha256(readFileSync(sdkEntry)) : null,
  };
}

/** Identify the checkout containing the loaded CLI, independent of the launch cwd. */
export function captureEvaluatorIdentity(root = fileURLToPath(new URL("../../", import.meta.url))): EvaluationRuntimeIdentity["evaluator"] {
  const git = spawnSync("git", ["rev-parse", "--show-prefix", "--verify", "HEAD"], { cwd: root, encoding: "utf8", timeout: 2_000 });
  const [prefix, commit] = git.stdout?.split(/\r?\n/) ?? [];
  const gitCommit = git.status === 0 && prefix === "" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit ?? "") ? commit! : null;
  const paths = ["bin/skill-eval.mjs", "package.json"];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(file);
      else if (/\.m?ts$/.test(entry.name) && !/\.test\.m?ts$/.test(entry.name)) paths.push(file);
    }
  };
  walk("src");
  const files = paths.sort().map(file => [file, sha256(readFileSync(join(root, file)))]);
  const workerSha256 = files.find(([file]) => file === "src/core/controlled-worker.ts")?.[1];
  const judgeDecoderSha256 = files.find(([file]) => file === "src/core/judge-json.mts")?.[1];
  if (!workerSha256 || !judgeDecoderSha256) throw new Error("EVALUATOR_WORKER_IDENTITY_MISSING");
  return { gitCommit, sourceSha256: sha256(Buffer.from(JSON.stringify(files))), workerSha256, judgeDecoderSha256 };
}

/** Compare the exact worker bytes to be copied and the SDK entries resolved for this session. */
export function assertSessionRuntimeIdentity(
  expected: EvaluationRuntimeIdentity, runtime: ReturnType<typeof resolvePiRuntime>, workerBytes: Uint8Array, judgeDecoderBytes?: Uint8Array,
): void {
  if (sha256(workerBytes) !== expected.evaluator.workerSha256 ||
      judgeDecoderBytes && sha256(judgeDecoderBytes) !== expected.evaluator.judgeDecoderSha256) throw new Error("EVALUATOR_WORKER_DRIFT");
  let actual: PiRuntimeIdentity;
  try { actual = readPiRuntimeIdentity(runtime); }
  catch { throw new Error("PI_SDK_DRIFT"); }
  if (!actual.sdkEntrySha256 || (Object.keys(actual) as Array<keyof PiRuntimeIdentity>).some(key => actual[key] !== expected.piSdk[key])) {
    throw new Error("PI_SDK_DRIFT");
  }
}
