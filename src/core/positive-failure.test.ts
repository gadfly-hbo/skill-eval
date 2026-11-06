import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PositiveFailureEvidence } from "./positive-failure.ts";

test("first structured tool failure retains its identity when cleanup aborts and generic worker errors follow", () => {
  const evidence = new PositiveFailureEvidence("fixture-session");
  evidence.observe({ type: "tool_execution_end", toolCallId: "first", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "private text must not be copied" }], structuredContent: { exit_code: 1 } } }, 12);
  evidence.observe({ type: "controlled_error", code: "WORKER_TOOL_FAILED" }, 13);
  evidence.observe({ type: "tool_execution_end", toolCallId: "parallel", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "partial stdout\n\nCommand aborted" }] } }, 14);
  evidence.observe({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } }, 15);
  const snapshot = evidence.snapshot();
  assert.deepEqual(snapshot.firstCause, { code: "TOOL_EXECUTION_FAILED", incidentType: "tool_error", eventIndex: 12, toolCallId: "first", toolName: "bash", exitCode: 1 });
  assert.equal(snapshot.secondary[1]?.incidentType, "tool_aborted_during_cleanup");
  assert.equal(snapshot.secondary[2]?.incidentType, "assistant_aborted_during_cleanup");
  assert.ok(!JSON.stringify(snapshot).includes("private text"));
});

test("successful reads containing error words and exit-zero shell denials do not become first causes", () => {
  const evidence = new PositiveFailureEvidence("fixture");
  assert.equal(evidence.observe({ type: "tool_execution_end", toolCallId: "read", toolName: "read", isError: false, result: { content: [{ type: "text", text: "if (aborted) { throw Error('Permission denied') }" }] } }, 2), false);
  evidence.observe({ type: "tool_execution_end", toolCallId: "compound", toolName: "bash", isError: false, result: { content: [{ type: "text", text: "ls: Operation not permitted\n{}" }], structuredContent: { exit_code: 0 } } }, 3);
  const snapshot = evidence.snapshot();
  assert.equal(snapshot.firstCause, null);
  assert.deepEqual(snapshot.secondary, []);
  assert.deepEqual(snapshot.observations, [{ kind: "successful_bash_output_mentions_permission_denial", eventIndex: 3, toolCallId: "compound", toolName: "bash", exitCode: 0, authoritativeFailure: false }]);
});

test("a generic request failure remains the first cause when worker termination follows", () => {
  const evidence = new PositiveFailureEvidence("fixture");
  evidence.record("PROVIDER_HTTP_401", "request_error");
  evidence.observe({ type: "controlled_error", code: "CONTROLLED_WORKER_TERMINATED" }, 9);
  assert.equal(evidence.snapshot().firstCause?.code, "PROVIDER_HTTP_401");
  assert.equal(evidence.snapshot().firstCause?.eventIndex, null);
  assert.equal(evidence.snapshot().secondary[0]?.eventIndex, 9);
});

test("a standalone abort without an earlier cause is an error, not assumed cleanup", () => {
  const evidence = new PositiveFailureEvidence("fixture");
  evidence.observe({ type: "tool_execution_end", toolCallId: "unknown", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "Command aborted" }] } }, 0);
  assert.equal(evidence.snapshot().firstCause?.incidentType, "tool_error");
});

const preservedTrace = fileURLToPath(new URL("../../runs/da190-20261106-frozen-v1-positive/cases/baseline/da-positive-json/1/events.json", import.meta.url));
test("the preserved real trace identifies event 359 as first cause without rerunning or changing the record", { skip: !existsSync(preservedTrace) }, () => {
  const bytes = readFileSync(preservedTrace);
  const before = createHash("sha256").update(bytes).digest("hex");
  const evidence = new PositiveFailureEvidence("preserved-failure-readonly");
  JSON.parse(bytes.toString("utf8")).forEach((event: any, index: number) => evidence.observe(event, index));
  const snapshot = evidence.snapshot();
  assert.equal(snapshot.firstCause?.eventIndex, 359);
  assert.equal(snapshot.firstCause?.toolName, "bash");
  assert.equal(snapshot.firstCause?.exitCode, 1);
  assert.equal(snapshot.observations[0]?.eventIndex, 220);
  assert.equal(snapshot.secondary.find(row => row.eventIndex === 362)?.incidentType, "tool_aborted_during_cleanup");
  assert.equal(createHash("sha256").update(readFileSync(preservedTrace)).digest("hex"), before);
});
