/** Native Pi session inside the network-denied evaluation sandbox.
 * Real credentials and HTTP dispatch belong exclusively to the parent broker.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

interface WorkerConfig {
  sdkRoot: string;
  workspaceRoot: string;
  home?: string;
  sessionId: string;
  prompt: string;
  model: string;
  role: "subject" | "judge";
  skillPaths: string[];
  maxOutputTokens: number;
  contextWindow: number;
}

interface BrokerResponse {
  type: "response" | "response-error";
  requestId: string;
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  code?: string;
}

const pending = new Map<string, { resolve: (response: Response) => void; reject: (error: Error) => void }>();
let requestSequence = 0;
let requestPrefix = "";
let stopped = false;
let session: any;
let killChildren: (() => void) | undefined;
const emit = (event: unknown) => process.stdout.write(`${JSON.stringify(event)}\n`);
const forbidden = () => { throw new Error("CONTROLLED_WORKER_SIDE_EFFECT"); };

function stop(code: string): void {
  if (stopped) return;
  stopped = true;
  process.exitCode = 1;
  emit({ type: "controlled_error", code });
  for (const request of pending.values()) request.reject(new Error(code));
  pending.clear();
  killChildren?.();
  // Awaiting abort inside an event listener would wait for that same listener.
  void session?.abort().catch(() => {});
  if (process.connected) process.disconnect();
}

function receive(message: unknown): void {
  const value = message as BrokerResponse;
  if (!value || (value.type !== "response" && value.type !== "response-error")) return;
  const request = pending.get(value.requestId);
  if (!request) return;
  pending.delete(value.requestId);
  if (value.type === "response-error") {
    // Let Pi's native retry policy handle a transport failure. The parent owns
    // the original wire evidence; no raw credential-bearing exception crosses IPC.
    request.reject(new Error("fetch failed"));
    return;
  }
  if (!Number.isInteger(value.status) || value.status! < 200 || value.status! > 599 || typeof value.body !== "string") {
    request.reject(new Error("BROKER_RESPONSE_INVALID"));
    stop("BROKER_RESPONSE_INVALID");
    return;
  }
  try {
    const body = [204, 205, 304].includes(value.status!) ? null : value.body;
    request.resolve(new Response(body, { status: value.status, headers: value.headers }));
  } catch {
    request.reject(new Error("BROKER_RESPONSE_INVALID"));
    stop("BROKER_RESPONSE_INVALID");
  }
}

const brokerFetch: typeof fetch = async (input, init) => {
  if (stopped || !process.connected || !process.send) throw new Error("BROKER_UNAVAILABLE");
  const request = new Request(input, init);
  request.signal.throwIfAborted();
  if (request.method !== "POST") throw new Error("BROKER_METHOD_FORBIDDEN");
  const body = await request.text();
  if (stopped) throw new Error("CONTROLLED_WORKER_STOPPED");
  const requestId = `${requestPrefix}-r${++requestSequence}`;
  return new Promise<Response>((resolve, reject) => {
    const abort = () => {
      pending.delete(requestId);
      reject(new Error("BROKER_REQUEST_ABORTED"));
    };
    const cleanup = () => request.signal.removeEventListener("abort", abort);
    pending.set(requestId, {
      resolve: (response) => { cleanup(); resolve(response); },
      reject: (error) => { cleanup(); reject(error); },
    });
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) { abort(); return; }
    process.send!({
      type: "request", requestId, url: request.url, body,
      headers: Object.fromEntries(request.headers.entries()),
    }, (error) => {
      if (error) {
        pending.get(requestId)?.reject(new Error("BROKER_SEND_FAILED"));
        pending.delete(requestId);
        stop("BROKER_SEND_FAILED");
      }
    });
  });
};

// The OS sandbox denies networking for this process and every native tool child.
// This also catches SDK code paths which omit the explicit per-request fetch.
globalThis.fetch = brokerFetch;
process.env.PI_OFFLINE = "1";
process.on("message", receive);
process.on("disconnect", () => { if (!stopped && pending.size > 0) stop("BROKER_DISCONNECTED"); });
process.on("SIGTERM", () => stop("CONTROLLED_WORKER_TERMINATED"));
process.on("SIGHUP", () => stop("CONTROLLED_WORKER_TERMINATED"));

async function main(): Promise<void> {
  const config = JSON.parse(readFileSync(0, "utf8")) as WorkerConfig;
  if (!config || !Number.isSafeInteger(config.maxOutputTokens) || config.maxOutputTokens < 1 ||
      !Number.isSafeInteger(config.contextWindow) || config.contextWindow < 1 ||
      (config.role !== "subject" && config.role !== "judge") ||
      typeof config.model !== "string" || !config.model.includes("/") || !Array.isArray(config.skillPaths) ||
      typeof config.sessionId !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(config.sessionId)) {
    throw new Error("WORKER_CONFIG_INVALID");
  }
  requestPrefix = config.sessionId;
  const allowed = config.model === "minimax-cn/MiniMax-M3.1-Flash"
    ? { api: "anthropic-messages", baseUrl: "https://api.minimaxi.com/anthropic" }
    : config.model === "xiaomi-token-plan-cn/mimo-v2.6-flash"
      ? { api: "openai-completions", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1" }
      : undefined;
  if (!allowed) throw new Error("WORKER_MODEL_INVALID");
  const parseJudgeJson = config.role === "judge" ? (await import("./judge-json.mts")).parseJudgeJson : undefined;
  // Apple's /usr/bin/python3 shim otherwise writes xcrun_db outside the sandbox
  // and mixes denied-cache warnings into the native bash tool's combined output.
  process.env.xcrun_db = join(config.workspaceRoot, ".xcrun_db");
  if (!process.connected) throw new Error("BROKER_UNAVAILABLE");
  const sdk = await import(pathToFileURL(join(config.sdkRoot, "dist", "index.js")).href);
  const shell = await import(pathToFileURL(join(config.sdkRoot, "dist", "utils", "shell.js")).href);
  killChildren = shell.killTrackedDetachedChildren;
  const agentDir = join(config.home ?? join(config.workspaceRoot, ".pi-home"), ".pi", "agent");
  const modelsPath = join(agentDir, "models.json"), cachePath = join(agentDir, "models-store.json");
  const runtime = await sdk.ModelRuntime.create({
    modelsPath: existsSync(modelsPath) ? modelsPath : null,
    credentials: {
      read: async () => ({ type: "api_key", key: "controlled-broker-placeholder" }),
      list: async () => [], modify: forbidden, delete: forbidden,
    },
    modelsStore: { read: forbidden, write: forbidden, delete: forbidden },
    refreshOnCreate: false, allowModelNetwork: false,
  });
  const slash = config.model.indexOf("/"), provider = config.model.slice(0, slash), id = config.model.slice(slash + 1);
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : {};
  await runtime.getProvider(provider)?.refreshModels?.({
    stored: cache[provider], allowNetwork: false, signal: new AbortController().signal,
    publish: async (publication: { persist?: unknown; update?: () => void }) => {
      if (publication.persist !== undefined) forbidden();
      publication.update?.();
      return true;
    },
  });
  if (runtime.getError()) throw new Error("WORKER_CATALOG_INVALID");
  const model = runtime.getModel(provider, id);
  if (!model || model.provider !== provider || model.id !== id ||
      model.api !== allowed.api || model.baseUrl !== allowed.baseUrl || model.contextWindow !== config.contextWindow ||
      model.reasoning !== true || model.maxTokens !== config.maxOutputTokens) throw new Error("WORKER_MODEL_INVALID");
  const settings = sdk.SettingsManager.inMemory();
  const loader = new sdk.DefaultResourceLoader({
    cwd: config.workspaceRoot, agentDir, settingsManager: settings,
    noSkills: true, additionalSkillPaths: config.skillPaths,
    noContextFiles: true, noExtensions: true, noPromptTemplates: true, noThemes: true,
  });
  await loader.reload();
  const result = await sdk.createAgentSession({
    cwd: config.workspaceRoot, agentDir, modelRuntime: runtime, model,
    settingsManager: settings, resourceLoader: loader,
    sessionManager: sdk.SessionManager.inMemory(config.workspaceRoot, { id: config.sessionId }),
  });
  session = result.session;
  if (result.modelFallbackMessage) throw new Error("WORKER_MODEL_FALLBACK");
  const nativeStream = session.agent.streamFunction.bind(session.agent);
  session.agent.streamFunction = (requestedModel: any, context: unknown, options: any = {}) => {
    if (stopped || requestedModel.provider !== provider || requestedModel.id !== id) throw new Error("WORKER_MODEL_CHANGED");
    return nativeStream(requestedModel, context, {
      ...options, apiKey: "controlled-broker-placeholder", fetch: brokerFetch,
      maxTokens: options.maxTokens ?? model.maxTokens,
      onProviderStreamEvent: async (data: unknown, eventModel: any) => {
        emit({ type: "provider_stream_event", provider: eventModel.provider, api: eventModel.api, model: eventModel.id, data });
        await options.onProviderStreamEvent?.(data, eventModel);
      },
    });
  };
  let finalAssistant: any;
  session.subscribe((event: any) => {
    emit(event);
    if (event.type === "message_end" && event.message?.role === "assistant") {
      const message = event.message;
      finalAssistant = message;
      if (message.provider !== provider || message.model !== id || (message.responseModel && message.responseModel !== id)) stop("WORKER_RESPONSE_MODEL_CHANGED");
    }
  });
  const assistantText = (): string => (finalAssistant?.content ?? [])
    .filter((block: { type: string }) => block.type === "text")
    .map((block: { text: string }) => block.text).join("\n").trim();
  try {
    await session.prompt(config.prompt);
    if (!stopped && parseJudgeJson && finalAssistant?.stopReason === "stop") {
      let invalidJson = false;
      try { parseJudgeJson(assistantText()); }
      catch { invalidJson = true; }
      if (invalidJson) {
        emit({ type: "judge_json_repair_requested" });
        finalAssistant = undefined;
        await session.prompt("上一条评委答复无法解析为 JSON。请保留同一份 A/B 展示顺序、原判定、分数、置信度和理由，重新输出为一个合法 JSON 对象。正确转义字符串中的引号和反斜杠。只输出该对象。");
      }
    }
  }
  catch {
    process.exitCode = 1;
    emit({ type: "native_session_failed", stopReason: "error" });
    return;
  }
  // Only evaluate the terminal result after the SDK has completed its own
  // retry/compaction/recovery path; intermediate errors remain raw events.
  const stopReason = finalAssistant?.stopReason ?? "missing";
  if (stopReason !== "stop" || parseJudgeJson && !assistantText()) {
    process.exitCode = 1;
    emit({ type: "native_session_failed", stopReason: stopReason === "stop" ? "empty" : stopReason });
  }
}

try {
  await main();
} catch {
  // Native errors may include HTTP headers or config values; expose a stable code.
  stop("CONTROLLED_WORKER_FAILED");
} finally {
  killChildren?.();
  try { await session?.abort(); } catch { /* already stopped */ }
  session?.dispose();
  if (process.connected) process.disconnect();
}
