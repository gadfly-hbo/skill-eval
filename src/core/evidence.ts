/**
 * 执行证据摘要提取。
 *
 * 为什么需要这个模块：评委的输入只有两份输出文本，看不到工具执行记录。
 * 有些 skill 的核心机制是「用脚本复算」（如 data-analysis 的 `scripts/calc.py`），
 * 输出里会写「全部经 calc.py 复算」——但评委无法核实这句话，
 * 于是把**真实执行过的脚本**判成「无依据断言」。
 *
 * 实测（2026-11-05 data-analysis，trap-incomplete-period #1）：
 * skill 侧确实执行了 `calc.py period`、`calc.py compare`、
 * `quality_check.py --data`、`quality_check.py --report`（events.json 有据），
 * 评委却写「目录中并无任何脚本」并判 loss，直接压低了整体胜率。
 *
 * 解法：把工具执行记录压成一段可读的摘要，注入评委提示词，
 * 并明确告知评委——该节只用于核实「声称做过的事是否真的做过」，
 * 不用于判断内容质量（否则会让评委改用「执行次数多」当质量信号）。
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PiEvent } from "./pi.ts";

/** 单条工具调用的紧凑摘要。 */
export interface ToolCallSummary {
  /** 工具名：read / bash / write / edit 等。 */
  tool: string;
  /** 一句话的动作描述（命令或路径）。 */
  action: string;
  /** 退出码（bash 才有意义）。 */
  exitCode?: number | undefined;
  /** 输出摘要（截断）。 */
  outputExcerpt?: string | undefined;
  /** 该调用是否报错。 */
  isError?: boolean | undefined;
}

export interface EvidenceOptions {
  /** 最多保留多少条工具调用摘要。 */
  maxCalls?: number;
  /** 单条 action 的最大长度。 */
  maxActionChars?: number;
  /** 单条输出摘录的最大长度。 */
  maxOutputChars?: number;
}

const DEFAULT_MAX_CALLS = 16;
const DEFAULT_MAX_ACTION_CHARS = 180;
const DEFAULT_MAX_OUTPUT_CHARS = 220;

/** 把绝对路径压缩成可读形态（保留末两段，避免评委被长路径淹没）。 */
function shortenPath(rawPath: string): string {
  const parts = rawPath.split("/").filter(Boolean);
  if (parts.length <= 2) return rawPath;
  return `…/${parts.slice(-2).join("/")}`;
}

/**
 * 压缩文本里的绝对路径。
 *
 * 评委只需要知道「哪个目录下的哪个文件」，不需要完整路径；
 * 完整路径既占上下文，又会把运行机的用户名带进提示词。
 */
function shortenPathsInText(text: string): string {
  return text.replace(/(?:\/[\w.@+-]+){3,}/g, (match) => shortenPath(match));
}

/** 抽取 bash 命令里的脚本调用特征，让「跑过哪个脚本」一眼可见。 */
function extractScriptCalls(command: string): string[] {
  const calls: string[] = [];
  const re = /([\w./-]*\.(?:py|sh|js|mjs|cjs|ts|rb|pl))/g;
  let match: RegExpExecArray | null = re.exec(command);
  while (match) {
    const name = match[1]!.split("/").pop() ?? match[1]!;
    if (!calls.includes(name)) calls.push(name);
    match = re.exec(command);
  }
  return calls;
}

function summarizeEvent(event: PiEvent, options: Required<EvidenceOptions>): ToolCallSummary | null {
  const tool = typeof event.toolName === "string" ? event.toolName : String(event.type);
  const args = (event.args ?? {}) as Record<string, unknown>;

  if (tool === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command.trim()) return null;
    const scripts = extractScriptCalls(command);
    const scriptHint = scripts.length ? ` [脚本: ${scripts.join(", ")}]` : "";
    const action =
      shortenPathsInText(command.replace(/\s+/g, " ").trim()).slice(0, options.maxActionChars) +
      scriptHint;
    const result = event.result as Record<string, unknown> | undefined;
    const structured = result?.structuredContent as Record<string, unknown> | undefined;
    const outText =
      typeof structured?.output === "string"
        ? structured.output
        : typeof result?.output === "string"
          ? result.output
          : "";
    const exitCode = typeof structured?.exit_code === "number" ? structured.exit_code : undefined;
    return {
      tool,
      action,
      exitCode,
      outputExcerpt: outText.trim().slice(0, options.maxOutputChars) || undefined,
      isError: event.isError === true,
    };
  }

  if (tool === "read" || tool === "write" || tool === "edit") {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return null;
    return { tool, action: `${shortenPath(path)}`, exitCode: 0 };
  }

  return { tool, action: String(tool) };
}

/**
 * 从 pi 事件流中提取工具调用摘要。
 *
 * 只看 `tool_execution_start`（携带 args）与 `tool_execution_end`（携带结果），
 * 按 toolCallId 配对，把结果合并进对应条目。
 */
export function extractToolCalls(events: PiEvent[], options: EvidenceOptions = {}): ToolCallSummary[] {
  const opts: Required<EvidenceOptions> = {
    maxCalls: options.maxCalls ?? DEFAULT_MAX_CALLS,
    maxActionChars: options.maxActionChars ?? DEFAULT_MAX_ACTION_CHARS,
    maxOutputChars: options.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
  };

  const byId = new Map<string, ToolCallSummary>();
  const order: string[] = [];

  for (const event of events) {
    const type = event.type;
    if (type !== "tool_execution_start" && type !== "tool_execution_end") continue;
    const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
    if (!id) continue;

    if (type === "tool_execution_start") {
      const summary = summarizeEvent(event, opts);
      if (!summary) continue;
      byId.set(id, summary);
      order.push(id);
      continue;
    }

    // tool_execution_end：把结果合并进已有条目（start 缺失时也建一条）。
    const existing = byId.get(id);
    const result = event.result as Record<string, unknown> | undefined;
    const structured = result?.structuredContent as Record<string, unknown> | undefined;
    const outText =
      typeof structured?.output === "string"
        ? structured.output
        : typeof result?.output === "string"
          ? result.output
          : "";
    const exitCode = typeof structured?.exit_code === "number" ? structured.exit_code : undefined;
    const isError = event.isError === true;

    if (existing) {
      existing.exitCode = exitCode ?? existing.exitCode;
      existing.outputExcerpt = outText.trim().slice(0, opts.maxOutputChars) || existing.outputExcerpt;
      existing.isError = isError;
      continue;
    }

    const summary = summarizeEvent(event, opts);
    if (!summary) continue;
    summary.exitCode = exitCode;
    summary.outputExcerpt = outText.trim().slice(0, opts.maxOutputChars) || undefined;
    summary.isError = isError;
    byId.set(id, summary);
    order.push(id);
  }

  const list = order.map((id) => byId.get(id)).filter((item): item is ToolCallSummary => Boolean(item));
  return list.slice(0, opts.maxCalls);
}

/**
 * 把工具调用摘要渲染成给评委看的文本块。
 *
 * 返回空字符串表示「没有可呈现的证据」——此时评委提示词里整节都不出现，
 * 避免「（无工具调用记录）」这种空提示干扰评委。
 */
export function formatEvidence(calls: ToolCallSummary[]): string {
  if (!calls.length) return "";
  const lines = calls.map((call, index) => {
    const head = `${index + 1}. [${call.tool}] ${call.action}`;
    const tail: string[] = [];
    if (typeof call.exitCode === "number") tail.push(`退出码 ${call.exitCode}`);
    if (call.isError) tail.push("报错");
    const meta = tail.length ? `（${tail.join("，")}）` : "";
    const out = call.outputExcerpt
      ? `\n   结果：${shortenPathsInText(call.outputExcerpt).replace(/\s+/g, " ").slice(0, 220)}`
      : "";
    return `${head}${meta}${out}`;
  });
  return lines.join("\n");
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
