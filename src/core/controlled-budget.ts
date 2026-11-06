/** Controlled eval's conservative USD equivalent, independent of SDK/plan cost fields. */
export const CONTROLLED_BUDGET_POLICY = Object.freeze({
  version: "controlled-eval-budget-v1",
  pricingVerifiedAt: "2026-11-06",
  pricingBasis: "Conservative public PAYGO USD equivalent; all input/cache tokens charged at uncached input rate; Token Plan cash billing remains unknown",
  pricingSources: Object.freeze(["https://www.minimax.io/blog/minimax-m31f", "https://mimo.mi.com/docs/en-US/price/pay-as-you-go", "https://mimo.mi.com/docs/en-US/price/token-plan"]),
  maxSessions: 8,
  maxNanoUsd: 1_000_000_000,
  models: Object.freeze({
    subject: Object.freeze({ model: "minimax-cn/MiniMax-M3.1-Flash", contextWindow: 1_000_000, maxOutputTokens: 4096, inputNanoUsdPerToken: 150, outputNanoUsdPerToken: 600 }),
    judge: Object.freeze({ model: "xiaomi-token-plan-cn/mimo-v2.6-flash", contextWindow: 1_048_576, maxOutputTokens: 1024, inputNanoUsdPerToken: 140, outputNanoUsdPerToken: 280 }),
  }),
});

export type SessionRole = "subject" | "judge";
export interface ControlledUsage { input: number; output: number; cacheRead?: number; cacheWrite?: number; }
interface SessionCharge {
  id: string;
  role: SessionRole;
  model: string;
  state: "running" | "completed" | "failed";
}
interface RequestCharge {
  id: string;
  sessionId: string;
  role: SessionRole;
  model: string;
  reservedNanoUsd: number;
  chargedNanoUsd: number;
  maxOutputTokens: number;
  state: "pending" | "settled" | "failed";
  usage?: Required<ControlledUsage>;
  reason?: string;
}

export class BudgetStopError extends Error {
  constructor(reason: string) { super(reason); this.name = "BudgetStopError"; }
}

/** Single-flight reservation ledger. Failed/ambiguous requests keep their entire reservation. */
export class ControlledBudget {
  private sessions: SessionCharge[] = [];
  private requests: RequestCharge[] = [];
  private active?: SessionCharge;
  private pending?: RequestCharge;
  private stoppedReason?: string;

  beginSession(id: string, role: SessionRole, model: string): void {
    this.assertOpen();
    if (typeof id !== "string" || !id.trim() || this.sessions.some(row => row.id === id)) this.reject("invalid-or-duplicate-session");
    if (this.active || this.pending) this.reject("concurrent-session");
    if (this.sessions.length >= CONTROLLED_BUDGET_POLICY.maxSessions) this.reject("session-limit");
    if (role !== "subject" && role !== "judge") this.reject("invalid-session-role");
    const policy = CONTROLLED_BUDGET_POLICY.models[role];
    if (!policy || model !== policy.model) this.reject("model-identity-mismatch");
    this.active = { id, role, model, state: "running" };
    this.sessions.push(this.active);
  }

  reserve(requestId: string): { reservedNanoUsd: number; maxOutputTokens: number; model: string } {
    this.assertOpen();
    if (!this.active) this.reject("request-without-session");
    if (this.pending) this.reject("concurrent-request");
    if (typeof requestId !== "string" || !requestId.trim() || this.requests.some(row => row.id === requestId)) this.reject("invalid-or-duplicate-request");
    const policy = CONTROLLED_BUDGET_POLICY.models[this.active.role];
    const reservedNanoUsd = policy.contextWindow * policy.inputNanoUsdPerToken + policy.maxOutputTokens * policy.outputNanoUsdPerToken;
    if (reservedNanoUsd > this.snapshot().availableNanoUsd) this.reject("budget-exhausted-before-dispatch");
    this.pending = {
      id: requestId, sessionId: this.active.id, role: this.active.role, model: this.active.model,
      reservedNanoUsd, chargedNanoUsd: 0, maxOutputTokens: policy.maxOutputTokens, state: "pending",
    };
    this.requests.push(this.pending);
    return { reservedNanoUsd, maxOutputTokens: policy.maxOutputTokens, model: policy.model };
  }

  settle(requestId: string, usage: ControlledUsage): void {
    this.assertOpen();
    if (!this.pending || this.pending.id !== requestId) this.reject("usage-without-matching-request");
    const policy = CONTROLLED_BUDGET_POLICY.models[this.pending.role];
    if (!usage || typeof usage !== "object") this.reject("missing-usage");
    const normalized = { input: usage.input, output: usage.output, cacheRead: usage.cacheRead === undefined ? 0 : usage.cacheRead, cacheWrite: usage.cacheWrite === undefined ? 0 : usage.cacheWrite };
    if (Object.values(normalized).some(value => !Number.isSafeInteger(value) || value < 0)) this.reject("invalid-usage");
    const inputTokens = normalized.input + normalized.cacheRead + normalized.cacheWrite;
    if (!Number.isSafeInteger(inputTokens) || inputTokens > policy.contextWindow || normalized.output > policy.maxOutputTokens || inputTokens + normalized.output === 0) this.reject("usage-outside-reservation");
    this.pending.usage = normalized;
    this.pending.chargedNanoUsd = inputTokens * policy.inputNanoUsdPerToken + normalized.output * policy.outputNanoUsdPerToken;
    this.pending.state = "settled";
    this.pending = undefined;
  }

  failRequest(requestId: string, reason: string): void {
    if (!this.pending || this.pending.id !== requestId) this.reject("failure-without-matching-request");
    this.stop(reason);
  }

  endSession(): void {
    this.assertOpen();
    if (!this.active || this.pending) this.reject("incomplete-session");
    if (!this.requests.some(row => row.sessionId === this.active!.id && row.state === "settled")) this.reject("session-without-usage");
    this.active.state = "completed";
    this.active = undefined;
  }

  stop(reason: string): void {
    if (!this.stoppedReason) this.stoppedReason = reason || "unspecified-failure";
    if (this.pending) {
      this.pending.state = "failed";
      this.pending.reason = this.stoppedReason;
      this.pending.chargedNanoUsd = this.pending.reservedNanoUsd;
      this.pending = undefined;
    }
    if (this.active) {
      this.active.state = "failed";
      this.active = undefined;
    }
  }

  snapshot() {
    const chargedNanoUsd = this.requests.reduce((sum, row) => sum + row.chargedNanoUsd, 0);
    const reservedNanoUsd = this.pending?.reservedNanoUsd ?? 0;
    return {
      policy: CONTROLLED_BUDGET_POLICY,
      state: this.stoppedReason ? "stopped" as const : "open" as const,
      stoppedReason: this.stoppedReason ?? null,
      chargedNanoUsd,
      reservedNanoUsd,
      availableNanoUsd: CONTROLLED_BUDGET_POLICY.maxNanoUsd - chargedNanoUsd - reservedNanoUsd,
      sessions: this.sessions.map(row => ({ ...row })),
      requests: this.requests.map(row => ({ ...row, ...(row.usage ? { usage: { ...row.usage } } : {}) })),
    };
  }

  private assertOpen(): void { if (this.stoppedReason) throw new BudgetStopError(this.stoppedReason); }
  private reject(reason: string): never { this.stop(reason); throw new BudgetStopError(this.stoppedReason!); }
}

export type BudgetSnapshot = ReturnType<ControlledBudget["snapshot"]>;
