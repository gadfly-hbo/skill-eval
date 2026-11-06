/** Sanitized first-cause evidence. Observation never changes the strict stop policy. */
import type { PiEvent } from "./pi.ts";

export type PositiveIncidentType = "tool_error" | "worker_error" | "assistant_error" | "request_error" | "timeout" | "startup_error" | "persistence_error" | "tool_aborted_during_cleanup" | "assistant_aborted_during_cleanup";
export interface PositiveFailureCause {
  code: string;
  incidentType: PositiveIncidentType;
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
const identifier = (value: unknown): string | null => typeof value === "string" ? value.slice(0, 256) : null;

export class PositiveFailureEvidence {
  private firstCause: PositiveFailureCause | null = null;
  private secondary: PositiveFailureCause[] = [];
  private observations: OutputObservation[] = [];
  private readonly sessionId: string;
  constructor(sessionId: string) { this.sessionId = sessionId; }

  record(code: string, incidentType: PositiveIncidentType, eventIndex: number | null = null): void {
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
        this.add({ code: cleanup ? "TOOL_ABORTED_DURING_CLEANUP" : "TOOL_EXECUTION_FAILED", incidentType: cleanup ? "tool_aborted_during_cleanup" : "tool_error", eventIndex, toolCallId: identifier(event.toolCallId), toolName: identifier(event.toolName), exitCode });
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
    const message = event.message as { role?: string; stopReason?: string } | undefined;
    if (event.type === "message_end" && message?.role === "assistant" && ["error", "aborted", "length"].includes(message.stopReason ?? "")) {
      const cleanup = this.firstCause !== null && message.stopReason === "aborted";
      this.record(cleanup ? "ASSISTANT_ABORTED_DURING_CLEANUP" : `ASSISTANT_${message.stopReason!.toUpperCase()}`, cleanup ? "assistant_aborted_during_cleanup" : "assistant_error", eventIndex);
      return true;
    }
    return false;
  }

  snapshot() {
    return { schemaVersion: 1, sessionId: this.sessionId, firstCause: this.firstCause ? { ...this.firstCause } : null, secondary: this.secondary.map(cause => ({ ...cause })), observations: this.observations.map(row => ({ ...row })) };
  }

  private add(cause: PositiveFailureCause): void {
    if (this.firstCause === null) this.firstCause = cause;
    else this.secondary.push(cause);
  }
}

export type PositiveFailureSnapshot = ReturnType<PositiveFailureEvidence["snapshot"]>;
