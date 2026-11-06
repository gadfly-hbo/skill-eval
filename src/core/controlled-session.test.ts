import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ControlledBudget } from "./controlled-budget.ts";
import { resolvePiRuntime } from "./isolation.ts";
import { dispatchControlledRequest, parseProviderUsage, simulateControlledSession } from "./controlled-session.ts";

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

test("failure to persist a reserved charge prevents HTTP and conservatively retains the reservation", async () => {
  const budget = new ControlledBudget(); budget.beginSession("disk-failed", "subject", subject);
  let calls = 0;
  await assert.rejects(dispatchControlledRequest(request, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal,
    onLedger: () => { throw new Error("OFFLINE_DISK_FAILURE"); },
    fetcher: async () => { calls++; throw new Error("MUST_NOT_DISPATCH"); },
  }));
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().state, "stopped");
  assert.equal(budget.snapshot().chargedNanoUsd, 152_457_600);
  assert.equal(budget.snapshot().requests[0]?.state, "failed");
});

test("routing or wire cap changes never reach HTTP and stop the entire batch", async () => {
  for (const changed of [
    { ...request, url: "https://example.com/v1/messages" },
    { ...request, body: request.body.replace("4096", "4097") },
    { ...request, body: request.body.replace("MiniMax-M3.1-Flash", "MiniMax-M3") },
    { ...request, body: request.body.replace('"stream":true', '"stream":false') },
    { ...request, body: request.body.replace('"messages":[]', '"messages":[],"mcp_servers":[{"url":"https://example.com"}]') },
    { ...request, body: request.body.replace('"messages":[]', '"messages":[{"content":[{"type":"image","source":{}}]}]') },
  ]) {
    const budget = new ControlledBudget(); budget.beginSession("b", "subject", subject);
    let calls = 0;
    await assert.rejects(dispatchControlledRequest(changed, { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return new Response(anthropic); } }));
    assert.equal(calls, 0);
    assert.throws(() => budget.reserve("after-failure"));
  }
});

test("401, network failure and missing usage retain the reservation and prohibit a second HTTP request", async () => {
  for (const fetcher of [
    async () => new Response("PRIVATE_ERROR_TEXT", { status: 401 }),
    async () => { throw new Error("PRIVATE_NETWORK_TEXT"); },
    async () => new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } }),
  ]) {
    const budget = new ControlledBudget(); budget.beginSession("b", "subject", subject);
    let calls = 0;
    const options = { model: subject, budget, apiKey: "fixture-only", signal: new AbortController().signal, fetcher: async () => { calls++; return fetcher(); } };
    await assert.rejects(dispatchControlledRequest(request, options), (error: Error) => !/PRIVATE/.test(error.message));
    await assert.rejects(dispatchControlledRequest({ ...request, requestId: "retry" }, options));
    assert.equal(calls, 1);
    assert.match(JSON.stringify(budget.snapshot()), /152457600/);
  }
});

test("raw usage requires completed streams, bounded integer counts and normal completion", () => {
  assert.deepEqual(parseProviderUsage(subject, anthropic), { input: 100, output: 20, cacheRead: 0, cacheWrite: 0 });
  for (const bad of [anthropic.replace('"input_tokens":100', '"input_tokens":-1'), anthropic.replace('"output_tokens":20', '"output_tokens":0.5'), anthropic.replace("end_turn", "max_tokens"), anthropic.replace('data: {"type":"message_stop"}\n\n', "")]) {
    assert.throws(() => parseProviderUsage(subject, bad));
  }
  const openai = 'data: {"model":"mimo-v2.6-flash","choices":[{"finish_reason":"stop"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":30,"completion_tokens":10,"prompt_tokens_details":{"cached_tokens":20}}}\n\ndata: [DONE]\n\n';
  assert.deepEqual(parseProviderUsage(judge, openai), { input: 10, output: 10, cacheRead: 20, cacheWrite: 0 });
  assert.throws(() => parseProviderUsage(judge, openai.replace("stop", "length")));
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
test("native controlled parent aborts on timeout and retains any dispatched reservation", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
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
    assert.equal(budget.snapshot().state, "stopped");
    assert.ok(calls <= 1);
    if (calls) assert.equal(budget.snapshot().chargedNanoUsd, 152457600);
    assert.throws(() => budget.beginSession("after", "subject", subject));
    assert.equal(result.failureEvidence.firstCause?.code, "SESSION_TIMEOUT");
    assert.equal(result.failureEvidence.firstCause?.incidentType, "timeout");
    assert.equal(JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8")).firstCause.code, "SESSION_TIMEOUT");
  } finally { rmSync(root, { recursive: true, force: true }); }
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

test("a normal provider completion with empty final output stops execution and retains its usage", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
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
    assert.equal(budget.snapshot().state, "stopped");
    assert.equal(budget.snapshot().requests[0]?.state, "settled");
    assert.equal(budget.snapshot().chargedNanoUsd, 27000);
    assert.equal(result.failureEvidence.firstCause?.code, "SESSION_FAILED_OR_EMPTY");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("exit-zero compound shell denial remains observational and does not change the strict native error gate", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
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
    assert.equal(result.failureEvidence.observations[0]?.exitCode, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native tools cannot overwrite first-cause evidence and a real tool failure still prevents all followup HTTP", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-failure-tamper-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-failure-tamper", prompt: "Offline evidence boundary fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      return new Response(nativeResponse("", { id: "evidence-tamper", name: "write", input: { path: join(root, "failure-evidence.json"), content: "OVERWRITE_PRIVATE_EVIDENCE" } }), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 1);
    assert.notEqual(result.exitCode, 0);
    const captured = JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8"));
    assert.equal(captured.firstCause.code, "TOOL_EXECUTION_FAILED");
    assert.equal(captured.firstCause.toolCallId, "evidence-tamper");
    assert.equal(result.events[captured.firstCause.eventIndex]?.type, "tool_execution_end");
    assert.ok(!JSON.stringify(captured).includes("OVERWRITE_PRIVATE_EVIDENCE"));
    assert.throws(() => budget.beginSession("later", "subject", subject));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("native broker failure records the HTTP cause before generic worker termination and retains the full charge", { skip: !nativeAvailable, timeout: 15_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-parent-http-cause-"));
  const workspace = join(root, "workspace"); mkdirSync(workspace);
  const budget = new ControlledBudget(); let calls = 0;
  try {
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-http-cause", prompt: "Offline auth error fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => {
      calls++;
      return new Response("PRIVATE_RESPONSE_BODY", { status: 401 });
    });
    assert.equal(calls, 1);
    assert.equal(result.failureEvidence.firstCause?.code, "PROVIDER_HTTP_401");
    assert.equal(result.failureEvidence.firstCause?.incidentType, "request_error");
    assert.equal(result.failureEvidence.firstCause?.eventIndex, null);
    assert.equal(budget.snapshot().chargedNanoUsd, 152457600);
    assert.equal(result.failureEvidence.secondary.some(row => row.code === "REQUEST_ABORTED"), true);
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
      writeFileSync(join(root, ".failure-evidence.tmp"), "PRESERVED_CONFLICT", { flag: "wx" });
      return new Response(nativeResponse("", { id: "observation", name: "bash", input: { command: "printf 'Permission denied\\n'" } }), { headers: { "content-type": "text/event-stream" } });
    });
    assert.equal(calls, 1);
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
    const result = await simulateControlledSession({ workspaceRoot: workspace, home: root, sessionId: "offline-tamper", prompt: "Offline tool fixture", model: subject, role: "subject", skillPaths: [], budget, timeoutMs: 10000 }, async () => { calls++; return new Response(payload, { headers: { "content-type": "text/event-stream" } }); });
    assert.equal(calls, 1, "Tool failure must not trigger a repair request");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.events.some(event => event.type === "tool_execution_end" && event.isError === true));
    assert.equal(JSON.parse(readFileSync(evidence, "utf8")).response.body, payload);
    assert.equal(existsSync(join(workspace, "events.partial.json")), false);
    const failure = JSON.parse(readFileSync(join(root, "failure-evidence.json"), "utf8"));
    assert.equal(failure.firstCause.code, "TOOL_EXECUTION_FAILED");
    assert.equal(failure.firstCause.toolCallId, "tamper");
    assert.equal(failure.firstCause.toolName, "write");
    assert.equal(result.events[failure.firstCause.eventIndex]?.type, "tool_execution_end");
    assert.equal(result.failureEvidence.firstCause?.toolCallId, "tamper");
    assert.equal(existsSync(join(workspace, "failure-evidence.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
