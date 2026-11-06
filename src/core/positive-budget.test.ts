import assert from "node:assert/strict";
import { test } from "node:test";
import { PositiveBudget } from "./positive-budget.ts";

const subject = "minimax-cn/MiniMax-M3.1-Flash";
const judge = "xiaomi-token-plan-cn/mimo-v2.6-flash";

test("阳性预算在请求前预留上下文最坏费用，完整 usage 后按保守等价值结算", () => {
  const budget = new PositiveBudget();
  budget.beginSession("baseline-1", "subject", subject);
  assert.equal(budget.reserve("http-1").reservedNanoUsd, 152_457_600);
  assert.equal(budget.snapshot().availableNanoUsd, 847_542_400);
  budget.settle("http-1", { input: 1000, output: 100, cacheRead: 500, cacheWrite: 100 });
  budget.endSession();
  assert.equal(budget.snapshot().chargedNanoUsd, 300_000);
  assert.equal(budget.snapshot().availableNanoUsd, 999_700_000);
  assert.equal(budget.snapshot().requests[0]?.state, "settled");
});

test("阳性预算把评委套餐请求也纳入同一账本，不使用 SDK 零费用字段", () => {
  const budget = new PositiveBudget();
  budget.beginSession("judge-1", "judge", judge);
  assert.equal(budget.reserve("judge-http-1").reservedNanoUsd, 147_087_360);
  budget.settle("judge-http-1", { input: 2000, cacheRead: 1000, output: 500 });
  budget.endSession();
  assert.equal(budget.snapshot().chargedNanoUsd, 560_000);
  assert.equal(budget.snapshot().requests[0]?.role, "judge");
});

test("第九个会话在启动前拒绝，已完成的八个会话全部保留", () => {
  const budget = new PositiveBudget();
  for (let index = 0; index < 8; index++) {
    const role = index < 4 ? "subject" : "judge";
    budget.beginSession(`session-${index}`, role, role === "subject" ? subject : judge);
    budget.reserve(`http-${index}`);
    budget.settle(`http-${index}`, { input: 1, output: 1 });
    budget.endSession();
  }
  assert.throws(() => budget.beginSession("session-8", "judge", judge), /session-limit/);
  assert.equal(budget.snapshot().sessions.length, 8);
  assert.ok(budget.snapshot().sessions.every(row => row.state === "completed"));
});

test("美元预算不足时在下一请求前阻断，不能靠更多工具循环绕过", () => {
  const budget = new PositiveBudget();
  budget.beginSession("many-turns", "subject", subject);
  for (let index = 0; index < 6; index++) {
    budget.reserve(`http-${index}`);
    budget.settle(`http-${index}`, { input: 1_000_000, output: 4096 });
  }
  assert.throws(() => budget.reserve("blocked-http"), /budget-exhausted-before-dispatch/);
  assert.equal(budget.snapshot().requests.length, 6);
  assert.equal(budget.snapshot().chargedNanoUsd, 914_745_600);
  assert.equal(budget.snapshot().availableNanoUsd, 85_254_400);
});

test("请求失败或主动停止保留全部预留费用，阻断后续会话并保留首次原因", () => {
  const budget = new PositiveBudget();
  budget.beginSession("failed", "subject", subject);
  budget.reserve("uncertain-charge");
  budget.failRequest("uncertain-charge", "http-401");
  budget.stop("later-cleanup");
  assert.equal(budget.snapshot().chargedNanoUsd, 152_457_600);
  assert.equal(budget.snapshot().reservedNanoUsd, 0);
  assert.equal(budget.snapshot().stoppedReason, "http-401");
  assert.equal(budget.snapshot().requests[0]?.state, "failed");
  assert.equal(budget.snapshot().sessions[0]?.state, "failed");
  assert.throws(() => budget.reserve("retry"), /http-401/);
  assert.throws(() => budget.beginSession("next", "judge", judge), /http-401/);
});

test("缺失、全零、负数、小数、溢出和超出预留的 usage 都不能释放预算", () => {
  const invalid = [undefined, null, {}, { input: 0, output: 0 }, { input: -1, output: 1 },
    { input: 1, output: 0.5 }, { input: NaN, output: 1 }, { input: Infinity, output: 1 },
    { input: Number.MAX_SAFE_INTEGER + 1, output: 1 }, { input: 1_000_000, cacheRead: 1, output: 1 },
    { input: 1, output: 4097 }, { input: 1, output: 1, cacheRead: null }];
  for (const usage of invalid) {
    const budget = new PositiveBudget();
    budget.beginSession("invalid", "subject", subject);
    budget.reserve("http");
    assert.throws(() => budget.settle("http", usage as never), JSON.stringify(usage));
    assert.equal(budget.snapshot().chargedNanoUsd, 152_457_600);
    assert.equal(budget.snapshot().state, "stopped");
  }
});

test("错误模型、并发请求、重复 ID 和未结算会话均失败关闭", () => {
  const wrongModel = new PositiveBudget();
  assert.throws(() => wrongModel.beginSession("wrong", "subject", "minimax-cn/MiniMax-M3"), /model-identity-mismatch/);
  assert.equal(wrongModel.snapshot().sessions.length, 0);
  for (const action of ["concurrent-request", "concurrent-session", "incomplete-session", "mismatched-usage"] as const) {
    const budget = new PositiveBudget();
    budget.beginSession("one", "subject", subject);
    budget.reserve("http");
    assert.throws(() => {
      if (action === "concurrent-request") budget.reserve("http-2");
      if (action === "concurrent-session") budget.beginSession("two", "judge", judge);
      if (action === "incomplete-session") budget.endSession();
      if (action === "mismatched-usage") budget.settle("another", { input: 1, output: 1 });
    });
    assert.equal(budget.snapshot().chargedNanoUsd, 152_457_600);
    assert.equal(budget.snapshot().state, "stopped");
  }
  const duplicate = new PositiveBudget();
  duplicate.beginSession("one", "subject", subject);
  duplicate.reserve("http");
  duplicate.settle("http", { input: 1, output: 1 });
  assert.throws(() => duplicate.reserve("http"), /invalid-or-duplicate-request/);
});

test("账本快照可序列化且修改返回值不会改写历史或收费", () => {
  const budget = new PositiveBudget();
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
  const budget = new PositiveBudget();
  assert.throws(() => budget.beginSession("invalid-role", "toString" as never, undefined as never), /invalid-session-role/);
  assert.equal(budget.snapshot().sessions.length, 0);
  assert.equal(budget.snapshot().availableNanoUsd, 1_000_000_000);
});
