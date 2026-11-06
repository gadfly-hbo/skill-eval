/** Read-only local catalog checks. A successful lookup is never execution authorization. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPath, resolvePiRuntime } from "./isolation.ts";

export interface ModelIdentity {
  provider: string;
  id: string;
  api: string;
  /** Safe display URL; this is not a check of remote routing or credentials. */
  baseUrl: string;
  baseUrlRedacted: boolean;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
}

export interface ModelPreflightEntry {
  role: "subject" | "judge";
  requested: string;
  model: ModelIdentity | null;
  error: string | null;
}

export interface ModelPreflightReport {
  valid: boolean;
  status: "LOCAL_MODEL_IDENTITIES_CONFIRMED" | "BLOCKED";
  models: ModelPreflightEntry[];
  errors: string[];
  evidenceLevel: "offline-model-catalog";
  providerCalls: "NOT_RUN";
  remoteAvailability: "NOT_RUN";
  authValidity: "UNKNOWN";
  billing: "UNKNOWN";
  executionAuthorized: false;
  configHome: string;
  runtime?: { package: string; version: string; entrySha256: string };
}

export interface ModelPreflightOptions {
  models: readonly string[];
  judgeModel?: string;
  home?: string;
  pathEnv?: string;
}

/** Reuse the SDK's composition and strict getModel; never launch the pi CLI. */
export async function preflightModels(options: ModelPreflightOptions): Promise<ModelPreflightReport> {
  const home = resolve(options.home ?? homedir());
  const requests: ModelPreflightEntry[] = options.models.flatMap((reference) => [
    { role: "subject", requested: reference, model: null, error: null },
    { role: "judge", requested: options.judgeModel ?? reference, model: null, error: null },
  ]);
  const report: ModelPreflightReport = {
    valid: false, status: "BLOCKED", models: requests, errors: [], configHome: home,
    evidenceLevel: "offline-model-catalog", providerCalls: "NOT_RUN", remoteAvailability: "NOT_RUN",
    authValidity: "UNKNOWN", billing: "UNKNOWN", executionAuthorized: false,
  };
  for (const entry of requests) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[^\s/]+(?:\/[^\s/]+)*$/.test(entry.requested)) {
      entry.error = "必须显式指定完整 provider/id；不接受裸型号、空值或模糊匹配";
      report.errors.push(`${entry.role}: ${entry.error}`);
    }
  }
  if (!requests.length) report.errors.push("缺少待核验的被评模型");
  if (report.errors.length) return report;
  try {
    const runtime = resolvePiRuntime(options.pathEnv);
    const packageRoot = runtime.readOnlyRoots[0]!;
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
    const entry = runtime.args[0] ?? runtime.command;
    report.runtime = {
      package: String(manifest.name), version: String(manifest.version),
      entrySha256: createHash("sha256").update(readFileSync(entry)).digest("hex"),
    };
    if (process.platform !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
      report.errors.push("只读离线模型预检需要 macOS sandbox-exec；未回退到未隔离查询");
      return report;
    }
    // No SDK/CLI gets real credentials. SDK defaults cannot read either auth file,
    // and imports/configuration cannot write or reach any network endpoint.
    const forbiddenAuth = [...new Set([home, homedir()].map((h) => canonicalPath(join(h, ".pi", "agent", "auth.json"))))];
    const profile = [
      "(version 1)", "(allow default)", "(deny network*)", "(deny file-write*)",
      `(deny file-read* ${forbiddenAuth.map((p) => `(literal ${JSON.stringify(p)})`).join(" ")})`,
    ].join("\n");
    const worker = fileURLToPath(new URL("./model-preflight-worker.ts", import.meta.url));
    const result = spawnSync("/usr/bin/sandbox-exec", ["-p", profile, realpathSync(process.execPath), "--experimental-strip-types", worker], {
      input: JSON.stringify({ packageRoot, home, requests }), encoding: "utf8", timeout: 15_000,
      maxBuffer: 1024 * 1024,
      env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", HOME: home, PI_OFFLINE: "1", NODE_DISABLE_COMPILE_CACHE: "1" },
    });
    if (result.status !== 0 || result.error) {
      report.errors.push("Pi SDK 离线目录查询未成功；未执行 pi、联网或使用备用模型");
      return report;
    }
    // Native configuration errors/stderr may contain private values; never relay them.
    const checked = JSON.parse(result.stdout) as { models: ModelPreflightEntry[]; errors: string[] };
    if (!Array.isArray(checked.models) || !Array.isArray(checked.errors) || checked.models.length !== requests.length) {
      throw new Error("Invalid worker result");
    }
    report.models = checked.models;
    report.errors = checked.errors;
    report.valid = report.errors.length === 0 && checked.models.every((m, i) =>
      m.requested === requests[i]!.requested && m.role === requests[i]!.role && m.model !== null && m.error === null);
    report.status = report.valid ? "LOCAL_MODEL_IDENTITIES_CONFIRMED" : "BLOCKED";
    if (!report.valid && !report.errors.length) report.errors.push("Pi SDK 返回的身份核验结果不完整");
  } catch {
    report.errors.push("Pi SDK 模型目录或配置无法安全读取；未回退为缓存扫描或近似匹配");
  }
  return report;
}
