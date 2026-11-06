import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CONTROLLED_BUDGET_POLICY } from "./controlled-budget.ts";
import { createControlledExecution, validateControlledPlan } from "./execution.ts";
import type { PiRunOptions } from "./pi.ts";

// Parent-side test guard: every HTTP response must come from an explicit fixture.
globalThis.fetch = async () => { throw new Error("REAL_PROVIDER_FORBIDDEN_IN_OFFLINE_TEST"); };

const model = CONTROLLED_BUDGET_POLICY.models.subject.model;
const judgeModel = CONTROLLED_BUDGET_POLICY.models.judge.model;
const plan = { model, judgeModel, plannedSessions: 2 };

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
      ...[0, -1, 1.5, 9, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(plannedSessions => ({ plannedSessions })),
    ]) {
      assert.throws(() => createControlledExecution({ ...plan, ...changed, runRoot,
        get home(): string { homeReads++; throw new Error("MUST_NOT_READ_SOURCE_HOME"); },
      }), /CONTROLLED_(MODEL_PROFILE_MISMATCH|SESSION_PLAN_LIMIT)/);
    }
    assert.equal(homeReads, 0);
    assert.equal(existsSync(runRoot), false);
    assert.doesNotThrow(() => validateControlledPlan({ ...plan, plannedSessions: 8 }));
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
    assert.deepEqual(record.sessions, []);
    assert.deepEqual(JSON.parse(readFileSync(join(f.runRoot, "budget-ledger.json"), "utf8")), execution.snapshot());
    assert.equal(execution.snapshot().policy.maxNanoUsd, 1_000_000_000);
    assert.equal(execution.snapshot().policy.models.subject.maxOutputTokens, 4096);
    assert.equal(execution.snapshot().policy.models.judge.maxOutputTokens, 1024);
  } finally { f.cleanup(); }
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
