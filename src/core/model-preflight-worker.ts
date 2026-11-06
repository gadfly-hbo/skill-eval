/** Sandboxed metadata worker: no CLI, credential store, catalog persistence or inference. */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ModelIdentity, ModelPreflightEntry } from "./model-preflight.ts";

const forbidden = () => { throw new Error("OFFLINE_CATALOG_SIDE_EFFECT"); };
// Defense in depth: the OS also denies all networking and file writes.
globalThis.fetch = async () => forbidden();

function endpoint(value: string): { baseUrl: string; baseUrlRedacted: boolean } {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid model endpoint");
  return { baseUrl: url.origin + url.pathname, baseUrlRedacted: Boolean(url.username || url.password || url.search || url.hash) };
}

async function inspect() {
  const { packageRoot, home, requests } = JSON.parse(readFileSync(0, "utf8")) as {
    packageRoot: string; home: string; requests: ModelPreflightEntry[];
  };
  const modelsPath = join(home, ".pi", "agent", "models.json");
  const cachePath = join(home, ".pi", "agent", "models-store.json");
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  const { ModelRuntime } = await import(pathToFileURL(join(packageRoot, "dist", "core", "model-runtime.js")).href);
  const runtime = await ModelRuntime.create({
    modelsPath: existsSync(modelsPath) ? modelsPath : null,
    credentials: { read: forbidden, list: forbidden, modify: forbidden, delete: forbidden },
    modelsStore: { read: forbidden, write: forbidden, delete: forbidden },
    refreshOnCreate: false, allowModelNetwork: false,
  });
  if (runtime.getError()) throw new Error("SDK_CONFIG_INVALID");
  for (const providerId of new Set(requests.map((r) => r.requested.split("/")[0]!))) {
    // The SDK restores its own overlay then applies models.json. No reimplementation
    // of timestamp precedence, personalized catalogs, or model overrides lives here.
    await runtime.getProvider(providerId)?.refreshModels?.({
      stored: cache[providerId], allowNetwork: false, signal: new AbortController().signal,
      publish: async (publication: { persist?: unknown; update?: () => void }) => {
        if (publication.persist !== undefined) forbidden();
        publication.update?.();
        return true;
      },
    });
  }
  if (runtime.getError()) throw new Error("SDK_CONFIG_INVALID");
  const errors: string[] = [];
  const models = requests.map((request) => {
    const slash = request.requested.indexOf("/");
    const providerId = request.requested.slice(0, slash), id = request.requested.slice(slash + 1);
    // getModel is the strict SDK lookup, not the CLI's fuzzy/custom-id resolver.
    const model = runtime.getModel(providerId, id);
    if (!model || model.provider !== providerId || model.id !== id) {
      const error = "Pi 完整合并目录中没有精确 provider/id，禁止近似或备用模型";
      errors.push(`${request.role}: ${request.requested}: ${error}`);
      return { ...request, model: null, error };
    }
    const identity: ModelIdentity = {
      provider: model.provider, id: model.id, api: model.api, ...endpoint(model.baseUrl),
      contextWindow: model.contextWindow, maxTokens: model.maxTokens, reasoning: model.reasoning,
    };
    return { ...request, model: identity, error: null };
  });
  return { models, errors };
}

try {
  process.stdout.write(JSON.stringify(await inspect()));
} catch {
  // Do not echo native model config/errors, which can contain key/header values.
  process.stdout.write(JSON.stringify({ models: [], errors: ["Pi SDK 完整目录读取失败或配置无效；离线查询已阻断"] }));
  process.exitCode = 1;
}
