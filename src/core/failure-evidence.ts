/** Sanitized execution observations and the first fatal execution cause. */
import type { PiEvent } from "./pi.ts";

export const TOOL_ERROR_POLICY_VERSION = "native-agent-recovery-v2";

export type IncidentType = "tool_error" | "worker_error" | "assistant_error" | "request_error" | "timeout" | "startup_error" | "persistence_error" | "tool_aborted_during_cleanup" | "assistant_aborted_during_cleanup";
export interface FailureCause {
  code: string;
  incidentType: IncidentType;
  eventIndex: number | null;
  toolCallId: string | null;
  toolName: string | null;
  exitCode: number | null;
}
interface OutputObservation {
  kind: "successful_bash_output_mentions_permission_denial";
  eventIndex: number;
  toolCallId: string | null;
  toolName: string;
  exitCode: 0;
  authoritativeFailure: false;
}
interface ToolErrorObservation {
  kind: "recoverable_tool_error";
  eventIndex: number;
  toolCallId: string | null;
  toolName: string | null;
  exitCode: number | null;
  authoritativeFailure: false;
}
interface NativeRecoveryObservation {
  kind: "native_recovery_event";
  eventIndex: number;
  eventType: string;
  stopReason: string | null;
  authoritativeFailure: false;
}
const identifier = (value: unknown): string | null => typeof value === "string" ? value.slice(0, 256) : null;

export class FailureEvidence {
  private firstCause: FailureCause | null = null;
  private secondary: FailureCause[] = [];
  private observations: Array<OutputObservation | ToolErrorObservation | NativeRecoveryObservation> = [];
  private readonly sessionId: string;
  constructor(sessionId: string) { this.sessionId = sessionId; }
  hasFatalCause(): boolean { return this.firstCause !== null; }

  record(code: string, incidentType: IncidentType, eventIndex: number | null = null): void {
    this.add({ code: /^[A-Z][A-Z0-9_]{0,100}$/.test(code) ? code : "CONTROLLED_FAILURE", incidentType, eventIndex, toolCallId: null, toolName: null, exitCode: null });
  }

  observe(event: PiEvent, eventIndex: number): boolean {
    if (event.type === "tool_execution_end") {
      const result = event.result as { content?: Array<{ type?: string; text?: string }>; structuredContent?: { exit_code?: unknown; output?: unknown } } | undefined;
      const exit = result?.structuredContent?.exit_code;
      const exitCode = typeof exit === "number" && Number.isSafeInteger(exit) ? exit : null;
      const content = (result?.content ?? []).filter(block => block?.type === "text" && typeof block.text === "string").map(block => block.text).join("\n").trim();
      if (event.isError === true) {
        const cleanup = this.firstCause !== null && exitCode === null && (content === "Command aborted" || content.endsWith("\nCommand aborted"));
        if (cleanup) this.add({ code: "TOOL_ABORTED_DURING_CLEANUP", incidentType: "tool_aborted_during_cleanup", eventIndex, toolCallId: identifier(event.toolCallId), toolName: identifier(event.toolName), exitCode });
        else this.observations.push({ kind: "recoverable_tool_error", eventIndex, toolCallId: identifier(event.toolCallId), toolName: identifier(event.toolName), exitCode, authoritativeFailure: false });
        return true;
      }
      // Native bash reports the final shell status. Text only documents a possible
      // subcommand denial: it is never promoted to an error or used by the stopper.
      if (event.isError === false && event.toolName === "bash" && exitCode === 0 && /Operation not permitted|Permission denied|\bEPERM\b|\bEACCES\b/.test(content)) {
        this.observations.push({ kind: "successful_bash_output_mentions_permission_denial", eventIndex, toolCallId: identifier(event.toolCallId), toolName: "bash", exitCode: 0, authoritativeFailure: false });
        return true;
      }
    }
    if (event.type === "controlled_error") {
      this.record(typeof event.code === "string" ? event.code : "WORKER_ERROR", "worker_error", eventIndex);
      return true;
    }
    if (event.type === "native_session_failed") {
      this.record("NATIVE_SESSION_FAILED", "assistant_error", eventIndex);
      return true;
    }
    const message = event.message as { role?: string; stopReason?: string } | undefined;
    if (event.type === "message_end" && message?.role === "assistant" && ["error", "aborted", "length", "deferred", "pending"].includes(message.stopReason ?? "")) {
      const cleanup = this.firstCause !== null && message.stopReason === "aborted";
      if (cleanup) this.record("ASSISTANT_ABORTED_DURING_CLEANUP", "assistant_aborted_during_cleanup", eventIndex);
      else this.observations.push({ kind: "native_recovery_event", eventIndex, eventType: event.type, stopReason: message.stopReason ?? null, authoritativeFailure: false });
      return true;
    }
    if (["auto_retry_start", "auto_retry_end", "compaction_start", "compaction_end"].includes(event.type)) {
      this.observations.push({ kind: "native_recovery_event", eventIndex, eventType: event.type, stopReason: null, authoritativeFailure: false });
      return true;
    }
    return false;
  }

  snapshot() {
    return { schemaVersion: 1, toolErrorPolicy: TOOL_ERROR_POLICY_VERSION, sessionId: this.sessionId, firstCause: this.firstCause ? { ...this.firstCause } : null, secondary: this.secondary.map(cause => ({ ...cause })), observations: this.observations.map(row => ({ ...row })) };
  }

  private add(cause: FailureCause): void {
    if (this.firstCause === null) this.firstCause = cause;
    else this.secondary.push(cause);
  }
}

export type FailureSnapshot = ReturnType<FailureEvidence["snapshot"]>;
