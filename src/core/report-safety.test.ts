import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRecomputeGuard } from "./report-safety.ts";

test("重算拿到运行记录 → 放行", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 20,
    storedResultCount: 20,
    hasStored: true,
  });
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.reason, null);
});

test("重算为空但原摘要有记录 → 拒绝写盘", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 0,
    storedResultCount: 20,
    hasStored: true,
  });
  assert.equal(verdict.blocked, true);
  assert.match(verdict.reason ?? "", /20 条运行记录/);
  assert.ok(verdict.hint);
});

test("重算为空且原摘要也为空 → 放行（覆盖无损失）", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 0,
    storedResultCount: 0,
    hasStored: true,
  });
  assert.equal(verdict.blocked, false);
});

test("原摘要不存在且重算为空 → 放行", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 0,
    storedResultCount: 0,
    hasStored: false,
  });
  assert.equal(verdict.blocked, false);
});

test("拒绝原因包含原摘要的记录条数，便于定位", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 0,
    storedResultCount: 137,
    hasStored: true,
  });
  assert.match(verdict.reason ?? "", /137/);
});

test("提示里给出两条可操作的出路", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 0,
    storedResultCount: 5,
    hasStored: true,
  });
  assert.match(verdict.hint ?? "", /--suite-file/);
  assert.match(verdict.hint ?? "", /cases\//);
});

test("有记录时不给提示", () => {
  const verdict = evaluateRecomputeGuard({
    resultCount: 1,
    storedResultCount: 1,
    hasStored: true,
  });
  assert.equal(verdict.hint, null);
});
