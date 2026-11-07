import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { ControlledBudget, CONTROLLED_BUDGET_POLICY, type BudgetUpdate } from "./controlled-budget.ts";
import { createControlledExecution, createLedgerPersistence, validateControlledPlan } from "./execution.ts";
import type { PiRunOptions } from "./pi.ts";
import { resolvePiRuntime } from "./isolation.ts";

// Parent-side test guard: every HTTP response must come from an explicit fixture.
globalThis.fetch = async () => { throw new Error("REAL_PROVIDER_FORBIDDEN_IN_OFFLINE_TEST"); };

const model = CONTROLLED_BUDGET_POLICY.models.subject.model;
const judgeModel = CONTROLLED_BUDGET_POLICY.models.judge.model;
const nativeLimits = {
  subject: { contextWindow: CONTROLLED_BUDGET_POLICY.models.subject.contextWindow, maxOutputTokens: CONTROLLED_BUDGET_POLICY.models.subject.maxOutputTokens },
  judge: { contextWindow: CONTROLLED_BUDGET_POLICY.models.judge.contextWindow, maxOutputTokens: CONTROLLED_BUDGET_POLICY.models.judge.maxOutputTokens },
};
const plan = { model, judgeModel, plannedSessions: 2, nativeLimits };
const nativeAvailable = process.platform === "darwin" && (() => {
  try { return existsSync(join(resolvePiRuntime().readOnlyRoots[0]!, "dist", "index.js")); }
  catch { return false; }
})();

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "controlled-execution-"));
  const runRoot = join(root, "run"), home = join(root, "source-home");
  const workspaceRoot = join(runRoot, "cases", "one", "workspace");
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const request: PiRunOptions = { model, workspaceRoot, sessionId: "fixture", prompt: "Offline fixture" };
  return { root, runRoot, home, workspaceRoot, request, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("controlled plan rejects unknown models and invalid counts before directories or source-home access", () => {
  const root = mkdtempSync(join(tmpdir(), "controlled-pure-plan-"));
  const runRoot = join(root, "never-created");
  let homeReads = 0;
  try {
    for (const changed of [
      { model: "minimax-cn/MiniMax-M3" }, { judgeModel: model },
      ...[0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(plannedSessions => ({ plannedSessions })),
    ]) {
      assert.throws(() => createControlledExecution({ ...plan, ...changed, runRoot,
        get home(): string { homeReads++; throw new Error("MUST_NOT_READ_SOURCE_HOME"); },
      }), /CONTROLLED_(MODEL_PROFILE_MISMATCH|SESSION_PLAN_LIMIT)/);
    }
    assert.equal(homeReads, 0);
    assert.equal(existsSync(runRoot), false);
    assert.doesNotThrow(() => validateControlledPlan({ ...plan, plannedSessions: 8 }));
    assert.doesNotThrow(() => validateControlledPlan({ ...plan, plannedSessions: 100 }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("real factory writes a single immutable plan and initially empty combined subject/judge ledger", () => {
  const f = fixture();
  try {
    const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
    assert.equal(execution.mode, "real");
    assert.equal(execution.isStopped(), false);
    const record = JSON.parse(readFileSync(join(f.runRoot, "controlled-execution.json"), "utf8"));
    assert.deepEqual(record.catalogHashes, { "models.json": null, "models-store.json": null });
    assert.equal(record.plannedSessions, 2);
    assert.equal(record.toolErrorPolicy, "native-agent-recovery-v2");
    assert.deepEqual(record.sessions, []);
    assert.deepEqual(JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8")), execution.snapshot());
    assert.equal(execution.snapshot().policy.maxNanoUsd, null);
    assert.equal(execution.snapshot().policy.maxSessions, null);
    assert.equal(execution.snapshot().policy.models.subject.maxOutputTokens, 524288);
    assert.equal(execution.snapshot().policy.models.judge.maxOutputTokens, 131072);
    assert.deepEqual(record.nativeLimits, nativeLimits);
    assert.equal(record.nativeLimitsSource, "verified-sdk-model-catalog");
  } finally { f.cleanup(); }
});

test("real execution requires verified native model metadata before touching home or output", () => {
  const root = mkdtempSync(join(tmpdir(), "native-model-limits-required-"));
  const runRoot = join(root, "never-created");
  let homeReads = 0;
  try {
    for (const limits of [undefined, { subject: nativeLimits.subject }, { ...nativeLimits, judge: { contextWindow: 1, maxOutputTokens: 2 } }]) {
      assert.throws(() => createControlledExecution({ ...plan, nativeLimits: limits as never, runRoot,
        get home(): string { homeReads++; throw new Error("MUST_NOT_READ_SOURCE_HOME"); },
      }), /CONTROLLED_NATIVE_MODEL_LIMITS_(REQUIRED|INVALID)/);
    }
    assert.equal(homeReads, 0);
    assert.equal(existsSync(runRoot), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("SDK final sample failure leaves later matrix samples executable and its charge unknown", { skip: !nativeAvailable, timeout: 20000 }, async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    writeFileSync(join(f.home, ".pi", "agent", "auth.json"), JSON.stringify({ "minimax-cn": { type: "api_key", key: "offline-factory-fixture" } }), { mode: 0o600 });
    const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response(JSON.stringify({ error: { type: "authentication_error", message: "OFFLINE_AUTH_FAILURE" } }), { status: 401, headers: { "content-type": "application/json" } });
      const body = [
        { type: "message_start", message: { id: "fixture-next", type: "message", role: "assistant", model: "MiniMax-M3.1-Flash", content: [], usage: { input_tokens: 100, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "NEXT SAMPLE COMPLETED" } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
    const failed = await execution.run("subject", { ...f.request, timeoutMs: 10000 });
    assert.notEqual(failed.exitCode, 0);
    assert.equal(execution.isStopped(), false);
    assert.equal(execution.snapshot().sessions[0]?.state, "failed");
    assert.equal(execution.snapshot().requests[0]?.chargedNanoUsd, null);
    const nextWorkspace = join(f.runRoot, "cases", "next", "workspace");
    mkdirSync(nextWorkspace, { recursive: true });
    const next = await execution.run("subject", { ...f.request, sessionId: "next-fixture", workspaceRoot: nextWorkspace, timeoutMs: 10000 });
    assert.equal(next.exitCode, 0);
    assert.equal(next.metrics.output, "NEXT SAMPLE COMPLETED");
    assert.equal(calls, 2);
    assert.equal(execution.snapshot().sessions[1]?.state, "completed");
    assert.equal(execution.snapshot().knownChargedNanoUsd, 27000);
    assert.equal(execution.snapshot().chargedNanoUsd, null);
    execution.finalize?.();
    assert.deepEqual(JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8")), execution.snapshot());
  } finally { globalThis.fetch = originalFetch; f.cleanup(); }
});

test("shared executor accepts native recovery from a tool error without retroactively stopping the batch", { skip: !nativeAvailable, timeout: 15000 }, async () => {
  const f = fixture(), originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    writeFileSync(join(f.home, ".pi", "agent", "auth.json"), JSON.stringify({ "minimax-cn": { type: "api_key", key: "offline-factory-fixture" } }), { mode: 0o600 });
    const execution = createControlledExecution({ ...plan, plannedSessions: 1, runRoot: f.runRoot, home: f.home });
    globalThis.fetch = async (url, options) => {
      assert.equal(String(url), "https://api.minimaxi.com/anthropic/v1/messages?beta=true");
      assert.equal(new Headers(options?.headers).get("x-api-key"), "offline-factory-fixture");
      calls++;
      const block = calls === 1
        ? { type: "tool_use", id: "native-correction", name: "bash", input: { command: "false" } }
        : { type: "text", text: "OFFLINE RECOVERY" };
      const body = [
        { type: "message_start", message: { id: "fixture", type: "message", role: "assistant", model: "MiniMax-M3.1-Flash", content: [], usage: { input_tokens: 100, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: block },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: calls === 1 ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } },
        { type: "message_stop" },
      ].map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    };
    const result = await execution.run("subject", { ...f.request, timeoutMs: 10000 });
    assert.equal(calls, 2);
    assert.equal(result.exitCode, 0);
    assert.equal(result.metrics.output, "OFFLINE RECOVERY");
    assert.ok(result.events.some(event => event.type === "tool_execution_end" && event.isError === true));
    assert.equal(execution.isStopped(), false);
    assert.equal(execution.snapshot().sessions[0]?.state, "completed");
    assert.equal(execution.snapshot().chargedNanoUsd, 54000);
    execution.finalize?.();
    assert.equal(JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8")).state, "open");
  } finally { globalThis.fetch = originalFetch; f.cleanup(); }
});

for (const requests of [128, 5000]) test(`incremental ledger persists ${requests} requests within a fixed byte envelope`, (t) => {
  const root = mkdtempSync(join(tmpdir(), "native-ledger-bytes-"));
  const ledgerPath = join(root, "budget-ledger.json"), journalPath = join(root, "budget-ledger.jsonl");
  const originalOpen = fs.openSync, originalClose = fs.closeSync, originalWrite = fs.writeFileSync, originalAppend = fs.appendFileSync;
  const originalSnapshot = ControlledBudget.prototype.snapshot;
  const descriptors = new Map<number, string>();
  let writtenBytes = 0, snapshotWrites = 0, snapshotCalls = 0, insideAppend = false, finishing = false;
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const fd = originalOpen(...args); descriptors.set(fd, String(args[0])); return fd;
  });
  t.mock.method(fs, "closeSync", (fd: number) => { descriptors.delete(fd); originalClose(fd); });
  t.mock.method(fs, "writeFileSync", (path: Parameters<typeof fs.writeFileSync>[0], data: Parameters<typeof fs.writeFileSync>[1], options?: Parameters<typeof fs.writeFileSync>[2]) => {
    const target = typeof path === "number" ? descriptors.get(path) : String(path);
    if (!insideAppend && (target === ledgerPath || target === `${ledgerPath}.tmp`)) {
      writtenBytes += Buffer.byteLength(data as string); snapshotWrites++;
      // Count an accidentally restored legacy rewrite without writing prefixes.
      if (target === `${ledgerPath}.tmp` && !finishing) return;
    }
    originalWrite(path, data, options);
  });
  t.mock.method(fs, "appendFileSync", (path: Parameters<typeof fs.appendFileSync>[0], data: Parameters<typeof fs.appendFileSync>[1], options?: Parameters<typeof fs.appendFileSync>[2]) => {
    if (String(path) === journalPath) writtenBytes += Buffer.byteLength(data as string);
    insideAppend = true;
    try { originalAppend(path, data, options); } finally { insideAppend = false; }
  });
  // The load test measures bytes and framing, not physical disk durability.
  t.mock.method(fs, "fsyncSync", () => {});
  t.mock.method(ControlledBudget.prototype, "snapshot", function (this: ControlledBudget) {
    snapshotCalls++;
    if (snapshotCalls > 300) throw new Error("OFFLINE_FULL_HISTORY_SNAPSHOT_REPEATED");
    return originalSnapshot.call(this);
  });
  syncBuiltinESMExports();
  try {
    const ledger = new ControlledBudget(), persistence = createLedgerPersistence(ledger, ledgerPath);
    const initial = readFileSync(ledgerPath, "utf8");
    ledger.beginSession("long-native-session", "subject", model); persistence.sync();
    for (let index = 0; index < requests; index++) {
      const id = `http-${index}`;
      ledger.reserve(id); persistence.sync();
      ledger.settle(id, { input: 2, output: 1 }); persistence.sync();
    }
    ledger.endSession(); persistence.sync();
    assert.equal(readFileSync(ledgerPath, "utf8"), initial, "full snapshot must not be rewritten on HTTP updates");
    finishing = true; persistence.finalize(); persistence.finalize();
    const expected = originalSnapshot.call(ledger), finalBytes = Buffer.byteLength(JSON.stringify(expected));
    assert.ok(writtenBytes <= finalBytes * 5 + 2048, `ledger attempted ${writtenBytes} bytes for ${finalBytes} final bytes`);
    assert.ok(snapshotCalls <= 3, `full history was scanned ${snapshotCalls} times`);
    assert.equal(snapshotWrites, 2, "one empty and one terminal compatibility snapshot");
    assert.deepEqual(JSON.parse(readFileSync(ledgerPath, "utf8")), expected);
    const journal = readFileSync(journalPath, "utf8");
    assert.ok(journal.endsWith("\n"));
    const updates = journal.trimEnd().split("\n").map(line => JSON.parse(line) as BudgetUpdate);
    const sessions = new Map<string, unknown>(), rows = new Map<string, unknown>();
    for (const update of updates) {
      if (update.type === "session") sessions.set(update.session.id, update.session);
      if (update.type === "request") rows.set(update.request.id, update.request);
    }
    assert.equal(updates.length, requests * 2 + 3);
    assert.deepEqual([...sessions.values()], expected.sessions);
    assert.deepEqual([...rows.values()], expected.requests);
    assert.equal(expected.chargedNanoUsd, requests * 900);
    assert.equal(fs.statSync(journalPath).mode & 0o777, 0o600);
    t.diagnostic(JSON.stringify({ requests, records: updates.length, writtenBytes, finalBytes, snapshotCalls, snapshotWrites }));
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    rmSync(root, { recursive: true, force: true });
  }
});

for (const failure of ["append", "fsync"] as const) test(`ledger ${failure} failure blocks dispatch and records a Host failure`, { skip: !nativeAvailable, timeout: 15000 }, async (t) => {
  const f = fixture(), originalFetch = globalThis.fetch;
  const journalPath = join(fs.realpathSync(f.runRoot), "budget-ledger.jsonl");
  const originalAppend = fs.appendFileSync, originalOpen = fs.openSync, originalClose = fs.closeSync, originalFsync = fs.fsyncSync;
  const descriptors = new Map<number, string>();
  let pendingWritten = false, calls = 0;
  t.mock.method(fs, "openSync", (...args: Parameters<typeof fs.openSync>) => {
    const fd = originalOpen(...args); descriptors.set(fd, String(args[0])); return fd;
  });
  t.mock.method(fs, "closeSync", (fd: number) => { descriptors.delete(fd); originalClose(fd); });
  t.mock.method(fs, "appendFileSync", (path: Parameters<typeof fs.appendFileSync>[0], data: Parameters<typeof fs.appendFileSync>[1], options?: Parameters<typeof fs.appendFileSync>[2]) => {
    if (String(path) === journalPath) {
      const row = JSON.parse(String(data));
      if (row.type === "request" && row.request.state === "pending") {
        if (failure === "append") throw Object.assign(new Error("OFFLINE_LEDGER_FULL"), { code: "ENOSPC" });
        pendingWritten = true;
      }
    }
    originalAppend(path, data, options);
  });
  t.mock.method(fs, "fsyncSync", (fd: number) => {
    if (failure === "fsync" && pendingWritten && descriptors.get(fd) === journalPath) throw new Error("OFFLINE_LEDGER_SYNC_FAILED");
    originalFsync(fd);
  });
  syncBuiltinESMExports();
  try {
    writeFileSync(join(f.home, ".pi", "agent", "auth.json"), JSON.stringify({ "minimax-cn": { type: "api_key", key: "offline-factory-fixture" } }));
    globalThis.fetch = async () => { calls++; throw new Error("MUST_NOT_DISPATCH"); };
    const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
    const failed = await execution.run("subject", { ...f.request, timeoutMs: 10000 });
    assert.notEqual(failed.exitCode, 0);
    assert.equal(execution.isStopped(), true);
    assert.equal(execution.snapshot().stoppedReason, "LEDGER_PERSISTENCE_FAILED");
    assert.equal(calls, 0);
    assert.equal((await execution.run("subject", { ...f.request, sessionId: "after-ledger-failure" })).stderr, "CONTROLLED_EXECUTION_STOPPED");
    assert.equal(calls, 0);
    execution.finalize?.();
    const final = JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8"));
    assert.equal(final.stoppedReason, "LEDGER_PERSISTENCE_FAILED");
  } finally {
    globalThis.fetch = originalFetch; t.mock.restoreAll(); syncBuiltinESMExports();
    f.cleanup();
  }
});

test("terminal snapshot failure remains fatal and never retries full history serialization", (t) => {
  const root = mkdtempSync(join(tmpdir(), "native-ledger-final-failure-"));
  const ledgerPath = join(root, "budget-ledger.json"), journalPath = join(root, "budget-ledger.jsonl");
  const ledger = new ControlledBudget(), persistence = createLedgerPersistence(ledger, ledgerPath);
  const initial = readFileSync(ledgerPath, "utf8"), originalRename = fs.renameSync, originalSnapshot = ledger.snapshot;
  let finalSnapshots = 0;
  t.mock.method(ledger, "snapshot", function (this: ControlledBudget) { finalSnapshots++; return originalSnapshot.call(this); });
  t.mock.method(fs, "renameSync", (oldPath: Parameters<typeof fs.renameSync>[0], newPath: Parameters<typeof fs.renameSync>[1]) => {
    if (String(oldPath) === `${ledgerPath}.tmp`) throw new Error("OFFLINE_FINAL_RENAME_FAILED");
    originalRename(oldPath, newPath);
  });
  syncBuiltinESMExports();
  try {
    ledger.beginSession("completed", "subject", model);
    ledger.reserve("recorded-http"); ledger.settle("recorded-http", { input: 1, output: 1 }); ledger.endSession(); persistence.sync();
    assert.throws(() => persistence.finalize(), /LEDGER_PERSISTENCE_FAILED/);
    assert.throws(() => persistence.finalize(), /LEDGER_PERSISTENCE_FAILED/);
    assert.throws(() => persistence.finalize(), /LEDGER_PERSISTENCE_FAILED/);
    assert.equal(finalSnapshots, 1);
    assert.equal(ledger.isStopped(), true);
    assert.equal(readFileSync(ledgerPath, "utf8"), initial);
    const rows = readFileSync(journalPath, "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
    assert.deepEqual(rows.at(-1), { type: "state", state: "stopped", stoppedReason: "LEDGER_PERSISTENCE_FAILED" });
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports(); rmSync(root, { recursive: true, force: true });
  }
});

test("new executions cannot overwrite existing records or silently resume historical runs", () => {
  const f = fixture();
  try {
    createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
    const record = readFileSync(join(f.runRoot, "controlled-execution.json"));
    const ledger = readFileSync(join(f.runRoot, "budget-ledger.json"));
    assert.throws(() => createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home }), /CONTROLLED_EXECUTION_RECORD_EXISTS/);
    assert.deepEqual(readFileSync(join(f.runRoot, "controlled-execution.json")), record);
    assert.deepEqual(readFileSync(join(f.runRoot, "budget-ledger.json")), ledger);
  } finally { f.cleanup(); }
});

test("role model mismatch stops the same ledger for subjects and judges before any session", async () => {
  const f = fixture();
  try {
    const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
    const result = await execution.run("judge", f.request);
    assert.equal(result.stderr, "CONTROLLED_ROLE_MODEL_MISMATCH");
    assert.equal(execution.isStopped(), true);
    assert.equal(execution.snapshot().sessions.length, 0);
    assert.equal((await execution.run("subject", f.request)).stderr, "CONTROLLED_EXECUTION_STOPPED");
    const ledger = JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8"));
    assert.equal(ledger.stoppedReason, "CONTROLLED_ROLE_MODEL_MISMATCH");
  } finally { f.cleanup(); }
});

test("unsupported network, hooks or runtime roots fail closed without child sessions", async () => {
  for (const changed of [{ allowWeb: true }, { inheritHostFsHooks: true }, { isolation: { runtimeRoots: ["/usr"] } }]) {
    const f = fixture();
    try {
      const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
      const result = await execution.run("subject", { ...f.request, ...changed });
      assert.equal(result.stderr, "CONTROLLED_UNSUPPORTED_RUNTIME_ACCESS");
      assert.equal(execution.snapshot().sessions.length, 0);
      assert.equal(execution.isStopped(), true);
    } finally { f.cleanup(); }
  }
});

test("model workspace and explicit skill roots cannot expose the controller evidence directory", async () => {
  for (const changed of [
    (f: ReturnType<typeof fixture>) => ({ workspaceRoot: join(f.root, "outside") }),
    (f: ReturnType<typeof fixture>) => ({ workspaceRoot: join(f.runRoot, "workspace") }),
    (f: ReturnType<typeof fixture>) => ({ skillPaths: [join(f.runRoot, "SKILL.md")] }),
    (f: ReturnType<typeof fixture>) => ({ isolation: { skillRoots: [f.root] } }),
  ]) {
    const f = fixture();
    try {
      const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
      const result = await execution.run("subject", { ...f.request, ...changed(f) });
      assert.match(result.stderr, /CONTROLLED_(WORKSPACE_BOUNDARY|EVIDENCE_EXPOSURE|SKILL_ROOT_MISMATCH)/);
      assert.equal(execution.snapshot().sessions.length, 0);
      assert.equal(execution.isStopped(), true);
    } finally { f.cleanup(); }
  }
});

test("source catalog is locked once for both roles and drift fails before reading auth or HTTP", async () => {
  for (const role of ["subject", "judge"] as const) {
    const f = fixture();
    const source = join(f.home, ".pi", "agent", "models.json");
    try {
      writeFileSync(source, "{}");
      writeFileSync(join(f.home, ".pi", "agent", "auth.json"), "MUST_NOT_PARSE_AUTH");
      const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
      writeFileSync(source, '{"changed":true}');
      const result = await execution.run(role, { ...f.request, model: role === "subject" ? model : judgeModel });
      assert.equal(result.stderr, "CATALOG_DRIFT");
      assert.equal(result.exitCode, null);
      assert.equal(execution.isStopped(), true);
      assert.equal(execution.snapshot().requests.length, 0);
      assert.equal(execution.snapshot().sessions[0]?.state, "failed");
      const snapshot = JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8"));
      assert.equal(snapshot.stoppedReason, "CATALOG_DRIFT");
    } finally { f.cleanup(); }
  }
});

test("long and unsafe external session identities map to safe deterministic transport IDs and remain traceable", async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.home, ".pi", "agent", "models.json"), "{}");
    const execution = createControlledExecution({ ...plan, runRoot: f.runRoot, home: f.home });
    writeFileSync(join(f.home, ".pi", "agent", "models.json"), '{"changed":true}');
    const sessionId = `${"long-case/../../".repeat(15)}中文 task`;
    const result = await execution.run("subject", { ...f.request, sessionId });
    assert.equal(result.stderr, "CATALOG_DRIFT");
    const record = JSON.parse(readFileSync(join(f.runRoot, "controlled-execution.json"), "utf8"));
    const expected = `eval-${createHash("sha256").update(sessionId).digest("hex")}`;
    assert.equal(record.sessions[0].sessionId, sessionId);
    assert.equal(record.sessions[0].transportSessionId, expected);
    assert.match(expected, /^[A-Za-z0-9_-]{1,80}$/);
    assert.equal(execution.snapshot().sessions[0]?.id, expected);
  } finally { f.cleanup(); }
});
