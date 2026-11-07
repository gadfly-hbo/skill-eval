/**
 * 执行证据摘要：完整动作与结果留在原始事件中用于复核；
 * 评委只接收匿名执行成功/失败/未知计数，不接收加载读取、文件名、命令或路径。
 * 计数只能证明发生过执行，不能证明某个具体脚本、计算或结论正确。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PiEvent } from "./pi.ts";

/** 给匿名执行计数使用的工具状态。完整动作与输出仅保留在原始事件中。 */
export interface ToolCallSummary {
  /** 工具名：read / bash / write / edit 等。 */
  tool: string;
  /** 退出码（bash 才有意义）。 */
  exitCode?: number | undefined;
  /** 该调用是否报错。 */
  isError?: boolean | undefined;
}

export interface EvidenceOptions {
  /** 最多保留多少条工具调用摘要。 */
  maxCalls?: number;
}

/**
 * 从 pi 事件流中提取工具调用摘要。
 *
 * 只看 `tool_execution_start` 与 `tool_execution_end`，按 toolCallId 配对。
 * 不读取命令、路径或输出正文。
 */
export function extractToolCalls(events: PiEvent[], options: EvidenceOptions = {}): ToolCallSummary[] {
  const byId = new Map<string, ToolCallSummary>();
  const order: string[] = [];

  for (const event of events) {
    const type = event.type;
    if (type !== "tool_execution_start" && type !== "tool_execution_end") continue;
    const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
    if (!id) continue;

    let summary = byId.get(id);
    if (!summary) {
      summary = { tool: typeof event.toolName === "string" ? event.toolName : type };
      byId.set(id, summary);
      order.push(id);
    }

    if (type === "tool_execution_start") continue;

    const result = event.result as Record<string, unknown> | undefined;
    const structured = result?.structuredContent as Record<string, unknown> | undefined;
    if (typeof structured?.exit_code === "number") {
      summary.exitCode = structured.exit_code;
    }
    summary.isError = event.isError === true;
  }

  const list = order.map((id) => byId.get(id)).filter((item): item is ToolCallSummary => Boolean(item));
  return options.maxCalls === undefined ? list : list.slice(0, options.maxCalls);
}

/**
 * 把工具调用摘要渲染成给评委看的文本块。
 *
 * 返回空字符串表示「没有可呈现的证据」——此时评委提示词里整节都不出现，
 * 避免「（无工具调用记录）」这种空提示干扰评委。
 */
export function formatEvidence(calls: ToolCallSummary[]): string {
  // 原始动作/路径/命令/输出保留在事件证据内，盲审只传执行结果计数。
  // 加载与资料读取不参与质量证据，避免其成为候选身份信号。
  const execution = calls.filter((call) => call.tool === "bash");
  if (!execution.length) return "";
  const failed = execution.filter((call) => call.isError || (typeof call.exitCode === "number" && call.exitCode !== 0)).length;
  const succeeded = execution.filter((call) => !call.isError && call.exitCode === 0).length;
  const unknown = execution.length - failed - succeeded;
  return `匿名执行结果：成功 ${succeeded} 次；失败 ${failed} 次；结果未知 ${unknown} 次。`;
}

/**
 * 从运行目录的 events.json 读取事件并生成证据摘要。
 *
 * 读不到文件时返回空字符串（不抛异常）——证据是增强项，
 * 缺失不应影响评判主流程。
 */
export function loadEvidenceFromDir(caseDir: string, options: EvidenceOptions = {}): string {
  try {
    const raw = readFileSync(join(caseDir, "events.json"), "utf8");
    const events = JSON.parse(raw) as PiEvent[];
    return formatEvidence(extractToolCalls(events, options));
  } catch {
    return "";
  }
}
