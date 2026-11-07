/** One controlled transport shared by the ordinary eval subject and judge orchestration. */
import { createHash } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { ControlledBudget, CONTROLLED_BUDGET_POLICY, type BudgetSnapshot, type NativeModelLimitsByRole, type SessionRole } from "./controlled-budget.ts";
import { evaluationInterruption, runControlledSession } from "./controlled-session.ts";
import { canonicalPath } from "./isolation.ts";
import { emptyMetrics, type PiRunOptions, type PiRunResult } from "./pi.ts";
import { TOOL_ERROR_POLICY_VERSION } from "./failure-evidence.ts";
import type { EvaluationRuntimeIdentity } from "./runtime-identity.ts";

export interface EvaluationExecution {
  mode: "real" | "simulated";
  run(role: SessionRole, options: PiRunOptions): Promise<PiRunResult>;
  isStopped(): boolean;
  snapshot(): BudgetSnapshot;
  finalize?(): void;
}

interface ControlledPlan { model: string; judgeModel: string; plannedSessions: number; }

/** Pure validation: no directories, credentials or Provider calls. */
export function validateControlledPlan(plan: ControlledPlan): void {
  if (plan.model !== CONTROLLED_BUDGET_POLICY.models.subject.model || plan.judgeModel !== CONTROLLED_BUDGET_POLICY.models.judge.model) {
    throw new Error(`CONTROLLED_MODEL_PROFILE_MISMATCH: 当前成本 profile 仅支持 subject=${CONTROLLED_BUDGET_POLICY.models.subject.model}、judge=${CONTROLLED_BUDGET_POLICY.models.judge.model}；不自动替换模型`);
  }
  if (!Number.isSafeInteger(plan.plannedSessions) || plan.plannedSessions < 1) {
    throw new Error("CONTROLLED_SESSION_PLAN_LIMIT: 计划会话数须为正整数；会话矩阵由实验方案确定");
  }
}

function persistJson(path: string, value: unknown, initial = false): void {
  const target = initial ? path : `${path}.tmp`;
  const file = openSync(target, "wx", 0o600);
  try { writeFileSync(file, JSON.stringify(value, null, 2)); fsyncSync(file); }
  finally { closeSync(file); }
  if (!initial) renameSync(target, path);
  const directory = openSync(dirname(path), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** Incremental accounting is authoritative; the JSON file is a compatibility snapshot. */
export function createLedgerPersistence(budget: ControlledBudget, ledgerPath: string): { sync(): void; finalize(): void } {
  const journalPath = join(dirname(ledgerPath), "budget-ledger.jsonl");
  if ([ledgerPath, `${ledgerPath}.tmp`, journalPath].some(existsSync)) throw new Error("CONTROLLED_EXECUTION_RECORD_EXISTS");
  persistJson(ledgerPath, budget.snapshot(), true);
  let finalWritten = false;
  let finalAttempted = false;
  const writeFinal = () => {
    if (finalAttempted) return;
    finalAttempted = true;
    persistJson(ledgerPath, budget.snapshot());
    finalWritten = true;
  };
  const sync = () => {
    const changes = budget.drainUpdates();
    if (!changes.length) return;
    try {
      for (const change of changes) appendFileSync(journalPath, JSON.stringify(change) + "\n", { mode: 0o600 });
      const file = openSync(journalPath, "r");
      try { fsyncSync(file); } finally { closeSync(file); }
    } catch {
      budget.stop("LEDGER_PERSISTENCE_FAILED");
      // Preserve a terminal snapshot if the journal alone failed. A failing disk
      // must never trigger another Provider dispatch or an unbounded write loop.
      try { writeFinal(); } catch { /* the caller still receives the Host failure */ }
      throw new Error("LEDGER_PERSISTENCE_FAILED");
    }
  };
  sync();
  const directory = openSync(dirname(ledgerPath), "r");
  try { fsyncSync(directory); } finally { closeSync(directory); }
  return {
    sync,
    finalize() {
      if (finalWritten) return;
      if (finalAttempted) throw new Error("LEDGER_PERSISTENCE_FAILED");
      try { sync(); writeFinal(); }
      catch {
        budget.stop("LEDGER_PERSISTENCE_FAILED");
        // If only the compatibility snapshot failed, the primary journal can
        // still preserve the Host-stop cause without another full serialization.
        try { sync(); } catch { /* original finalization failure remains fatal */ }
        throw new Error("LEDGER_PERSISTENCE_FAILED");
      }
    },
  };
}

/** Real factory has no injection or environment bypass. Offline tests supply explicit simulated executors. */
export function createControlledExecution(options: ControlledPlan & { runRoot: string; home?: string; nativeLimits?: NativeModelLimitsByRole; signal?: AbortSignal | undefined; runtimeIdentity?: EvaluationRuntimeIdentity | undefined }): EvaluationExecution {
  validateControlledPlan(options);
  const { model: subjectModel, judgeModel, plannedSessions } = options;
  if (!options.nativeLimits?.subject || !options.nativeLimits?.judge) throw new Error("CONTROLLED_NATIVE_MODEL_LIMITS_REQUIRED: 真实执行须绑定已核验目录中的原生上下文与输出上限");
  const budget = new ControlledBudget(options.nativeLimits);
  const runRoot = canonicalPath(options.runRoot), home = canonicalPath(options.home ?? homedir());
  const ledgerPath = join(runRoot, "budget-ledger.json"), recordPath = join(runRoot, "controlled-execution.json");
  // Refuse reuse before touching either historical record; run continuation is not selective replay.
  if ([ledgerPath, join(runRoot, "budget-ledger.jsonl"), recordPath, `${ledgerPath}.tmp`, `${recordPath}.tmp`].some(existsSync)) throw new Error("CONTROLLED_EXECUTION_RECORD_EXISTS");
  const catalogHashes: Record<string, string | null> = {};
  for (const name of ["models.json", "models-store.json"]) {
    const source = join(home, ".pi", "agent", name);
    catalogHashes[name] = existsSync(source) ? createHash("sha256").update(readFileSync(source)).digest("hex") : null;
  }
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1, mode: "real", profile: CONTROLLED_BUDGET_POLICY.version,
    toolErrorPolicy: TOOL_ERROR_POLICY_VERSION,
    model: subjectModel, judgeModel, plannedSessions,
    nativeLimits: {
      subject: { contextWindow: budget.getModelLimits("subject").contextWindow, maxOutputTokens: budget.getModelLimits("subject").maxOutputTokens },
      judge: { contextWindow: budget.getModelLimits("judge").contextWindow, maxOutputTokens: budget.getModelLimits("judge").maxOutputTokens },
    },
    nativeLimitsSource: "verified-sdk-model-catalog",
    catalogHashes, sessions: [] as Array<{ sessionId: string; transportSessionId: string; role: SessionRole }>,
  };
  const persistence = createLedgerPersistence(budget, ledgerPath);
  persistJson(recordPath, record, true);
  const syncLedger = persistence.sync;
  let finalized = false;
  const checkInterruption = () => {
    if (!finalized && options.signal?.aborted && !budget.isStopped()) budget.stop(evaluationInterruption(options.signal.reason));
  };
  const finalize = () => { checkInterruption(); persistence.finalize(); finalized = true; };
  const rejected = (reason: string): PiRunResult => ({
    exitCode: null, metrics: emptyMetrics(), events: [], stderr: reason, timedOut: false,
    isolation: { verified: false, issues: [reason], backend: "macos-sandbox-exec-network-denied" },
  });
  const stop = (reason: string): PiRunResult => {
    budget.stop(reason);
    try { finalize(); }
    catch { return rejected("LEDGER_PERSISTENCE_FAILED"); }
    return rejected(reason);
  };
  return {
    mode: "real",
    snapshot: () => { checkInterruption(); return budget.snapshot(); },
    isStopped: () => { checkInterruption(); return budget.isStopped(); },
    finalize,
    async run(role, request) {
      checkInterruption();
      if (budget.isStopped()) return rejected("CONTROLLED_EXECUTION_STOPPED");
      if (finalized) return rejected("CONTROLLED_EXECUTION_FINALIZED");
      try {
        if (role !== "subject" && role !== "judge") return stop("CONTROLLED_INVALID_ROLE");
        const model = role === "subject" ? subjectModel : judgeModel;
        if (request.model !== model) return stop("CONTROLLED_ROLE_MODEL_MISMATCH");
        if (record.sessions.length >= plannedSessions) return stop("CONTROLLED_SESSION_PLAN_EXHAUSTED");
        if (request.allowWeb || request.inheritHostFsHooks || request.isolation?.runtimeRoots?.length) return stop("CONTROLLED_UNSUPPORTED_RUNTIME_ACCESS");
        if (typeof request.sessionId !== "string" || !request.sessionId.trim() || record.sessions.some(row => row.sessionId === request.sessionId)) return stop("CONTROLLED_INVALID_SESSION_ID");
        if (typeof request.prompt !== "string" || !request.prompt.trim() || request.timeoutMs !== undefined && (!Number.isSafeInteger(request.timeoutMs) || request.timeoutMs < 1)) return stop("CONTROLLED_INVALID_SESSION_OPTIONS");
        const workspace = canonicalPath(request.workspaceRoot), evidenceRoot = dirname(workspace);
        // All controller records must stay above the model-writable workspace.
        if (!workspace.startsWith(`${runRoot}${sep}`) || evidenceRoot === runRoot) return stop("CONTROLLED_WORKSPACE_BOUNDARY");
        const skillPaths = (request.skillPaths ?? []).map(path => canonicalPath(path));
        const expectedRoots = [...new Set(skillPaths.map(dirname))].sort();
        const declaredRoots = [...new Set((request.isolation?.skillRoots ?? expectedRoots).map(path => canonicalPath(path)))].sort();
        if (JSON.stringify(expectedRoots) !== JSON.stringify(declaredRoots)) return stop("CONTROLLED_SKILL_ROOT_MISMATCH");
        if (expectedRoots.some(root => root === runRoot || runRoot.startsWith(`${root}${sep}`) || evidenceRoot === root || evidenceRoot.startsWith(`${root}${sep}`) || root === workspace || root.startsWith(`${workspace}${sep}`))) return stop("CONTROLLED_EVIDENCE_EXPOSURE");
        // Short, path-safe, deterministic transport IDs also bound broker request filenames.
        const transportSessionId = `eval-${createHash("sha256").update(request.sessionId).digest("hex")}`;
        record.sessions.push({ sessionId: request.sessionId, transportSessionId, role });
        persistJson(recordPath, record);
        const result = await runControlledSession({
          workspaceRoot: workspace, sessionId: transportSessionId, prompt: request.prompt,
          model, skillPaths, home, role, budget, timeoutMs: request.timeoutMs,
          catalogHashes, onLedger: syncLedger, onEvent: request.onEvent,
          signal: options.signal, runtimeIdentity: options.runtimeIdentity,
        });
        checkInterruption();
        // Ordinary SDK failures remain sample data. The session records batch
        // stop causes itself; a missing isolation proof is also a Host fault.
        if (!result.isolation.verified) budget.stop(result.stderr || "CONTROLLED_SANDBOX_FAILED");
        syncLedger();
        if (budget.isStopped()) finalize();
        return result;
      } catch {
        // Avoid surfacing credential-bearing native or filesystem exception text.
        return stop(budget.getStopReason() ?? "CONTROLLED_EXECUTION_FAILED");
      }
    },
  };
}
