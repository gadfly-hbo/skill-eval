import test from "node:test";
import assert from "node:assert/strict";
import { FailureEvidence } from "./failure-evidence.ts";

test("tool errors remain observations and a later fatal cause retains its identity through cleanup", () => {
  const evidence = new FailureEvidence("fixture-session");
  evidence.observe({ type: "tool_execution_end", toolCallId: "first", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "private text must not be copied" }], structuredContent: { exit_code: 1 } } }, 12);
  evidence.record("PROVIDER_HTTP_401", "request_error");
  evidence.observe({ type: "controlled_error", code: "REQUEST_ABORTED" }, 13);
  evidence.observe({ type: "tool_execution_end", toolCallId: "parallel", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "partial stdout\n\nCommand aborted" }] } }, 14);
  evidence.observe({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } }, 15);
  const snapshot = evidence.snapshot();
  assert.deepEqual(snapshot.firstCause, { code: "PROVIDER_HTTP_401", incidentType: "request_error", eventIndex: null, toolCallId: null, toolName: null, exitCode: null });
  assert.deepEqual(snapshot.observations, [{ kind: "recoverable_tool_error", eventIndex: 12, toolCallId: "first", toolName: "bash", exitCode: 1, authoritativeFailure: false }]);
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

test("an aborted tool without a fatal session cause remains an observable tool error", () => {
  const evidence = new FailureEvidence("fixture");
  evidence.observe({ type: "tool_execution_end", toolCallId: "unknown", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "Command aborted" }] } }, 0);
  assert.equal(evidence.snapshot().firstCause, null);
  assert.equal(evidence.snapshot().observations[0]?.kind, "recoverable_tool_error");
  evidence.observe({ type: "message_end", message: { role: "assistant", stopReason: "aborted" } }, 1);
  assert.equal(evidence.snapshot().firstCause, null);
  assert.equal(evidence.snapshot().observations[1]?.kind, "native_recovery_event");
  evidence.observe({ type: "native_session_failed", stopReason: "aborted" }, 2);
  assert.equal(evidence.snapshot().firstCause?.code, "NATIVE_SESSION_FAILED");
});


test("native intermediate error and retry remain observations until an actual terminal failure", () => {
  const evidence = new FailureEvidence("native-recovery");
  evidence.observe({ type: "message_end", message: { role: "assistant", stopReason: "error", errorMessage: "PRIVATE_PROVIDER_TEXT" } }, 0);
  evidence.observe({ type: "auto_retry_start", errorMessage: "PRIVATE_PROVIDER_TEXT" }, 1);
  evidence.observe({ type: "message_end", message: { role: "assistant", stopReason: "stop" } }, 2);
  assert.equal(evidence.snapshot().firstCause, null);
  assert.equal(evidence.snapshot().observations.length, 2);
  assert.ok(!JSON.stringify(evidence.snapshot()).includes("PRIVATE_PROVIDER_TEXT"));
  evidence.observe({ type: "native_session_failed", stopReason: "error" }, 3);
  assert.equal(evidence.snapshot().firstCause?.eventIndex, 3);
  assert.equal(evidence.snapshot().firstCause?.code, "NATIVE_SESSION_FAILED");
});
