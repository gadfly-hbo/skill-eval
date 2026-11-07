import assert from "node:assert/strict";
import { test } from "node:test";
import { ControlledBudget } from "./controlled-budget.ts";

const subject = "minimax-cn/MiniMax-M3.1-Flash";
const judge = "xiaomi-token-plan-cn/mimo-v2.6-flash";

test("原生上限与无预算封顶允许超过八会话及一美元的已授权实验", () => {
  const ledger = new ControlledBudget();
  for (let index = 0; index < 10; index++) {
    ledger.beginSession(`native-${index}`, "subject", subject);
    const request = ledger.reserve(`native-http-${index}`);
    assert.equal(request.maxOutputTokens, 524288);
    ledger.settle(`native-http-${index}`, { input: 900000, output: 4096 });
    ledger.endSession();
  }
  assert.ok(ledger.snapshot().chargedNanoUsd! > 1_000_000_000);
  assert.equal(ledger.snapshot().policy.maxNanoUsd, null);
  assert.equal(ledger.snapshot().policy.maxSessions, null);
  assert.equal(ledger.snapshot().availableNanoUsd, null);
  assert.equal(ledger.snapshot().sessions.length, 10);
});

test("未知费用不伪造为零或封顶扣款，原生重试仍可继续并独立记账", () => {
  const ledger = new ControlledBudget();
  ledger.beginSession("native-retry", "subject", subject);
  ledger.reserve("http-429");
  ledger.failRequest("http-429", "PROVIDER_HTTP_429");
  assert.equal(ledger.snapshot().state, "open");
  assert.equal(ledger.snapshot().requests[0]?.chargedNanoUsd, null);
  assert.equal(ledger.snapshot().chargedNanoUsd, null);
  ledger.reserve("http-recovered");
  ledger.settle("http-recovered", { input: 1, output: 1 });
  ledger.endSession();
  assert.equal(ledger.snapshot().state, "open");
  assert.equal(ledger.snapshot().sessions[0]?.state, "completed");
  assert.equal(ledger.snapshot().requests[1]?.chargedNanoUsd, 750);
  assert.equal(ledger.snapshot().chargedNanoUsd, null);
});

test("记账前保存原生窗口最坏估计，完整 usage 后记录已知费用", () => {
  const budget = new ControlledBudget();
  budget.beginSession("baseline-1", "subject", subject);
  assert.equal(budget.reserve("http-1").reservedNanoUsd, 464_572_800);
  assert.equal(budget.snapshot().availableNanoUsd, null);
  assert.equal(budget.snapshot().chargedNanoUsd, null);
  budget.settle("http-1", { input: 1000, output: 100, cacheRead: 500, cacheWrite: 100 });
  budget.endSession();
  assert.equal(budget.snapshot().chargedNanoUsd, 300_000);
  assert.equal(budget.snapshot().knownChargedNanoUsd, 300_000);
  assert.equal(budget.snapshot().availableNanoUsd, null);
  assert.equal(budget.snapshot().requests[0]?.state, "settled");
});

test("受控预算把评委套餐请求也纳入同一账本，不使用 SDK 零费用字段", () => {
  const budget = new ControlledBudget();
  budget.beginSession("subject-1", "subject", subject);
  budget.reserve("subject-http-1");
  budget.settle("subject-http-1", { input: 1, output: 1 });
  budget.endSession();
  budget.beginSession("judge-1", "judge", judge);
  assert.equal(budget.reserve("judge-http-1").reservedNanoUsd, 183_500_800);
  budget.settle("judge-http-1", { input: 2000, cacheRead: 1000, output: 500 });
  budget.endSession();
  assert.equal(budget.snapshot().chargedNanoUsd, 560_750);
  assert.equal(budget.snapshot().requests[1]?.role, "judge");
  assert.equal(budget.snapshot().sessions.length, 2);
});

test("真实Host停止保留未知请求和首次原因，不把最坏估计冒充已知费用", () => {
  const budget = new ControlledBudget();
  budget.beginSession("failed", "subject", subject);
  budget.reserve("uncertain-charge");
  budget.stop("HOST_EVIDENCE_WRITE_FAILED");
  budget.stop("later-cleanup");
  assert.equal(budget.snapshot().chargedNanoUsd, null);
  assert.equal(budget.snapshot().knownChargedNanoUsd, 0);
  assert.equal(budget.snapshot().uncertainExposureNanoUsd, 464_572_800);
  assert.equal(budget.snapshot().reservedNanoUsd, 0);
  assert.equal(budget.snapshot().stoppedReason, "HOST_EVIDENCE_WRITE_FAILED");
  assert.equal(budget.snapshot().requests[0]?.state, "failed");
  assert.equal(budget.snapshot().sessions[0]?.state, "failed");
  assert.throws(() => budget.reserve("retry"), /HOST_EVIDENCE_WRITE_FAILED/);
  assert.throws(() => budget.beginSession("next", "judge", judge), /HOST_EVIDENCE_WRITE_FAILED/);
});

test("非法或超出原生目录的 usage 记为未知，账本不剥夺SDK恢复机会", () => {
  const invalid = [undefined, null, {}, { input: 0, output: 0 }, { input: -1, output: 1 },
    { input: 1, output: 0.5 }, { input: NaN, output: 1 }, { input: Infinity, output: 1 },
    { input: Number.MAX_SAFE_INTEGER + 1, output: 1 }, { input: 1_000_000, cacheRead: 1, output: 1 },
    { input: 1, output: 524289 }, { input: 1, output: 1, cacheRead: null }];
  for (const usage of invalid) {
    const budget = new ControlledBudget();
    budget.beginSession("invalid", "subject", subject);
    budget.reserve("http");
    assert.throws(() => budget.settle("http", usage as never), JSON.stringify(usage));
    budget.failRequest("http", "INVALID_PROVIDER_USAGE");
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    assert.equal(budget.snapshot().requests[0]?.usageStatus, "unknown");
    assert.equal(budget.snapshot().state, "open");
    assert.doesNotThrow(() => budget.reserve("sdk-retry"));
  }
});

test("错误模型、并发实验会话、重复 ID 和错配结算仍是Host协议错误", () => {
  const wrongModel = new ControlledBudget();
  assert.throws(() => wrongModel.beginSession("wrong", "subject", "minimax-cn/MiniMax-M3"), /model-identity-mismatch/);
  assert.equal(wrongModel.snapshot().sessions.length, 0);
  for (const action of ["concurrent-session", "mismatched-usage"] as const) {
    const budget = new ControlledBudget();
    budget.beginSession("one", "subject", subject);
    budget.reserve("http");
    assert.throws(() => {
      if (action === "concurrent-session") budget.beginSession("two", "judge", judge);
      if (action === "mismatched-usage") budget.settle("another", { input: 1, output: 1 });
    });
    assert.equal(budget.snapshot().chargedNanoUsd, null);
    assert.equal(budget.snapshot().state, "stopped");
  }
  const duplicate = new ControlledBudget();
  duplicate.beginSession("one", "subject", subject);
  duplicate.reserve("http");
  duplicate.settle("http", { input: 1, output: 1 });
  assert.throws(() => duplicate.reserve("http"), /invalid-or-duplicate-request/);
});

test("账本快照可序列化且修改返回值不会改写历史或收费", () => {
  const budget = new ControlledBudget();
  budget.beginSession("one", "subject", subject);
  budget.reserve("http");
  budget.settle("http", { input: 1, output: 1 });
  const copy = budget.snapshot();
  copy.requests[0]!.usage!.input = 1_000_000;
  copy.requests[0]!.chargedNanoUsd = 0;
  copy.sessions[0]!.state = "completed";
  assert.equal(JSON.parse(JSON.stringify(budget.snapshot())).chargedNanoUsd, 750);
  assert.equal(budget.snapshot().requests[0]?.usage?.input, 1);
  assert.equal(budget.snapshot().sessions[0]?.state, "running");
});

test("运行时非法角色不能通过原型属性绕过精确模型与额度检查", () => {
  const budget = new ControlledBudget();
  assert.throws(() => budget.beginSession("invalid-role", "toString" as never, undefined as never), /invalid-session-role/);
  assert.equal(budget.snapshot().sessions.length, 0);
  assert.equal(budget.snapshot().availableNanoUsd, null);
});

test("SDK同会话并行HTTP按请求ID分别结算，样本失败不连坐下一样本", () => {
  const ledger = new ControlledBudget();
  ledger.beginSession("parallel-native", "subject", subject);
  ledger.reserve("foreground");
  ledger.reserve("sdk-background");
  ledger.settle("sdk-background", { input: 10, output: 2 });
  ledger.failRequest("foreground", "SDK_FINAL_ERROR");
  ledger.endSession(false);
  assert.equal(ledger.snapshot().state, "open");
  assert.equal(ledger.snapshot().sessions[0]?.state, "failed");
  assert.equal(ledger.snapshot().knownChargedNanoUsd, 2700);
  assert.equal(ledger.snapshot().unknownRequests, 1);
  ledger.beginSession("next-sample", "judge", judge);
  ledger.reserve("next-sample-http");
  ledger.settle("next-sample-http", { input: 1, output: 1 });
  ledger.endSession();
  assert.equal(ledger.snapshot().sessions[1]?.state, "completed");
  assert.equal(ledger.snapshot().knownChargedNanoUsd, 3120);
  assert.equal(ledger.snapshot().chargedNanoUsd, null);
});

test("真实模型目录限额由调用方注入并冻结，历史pinned值不覆盖目录", () => {
  const supplied = { subject: { contextWindow: 2_000_000, maxOutputTokens: 600_000 }, judge: { contextWindow: 900_000, maxOutputTokens: 140_000 } };
  const ledger = new ControlledBudget(supplied);
  supplied.subject.maxOutputTokens = 1;
  assert.equal(ledger.getModelLimits("subject").maxOutputTokens, 600_000);
  assert.equal(ledger.snapshot().policy.models.judge.maxOutputTokens, 140_000);
  ledger.beginSession("catalog-bound", "subject", subject);
  assert.equal(ledger.reserve("catalog-http").maxOutputTokens, 600_000);
  ledger.settle("catalog-http", { input: 1_200_000, output: 550_000 });
  ledger.endSession();
  assert.equal(ledger.snapshot().chargedNanoUsd, 510_000_000);
  assert.throws(() => new ControlledBudget({ subject: { contextWindow: 100, maxOutputTokens: 101 } }), /NATIVE_MODEL_LIMITS_INVALID/);
});

test("SDK取消与HTTP收尾竞态不误停下一样本，迟到usage可补充未知费用", () => {
  const ledger = new ControlledBudget();
  ledger.beginSession("cancelled-sample", "subject", subject);
  ledger.reserve("late-http");
  ledger.endSession(false);
  assert.doesNotThrow(() => ledger.failRequest("late-http", "LATE_ABORT"));
  assert.equal(ledger.snapshot().state, "open");
  assert.equal(ledger.snapshot().chargedNanoUsd, null);
  ledger.beginSession("next-sample", "judge", judge);
  ledger.settle("late-http", { input: 100, output: 20 });
  assert.equal(ledger.snapshot().chargedNanoUsd, 27000);
  assert.equal(ledger.snapshot().sessions[0]?.state, "failed");
  assert.equal(ledger.snapshot().sessions[1]?.state, "running");
  assert.doesNotThrow(() => ledger.failRequest("late-http", "LATE_COMPLETION_CLEANUP"));
  ledger.reserve("host-cancelled-http");
  ledger.stop("USER_CANCELLED");
  ledger.settle("host-cancelled-http", { input: 2, output: 1 });
  assert.equal(ledger.snapshot().state, "stopped");
  assert.equal(ledger.snapshot().chargedNanoUsd, 27560);
  assert.throws(() => ledger.reserve("after-stop"), /USER_CANCELLED/);
});

test("SDK主结果成功时后台请求取消只影响费用完整性，不改写会话成功", () => {
  const ledger = new ControlledBudget();
  ledger.beginSession("native-background", "subject", subject);
  ledger.reserve("foreground");
  ledger.settle("foreground", { input: 1, output: 1 });
  ledger.reserve("cache-warming");
  ledger.endSession(true);
  assert.equal(ledger.snapshot().sessions[0]?.state, "completed");
  assert.equal(ledger.snapshot().state, "open");
  assert.equal(ledger.snapshot().chargedNanoUsd, null);
  assert.equal(ledger.snapshot().knownChargedNanoUsd, 750);
  assert.equal(ledger.snapshot().requests[1]?.usageStatus, "unknown");
});

test("增量队列保留每次行变更的原值，读走和修改副本不改写账本历史", () => {
  const ledger = new ControlledBudget();
  assert.equal(ledger.drainUpdates()[0]?.type, "policy");
  ledger.beginSession("journal-session", "subject", subject);
  ledger.reserve("reported");
  ledger.settle("reported", { input: 1, output: 1 });
  ledger.reserve("unknown");
  ledger.failRequest("unknown", "SDK_FINAL_ERROR");
  ledger.endSession(false);
  ledger.stop("HOST_STOP");
  const updates = ledger.drainUpdates();
  const requests = updates.filter(row => row.type === "request");
  assert.deepEqual(requests.map(row => row.request.state), ["pending", "settled", "pending", "failed"]);
  assert.equal(requests[0]?.request.chargedNanoUsd, null);
  assert.equal(requests[1]?.request.chargedNanoUsd, 750);
  assert.equal(requests[3]?.request.usageStatus, "unknown");
  assert.deepEqual(updates.filter(row => row.type === "session").map(row => row.session.state), ["running", "failed"]);
  assert.deepEqual(updates.at(-1), { type: "state", state: "stopped", stoppedReason: "HOST_STOP" });
  requests[1]!.request.usage!.input = 999;
  assert.equal(ledger.snapshot().requests[0]?.usage?.input, 1);
  assert.deepEqual(ledger.drainUpdates(), []);
});
