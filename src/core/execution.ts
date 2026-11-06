/** One controlled transport shared by the ordinary eval subject and judge orchestration. */
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, sep } from "node:path";
import { ControlledBudget, CONTROLLED_BUDGET_POLICY, type BudgetSnapshot, type SessionRole } from "./controlled-budget.ts";
import { runControlledSession } from "./controlled-session.ts";
import { canonicalPath } from "./isolation.ts";
import { DEFAULT_TIMEOUT_MS, emptyMetrics, type PiRunOptions, type PiRunResult } from "./pi.ts";

export interface EvaluationExecution {
  mode: "real" | "simulated";
  run(role: SessionRole, options: PiRunOptions): Promise<PiRunResult>;
  isStopped(): boolean;
  snapshot(): BudgetSnapshot;
}

interface ControlledPlan { model: string; judgeModel: string; plannedSessions: number; }

/** Pure validation: no directories, credentials or Provider calls. */
export function validateControlledPlan(plan: ControlledPlan): void {
  if (plan.model !== CONTROLLED_BUDGET_POLICY.models.subject.model || plan.judgeModel !== CONTROLLED_BUDGET_POLICY.models.judge.model) {
    throw new Error(`CONTROLLED_MODEL_PROFILE_MISMATCH: 当前成本 profile 仅支持 subject=${CONTROLLED_BUDGET_POLICY.models.subject.model}、judge=${CONTROLLED_BUDGET_POLICY.models.judge.model}；不自动替换模型`);
  }
  if (!Number.isSafeInteger(plan.plannedSessions) || plan.plannedSessions < 1 || plan.plannedSessions > CONTROLLED_BUDGET_POLICY.maxSessions) {
    throw new Error("CONTROLLED_SESSION_PLAN_LIMIT: 计划会话数须为 1–8 的整数；请缩小计划或另行制定预算");
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

/** Real factory has no injection or environment bypass. Offline tests supply explicit simulated executors. */
export function createControlledExecution(options: ControlledPlan & { runRoot: string; home?: string }): EvaluationExecution {
  validateControlledPlan(options);
  const { model: subjectModel, judgeModel, plannedSessions } = options;
  const runRoot = canonicalPath(options.runRoot), home = canonicalPath(options.home ?? homedir());
  const budget = new ControlledBudget();
  const ledgerPath = join(runRoot, "budget-ledger.json"), recordPath = join(runRoot, "controlled-execution.json");
  // Refuse reuse before touching either historical record; run continuation is not selective replay.
  if ([ledgerPath, recordPath, `${ledgerPath}.tmp`, `${recordPath}.tmp`].some(existsSync)) throw new Error("CONTROLLED_EXECUTION_RECORD_EXISTS");
  const catalogHashes: Record<string, string | null> = {};
  for (const name of ["models.json", "models-store.json"]) {
    const source = join(home, ".pi", "agent", name);
    catalogHashes[name] = existsSync(source) ? createHash("sha256").update(readFileSync(source)).digest("hex") : null;
  }
  mkdirSync(runRoot, { recursive: true, mode: 0o700 });
  const record = {
    schemaVersion: 1, mode: "real", profile: CONTROLLED_BUDGET_POLICY.version,
    model: subjectModel, judgeModel, plannedSessions,
    catalogHashes, sessions: [] as Array<{ sessionId: string; transportSessionId: string; role: SessionRole }>,
  };
  persistJson(ledgerPath, budget.snapshot(), true);
  persistJson(recordPath, record, true);
  const syncLedger = () => persistJson(ledgerPath, budget.snapshot());
  const rejected = (reason: string): PiRunResult => ({
    exitCode: null, metrics: emptyMetrics(), events: [], stderr: reason, timedOut: false,
    isolation: { verified: false, issues: [reason], backend: "macos-sandbox-exec-network-denied" },
  });
  const stop = (reason: string): PiRunResult => {
    budget.stop(reason);
    syncLedger();
    return rejected(reason);
  };
  return {
    mode: "real",
    snapshot: () => budget.snapshot(),
    isStopped: () => budget.snapshot().state === "stopped",
    async run(role, request) {
      if (budget.snapshot().state === "stopped") return rejected("CONTROLLED_EXECUTION_STOPPED");
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
          model, skillPaths, home, role, budget, timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          catalogHashes, onLedger: syncLedger, onEvent: request.onEvent,
        });
        if (result.exitCode !== 0 || result.timedOut || !result.isolation.verified || !result.metrics.output.trim() ||
            result.events.some(event => event.type === "tool_execution_end" && event.isError === true)) {
          budget.stop(result.stderr || "CONTROLLED_SESSION_FAILED");
        }
        syncLedger();
        return result;
      } catch {
        // Avoid surfacing credential-bearing native or filesystem exception text.
        return stop("CONTROLLED_EXECUTION_FAILED");
      }
    },
  };
}
