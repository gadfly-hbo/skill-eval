import test from "node:test";
import assert from "node:assert/strict";
import { FailureEvidence } from "./failure-evidence.ts";

test("first structured tool failure retains its identity when cleanup aborts and generic worker errors follow", () => {
  const evidence = new FailureEvidence("fixture-session");
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
  const evidence = new FailureEvidence("fixture");
  assert.equal(evidence.observe({ type: "tool_execution_end", toolCallId: "read", toolName: "read", isError: false, result: { content: [{ type: "text", text: "if (aborted) { throw Error('Permission denied') }" }] } }, 2), false);
  evidence.observe({ type: "tool_execution_end", toolCallId: "compound", toolName: "bash", isError: false, result: { content: [{ type: "text", text: "ls: Operation not permitted\n{}" }], structuredContent: { exit_code: 0 } } }, 3);
  const snapshot = evidence.snapshot();
  assert.equal(snapshot.firstCause, null);
  assert.deepEqual(snapshot.secondary, []);
  assert.deepEqual(snapshot.observations, [{ kind: "successful_bash_output_mentions_permission_denial", eventIndex: 3, toolCallId: "compound", toolName: "bash", exitCode: 0, authoritativeFailure: false }]);
});

test("a generic request failure remains the first cause when worker termination follows", () => {
  const evidence = new FailureEvidence("fixture");
  evidence.record("PROVIDER_HTTP_401", "request_error");
  evidence.observe({ type: "controlled_error", code: "CONTROLLED_WORKER_TERMINATED" }, 9);
  assert.equal(evidence.snapshot().firstCause?.code, "PROVIDER_HTTP_401");
  assert.equal(evidence.snapshot().firstCause?.eventIndex, null);
  assert.equal(evidence.snapshot().secondary[0]?.eventIndex, 9);
});

test("a standalone abort without an earlier cause is an error, not assumed cleanup", () => {
  const evidence = new FailureEvidence("fixture");
  evidence.observe({ type: "tool_execution_end", toolCallId: "unknown", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "Command aborted" }] } }, 0);
  assert.equal(evidence.snapshot().firstCause?.incidentType, "tool_error");
});
