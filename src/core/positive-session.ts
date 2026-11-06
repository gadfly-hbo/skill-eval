/** Restricted native Pi session. Only this parent process owns credentials/network. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { PositiveBudget, BudgetStopError } from "./positive-budget.ts";
import { buildSandboxCommand, resolvePiRuntime, verifySandboxCommand } from "./isolation.ts";
import { collectMetrics, emptyMetrics, type PiEvent, type PiRunResult } from "./pi.ts";

const SUBJECT = "minimax-cn/MiniMax-M3.1-Flash";
const JUDGE = "xiaomi-token-plan-cn/mimo-v2.6-flash";
export interface PositiveRequest { requestId: string; url: string; body: string; headers: Record<string, string> }
class PositiveRequestError extends Error {}
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new PositiveRequestError("INVALID_PROVIDER_USAGE");
  return value;
}

/** Parse the original wire evidence, because the SDK creates zero usage on errors. */
export function parsePositiveUsage(model: string, text: string): Usage {
  const data = text.replace(/\r\n/g, "\n").split("\n\n").map((part) => part.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")).filter(Boolean);
  if (model === SUBJECT) {
    let input: Usage | undefined, output: number | undefined, finalOutputSeen = false, ended = false, reason: string | undefined;
    for (const payload of data) {
      if (ended) throw new PositiveRequestError("PROVIDER_DATA_AFTER_END");
      const event = JSON.parse(payload);
      if (event.type === "error") throw new PositiveRequestError("PROVIDER_STREAM_ERROR");
      if (event.type === "message_start") {
        if (input || event.message?.model !== "MiniMax-M3.1-Flash") throw new PositiveRequestError("PROVIDER_MODEL_OR_USAGE_MISMATCH");
        const usage = event.message.usage;
        input = { input: count(usage?.input_tokens), output: 0, cacheRead: count(usage?.cache_read_input_tokens === undefined ? 0 : usage.cache_read_input_tokens), cacheWrite: count(usage?.cache_creation_input_tokens === undefined ? 0 : usage.cache_creation_input_tokens) };
        if (usage?.output_tokens !== undefined) output = count(usage.output_tokens);
      }
      if (event.type === "message_delta") {
        if (!input) throw new PositiveRequestError("PROVIDER_USAGE_ORDER");
        for (const [wire, key] of [["input_tokens", "input"], ["cache_read_input_tokens", "cacheRead"], ["cache_creation_input_tokens", "cacheWrite"]] as const) {
          if (event.usage?.[wire] !== undefined) {
            const next = count(event.usage[wire]);
            if (next < input[key]) throw new PositiveRequestError("NONMONOTONIC_PROVIDER_USAGE");
            input[key] = next;
          }
        }
        if (event.usage?.output_tokens !== undefined) {
          const next = count(event.usage.output_tokens);
          if (output !== undefined && next < output) throw new PositiveRequestError("NONMONOTONIC_PROVIDER_USAGE");
          output = next;
          finalOutputSeen = true;
        }
        if (event.delta?.stop_reason) reason = event.delta.stop_reason;
      }
      if (event.type === "message_stop") ended = true;
    }
    if (!input || output === undefined || !finalOutputSeen || !ended || !["end_turn", "tool_use"].includes(reason ?? "")) throw new PositiveRequestError("INCOMPLETE_OR_ABNORMAL_PROVIDER_STREAM");
    return { ...input, output };
  }
  if (model !== JUDGE) throw new PositiveRequestError("UNAPPROVED_MODEL");
  let usage: Usage | undefined, reason: string | undefined, done = false, modelSeen = false;
  for (const payload of data) {
    if (done) throw new PositiveRequestError("PROVIDER_DATA_AFTER_END");
    if (payload === "[DONE]") { done = true; continue; }
    const event = JSON.parse(payload);
    if (event.error) throw new PositiveRequestError("PROVIDER_STREAM_ERROR");
    if (event.model !== undefined) {
      if (event.model !== "mimo-v2.6-flash") throw new PositiveRequestError("PROVIDER_MODEL_MISMATCH");
      modelSeen = true;
    }
    for (const choice of event.choices ?? []) if (choice.finish_reason) reason = choice.finish_reason;
    if (event.usage) {
      if (usage) throw new PositiveRequestError("DUPLICATE_PROVIDER_USAGE");
      const total = count(event.usage.prompt_tokens), cacheRead = count(event.usage.prompt_tokens_details?.cached_tokens === undefined ? 0 : event.usage.prompt_tokens_details.cached_tokens);
      if (cacheRead > total) throw new PositiveRequestError("INVALID_PROVIDER_USAGE");
      const output = count(event.usage.completion_tokens);
      if (event.usage.total_tokens !== undefined && count(event.usage.total_tokens) !== total + output) throw new PositiveRequestError("INCONSISTENT_PROVIDER_USAGE");
      usage = { input: total - cacheRead, output, cacheRead, cacheWrite: 0 };
    }
  }
  if (!usage || !done || !modelSeen || !["stop", "tool_calls"].includes(reason ?? "")) throw new PositiveRequestError("INCOMPLETE_OR_ABNORMAL_PROVIDER_STREAM");
  return usage;
}

function validateRequest(request: PositiveRequest, model: string): void {
  if (!request || typeof request.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.requestId) || typeof request.body !== "string" || Buffer.byteLength(request.body) > 8 * 1024 * 1024) throw new PositiveRequestError("INVALID_BROKER_REQUEST");
  const url = new URL(request.url);
  const expected = model === SUBJECT ? "https://api.minimaxi.com/anthropic/v1/messages" : model === JUDGE ? "https://token-plan-cn.xiaomimimo.com/v1/chat/completions" : "";
  if (url.origin + url.pathname !== expected || url.username || url.password || url.hash || (url.search && !(model === SUBJECT && url.search === "?beta=true"))) throw new PositiveRequestError("UNAPPROVED_PROVIDER_ROUTE");
  const body = JSON.parse(request.body), cap = model === SUBJECT ? 4096 : 1024;
  const knownFields = new Set(["model", "messages", "system", "max_tokens", "max_completion_tokens", "stream", "tools", "tool_choice", "parallel_tool_calls", "thinking", "reasoning_effort", "output_config", "temperature", "top_p", "stop", "stop_sequences", "metadata", "stream_options", "betas", "store", "n"]);
  if (Object.keys(body).some((key) => !knownFields.has(key)) || body.store !== undefined && body.store !== false) throw new PositiveRequestError("UNPRICED_PROVIDER_FEATURE");
  if (Buffer.byteLength(request.body) > (model === SUBJECT ? 1_000_000 : 1_048_576)) throw new PositiveRequestError("WIRE_INPUT_BOUND");
  if (body.model !== model.split("/")[1] || body.stream !== true || !Array.isArray(body.messages)) throw new PositiveRequestError("WIRE_MODEL_OR_STREAM_MISMATCH");
  const limits = [body.max_tokens, body.max_completion_tokens].filter((x) => x !== undefined);
  if (limits.length !== 1 || limits[0] !== cap || (model === SUBJECT && body.max_tokens !== cap) || body.n !== undefined && body.n !== 1) throw new PositiveRequestError("WIRE_OUTPUT_LIMIT_MISMATCH");
  if (model === SUBJECT && body.thinking?.type === "enabled" && (!Number.isSafeInteger(body.thinking.budget_tokens) || body.thinking.budget_tokens >= cap)) throw new PositiveRequestError("WIRE_THINKING_LIMIT_MISMATCH");
  if (model === JUDGE && body.thinking !== undefined && (!body.thinking || typeof body.thinking !== "object" || Object.keys(body.thinking).some(key => key !== "type") || !["enabled", "disabled"].includes(body.thinking.type))) throw new PositiveRequestError("WIRE_THINKING_LIMIT_MISMATCH");
  // Native local tools are permitted. Server-side tools can carry separate charges.
  if (body.tools?.some((tool: { type?: string }) => tool.type && !["function", "custom"].includes(tool.type))) throw new PositiveRequestError("SERVER_SIDE_TOOLS_FORBIDDEN");
  const textBlocks = (content: unknown): boolean => typeof content === "string" || content === null || content === undefined || Array.isArray(content) && content.every(block => block && ["text", "thinking", "redacted_thinking", "tool_use", "tool_result"].includes(block.type) && (block.type !== "tool_result" || textBlocks(block.content)));
  if (!textBlocks(body.system) || !body.messages.every((message: { content?: unknown }) => textBlocks(message.content))) throw new PositiveRequestError("TEXT_ONLY_REQUEST_REQUIRED");
  if (model === JUDGE && body.stream_options?.include_usage !== true) throw new PositiveRequestError("WIRE_USAGE_REQUIRED");
  for (const key of ["web_search", "web_search_options", "search_parameters", "service_tier", "background"]) if (body[key] !== undefined) throw new PositiveRequestError("UNPRICED_PROVIDER_FEATURE");
}

/** The only HTTP dispatch seam. Tests supply an in-memory fetch, never credentials. */
export async function dispatchPositiveRequest(request: PositiveRequest, options: {
  model: string; budget: PositiveBudget; apiKey: string; signal: AbortSignal;
  fetcher?: typeof fetch; onLedger?: () => void; onWire?: (request: PositiveRequest, response: { status: number; body: string }) => void;
  onChunk?: (request: PositiveRequest, chunk: Uint8Array) => void;
}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  let reserved = false;
  try {
    validateRequest(request, options.model);
    const reservation = options.budget.reserve(request.requestId); reserved = true;
    if (reservation.model !== options.model || reservation.maxOutputTokens !== (options.model === SUBJECT ? 4096 : 1024)) throw new PositiveRequestError("RESERVATION_MODEL_MISMATCH");
    options.onLedger?.(); // Persist the charge before dispatch; persistence failure stops dispatch.
    const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
    if (options.model === SUBJECT) {
      headers["x-api-key"] = options.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      const beta = Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === "anthropic-beta")?.[1];
      if (beta && /^[a-zA-Z0-9,._-]{1,500}$/.test(beta)) headers["anthropic-beta"] = beta;
    } else headers.authorization = `Bearer ${options.apiKey}`;
    const response = await (options.fetcher ?? fetch)(request.url, { method: "POST", headers, body: request.body, signal: options.signal, redirect: "error" });
    if (response.status !== 200) throw new PositiveRequestError(`PROVIDER_HTTP_${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/event-stream")) throw new PositiveRequestError("PROVIDER_STREAM_CONTENT_TYPE");
    // Bounded accumulation keeps original SSE evidence; output and request time are separately capped.
    let body = "", bytes = 0;
    if (!response.body) throw new PositiveRequestError("PROVIDER_EMPTY_BODY");
    const decoder = new TextDecoder();
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new PositiveRequestError("PROVIDER_BODY_LIMIT");
      options.onChunk?.(request, chunk);
      body += decoder.decode(chunk, { stream: true });
    }
    body += decoder.decode();
    options.onWire?.(request, { status: response.status, body });
    const usage = parsePositiveUsage(options.model, body);
    options.budget.settle(request.requestId, usage); reserved = false;
    options.onLedger?.();
    return { status: response.status, headers: { "content-type": "text/event-stream" }, body };
  } catch (error) {
    const code = error instanceof PositiveRequestError ? error.message : error instanceof BudgetStopError ? "BUDGET_STOP" : "BROKER_REQUEST_FAILED";
    if (reserved) { try { options.budget.failRequest(request.requestId, code); } catch { /* fatal already recorded */ } }
    else options.budget.stop(code);
    options.onLedger?.();
    throw new PositiveRequestError(code);
  }
}

export interface ControlledSessionOptions {
  workspaceRoot: string; sessionId: string; prompt: string; model: string; skillPaths: string[]; home: string;
  role: "subject" | "judge"; budget: PositiveBudget; timeoutMs: number; onLedger?: () => void;
  catalogHashes?: Record<string, string | null>;
}

function safeCatalog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeCatalog);
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new PositiveRequestError("CATALOG_URL_CONTAINS_PRIVATE_COMPONENTS");
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:api[_-]?key|authorization|auth|headers?|secret|credentials?|access[_-]?token|refresh[_-]?token)$/i.test(key)).map(([key, item]) => [key, safeCatalog(item)]));
}

export async function runControlledSession(options: ControlledSessionOptions): Promise<PiRunResult> {
  return runSession(options);
}

/** Explicit offline seam: never loads a real key and requires a supplied in-memory HTTP adapter. */
export async function simulateControlledSession(options: ControlledSessionOptions, fetcher: typeof fetch): Promise<PiRunResult> {
  if (typeof fetcher !== "function") throw new PositiveRequestError("OFFLINE_FETCH_REQUIRED");
  return runSession(options, fetcher);
}

async function runSession(options: ControlledSessionOptions, offlineFetch?: typeof fetch): Promise<PiRunResult> {
  const events: PiEvent[] = [], metrics = emptyMetrics();
  // The sandbox grants only workspace access; raw accounting evidence stays in its parent.
  const evidenceRoot = dirname(options.workspaceRoot);
  let isolation = { verified: false, issues: ["CONTROLLED_SANDBOX_NOT_VERIFIED"] as string[], backend: "macos-sandbox-exec-network-denied" };
  let stderr = "", timedOut = false, started = false;
  try {
    options.budget.beginSession(options.sessionId, options.role, options.model); started = true; options.onLedger?.();
    if (!offlineFetch && !options.catalogHashes) throw new PositiveRequestError("CATALOG_LOCK_REQUIRED");
    const home = join(options.workspaceRoot, ".pi-home"), config = join(home, ".pi", "agent");
    mkdirSync(config, { recursive: true, mode: 0o700 });
    for (const name of ["models.json", "models-store.json"]) {
      const source = join(options.home, ".pi", "agent", name);
      const bytes = existsSync(source) ? readFileSync(source) : null;
      const digest = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
      if (options.catalogHashes && options.catalogHashes[name] !== digest) throw new PositiveRequestError("CATALOG_DRIFT");
      if (bytes) {
        const provider = options.model.split("/")[0]!, original = JSON.parse(bytes.toString("utf8"));
        const selected = name === "models.json" ? { providers: original.providers?.[provider] ? { [provider]: original.providers[provider] } : {} } : original[provider] ? { [provider]: original[provider] } : {};
        writeFileSync(join(config, name), JSON.stringify(safeCatalog(selected)), { flag: "wx", mode: 0o600 });
      }
    }
    const runtime = resolvePiRuntime(), sdkRoot = runtime.readOnlyRoots[0]!;
    // Read only the selected key in the controller; never copy auth to a tool-readable path.
    const auth = offlineFetch ? undefined : JSON.parse(readFileSync(join(options.home, ".pi", "agent", "auth.json"), "utf8"));
    const credential = offlineFetch ? { type: "api_key", key: "offline-fixture-placeholder" } : auth[options.model.split("/")[0]!];
    if (credential?.type !== "api_key" || typeof credential.key !== "string" || !credential.key.trim() || credential.key.trim() !== credential.key || /^[!$]/.test(credential.key) || /[\r\n]/.test(credential.key)) throw new PositiveRequestError("SELECTED_LITERAL_API_KEY_REQUIRED");
    const worker = fileURLToPath(new URL("./positive-worker.ts", import.meta.url));
    // .mts carries ESM identity itself; Node need not read the repository package.json.
    const workerCopy = join(options.workspaceRoot, ".positive-worker.mts");
    writeFileSync(workerCopy, readFileSync(worker), { flag: "wx", mode: 0o400 });
    const command = buildSandboxCommand({ command: runtime.command, args: ["--experimental-strip-types", workerCopy], workspaceRoot: options.workspaceRoot, readOnlyRoots: [...runtime.readOnlyRoots, ...options.skillPaths.map(dirname)] });
    command.args[1] += "\n(deny network*)";
    isolation = { ...verifySandboxCommand(command, options.workspaceRoot), backend: "macos-sandbox-exec-network-denied" };
    if (!isolation.verified) throw new PositiveRequestError("CONTROLLED_SANDBOX_FAILED");
    const abort = new AbortController();
    const result = await new Promise<number | null>((resolveExit) => {
      const child = spawn(command.command, command.args, { cwd: options.workspaceRoot, detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"], env: { PATH: "/usr/bin:/bin", HOME: home, PI_CODING_AGENT_DIR: config, TMPDIR: home, PI_OFFLINE: "1", NODE_DISABLE_COMPILE_CACHE: "1", LANG: "en_US.UTF-8" } });
      let done = false, killing: NodeJS.Timeout | undefined;
      const stop = (code: string) => {
        options.budget.stop(code); stderr ||= code; abort.abort();
        try { options.onLedger?.(); } catch { stderr = "LEDGER_PERSISTENCE_FAILED"; }
        finally {
          if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } }
          killing ??= setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } } }, 1000);
        }
      };
      const timer = setTimeout(() => { timedOut = true; stop("SESSION_TIMEOUT"); }, options.timeoutMs);
      child.on("message", (value) => {
        const msg = value as { type?: string } & PositiveRequest;
        if (msg.type !== "request") { stop("INVALID_WORKER_IPC"); return; }
        void dispatchPositiveRequest(msg, { model: options.model, budget: options.budget, apiKey: credential.key, signal: abort.signal, fetcher: offlineFetch, onLedger: options.onLedger,
          onWire: (request, response) => writeFileSync(join(evidenceRoot, `wire-${request.requestId}.json`), JSON.stringify({ request: { url: request.url, body: request.body }, response }), { flag: "wx", mode: 0o600 }),
          onChunk: (request, chunk) => writeFileSync(join(evidenceRoot, `wire-${request.requestId}.partial.sse`), chunk, { flag: "a", mode: 0o600 }),
        }).then((response) => { if (child.connected) child.send({ type: "response", requestId: msg.requestId, ...response }, (error) => { if (error && !done) stop("WORKER_IPC_FAILURE"); }); }).catch(() => stop("REQUEST_ABORTED"));
      });
      const lines = createInterface({ input: child.stdout! });
      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line) as PiEvent; events.push(event); collectMetrics(metrics, event, options.workspaceRoot);
          // Persist incrementally, including failed or partial tool output.
          writeFileSync(join(evidenceRoot, "events.partial.json"), JSON.stringify(events), { mode: 0o600 });
          const message = event.message as { role?: string; stopReason?: string } | undefined;
          if (event.type === "tool_execution_end" && event.isError === true || event.type === "message_end" && message?.role === "assistant" && ["error", "aborted", "length"].includes(message.stopReason ?? "") || event.type === "controlled_error") stop("SESSION_EVENT_FAILURE");
        } catch { stop("INVALID_WORKER_EVENT"); }
      });
      // Raw SDK stderr can contain headers or credential hints; retain a safe code only.
      child.stderr?.on("data", () => { stderr ||= "WORKER_STDERR"; });
      const finish = (code: number | null) => { if (done) return; done = true; clearTimeout(timer); if (killing) clearTimeout(killing); if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } } abort.abort(); resolveExit(code); };
      child.on("error", () => { stop("WORKER_START_FAILURE"); finish(null); });
      child.stdin!.on("error", () => { if (!done) stop("WORKER_STDIN_FAILURE"); });
      child.on("close", finish);
      child.stdin!.end(JSON.stringify({ sdkRoot, workspaceRoot: options.workspaceRoot, home, sessionId: options.sessionId, prompt: options.prompt, model: options.model, skillPaths: options.skillPaths, maxOutputTokens: options.role === "subject" ? 4096 : 1024 }));
    });
    if (result !== 0 || stderr || !metrics.output.trim()) options.budget.stop(stderr || "SESSION_FAILED_OR_EMPTY");
    return { exitCode: stderr ? 1 : result, events, metrics, stderr, timedOut, isolation };
  } catch (error) {
    const code = error instanceof PositiveRequestError ? error.message : "CONTROLLED_SESSION_BLOCKED";
    options.budget.stop(code);
    return { exitCode: null, events, metrics, stderr: code, timedOut, isolation };
  } finally {
    if (started) { try { options.budget.endSession(); } catch { /* incomplete HTTP retains reservation */ } }
    options.onLedger?.();
  }
}
