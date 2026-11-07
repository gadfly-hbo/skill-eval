/** Restricted native Pi session. Only this parent process owns credentials/network. */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { ControlledBudget, BudgetStopError } from "./controlled-budget.ts";
import { buildSandboxCommand, resolvePiRuntime, verifySandboxCommand } from "./isolation.ts";
import { collectMetrics, emptyMetrics, type PiEvent, type PiRunResult } from "./pi.ts";
import { FailureEvidence, type FailureSnapshot, type IncidentType } from "./failure-evidence.ts";

const SUBJECT = "minimax-cn/MiniMax-M3.1-Flash";
const JUDGE = "xiaomi-token-plan-cn/mimo-v2.6-flash";
export interface ControlledRequest { requestId: string; url: string; body: string; headers: Record<string, string> }
class ControlledRequestError extends Error {}
class HostRequestError extends ControlledRequestError {}
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ControlledRequestError("INVALID_PROVIDER_USAGE");
  return value;
}

/** Parse the original wire evidence, because the SDK creates zero usage on errors. */
export function parseProviderUsage(model: string, text: string): Usage {
  const data = text.replace(/\r\n/g, "\n").split("\n\n").map((part) => part.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n")).filter(Boolean);
  if (model === SUBJECT) {
    let input: Usage | undefined, output: number | undefined, finalOutputSeen = false, ended = false, reason: string | undefined;
    for (const payload of data) {
      if (ended) throw new ControlledRequestError("PROVIDER_DATA_AFTER_END");
      const event = JSON.parse(payload);
      if (event.type === "error") throw new ControlledRequestError("PROVIDER_STREAM_ERROR");
      if (event.type === "message_start") {
        if (event.message?.model !== "MiniMax-M3.1-Flash") throw new HostRequestError("PROVIDER_MODEL_MISMATCH");
        if (input) throw new ControlledRequestError("DUPLICATE_PROVIDER_USAGE");
        const usage = event.message.usage;
        input = { input: count(usage?.input_tokens), output: 0, cacheRead: count(usage?.cache_read_input_tokens === undefined ? 0 : usage.cache_read_input_tokens), cacheWrite: count(usage?.cache_creation_input_tokens === undefined ? 0 : usage.cache_creation_input_tokens) };
        if (usage?.output_tokens !== undefined) output = count(usage.output_tokens);
      }
      if (event.type === "message_delta") {
        if (!input) throw new ControlledRequestError("PROVIDER_USAGE_ORDER");
        for (const [wire, key] of [["input_tokens", "input"], ["cache_read_input_tokens", "cacheRead"], ["cache_creation_input_tokens", "cacheWrite"]] as const) {
          if (event.usage?.[wire] !== undefined) {
            const next = count(event.usage[wire]);
            if (next < input[key]) throw new ControlledRequestError("NONMONOTONIC_PROVIDER_USAGE");
            input[key] = next;
          }
        }
        if (event.usage?.output_tokens !== undefined) {
          const next = count(event.usage.output_tokens);
          if (output !== undefined && next < output) throw new ControlledRequestError("NONMONOTONIC_PROVIDER_USAGE");
          output = next;
          finalOutputSeen = true;
        }
        if (event.delta?.stop_reason) reason = event.delta.stop_reason;
      }
      if (event.type === "message_stop") ended = true;
    }
    if (!input || output === undefined || !finalOutputSeen || !ended || !reason) throw new ControlledRequestError("INCOMPLETE_OR_ABNORMAL_PROVIDER_STREAM");
    return { ...input, output };
  }
  if (model !== JUDGE) throw new ControlledRequestError("UNAPPROVED_MODEL");
  let usage: Usage | undefined, reason: string | undefined, done = false, modelSeen = false;
  for (const payload of data) {
    if (done) throw new ControlledRequestError("PROVIDER_DATA_AFTER_END");
    if (payload === "[DONE]") { done = true; continue; }
    const event = JSON.parse(payload);
    if (event.error) throw new ControlledRequestError("PROVIDER_STREAM_ERROR");
    if (event.model !== undefined) {
      if (event.model !== "mimo-v2.6-flash") throw new HostRequestError("PROVIDER_MODEL_MISMATCH");
      modelSeen = true;
    }
    for (const choice of event.choices ?? []) if (choice.finish_reason) reason = choice.finish_reason;
    if (event.usage) {
      if (usage) throw new ControlledRequestError("DUPLICATE_PROVIDER_USAGE");
      const total = count(event.usage.prompt_tokens), cacheRead = count(event.usage.prompt_tokens_details?.cached_tokens === undefined ? 0 : event.usage.prompt_tokens_details.cached_tokens);
      if (cacheRead > total) throw new ControlledRequestError("INVALID_PROVIDER_USAGE");
      const output = count(event.usage.completion_tokens);
      if (event.usage.total_tokens !== undefined && count(event.usage.total_tokens) !== total + output) throw new ControlledRequestError("INCONSISTENT_PROVIDER_USAGE");
      usage = { input: total - cacheRead, output, cacheRead, cacheWrite: 0 };
    }
  }
  if (!usage || !done || !modelSeen || !reason) throw new ControlledRequestError("INCOMPLETE_OR_ABNORMAL_PROVIDER_STREAM");
  return usage;
}

function validateRequest(request: ControlledRequest, model: string, nativeOutput: number): void {
  if (!request || typeof request.requestId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.requestId) || typeof request.body !== "string") throw new HostRequestError("INVALID_BROKER_REQUEST");
  const url = new URL(request.url);
  const expected = model === SUBJECT ? "https://api.minimaxi.com/anthropic/v1/messages" : model === JUDGE ? "https://token-plan-cn.xiaomimimo.com/v1/chat/completions" : "";
  if (!expected || url.origin + url.pathname !== expected || url.username || url.password || url.hash || (url.search && !(model === SUBJECT && url.search === "?beta=true"))) throw new HostRequestError("UNAPPROVED_PROVIDER_ROUTE");
  const body = JSON.parse(request.body);
  if (body.model !== model.split("/")[1] || body.stream !== true || !Array.isArray(body.messages)) throw new HostRequestError("WIRE_MODEL_OR_STREAM_MISMATCH");
  const limits = [body.max_tokens, body.max_completion_tokens].filter(value => value !== undefined);
  if (limits.length !== 1 || !Number.isSafeInteger(limits[0]) || limits[0] < 1 || limits[0] > nativeOutput) throw new HostRequestError("WIRE_OUTPUT_LIMIT_MISMATCH");
  // Local SDK tools stay native. Remote services are a separate authorization
  // boundary, not a token/cost policy or a payload-field whitelist.
  if (body.tools?.some((tool: { type?: string }) => tool.type && !["function", "custom"].includes(tool.type)) || ["web_search", "web_search_options", "search_parameters", "mcp_servers"].some(key => body[key] !== undefined)) throw new HostRequestError("EXTERNAL_SERVICES_NOT_AUTHORIZED");
}

/** One HTTP observation seam. SDK receives original statuses and owns recovery. */
export async function dispatchControlledRequest(request: ControlledRequest, options: {
  model: string; budget: ControlledBudget; apiKey: string; signal: AbortSignal;
  fetcher?: typeof fetch; onLedger?: () => void; onWire?: (request: ControlledRequest, response: { status: number; body: string }) => void;
  onRequest?: (request: ControlledRequest) => void;
  onChunk?: (request: ControlledRequest, chunk: Uint8Array) => void;
}): Promise<{ status: number; headers: Record<string, string>; body: string }> {
  let reserved = false;
  const persist = () => {
    try { options.onLedger?.(); }
    catch { throw new HostRequestError("LEDGER_PERSISTENCE_FAILED"); }
  };
  try {
    const role = options.model === SUBJECT ? "subject" : options.model === JUDGE ? "judge" : undefined;
    if (!role) throw new HostRequestError("UNAPPROVED_MODEL");
    try { validateRequest(request, options.model, options.budget.getModelLimits(role).maxOutputTokens); }
    catch (error) { throw error instanceof HostRequestError ? error : new HostRequestError("INVALID_BROKER_REQUEST"); }
    const reservation = options.budget.reserve(request.requestId); reserved = true;
    if (reservation.model !== options.model) throw new HostRequestError("RESERVATION_MODEL_MISMATCH");
    persist();
    try { options.onRequest?.(request); }
    catch { throw new HostRequestError("WIRE_EVIDENCE_WRITE_FAILED"); }
    const headers: Record<string, string> = { "content-type": "application/json", accept: "text/event-stream" };
    if (options.model === SUBJECT) {
      headers["x-api-key"] = options.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      const beta = Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === "anthropic-beta")?.[1];
      if (beta && /^[a-zA-Z0-9,._-]{1,500}$/.test(beta)) headers["anthropic-beta"] = beta;
    } else headers.authorization = `Bearer ${options.apiKey}`;
    const response = await (options.fetcher ?? fetch)(request.url, { method: "POST", headers, body: request.body, signal: options.signal, redirect: "error" });
    let body = "";
    if (response.body) {
      const decoder = new TextDecoder();
      for await (const chunk of response.body) {
        try { options.onChunk?.(request, chunk); }
        catch { throw new HostRequestError("WIRE_EVIDENCE_WRITE_FAILED"); }
        body += decoder.decode(chunk, { stream: true });
      }
      body += decoder.decode();
    }
    try { options.onWire?.(request, { status: response.status, body }); }
    catch { throw new HostRequestError("WIRE_EVIDENCE_WRITE_FAILED"); }
    // Accounting uncertainty is data. It must not pre-empt a native SDK retry,
    // compaction or a valid answer; unknown requests retain their raw evidence.
    try { options.budget.settle(request.requestId, parseProviderUsage(options.model, body)); }
    catch (error) {
      if (error instanceof HostRequestError) throw error;
      options.budget.failRequest(request.requestId, error instanceof ControlledRequestError ? error.message : "UNKNOWN_PROVIDER_USAGE");
    }
    reserved = false;
    persist();
    return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
  } catch (error) {
    const hostFailure = error instanceof HostRequestError || error instanceof BudgetStopError;
    const code = error instanceof ControlledRequestError ? error.message : error instanceof BudgetStopError ? "LEDGER_STATE_FAILED" : "PROVIDER_TRANSPORT_FAILED";
    if (reserved) { try { options.budget.failRequest(request.requestId, code); } catch { /* original failure preserved */ } }
    if (hostFailure) options.budget.stop(code);
    persist();
    throw hostFailure ? new HostRequestError(code) : new ControlledRequestError(code);
  }
}

export interface ControlledSessionOptions {
  workspaceRoot: string; sessionId: string; prompt: string; model: string; skillPaths: string[]; home: string;
  role: "subject" | "judge"; budget: ControlledBudget; timeoutMs?: number; onLedger?: () => void;
  catalogHashes?: Record<string, string | null>;
  onEvent?: (event: PiEvent) => void;
}

export type ControlledSessionResult = PiRunResult & { failureEvidence: FailureSnapshot };

function safeCatalog(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(safeCatalog);
  if (typeof value === "string" && /^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) throw new ControlledRequestError("CATALOG_URL_CONTAINS_PRIVATE_COMPONENTS");
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:api[_-]?key|authorization|auth|headers?|secret|credentials?|access[_-]?token|refresh[_-]?token)$/i.test(key)).map(([key, item]) => [key, safeCatalog(item)]));
}

export async function runControlledSession(options: ControlledSessionOptions): Promise<ControlledSessionResult> {
  return runSession(options);
}

/** Explicit offline seam: never loads a real key and requires a supplied in-memory HTTP adapter. */
export async function simulateControlledSession(options: ControlledSessionOptions, fetcher: typeof fetch): Promise<ControlledSessionResult> {
  if (typeof fetcher !== "function") throw new ControlledRequestError("OFFLINE_FETCH_REQUIRED");
  return runSession(options, fetcher);
}

async function runSession(options: ControlledSessionOptions, offlineFetch?: typeof fetch): Promise<ControlledSessionResult> {
  const events: PiEvent[] = [], metrics = emptyMetrics();
  // The sandbox grants only workspace access; raw accounting evidence stays in its parent.
  const evidenceRoot = dirname(options.workspaceRoot);
  const failures = new FailureEvidence(options.sessionId);
  const failureEvidence = failures.snapshot();
  let evidenceClaimed = false;
  const persistFailureEvidence = () => {
    try {
      Object.assign(failureEvidence, failures.snapshot());
      const path = join(evidenceRoot, "failure-evidence.json"), temporary = join(evidenceRoot, ".failure-evidence.tmp");
      const target = evidenceClaimed ? temporary : path;
      const file = openSync(target, "wx", 0o600);
      try { writeFileSync(file, JSON.stringify(failureEvidence, null, 2)); fsyncSync(file); }
      finally { closeSync(file); }
      if (evidenceClaimed) renameSync(temporary, path);
      evidenceClaimed = true;
      const directory = openSync(evidenceRoot, "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    } catch { throw new ControlledRequestError("FAILURE_EVIDENCE_WRITE_FAILED"); }
  };
  const recordFailure = (code: string, kind: IncidentType, eventIndex: number | null = null) => {
    const firstFatal = !failures.hasFatalCause();
    failures.record(code, kind, eventIndex);
    try { if (firstFatal) persistFailureEvidence(); }
    catch { failures.record("FAILURE_EVIDENCE_WRITE_FAILED", "persistence_error"); Object.assign(failureEvidence, failures.snapshot()); }
  };
  const syncLedger = () => {
    try { options.onLedger?.(); }
    catch {
      recordFailure("LEDGER_PERSISTENCE_FAILED", "persistence_error");
      throw new ControlledRequestError("LEDGER_PERSISTENCE_FAILED");
    }
  };
  let isolation = { verified: false, issues: ["CONTROLLED_SANDBOX_NOT_VERIFIED"] as string[], backend: "macos-sandbox-exec-network-denied" };
  let stderr = "", timedOut = false, started = false, successful = false, sawWorkerStderr = false;
  let outcome: ControlledSessionResult | undefined;
  try {
    persistFailureEvidence();
    options.budget.beginSession(options.sessionId, options.role, options.model); started = true; syncLedger();
    if (!offlineFetch && !options.catalogHashes) throw new ControlledRequestError("CATALOG_LOCK_REQUIRED");
    const home = join(options.workspaceRoot, ".pi-home"), config = join(home, ".pi", "agent");
    mkdirSync(config, { recursive: true, mode: 0o700 });
    for (const name of ["models.json", "models-store.json"]) {
      const source = join(options.home, ".pi", "agent", name);
      const bytes = existsSync(source) ? readFileSync(source) : null;
      const digest = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
      if (options.catalogHashes && options.catalogHashes[name] !== digest) throw new ControlledRequestError("CATALOG_DRIFT");
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
    if (credential?.type !== "api_key" || typeof credential.key !== "string" || !credential.key.trim() || credential.key.trim() !== credential.key || /^[!$]/.test(credential.key) || /[\r\n]/.test(credential.key)) throw new ControlledRequestError("SELECTED_LITERAL_API_KEY_REQUIRED");
    const worker = fileURLToPath(new URL("./controlled-worker.ts", import.meta.url));
    // .mts carries ESM identity itself; Node need not read the repository package.json.
    const workerCopy = join(options.workspaceRoot, ".controlled-worker.mts");
    writeFileSync(workerCopy, readFileSync(worker), { flag: "wx", mode: 0o400 });
    if (options.role === "judge") {
      const judgeDecoder = new URL("./judge-json.mts", import.meta.url);
      writeFileSync(join(options.workspaceRoot, "judge-json.mts"), readFileSync(judgeDecoder), { flag: "wx", mode: 0o400 });
    }
    const command = buildSandboxCommand({ command: runtime.command, args: ["--experimental-strip-types", workerCopy], workspaceRoot: options.workspaceRoot, readOnlyRoots: [...runtime.readOnlyRoots, ...options.skillPaths.map(dirname)] });
    command.args[1] += "\n(deny network*)";
    isolation = { ...verifySandboxCommand(command, options.workspaceRoot), backend: "macos-sandbox-exec-network-denied" };
    if (!isolation.verified) throw new ControlledRequestError("CONTROLLED_SANDBOX_FAILED");
    const abort = new AbortController();
    const inflight = new Set<Promise<void>>();
    const result = await new Promise<number | null>((resolveExit) => {
      const child = spawn(command.command, command.args, { cwd: options.workspaceRoot, detached: true, stdio: ["pipe", "pipe", "pipe", "ipc"], env: { PATH: "/usr/bin:/bin", HOME: home, PI_CODING_AGENT_DIR: config, TMPDIR: home, PI_OFFLINE: "1", NODE_DISABLE_COMPILE_CACHE: "1", LANG: "en_US.UTF-8" } });
      let done = false, killing: NodeJS.Timeout | undefined;
      const stop = (code: string) => {
        options.budget.stop(code); stderr ||= code; abort.abort();
        recordFailure(code, code === "SESSION_TIMEOUT" ? "timeout" : code.includes("PERSISTENCE") || code.endsWith("WRITE_FAILED") ? "persistence_error" : "worker_error");
        try { syncLedger(); } catch { stderr = "LEDGER_PERSISTENCE_FAILED"; }
        finally {
          if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } }
          killing ??= setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } } }, 1000);
        }
      };
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        timedOut = true; abort.abort(); stderr ||= "SESSION_TIMEOUT"; recordFailure("SESSION_TIMEOUT", "timeout");
        if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } }
        killing ??= setTimeout(() => { if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } } }, 1000);
      }, options.timeoutMs);
      child.on("message", (value) => {
        const msg = value as { type?: string } & ControlledRequest;
        if (msg.type !== "request") { stop("INVALID_WORKER_IPC"); return; }
        const pending = dispatchControlledRequest(msg, { model: options.model, budget: options.budget, apiKey: credential.key, signal: abort.signal, fetcher: offlineFetch, onLedger: syncLedger,
          onRequest: request => writeFileSync(join(evidenceRoot, `wire-${request.requestId}.request.json`), JSON.stringify({ url: request.url, body: request.body }), { flag: "wx", mode: 0o600 }),
          onWire: (request, response) => writeFileSync(join(evidenceRoot, `wire-${request.requestId}.json`), JSON.stringify({ request: { url: request.url, body: request.body }, response }), { flag: "wx", mode: 0o600 }),
          onChunk: (request, chunk) => writeFileSync(join(evidenceRoot, `wire-${request.requestId}.partial.sse`), chunk, { flag: "a", mode: 0o600 }),
        }).then((response) => { if (child.connected) child.send({ type: "response", requestId: msg.requestId, ...response }, (error) => { if (error && !done) stop("WORKER_IPC_FAILURE"); }); }).catch((error) => {
          if (error instanceof HostRequestError) {
            recordFailure(error.message, error.message.includes("PERSISTENCE") || error.message.endsWith("WRITE_FAILED") ? "persistence_error" : "worker_error");
            stop(error.message);
          } else if (child.connected) child.send({ type: "response-error", requestId: msg.requestId }, sendError => { if (sendError && !done) stop("WORKER_IPC_FAILURE"); });
        }).finally(() => { inflight.delete(pending); });
        inflight.add(pending);
      });
      const lines = createInterface({ input: child.stdout! });
      lines.on("line", (line) => {
        try {
          const event = JSON.parse(line) as PiEvent; events.push(event); collectMetrics(metrics, event, options.workspaceRoot);
          const hadFatalCause = failures.hasFatalCause();
          failures.observe(event, events.length - 1);
          if (!hadFatalCause && failures.hasFatalCause()) persistFailureEvidence();
          options.onEvent?.(event);
          // Append only this record; rewriting every accumulated prefix makes
          // streaming evidence quadratic. The runner writes final events.json once.
          try { appendFileSync(join(evidenceRoot, "events.partial.jsonl"), JSON.stringify(event) + "\n", { mode: 0o600 }); }
          catch { throw new ControlledRequestError("EVENT_EVIDENCE_WRITE_FAILED"); }
          if (event.type === "controlled_error" && !timedOut) stop("SESSION_EVENT_FAILURE");
        } catch (error) {
          if (error instanceof ControlledRequestError && ["FAILURE_EVIDENCE_WRITE_FAILED", "EVENT_EVIDENCE_WRITE_FAILED"].includes(error.message)) {
            recordFailure(error.message, "persistence_error", events.length - 1);
            stop(error.message);
          } else stop("INVALID_WORKER_EVENT");
        }
      });
      // Raw SDK stderr can contain headers or credential hints; retain a safe code only.
      child.stderr?.on("data", () => { sawWorkerStderr = true; });
      const finish = (code: number | null) => { if (done) return; done = true; if (timer) clearTimeout(timer); if (killing) clearTimeout(killing); if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* exited */ } } abort.abort(); resolveExit(code); };
      child.on("error", () => { stop("WORKER_START_FAILURE"); finish(null); });
      child.stdin!.on("error", () => { if (!done) stop("WORKER_STDIN_FAILURE"); });
      child.on("close", (code, signal) => {
        if (signal && !timedOut && !failures.snapshot().firstCause) {
          recordFailure("WORKER_EXIT_SIGNAL", "worker_error");
          options.budget.stop("WORKER_EXIT_SIGNAL");
        }
        finish(code);
      });
      child.stdin!.end(JSON.stringify({ sdkRoot, workspaceRoot: options.workspaceRoot, home, sessionId: options.sessionId, prompt: options.prompt, model: options.model, role: options.role, skillPaths: options.skillPaths, maxOutputTokens: options.budget.getModelLimits(options.role).maxOutputTokens, contextWindow: options.budget.getModelLimits(options.role).contextWindow }));
    });
    // Native SDK background work may still be aborting when the worker closes.
    // Finish its observed accounting before the matrix can open another sample.
    await Promise.allSettled([...inflight]);
    if (result !== 0 || stderr || !metrics.output.trim()) {
      stderr ||= sawWorkerStderr && result !== 0 ? "WORKER_STDERR" : "SESSION_FAILED_OR_EMPTY";
      if (!failures.snapshot().firstCause) recordFailure(stderr, "worker_error");
    }
    successful = !stderr && result === 0;
    return outcome = { exitCode: stderr ? 1 : result, events, metrics, stderr, timedOut, isolation, failureEvidence };
  } catch (error) {
    const code = error instanceof ControlledRequestError ? error.message : "CONTROLLED_SESSION_BLOCKED";
    options.budget.stop(code);
    recordFailure(code, ["FAILURE_EVIDENCE_WRITE_FAILED", "LEDGER_PERSISTENCE_FAILED"].includes(code) ? "persistence_error" : "startup_error");
    return outcome = { exitCode: null, events, metrics, stderr: code, timedOut, isolation, failureEvidence };
  } finally {
    if (started) { try { options.budget.endSession(successful); } catch { /* incomplete HTTP retains reservation */ } }
    try { persistFailureEvidence(); }
    catch {
      options.budget.stop("FAILURE_EVIDENCE_WRITE_FAILED");
      recordFailure("FAILURE_EVIDENCE_WRITE_FAILED", "persistence_error");
      if (outcome) { outcome.exitCode = 1; outcome.stderr = "FAILURE_EVIDENCE_WRITE_FAILED"; }
    }
    Object.assign(failureEvidence, failures.snapshot());
    syncLedger();
  }
}
