/** Usage and conservative USD-equivalent accounting; execution has no spending cap. */
export const CONTROLLED_BUDGET_POLICY = Object.freeze({
  version: "native-sdk-accounting-v2",
  pricingVerifiedAt: "2026-11-06",
  pricingBasis: "Conservative public PAYGO USD equivalent; all input/cache tokens charged at uncached input rate; Token Plan cash billing remains unknown",
  pricingSources: Object.freeze(["https://www.minimax.io/blog/minimax-m31f", "https://mimo.mi.com/docs/en-US/price/pay-as-you-go", "https://mimo.mi.com/docs/en-US/price/token-plan"]),
  maxSessions: null,
  maxNanoUsd: null,
  models: Object.freeze({
    subject: Object.freeze({ model: "minimax-cn/MiniMax-M3.1-Flash", contextWindow: 1_000_000, maxOutputTokens: 524_288, inputNanoUsdPerToken: 150, outputNanoUsdPerToken: 600 }),
    judge: Object.freeze({ model: "xiaomi-token-plan-cn/mimo-v2.6-flash", contextWindow: 1_048_576, maxOutputTokens: 131_072, inputNanoUsdPerToken: 140, outputNanoUsdPerToken: 280 }),
  }),
});

export type SessionRole = "subject" | "judge";
export interface NativeModelLimits { contextWindow: number; maxOutputTokens: number; }
export type NativeModelLimitsByRole = Record<SessionRole, NativeModelLimits>;
export interface ModelAccountingLimits extends NativeModelLimits {
  model: string;
  inputNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
}
export interface AccountingPolicy {
  version: string;
  pricingVerifiedAt: string;
  pricingBasis: string;
  pricingSources: readonly string[];
  maxSessions: null;
  maxNanoUsd: null;
  models: Readonly<Record<SessionRole, Readonly<ModelAccountingLimits>>>;
}
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
  /** Native-window worst-case estimate, never an amount charged for unknown usage. */
  reservedNanoUsd: number;
  chargedNanoUsd: number | null;
  maxOutputTokens: number;
  state: "pending" | "settled" | "failed";
  usageStatus: "pending" | "reported" | "unknown";
  usage?: Required<ControlledUsage>;
  reason?: string;
}
export type BudgetUpdate =
  | { type: "policy"; policy: AccountingPolicy }
  | { type: "session"; session: SessionCharge }
  | { type: "request"; request: RequestCharge }
  | { type: "state"; state: "stopped"; stoppedReason: string };

export class BudgetStopError extends Error {
  constructor(reason: string) { super(reason); this.name = "BudgetStopError"; }
}

/** Record each SDK request, including retries and concurrent SDK background work. */
export class ControlledBudget {
  readonly policy: AccountingPolicy;
  private sessions: SessionCharge[] = [];
  private sessionIds = new Set<string>();
  private requests: RequestCharge[] = [];
  private requestsById = new Map<string, RequestCharge>();
  private active?: SessionCharge;
  private pending = new Map<string, RequestCharge>();
  private stoppedReason?: string;
  private updates: BudgetUpdate[] = [];

  constructor(nativeLimits: Partial<NativeModelLimitsByRole> = {}) {
    const limits = (role: SessionRole) => {
      const value = nativeLimits[role] ?? CONTROLLED_BUDGET_POLICY.models[role];
      if (!value || !Number.isSafeInteger(value.contextWindow) || value.contextWindow < 1 ||
          !Number.isSafeInteger(value.maxOutputTokens) || value.maxOutputTokens < 1 || value.maxOutputTokens > value.contextWindow) {
        throw new Error("CONTROLLED_NATIVE_MODEL_LIMITS_INVALID");
      }
      return Object.freeze({ ...CONTROLLED_BUDGET_POLICY.models[role], contextWindow: value.contextWindow, maxOutputTokens: value.maxOutputTokens });
    };
    this.policy = Object.freeze({ ...CONTROLLED_BUDGET_POLICY, models: Object.freeze({ subject: limits("subject"), judge: limits("judge") }) });
    this.updates.push({ type: "policy", policy: this.policy });
  }

  getModelLimits(role: SessionRole) { return this.policy.models[role]; }
  isStopped(): boolean { return this.stoppedReason !== undefined; }
  getStopReason(): string | null { return this.stoppedReason ?? null; }
  /** Drain only changed rows; HTTP persistence never scans accumulated history. */
  drainUpdates(): BudgetUpdate[] { return this.updates.splice(0); }

  beginSession(id: string, role: SessionRole, model: string): void {
    this.assertOpen();
    if (typeof id !== "string" || !id.trim() || this.sessionIds.has(id)) this.reject("invalid-or-duplicate-session");
    if (this.active) this.reject("concurrent-session");
    if (role !== "subject" && role !== "judge") this.reject("invalid-session-role");
    const policy = this.getModelLimits(role);
    if (model !== policy.model) this.reject("model-identity-mismatch");
    this.active = { id, role, model, state: "running" };
    this.sessions.push(this.active);
    this.sessionIds.add(id);
    this.updates.push({ type: "session", session: { ...this.active } });
  }

  reserve(requestId: string): { reservedNanoUsd: number; maxOutputTokens: number; model: string } {
    this.assertOpen();
    if (!this.active) this.reject("request-without-session");
    if (typeof requestId !== "string" || !requestId.trim() || this.requestsById.has(requestId)) this.reject("invalid-or-duplicate-request");
    const policy = this.getModelLimits(this.active.role);
    const reservedNanoUsd = policy.contextWindow * policy.inputNanoUsdPerToken + policy.maxOutputTokens * policy.outputNanoUsdPerToken;
    const request: RequestCharge = {
      id: requestId, sessionId: this.active.id, role: this.active.role, model: this.active.model,
      reservedNanoUsd, chargedNanoUsd: null, maxOutputTokens: policy.maxOutputTokens, state: "pending", usageStatus: "pending",
    };
    this.pending.set(requestId, request);
    this.requests.push(request);
    this.requestsById.set(requestId, request);
    this.requestUpdated(request);
    return { reservedNanoUsd, maxOutputTokens: policy.maxOutputTokens, model: policy.model };
  }

  settle(requestId: string, usage: ControlledUsage): void {
    // A response can finish after session cancellation. It still belongs to its
    // recorded request and can replace UNKNOWN with actual reported usage.
    const recorded = this.requestsById.get(requestId);
    const pending = this.pending.get(requestId) ?? (recorded?.usageStatus === "unknown" ? recorded : undefined);
    if (!pending) this.reject("usage-without-matching-request");
    const policy = this.getModelLimits(pending.role);
    if (!usage || typeof usage !== "object") throw new BudgetStopError("missing-usage");
    const normalized = { input: usage.input, output: usage.output, cacheRead: usage.cacheRead === undefined ? 0 : usage.cacheRead, cacheWrite: usage.cacheWrite === undefined ? 0 : usage.cacheWrite };
    if (Object.values(normalized).some(value => !Number.isSafeInteger(value) || value < 0)) throw new BudgetStopError("invalid-usage");
    const inputTokens = normalized.input + normalized.cacheRead + normalized.cacheWrite;
    if (!Number.isSafeInteger(inputTokens) || inputTokens > policy.contextWindow || normalized.output > policy.maxOutputTokens || inputTokens + normalized.output === 0) throw new BudgetStopError("usage-outside-native-limits");
    pending.usage = normalized;
    pending.chargedNanoUsd = inputTokens * policy.inputNanoUsdPerToken + normalized.output * policy.outputNanoUsdPerToken;
    pending.state = "settled";
    pending.usageStatus = "reported";
    this.pending.delete(requestId);
    this.requestUpdated(pending);
  }

  /** A request fault belongs to the SDK; it may retry without stopping this session. */
  failRequest(requestId: string, reason: string): void {
    const pending = this.pending.get(requestId);
    if (!pending) {
      // Abort and child-close cleanup can both report the same completed request.
      if (this.requestsById.has(requestId)) return;
      this.reject("failure-without-matching-request");
    }
    pending.state = "failed";
    pending.usageStatus = "unknown";
    pending.reason = reason;
    this.pending.delete(requestId);
    this.requestUpdated(pending);
  }

  endSession(success = true): void {
    this.assertOpen();
    if (!this.active) this.reject("session-not-active");
    for (const pending of [...this.pending.values()]) {
      if (pending.sessionId === this.active.id) {
        this.failRequest(pending.id, "session-ended-with-pending-request");
      }
    }
    this.active.state = success ? "completed" : "failed";
    this.updates.push({ type: "session", session: { ...this.active } });
    this.active = undefined;
  }

  /** Only Host failures or explicit cancellation close the entire execution. */
  stop(reason: string): void {
    const firstStop = !this.stoppedReason;
    if (firstStop) this.stoppedReason = reason || "unspecified-failure";
    for (const request of [...this.pending.values()]) this.failRequest(request.id, this.stoppedReason!);
    if (this.active) {
      this.active.state = "failed";
      this.updates.push({ type: "session", session: { ...this.active } });
      this.active = undefined;
    }
    if (firstStop) this.updates.push({ type: "state", state: "stopped", stoppedReason: this.stoppedReason! });
  }

  snapshot() {
    const knownChargedNanoUsd = this.requests.reduce((sum, row) => sum + (row.chargedNanoUsd ?? 0), 0);
    const reservedNanoUsd = [...this.pending.values()].reduce((sum, row) => sum + row.reservedNanoUsd, 0);
    const unknown = this.requests.filter(row => row.usageStatus === "unknown");
    const uncertainExposureNanoUsd = unknown.reduce((sum, row) => sum + row.reservedNanoUsd, 0);
    return {
      policy: this.policy,
      state: this.stoppedReason ? "stopped" as const : "open" as const,
      stoppedReason: this.stoppedReason ?? null,
      chargedNanoUsd: unknown.length || this.pending.size ? null : knownChargedNanoUsd,
      knownChargedNanoUsd,
      unknownRequests: unknown.length,
      reservedNanoUsd,
      uncertainExposureNanoUsd,
      availableNanoUsd: null,
      sessions: this.sessions.map(row => ({ ...row })),
      requests: this.requests.map(row => ({ ...row, ...(row.usage ? { usage: { ...row.usage } } : {}) })),
    };
  }

  private assertOpen(): void { if (this.stoppedReason) throw new BudgetStopError(this.stoppedReason); }
  private reject(reason: string): never { this.stop(reason); throw new BudgetStopError(this.stoppedReason!); }
  private requestUpdated(request: RequestCharge): void {
    this.updates.push({ type: "request", request: { ...request, ...(request.usage ? { usage: { ...request.usage } } : {}) } });
  }
}

export type BudgetSnapshot = ReturnType<ControlledBudget["snapshot"]>;
