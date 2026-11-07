import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import { assertSkillIdentity, type SkillIdentity } from "./provenance.ts";
import type { EvalTask, Variant, RunResult } from "./runner.ts";
import type { NativeModelLimitsByRole } from "./controlled-budget.ts";
import type { EvaluationRuntimeIdentity } from "./runtime-identity.ts";
import { DELIVERABLE_SNAPSHOT, readVerifiedDeliverable, validDeliverablePath } from "./deliverable.ts";

export const RUN_MANIFEST_FILE = "run-manifest.json";
export const EVALUATION_POLICY_VERSION = "paired-task-v2";
export interface VerificationState { verified: boolean; issues: string[] }
export interface RunManifest {
  schemaVersion: 1;
  policyVersion: string;
  runId: string;
  model: string;
  judgeModel: string;
  repeat: number;
  judgeRepeat: number;
  judgeSeed: string;
  contextPrefix?: string;
  runtimeIdentity?: EvaluationRuntimeIdentity;
  settings?: { gainThresholdPp: number; timeoutMs?: number; judgeTimeoutMs?: number; keywordSignal: boolean; nodeVersion: string; nativeLimits?: NativeModelLimitsByRole };
  tasks: EvalTask[];
  variants: Variant[];
  candidate: { identity: SkillIdentity; snapshotDir: string; originalSkillPath: string };
  suiteMeta: { suiteId: string; suiteVersion: string; suiteHash: string; skillVersion: string; skillPath: string };
}

export function assertFreshRunRoot(runRoot: string): void {
  if (existsSync(runRoot) && readdirSync(runRoot).length > 0) throw new Error("运行目录非空，禁止覆盖历史评测记录；请使用新的 --out");
  mkdirSync(runRoot, { recursive: true });
}

export function saveRunManifest(runRoot: string, manifest: RunManifest): void {
  if (!Number.isSafeInteger(manifest.repeat) || manifest.repeat < 1 || !Number.isSafeInteger(manifest.judgeRepeat) || manifest.judgeRepeat < 1) {
    throw new Error("repeat/judgeRepeat 必须为正整数");
  }
  const ids = [...manifest.tasks.map((t) => t.id), ...manifest.variants.map((v) => v.id)];
  if (ids.some((id) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) || id === "..")) throw new Error("任务/变体 id 必须是安全的单个路径段");
  if (manifest.tasks.some((task) => task.deliverablePath !== undefined && !validDeliverablePath(task.deliverablePath))) {
    throw new Error("冻结交付路径无效");
  }
  writeFileSync(join(runRoot, RUN_MANIFEST_FILE), JSON.stringify(manifest, null, 2), { encoding: "utf8", flag: "wx" });
}

export function loadRunManifest(runRoot: string): RunManifest | null {
  const path = join(runRoot, RUN_MANIFEST_FILE);
  if (!existsSync(path)) return null;
  const manifest = JSON.parse(readFileSync(path, "utf8")) as RunManifest;
  if (manifest.schemaVersion !== 1 || !manifest.candidate?.identity?.hash || !Array.isArray(manifest.tasks) ||
      !Array.isArray(manifest.variants) || !Number.isSafeInteger(manifest.repeat) || manifest.repeat < 1) {
    throw new Error("冻结运行清单不完整或格式不受支持");
  }
  if (manifest.tasks.some((task) => task.deliverablePath !== undefined && !validDeliverablePath(task.deliverablePath))) {
    throw new Error("冻结交付路径无效");
  }
  return manifest;
}

export function frozenSkillPath(runRoot: string, manifest: RunManifest): string {
  const root = resolve(runRoot);
  const path = resolve(root, manifest.candidate.snapshotDir, manifest.candidate.identity.entry);
  if (!path.startsWith(`${root}${sep}`)) throw new Error("冻结候选路径越出运行目录");
  return path;
}

export function hashEvidenceFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function checkRunIntegrity(runRoot: string, manifest: RunManifest | null, storedResults: RunResult[] = []): VerificationState {
  if (!manifest) return { verified: false, issues: ["历史运行缺少冻结清单，候选身份与预定运行矩阵未验证"] };
  const issues: string[] = [];
  try { assertSkillIdentity(frozenSkillPath(runRoot, manifest), manifest.candidate.identity); }
  catch (error) { issues.push(`冻结候选校验失败：${error instanceof Error ? error.message : String(error)}`); }
  const byKey = new Map(storedResults.map((r) => [`${r.variantId}/${r.taskId}/${r.attempt}`, r]));
  for (const variant of manifest.variants) for (const task of manifest.tasks) for (let attempt = 1; attempt <= manifest.repeat; attempt++) {
    const key = `${variant.id}/${task.id}/${attempt}`;
    const dir = join(runRoot, "cases", variant.id, task.id, String(attempt));
    const stored = byKey.get(key);
    for (const name of ["result.json", "output.md", "events.json"]) {
      const file = join(dir, name);
      if (!existsSync(file)) issues.push(`缺失原始产物：cases/${key}/${name}`);
      else {
        const expected = stored?.evidenceHashes?.[name];
        if (!expected) issues.push(`缺少冻结产物哈希：cases/${key}/${name}`);
        else if (hashEvidenceFile(file) !== expected) issues.push(`原始产物哈希变化：cases/${key}/${name}`);
      }
    }
    if (task.deliverablePath) {
      const delivery = stored?.deliverable;
      if ((delivery && delivery.path !== task.deliverablePath) ||
          (stored?.status === "success" && delivery?.status !== "present")) {
        issues.push(`交付物记录与冻结任务不匹配：cases/${key}`);
      }
      if (delivery?.status === "present") {
        const expected = stored?.evidenceHashes?.[DELIVERABLE_SNAPSHOT];
        if (readVerifiedDeliverable(dir, expected) === undefined) {
          issues.push(`交付物快照缺失、无效或哈希变化：cases/${key}/${DELIVERABLE_SNAPSHOT}`);
        }
      }
    }
  }
  return { verified: issues.length === 0, issues };
}

export function relativeSnapshotDir(runRoot: string, skillPath: string): string {
  return relative(resolve(runRoot), dirname(resolve(skillPath)));
}
