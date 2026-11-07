import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import fs from "node:fs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlledBudget } from "./controlled-budget.ts";
import { resolvePiRuntime } from "./isolation.ts";
import { dispatchControlledRequest, parseProviderUsage, simulateControlledSession } from "./controlled-session.ts";
import { parseJudgeResponse } from "./judge.ts";

// Parent-side test guard: every HTTP response must come from an explicit fixture.
globalThis.fetch = async () => { throw new Error("REAL_PROVIDER_FORBIDDEN_IN_OFFLINE_TEST"); };

const subject = "minimax-cn/MiniMax-M3.1-Flash";
const judge = "xiaomi-token-plan-cn/mimo-v2.6-flash";
const anthropic = [
  { type: "message_start", message: { model: "MiniMax-M3.1-Flash", usage: { input_tokens: 100, output_tokens: 0 } } },
  { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
  { type: "message_stop" },
].map((data) => `data: ${JSON.stringify(data)}\n\n`).join("");
const request = { requestId: "r1", url: "https://api.minimaxi.com/anthropic/v1/messages?beta=true", body: JSON.stringify({ model: "MiniMax-M3.1-Flash", max_tokens: 4096, stream: true, messages: [] }), headers: {} };

test("broker reserves before dispatch and settles raw provider usage independently of SDK cost", async () => {
  const budget = new ControlledBudget();
  budget.beginSession("b1", "subject", subject);
  let called = 0, persisted = 0;
  await dispatchControlledRequest(request, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal,
    onLedger: () => { persisted++; },
    fetcher: async (_url, init) => {
      called++;
      assert.equal(persisted, 1, "reservation must be flushed before the first HTTP dispatch");
      assert.equal(init?.redirect, "error");
      assert.match(JSON.stringify(budget.snapshot()), /r1/);
      assert.equal((init?.headers as Record<string, string>)["x-api-key"], "fixture-only");
      return new Response(anthropic, { headers: { "content-type": "text/event-stream" } });
    },
  });
  budget.endSession();
  assert.equal(called, 1);
  assert.equal(persisted, 2, "settled original usage must also be flushed");
  // 100×150 + 20×600 nanoUSD, no reliance on model-provided monetary fields.
  assert.match(JSON.stringify(budget.snapshot()), /27000/);
});

test("failure to persist accounting prevents HTTP and preserves unknown exposure", async () => {
  const budget = new ControlledBudget(); budget.beginSession("disk-failed", "subject", subject);
  let calls = 0;
  await assert.rejects(dispatchControlledRequest(request, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal,
    onLedger: () => { throw new Error("OFFLINE_DISK_FAILURE"); },
    fetcher: async () => { calls++; throw new Error("MUST_NOT_DISPATCH"); },
  }));
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().state, "stopped");
  assert.equal(budget.snapshot().chargedNanoUsd, null);
  assert.equal(budget.snapshot().requests[0]?.state, "failed");
});

test("identity, native output or external-service violations stop before HTTP", async () => {
  for (const changed of [
    { ...request, url: "https://example.com/v1/messages" },
    { ...request, body: request.body.replace("4096", "524289") },
    { ...request, body: request.body.replace("MiniMax-M3.1-Flash", "MiniMax-M3") },
    { ...request, body: request.body.replace('"stream":true', '"stream":false') },
    { ...request, body: request.body.replace('"messages":[]', '"messages":[],"mcp_servers":[{"url":"https://example.com"}]') },
  ]) {
    const budget = new ControlledBudget(); budget.beginSession("b", "subject", subject);
    let calls = 0;
    await assert.rejects(dispatchControlledRequest(changed, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return new Response(anthropic); } }));
    assert.equal(calls, 0);
    assert.throws(() => budget.reserve("after-failure"));
  }
});

test("HTTP faults and missing usage remain observable while a later SDK request may succeed", async () => {
  for (const fetcher of [
    async () => new Response("PRIVATE_ERROR_TEXT", { status: 401 }),
    async () => { throw new Error("PRIVATE_NETWORK_TEXT"); },
    async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
  ]) {
    const budget = new ControlledBudget(); budget.beginSession("b", "subject", subject);
    let calls = 0;
    const options = { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return fetcher(); } };
    try { await dispatchControlledRequest(request, options); } catch (error) { assert.ok(!/PRIVATE/.test(String(error))); }
    assert.equal(budget.snapshot().state, "open");
    assert.equal(budget.snapshot().unknownRequests, 1);
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    await dispatchControlledRequest({ ...request, requestId: "native-followup" }, { ...options, fetcher: async () => { calls++; return new Response(anthropic); } });
    budget.endSession();
    assert.equal(calls, 2);
    assert.equal(budget.snapshot().knownChargedNanoUsd, 27000);
    assert.equal(budget.snapshot().requests[1]?.state, "settled");
  }
});

test("broker stops on the observed MiniMax 2056 quota signature while ordinary 429 remains recoverable", async () => {
  const body = (message: string) => JSON.stringify({ type: "error", error: { type: "rate_limit_error", message } });
  for (const fixture of [
    { body: body("已达到 Token Plan 用量上限：请升级 Token Plan 套餐或购买积分补充用量。 (2056)"), terminal: true },
    { body: body("rate limit (20560)"), terminal: false },
    { body: "2056", terminal: false },
  ]) {
    const budget = new ControlledBudget(); budget.beginSession("subject", "subject", subject);
    let calls = 0;
    const wire: Array<{ status: number; body: string }> = [];
    const options = { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal,
      onWire: (_request: unknown, response: { status: number; body: string }) => wire.push(response),
      fetcher: async () => { calls++; return new Response(fixture.body, { status: 429 }); },
    };
    const first = dispatchControlledRequest(request, options);
    if (fixture.terminal) {
      await assert.rejects(first, /PROVIDER_QUOTA_EXHAUSTED/);
      await assert.rejects(dispatchControlledRequest({ ...request, requestId: "after-quota" }, options), /PROVIDER_QUOTA_EXHAUSTED/);
      assert.equal(budget.snapshot().requests[0]?.reason, "PROVIDER_QUOTA_EXHAUSTED");
      assert.equal(budget.snapshot().sessions[0]?.state, "failed");
    } else {
      assert.equal((await first).status, 429);
    }
    assert.equal(budget.isStopped(), fixture.terminal);
    assert.equal(budget.snapshot().unknownRequests, 1);
    assert.equal(calls, 1);
    assert.deepEqual(wire, [{ status: 429, body: fixture.body }]);
  }
});

test("raw usage requires completed streams and valid counts, including native length stops", () => {
  assert.deepEqual(parseProviderUsage(subject, anthropic), { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(parseProviderUsage(subject, anthropic.replace("end_turn", "max_tokens")), { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 });
  for (const bad of [anthropic.replace('"input_tokens":100', '"input_tokens":-1'), anthropic.replace('"output_tokens":20', '"output_tokens":0.5'), anthropic.replace('data: {"type":"message_stop"}\n\n', "")]) {
    assert.throws(() => parseProviderUsage(subject, bad));
  }
  const openai = 'data: {"model":"mimo-v2.6-flash","choices":[{"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":20}}}\n\ndata: [DONE]\n\n';
  assert.deepEqual(parseProviderUsage(judge, openai), { input: 10, output: 10, cacheRead: 20, cacheWrite: 0 });
  assert.deepEqual(parseProviderUsage(judge, openai.replace("stop", "length")), { input: 10, output: 10, cacheRead: 20, cacheWrite: 0 });
  assert.throws(() => parseProviderUsage(judge, openai.replace('"cached_tokens":20', '"cached_tokens":31')));
  assert.throws(() => parseProviderUsage(judge, openai.replace('"cached_tokens":20', '"cached_tokens":null')));
  assert.throws(() => parseProviderUsage(judge, openai.replace('"prompt_tokens":30', '"total_tokens":999,"prompt_tokens":30')));
  assert.throws(() => parseProviderUsage(judge, openai + 'data: {"choices":[]}\n\n'));
  assert.throws(() => parseProviderUsage(subject, anthropic.replace('"input_tokens":100', '"input_tokens":100,"cache_read_input_tokens":null')));
  assert.throws(() => parseProviderUsage(subject, anthropic + 'data: {"type":"ping"}\n\n'));
});

test("Anthropic final input and cache usage replace initial counters before releasing any reservation", async () => {
  const updated = anthropic.replace('"usage":{"output_tokens":20}', '"usage":{"output_tokens":20,"input_tokens":1000,"cache_read_input_tokens":200,"cache_creation_input_tokens":30}');
  assert.deepEqual(parseProviderUsage(subject, updated), { input: 1000, output: 20, cacheRead: 200, cacheWrite: 30 });
  const budget = new ControlledBudget(); budget.beginSession("b", "subject", subject);
  await dispatchControlledRequest(request, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => new Response(updated, { headers: { "content-type": "text/event-stream" } }) });
  assert.equal(budget.snapshot().chargedNanoUsd, 196500);
});

test("request transport cannot use another active session's cheaper reservation", async () => {
  const budget = new ControlledBudget(); budget.beginSession("j", "judge", judge);
  let calls = 0;
  await assert.rejects(dispatchControlledRequest(request, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return new Response(anthropic); } }));
  assert.equal(calls, 0);
});

test("MiMo thinking uses the shared completion cap without an Anthropic budget_tokens field", async () => {
  const budget = new ControlledBudget(); budget.beginSession("j", "judge", judge);
  let calls = 0;
  const wire = { requestId: "j-r1", url: "https://token-plan-cn.xiaomimimo.com/v1/chat/completions", headers: {}, body: JSON.stringify({ model: "mimo-v2.6-flash", stream: true, max_completion_tokens: 1024, messages: [], stream_options: { include_usage: true }, thinking: { type: "enabled" } }) };
  const body = 'data: {"model":"mimo-v2.6-flash","choices":[{"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20,"total_tokens":120}}\n\ndata: [DONE]\n\n';
  await dispatchControlledRequest(wire, { model: judge, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return new Response(body, { headers: { "content-type": "text/event-stream" } }); } });
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().chargedNanoUsd, 19600);
});

const nativeAvailable = (() => { try { return process.platform === "darwin" && existsSync(join(resolvePiRuntime().readOnlyRoots[0]!, "dist", "index.js")); } catch { return false; } })();
test("evidence persistence failures have a stable first cause and never overwrite a prior evidence record", async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-evidence-existing-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const evidence = join(root, "failure-evidence.json"); writeFileSync(evidence, "IMMUTABLE_PRIOR_EVIDENCE");
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-persistence-existing", prompt: "fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 1000 }, async () => { calls++; throw new Error("MUST_NOT_DISPATCH"); });
    assert.equal(calls, 0);
    assert.equal(result.stderr, "FAILURE_EVIDENCE_WRITE_FAILED");
    assert.equal(result.failureEvidence.firstCause?.code, "FAILURE_EVIDENCE_WRITE_FAILED");
    assert.equal(result.failureEvidence.firstCause?.incidentType, "persistence_error");
    assert.equal(readFileSync(evidence, "utf8"), "IMMUTABLE_PRIOR_EVIDENCE");
    assert.equal(budget.snapshot().state, "stopped");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("catalog drift stops before dispatch, so baseline and P cannot silently use different settings", async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-catalog-drift-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const run = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-catalog", prompt: "fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 1000,
      catalogHashes: { "models.json": "0".repeat(64), "models-store.json": null },
    }, async () => { calls++; throw new Error("MUST_NOT_DISPATCH"); });
    assert.equal(calls, 0);
    assert.equal(run.stderr, "CATALOG_DRIFT");
    assert.equal(budget.snapshot().chargedNanoUsd, 0);
    assert.equal(budget.snapshot().state, "stopped");
    assert.equal(run.failureEvidence.firstCause?.code, "CATALOG_DRIFT");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test("an explicit timeout fails only its sample and preserves any unknown dispatched usage", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-timeout-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-timeout", prompt: "Offline timeout fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 3000 }, async (_url, init) => {
      calls++;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("OFFLINE_ABORT")), { once: true }));
    });
    assert.equal(result.timedOut, true);
    assert.equal(result.isolation.verified, true);
    assert.equal(budget.snapshot().state, "open");
    assert.ok(calls <= 1);
    if (calls) assert.equal(budget.snapshot().unknownRequests, 1);
    assert.equal(budget.snapshot().state, "open");
    budget.beginSession("after", "subject", subject);
    assert.equal(result.failureEvidence.firstCause?.code, "SESSION_TIMEOUT");
    assert.equal(result.failureEvidence.firstCause?.incidentType, "timeout");
    assert.equal(JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8")).firstCause.code, "SESSION_TIMEOUT");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const response of ["response", "response-error"] as const) test(`timeout cleanup preserves a ${response} IPC failure without stopping the batch`, { skip: !nativeAvailable, timeout: 15_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "controlled-timeout-ipc-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget();
  const originalSpawn = childProcess.spawn;
  let injected = 0;
  t.mock.method(childProcess, "spawn", (...args: unknown[]) => {
    const child = Reflect.apply(originalSpawn, childProcess, args) as ReturnType<typeof childProcess.spawn>;
    const originalSend = child.send;
    t.mock.method(child, "send", (...sendArgs: unknown[]) => {
      const message = sendArgs[0] as { type?: string };
      if (message.type === response) {
        injected++;
        const callback = sendArgs[1] as (error: Error) => void;
        queueMicrotask(() => callback(new Error("OFFLINE_CLOSED_IPC_AFTER_TIMEOUT")));
        return false;
      }
      return Reflect.apply(originalSend, child, sendArgs);
    });
    return child;
  });
  syncBuiltinESMExports();
  try {
    const run = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: `offline-timeout-ipc-${response}`, prompt: "Offline timeout cleanup fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 3000 }, async (_url, init) => {
      await new Promise<void>(resolve => init?.signal?.addEventListener("abort", () => resolve(), { once: true }));
      if (response === "response-error") throw new Error("OFFLINE_ABORT");
      return new Response(nativeResponse("Late original response"), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(injected, 1, "the closed-channel callback must be observed during timeout cleanup");
    assert.equal(run.timedOut, true);
    assert.equal(run.stderr, "SESSION_TIMEOUT");
    assert.equal(run.failureEvidence.firstCause?.code, "SESSION_TIMEOUT");
    assert.equal(budget.snapshot().state, "open");
    assert(run.failureEvidence.secondary.some(cause => cause.code === "WORKER_IPC_CLOSED_DURING_CLEANUP"));
    assert.equal(budget.snapshot().sessions[0]?.state, "failed");
    budget.beginSession("next-independent-sample", "subject", subject);
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an active native session IPC failure still stops the batch", { skip: !nativeAvailable, timeout: 15_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "controlled-active-ipc-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget();
  const originalSpawn = childProcess.spawn;
  let injected = 0;
  t.mock.method(childProcess, "spawn", (...args: unknown[]) => {
    const child = Reflect.apply(originalSpawn, childProcess, args) as ReturnType<typeof childProcess.spawn>;
    t.mock.method(child, "send", (_message: unknown, callback: (error: Error) => void) => {
      injected++;
      queueMicrotask(() => callback(new Error("OFFLINE_ACTIVE_IPC_FAILURE")));
      return false;
    });
    return child;
  });
  syncBuiltinESMExports();
  try {
    const run = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-active-ipc", prompt: "Offline active IPC fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => new Response(nativeResponse("Original response"), { headers: { "content-type": "text/event-stream" } }));
    assert.equal(injected, 1);
    assert.equal(run.timedOut, false);
    assert.equal(run.failureEvidence.firstCause?.code, "WORKER_IPC_FAILURE");
    assert.equal(budget.snapshot().state, "stopped");
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("native parent stops and cleans the worker even when ledger persistence fails after HTTP", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-persistence-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0, persists = 0;
  try {
    await assert.rejects(simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-persistence", prompt: "Offline failure fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10_000,
      onLedger: () => { if (++persists >= 3) throw new Error("OFFLINE_DISK_FAILURE"); },
    }, async () => { calls++; return new Response(anthropic, { headers: { "content-type": "text/event-stream" } }); }));
    assert.equal(calls, 1);
    assert.equal(budget.snapshot().state, "stopped");
    assert.equal(JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8")).firstCause.code, "LEDGER_PERSISTENCE_FAILED");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function nativeResponse(content: string, tool?: { id: string; name: string; input: unknown }): string {
  const blocks = tool ? [
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: tool.id, name: tool.name, input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } },
  ] : [
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: content } },
  ];
  return [
    { type: "message_start", message: { id: "offline-fixture", type: "message", role: "assistant", model: "MiniMax-M3.1-Flash", content: [], usage: { input_tokens: 100, output_tokens: 0 } } },
    ...blocks, { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ].map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

function nativeJudgeResponse(output: string): string {
  return [
    { model: "mimo-v2.6-flash", choices: [{ index: 0, delta: { role: "assistant", content: output }, finish_reason: null }] },
    { model: "mimo-v2.6-flash", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { model: "mimo-v2.6-flash", choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
  ].map(data => `data: ${JSON.stringify(data)}\n\n`).join("") + "data: [DONE]\n\n";
}

test("native sessions retain thinking and request their model-native maximum output", { skip: !nativeAvailable, timeout: 20_000 }, async () => {
  for (const spec of [
    { role: "judge" as const, model: judge, thinking: "enabled", cap: 131072 },
    { role: "subject" as const, model: subject, thinking: "adaptive", cap: 524288 },
  ]) {
    const root = mkdtempSync(join(tmpdir(), "controlled-thinking-mode-"));
    const workspace = join(root, "workspace"); mkdirSync(workspace);
    const budget = new ControlledBudget(); let calls = 0;
    let payload: { model: string; thinking?: { type?: string }; max_tokens?: number; max_completion_tokens?: number } | undefined;
    const output = '{"verdict":"tie","scoreA":80,"scoreB":80,"confidence":0.8,"reason":"Same fixture quality."}';
    try {
      const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: `offline-thinking-${spec.role}`, prompt: "Return the fixture comparison result.", model: spec.model, role: spec.role, skillPaths: [], budget, timeoutMs: 10_000 }, async (_url, init) => {
        calls++; payload = JSON.parse(String(init?.body));
        return new Response(spec.role === "judge" ? nativeJudgeResponse(output) : nativeResponse(output), { headers: { "content-type": "text/event-stream" } });
      });
      assert.equal(calls, 1);
      assert.equal(result.exitCode, 0);
      assert.equal(result.metrics.output, output);
      assert.equal(payload?.thinking?.type, spec.thinking);
      assert.equal(payload?.model, spec.model.split("/")[1]);
      assert.equal(payload?.max_completion_tokens ?? payload?.max_tokens, spec.cap);
      assert.equal(budget.snapshot().state, "open");
      assert.equal(budget.snapshot().requests[0]?.state, "settled");
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

for (const outcome of ["corrected", "invalid", "empty"] as const) test(`native judge keeps one session and both replies when JSON correction is ${outcome}`, { skip: !nativeAvailable, timeout: 20_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-judge-json-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const invalid = '{"verdict":"win","scoreA":45,"scoreB":95,"confidence":0.9,"reason":"B included "required-field"."}';
  const fixed = JSON.stringify({ verdict: "win", scoreA: 45, scoreB: 95, confidence: 0.9, reason: 'B included "required-field".' });
  const final = outcome === "corrected" ? fixed : outcome === "empty" ? "" : invalid;
  const payloads: Array<{ messages: Array<{ role: string; content: unknown }> }> = [];
  const budget = new ControlledBudget();
  try {
    const run = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "judge-json-fixture", prompt: "Compare anonymous A and B.", model: judge, role: "judge", skillPaths: [], budget }, async (_url, init) => {
      payloads.push(JSON.parse(String(init?.body)));
      return new Response(nativeJudgeResponse(payloads.length === 1 ? invalid : final), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(payloads.length, 2);
    assert(payloads[1]!.messages.some(message => message.role === "assistant" && (typeof message.content === "string" ? message.content === invalid : JSON.stringify(message.content).includes(JSON.stringify(invalid)))));
    assert(payloads[1]!.messages.some(message => message.role === "user" && JSON.stringify(message.content).includes("Compare anonymous A and B.")));
    const journal = readFileSync(join(root, "events.partial.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(journal, run.events);
    assert.equal(journal.filter(event => event.type === "judge_json_repair_requested").length, 1);
    assert.equal(run.exitCode, outcome === "empty" ? 1 : 0);
    assert.equal(run.metrics.output, final || invalid);
    assert.equal(parseJudgeResponse(run.metrics.output, { judgeDir: root, task: "", outputA: "", outputB: "", runId: "judge-json-fixture" }).verdict, outcome === "corrected" ? "win" : "not_judged");
    assert.equal(budget.snapshot().sessions.length, 1);
    assert.deepEqual(budget.snapshot().requests.map(request => request.usageStatus), ["reported", "reported"]);
    assert.equal(budget.snapshot().state, "open");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const { deltaCount, text } of [{ deltaCount: 128, text: "" }, { deltaCount: 10_001, text: "" }, { deltaCount: 1024, text: "汉字" }]) test(`native event journal keeps ${deltaCount} ${text ? "growing CJK" : "empty"} streamed records with linear filesystem bytes`, { skip: !nativeAvailable, timeout: 20_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "controlled-event-journal-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const journal = join(root, "events.partial.jsonl"), legacy = join(root, "events.partial.json");
  const originalWrite = fs.writeFileSync, originalAppend = fs.appendFileSync;
  let writtenBytes = 0, insideAppend = false, calls = 0;
  // Count attempted payload bytes. Discard the obsolete full-history sink so a
  // regression reports its write amplification without reproducing it on disk.
  t.mock.method(fs, "writeFileSync", (path: Parameters<typeof fs.writeFileSync>[0], data: Parameters<typeof fs.writeFileSync>[1], options?: Parameters<typeof fs.writeFileSync>[2]) => {
    if (!insideAppend && (path === journal || path === legacy)) writtenBytes += Buffer.byteLength(data as string);
    if (path !== legacy) originalWrite(path, data, options);
  });
  t.mock.method(fs, "appendFileSync", (path: Parameters<typeof fs.appendFileSync>[0], data: Parameters<typeof fs.appendFileSync>[1], options?: Parameters<typeof fs.appendFileSync>[2]) => {
    if (path === journal || path === legacy) writtenBytes += Buffer.byteLength(data as string);
    insideAppend = true;
    try { originalAppend(path, data, options); } finally { insideAppend = false; }
  });
  syncBuiltinESMExports();
  try {
    // Empty legal deltas exercise both raw-provider and native message-update
    // events without making every SDK message snapshot grow with the stream.
    const deltas = Array.from({ length: deltaCount }, (_, seq) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text }, seq })}\n\n`).join("");
    const body = nativeResponse("Journal fixture complete.").replace("event: content_block_stop", deltas + "event: content_block_stop");
    const budget = new ControlledBudget();
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: `offline-journal-${deltaCount}`, prompt: "Offline journal fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 15_000 }, async () => {
      calls++;
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(result.exitCode, 0);
    assert.equal(calls, 1);
    assert.equal(result.metrics.output, "Journal fixture complete." + text.repeat(deltaCount));
    assert.ok(writtenBytes <= Buffer.byteLength(JSON.stringify(result.events)) * 1.01,
      `event persistence wrote ${writtenBytes} bytes for ${Buffer.byteLength(JSON.stringify(result.events))} final bytes`);
    const persisted = readFileSync(journal, "utf8");
    assert.ok(persisted.endsWith("\n"), "the final record is complete even without a final array rewrite");
    assert.deepEqual(persisted.trimEnd().split("\n").map(line => JSON.parse(line)), result.events);
    assert.equal(writtenBytes, Buffer.byteLength(persisted));
    assert.equal(fs.statSync(journal).mode & 0o777, 0o600);
    const streamed = result.events.filter(event => event.type === "provider_stream_event" && typeof (event.data as { seq?: number })?.seq === "number");
    assert.equal(streamed.length, deltaCount);
    for (const [index, event] of streamed.entries()) assert.equal((event.data as { seq: number }).seq, index);
    assert.equal(existsSync(legacy), false);
    assert.equal(existsSync(join(workspace, "events.partial.jsonl")), false);
    t.diagnostic(JSON.stringify({ streamedDeltas: deltaCount, rawEvents: result.events.length, writtenBytes, finalEventBytes: Buffer.byteLength(JSON.stringify(result.events)) }));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an event journal append failure keeps its cause and prevents followup HTTP", { skip: !nativeAvailable, timeout: 15_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "controlled-journal-write-failure-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const journal = join(root, "events.partial.jsonl");
  const originalAppend = fs.appendFileSync;
  let calls = 0, failAppend = false;
  t.mock.method(fs, "appendFileSync", (path: Parameters<typeof fs.appendFileSync>[0], data: Parameters<typeof fs.appendFileSync>[1], options?: Parameters<typeof fs.appendFileSync>[2]) => {
    if (path === journal && failAppend) throw Object.assign(new Error("OFFLINE_DISK_FULL"), { code: "ENOSPC" });
    originalAppend(path, data, options);
  });
  syncBuiltinESMExports();
  try {
    const budget = new ControlledBudget();
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-journal-write-failure", prompt: "Offline journal failure fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10_000 }, async () => {
      calls++; failAppend = true;
      return new Response(nativeResponse("", { id: "would-require-followup", name: "bash", input: { command: "false" } }), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 1);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.failureEvidence.firstCause?.code, "EVENT_EVIDENCE_WRITE_FAILED");
    assert.equal(result.failureEvidence.firstCause?.incidentType, "persistence_error");
    const prefix = readFileSync(journal, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(prefix, result.events.slice(0, prefix.length));
    assert.equal(result.failureEvidence.firstCause?.eventIndex, prefix.length);
    assert.equal(JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8")).firstCause.code, "EVENT_EVIDENCE_WRITE_FAILED");
    assert.equal(budget.snapshot().state, "stopped");
    assert.throws(() => budget.beginSession("after-journal-failure", "subject", subject));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a broken provider stream is preserved while the SDK recovers natively", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-journal-broken-stream-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  const partial = nativeResponse("unfinished").split("event: message_delta")[0]!;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-journal-broken-stream", prompt: "Offline partial stream fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10_000 }, async () => {
      calls++;
      if (calls > 1) return new Response(nativeResponse("Recovered after stream close."), { headers: { "content-type": "text/event-stream" } });
      let emitted = false;
      return new Response(new ReadableStream<Uint8Array>({ pull(controller) {
        if (!emitted) { emitted = true; controller.enqueue(new TextEncoder().encode(partial)); }
        else controller.error(new Error("OFFLINE_STREAM_CLOSED"));
      } }), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 2);
    assert.equal(result.exitCode, 0);
    assert.equal(result.metrics.output, "Recovered after stream close.");
    const journal = readFileSync(join(root, "events.partial.jsonl"), "utf8");
    assert.ok(journal.endsWith("\n"));
    assert.deepEqual(journal.trimEnd().split("\n").map(line => JSON.parse(line)), result.events);
    assert.equal(fs.readdirSync(root).filter(name => /^wire-.*\.partial\.sse$/.test(name)).length, 2);
    const wire = "wire-offline-journal-broken-stream-r1.partial.sse";
    assert.equal(readFileSync(join(root, wire), "utf8"), partial);
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    assert.equal(budget.snapshot().knownChargedNanoUsd, 27000);
    assert.equal(budget.snapshot().unknownRequests, 1);
    assert.equal(budget.snapshot().state, "open");
    assert.equal(result.failureEvidence.firstCause, null);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an unexpectedly killed native worker leaves every received event as a complete journal record", { skip: !nativeAvailable, timeout: 15_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "controlled-journal-worker-close-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  // A native read blocks on this FIFO without starting any detached tool child.
  const fifo = join(workspace, "offline-unwritten-fifo");
  childProcess.execFileSync("/usr/bin/mkfifo", [fifo]);
  const originalSpawn = childProcess.spawn;
  let worker: ReturnType<typeof childProcess.spawn> | undefined, calls = 0, killed = false;
  t.mock.method(childProcess, "spawn", (...args: unknown[]) => {
    assert.equal((args[2] as { cwd?: string })?.cwd, workspace);
    worker = Reflect.apply(originalSpawn, childProcess, args) as ReturnType<typeof childProcess.spawn>;
    return worker;
  });
  syncBuiltinESMExports();
  try {
    const budget = new ControlledBudget();
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-journal-worker-close", prompt: "Offline worker crash fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10_000,
      onEvent: event => {
        if (event.type === "tool_execution_start" && event.toolCallId === "crash-while-reading") {
          assert.ok(worker?.pid);
          process.kill(-worker.pid, "SIGKILL"); killed = true;
        }
      },
    }, async () => {
      calls++;
      return new Response(nativeResponse("", { id: "crash-while-reading", name: "read", input: { path: fifo } }), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(killed, true);
    assert.equal(worker?.signalCode, "SIGKILL");
    assert.equal(calls, 1);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.timedOut, false);
    assert.ok(result.events.some(event => event.type === "tool_execution_start"));
    assert.equal(result.events.some(event => event.type === "tool_execution_end"), false);
    const journal = readFileSync(join(root, "events.partial.jsonl"), "utf8");
    assert.ok(journal.endsWith("\n"));
    assert.deepEqual(journal.trimEnd().split("\n").map(line => JSON.parse(line)), result.events);
    assert.equal(budget.snapshot().state, "stopped");
    assert.equal(budget.snapshot().chargedNanoUsd, 27_000);
  } finally {
    if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
      try { process.kill(-worker.pid, "SIGKILL"); } catch { /* already exited */ }
    }
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a denied read remains observable and the native session can finish through the broker", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-read-recovery-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const hidden = join(root, "private.txt"); writeFileSync(hidden, "PRIVATE_READ_CANARY");
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-read-recovery", prompt: "Offline read recovery fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.ok(!JSON.stringify(payload).includes("PRIVATE_READ_CANARY"));
      return new Response(calls === 1 ? nativeResponse("", { id: "denied-read", name: "read", input: { path: hidden } }) : nativeResponse("Recovered without the private file."), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 2);
    assert.equal(result.exitCode, 0);
    assert.equal(result.metrics.output, "Recovered without the private file.");
    assert.ok(result.events.some(event => event.type === "tool_execution_end" && event.isError === true));
    assert.equal(result.failureEvidence.firstCause, null);
    assert.equal(result.failureEvidence.observations[0]?.kind, "recoverable_tool_error");
    assert.equal(budget.snapshot().state, "open");
    assert.equal(budget.snapshot().requests.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const failure of ["401", "usage", "timeout"] as const) test(`tool correction followed by ${failure} remains sample-local`, { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-recovery-final-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: `offline-recovery-${failure}`, prompt: "Offline correction followed by a provider condition", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: failure === "timeout" ? 4000 : 10000 }, async (_url, init) => {
      calls++;
      if (calls === 1) return new Response(nativeResponse("", { id: "ordinary-error", name: "bash", input: { command: "false" } }), { headers: { "content-type": "text/event-stream" } });
      if (failure === "401") return new Response(JSON.stringify({ error: { type: "authentication_error", message: "offline authentication failure" } }), { status: 401 });
      if (failure === "usage") return new Response(nativeResponse("Native answer despite missing usage.").replace('"input_tokens":100,', ""), { headers: { "content-type": "text/event-stream" } });
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("OFFLINE_ABORTED")), { once: true }));
    });
    assert.equal(calls, 2);
    assert.equal(result.failureEvidence.observations[0]?.kind, "recoverable_tool_error");
    assert.equal(budget.snapshot().state, "open");
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    assert.equal(budget.snapshot().knownChargedNanoUsd, 27000);
    assert.equal(budget.snapshot().requests[1]?.usageStatus, "unknown");
    if (failure === "usage") {
      assert.equal(result.exitCode, 0);
      assert.equal(result.failureEvidence.firstCause, null);
    } else {
      assert.notEqual(result.exitCode, 0);
      assert.equal(result.failureEvidence.firstCause?.code, failure === "timeout" ? "SESSION_TIMEOUT" : "NATIVE_SESSION_FAILED");
    }
    budget.beginSession("next-independent-sample", "subject", subject);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an ordinary task prompt and missing-definition answer remain normal execution", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-prompt-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-task-prompt", prompt: "Underspecified offline fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async (_url, init) => {
      calls++;
      const payload = JSON.parse(String(init?.body));
      assert.ok(JSON.stringify(payload.messages).includes("Underspecified offline fixture"));
      return new Response(nativeResponse("缺少流程定义，无法确定交付规则。"), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 1);
    assert.equal(result.exitCode, 0);
    assert.equal(result.metrics.output, "缺少流程定义，无法确定交付规则。");
    assert.equal(result.failureEvidence.firstCause, null);
    assert.equal(budget.snapshot().sessions[0]?.state, "completed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a normal provider completion with empty output fails only this sample and retains usage", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-empty-output-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-empty-output", prompt: "Offline empty output fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      return new Response(nativeResponse(""), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 1);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.stderr, "SESSION_FAILED_OR_EMPTY");
    assert.equal(budget.snapshot().state, "open");
    assert.equal(budget.snapshot().sessions[0]?.state, "failed");
    assert.equal(budget.snapshot().requests[0]?.state, "settled");
    assert.equal(budget.snapshot().chargedNanoUsd, 27000);
    assert.equal(result.failureEvidence.firstCause?.code, "SESSION_FAILED_OR_EMPTY");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("exit-zero compound shell denial remains observational", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-compound-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-compound", prompt: "Offline compound status fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      const body = calls === 1 ? nativeResponse("", { id: "compound", name: "bash", input: { command: `ls '${root}'; printf '{}\\n'` } }) : nativeResponse("fixture finished");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 2);
    assert.equal(result.exitCode, 0);
    assert.equal(result.failureEvidence.firstCause, null);
    assert.equal(result.failureEvidence.observations.length, 1);
    assert.equal(result.failureEvidence.observations[0]?.authoritativeFailure, false);
    assert.equal(result.failureEvidence.observations.find(row => row.kind === "successful_bash_output_mentions_permission_denial")?.exitCode, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native tools cannot overwrite controller evidence and denied writes can be corrected", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-failure-tamper-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-failure-tamper", prompt: "Offline evidence boundary fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      return new Response(calls === 1 ? nativeResponse("", { id: "evidence-tamper", name: "write", input: { path: join(root, "failure-evidence.json"), content: "OVERWRITE_PRIVATE_EVIDENCE" } }) : nativeResponse("Recovered without altering evidence."), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 2);
    assert.equal(result.exitCode, 0);
    const captured = JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8"));
    assert.equal(captured.firstCause, null);
    assert.equal(captured.observations[0].toolCallId, "evidence-tamper");
    assert.equal(result.events[captured.observations[0].eventIndex]?.isError, true);
    assert.ok(!JSON.stringify(captured).includes("OVERWRITE_PRIVATE_EVIDENCE"));
    assert.equal(budget.snapshot().state, "open");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("terminal native authentication failure retains raw cause and unknown usage without stopping other samples", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-http-cause-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-http-cause", prompt: "Offline auth error fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      return new Response(JSON.stringify({ error: { type: "authentication_error", message: "PRIVATE_RESPONSE_BODY" } }), { status: 401 });
    });
    assert.equal(calls, 1);
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.failureEvidence.firstCause?.code, "NATIVE_SESSION_FAILED");
    assert.equal(budget.snapshot().state, "open");
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    assert.equal(budget.snapshot().requests[0]?.usageStatus, "unknown");
    assert.equal(JSON.parse(readFileSync(join(root, "wire-offline-http-cause-r1.json"), "utf8")).response.status, 401);
    assert.ok(!JSON.stringify(result.failureEvidence).includes("PRIVATE_RESPONSE_BODY"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("an event evidence write failure stops with a persistence cause instead of being mislabeled invalid JSON", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-event-persistence-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-event-persistence", prompt: "Offline event persistence fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      if (calls === 1) writeFileSync(join(root, ".failure-evidence.tmp"), "PRESERVED_CONFLICT", { flag: "wx" });
      return new Response(calls === 1 ? nativeResponse("", { id: "observation", name: "bash", input: { command: "printf 'Permission denied\\n'" } }) : nativeResponse("Completed before derived evidence persistence."), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 2);
    assert.equal(result.failureEvidence.firstCause?.code, "FAILURE_EVIDENCE_WRITE_FAILED");
    assert.equal(result.failureEvidence.firstCause?.incidentType, "persistence_error");
    assert.notEqual(result.exitCode, 0);
    assert.equal(readFileSync(join(root, ".failure-evidence.tmp"), "utf8"), "PRESERVED_CONFLICT");
    assert.equal(budget.snapshot().state, "stopped");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native tools cannot overwrite the controller's original wire accounting evidence", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-tamper-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  const evidence = join(root, "wire-offline-tamper-r1.json");
  const payload = [
    { type: "message_start", message: { id: "fixture", type: "message", role: "assistant", model: "MiniMax-M3.1-Flash", content: [], usage: { input_tokens: 100, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tamper", name: "write", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: evidence, content: "OVERRIDE" }) } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ].map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-tamper", prompt: "Offline tool fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => { calls++; return new Response(calls === 1 ? payload : nativeResponse("Recovered without changing original wire evidence."), { headers: { "content-type": "text/event-stream" } }); });
    assert.equal(calls, 2, "Tool failure must be returned to the agent for correction");
    assert.equal(result.exitCode, 0);
    assert.ok(result.events.some(event => event.type === "tool_execution_end" && event.isError === true));
    assert.equal(JSON.parse(readFileSync(evidence, "utf8")).response.body, payload);
    assert.equal(existsSync(join(workspace, "events.partial.json")), false);
    assert.equal(existsSync(join(workspace, "events.partial.jsonl")), false);
    const failure = JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8"));
    assert.equal(failure.firstCause, null);
    assert.equal(failure.observations[0].toolCallId, "tamper");
    assert.equal(failure.observations[0].toolName, "write");
    assert.equal(result.events[failure.observations[0].eventIndex]?.isError, true);
    assert.equal(result.failureEvidence.firstCause, null);
    assert.equal(existsSync(join(workspace, "failure-evidence.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("native SDK retries HTTP 429 and recovers without a fatal Host cause", { skip: !nativeAvailable, timeout: 20_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "native-provider-recovery-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "native-provider-recovery", prompt: "Offline SDK retry fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 15_000 }, async () => {
      calls++;
      return calls === 1
        ? new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "rate limit" } }), { status: 429, headers: { "content-type": "application/json", "retry-after": "0" } })
        : new Response(nativeResponse("Recovered by native Pi retry."), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.metrics.output, "Recovered by native Pi retry.");
    assert.equal(calls, 2);
    assert.ok(result.events.some(event => event.type === "auto_retry_start"));
    assert.equal(result.failureEvidence.firstCause, null);
    assert.ok(result.failureEvidence.observations.some(row => row.kind === "native_recovery_event"));
    assert.equal(budget.snapshot().state, "open");
    assert.equal(budget.snapshot().requests[0]?.usageStatus, "unknown");
    assert.equal(budget.snapshot().requests[1]?.state, "settled");
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    assert.equal(budget.snapshot().knownChargedNanoUsd, 27000);
    const original = JSON.parse(readFileSync(join(root, "wire-native-provider-recovery-r1.json"), "utf8"));
    assert.equal(original.response.status, 429);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native-window requests are not rejected by the former byte-count input or SSE limits", async () => {
  const budget = new ControlledBudget(); budget.beginSession("large-wire", "subject", subject);
  const large = { ...request, body: JSON.stringify({ model: "MiniMax-M3.1-Flash", max_tokens: 524288, stream: true, messages: [{ role: "user", content: "汉".repeat(350_000) }] }) };
  const response = anthropic.replace('data: {"type":"message_delta"', `data: ${JSON.stringify({ type: "ping", padding: "x".repeat(16 * 1024 * 1024) })}\n\ndata: {"type":"message_delta"`);
  let calls = 0;
  const result = await dispatchControlledRequest(large, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return new Response(response); } });
  assert.equal(calls, 1);
  assert.equal(result.body, response);
  assert.equal(budget.snapshot().requests[0]?.state, "settled");
});


test("recoverable observations do not rewrite growing derived failure history per event", { skip: !nativeAvailable, timeout: 20_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "native-observation-journal-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const originalWrite = fs.writeFileSync; let snapshots = 0;
  t.mock.method(fs, "writeFileSync", (path: Parameters<typeof fs.writeFileSync>[0], data: Parameters<typeof fs.writeFileSync>[1], options?: Parameters<typeof fs.writeFileSync>[2]) => {
    if (typeof data === "string" && data.startsWith("{")) {
      try { const value = JSON.parse(data); if (value.schemaVersion === 1 && Array.isArray(value.observations) && "firstCause" in value) snapshots++; } catch { /* other evidence */ }
    }
    originalWrite(path, data, options);
  });
  syncBuiltinESMExports();
  const toolCount = 24;
  const blocks = Array.from({ length: toolCount }, (_, index) => [
    { type: "content_block_start", index, content_block: { type: "tool_use", id: `ordinary-${index}`, name: "bash", input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: "false" }) } },
    { type: "content_block_stop", index },
  ]).flat();
  const first = [
    { type: "message_start", message: { id: "offline-multi-tool", type: "message", role: "assistant", model: "MiniMax-M3.1-Flash", content: [], usage: { input_tokens: 100, output_tokens: 0 } } },
    ...blocks,
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ].map(data => `event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`).join("");
  let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-many-observations", prompt: "Offline simultaneous ordinary tool errors", model: subject, role: "subject", skillPaths: [], budget: new ControlledBudget() }, async () => {
      calls++; return new Response(calls === 1 ? first : nativeResponse("Recovered from all ordinary tool errors."), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(result.exitCode, 0);
    assert.equal(calls, 2);
    assert.equal(result.failureEvidence.firstCause, null);
    assert.equal(result.failureEvidence.observations.filter(row => row.kind === "recoverable_tool_error").length, toolCount);
    assert.equal(snapshots, 2, "derived snapshot is initial + final; each observation lives in the raw append-only stream");
    const saved = JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8"));
    assert.deepEqual(saved, result.failureEvidence);
    const raw = readFileSync(join(root, "events.partial.jsonl"), "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(raw, result.events);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true }); }
});

for (const role of ["subject", "judge"] as const) test(`explicit ${role} response model drift remains a Host identity failure`, { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "native-response-model-drift-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  const wrongSubject = nativeResponse("Different model.").replace('"model":"MiniMax-M3.1-Flash"', '"model":"MiniMax-M3"');
  // The first OpenAI frame is correct: a later explicit model switch must also
  // be rejected, even if the native SDK preserves only its first responseModel.
  const wrongJudge = [
    { model: "mimo-v2.6-flash", choices: [{ index: 0, delta: { role: "assistant", content: "partial" }, finish_reason: null }] },
    { model: "different-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } },
  ].map(data => `data: ${JSON.stringify(data)}\n\n`).join("") + "data: [DONE]\n\n";
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: `native-model-drift-${role}`, prompt: "Offline model identity fixture", model: role === "subject" ? subject : judge, role, skillPaths: [], budget }, async () => {
      calls++; return new Response(role === "subject" ? wrongSubject : wrongJudge, { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 1);
    assert.notEqual(result.exitCode, 0);
    assert.equal(budget.snapshot().state, "stopped");
    assert.equal(result.failureEvidence.firstCause?.code, "PROVIDER_MODEL_MISMATCH");
    assert.equal(budget.snapshot().requests[0]?.usageStatus, "unknown");
    assert.equal(JSON.parse(readFileSync(join(root, `wire-native-model-drift-${role}-r1.json`), "utf8")).response.status, 200);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
