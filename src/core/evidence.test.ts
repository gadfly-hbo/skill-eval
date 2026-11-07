import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { extractToolCalls, formatEvidence, loadEvidenceFromDir } from "./evidence.ts";
import type { PiEvent } from "./pi.ts";

test("提取只保留判定状态，不构建命令、路径或输出摘要，原事件保持完整", () => {
  const events: PiEvent[] = [
    { type: "tool_execution_start", toolCallId: "private", toolName: "bash", args: { command: "python /private/candidate/secret.py" } },
    { type: "tool_execution_end", toolCallId: "private", toolName: "bash", isError: false, result: { structuredContent: { exit_code: 0, output: "PRIVATE_OUTPUT_SENTINEL" } } },
  ];
  const before = JSON.stringify(events);
  const calls = extractToolCalls(events);
  assert.deepEqual(calls, [{ tool: "bash", isError: false, exitCode: 0 }]);
  assert.equal(JSON.stringify(events), before);
  assert.equal(formatEvidence(calls), "匿名执行结果：成功 1 次；失败 0 次；结果未知 0 次。");
});

test("按 toolCallId 配对交错事件，不把结果归到另一调用", () => {
  const events: PiEvent[] = [
    { type: "tool_execution_start", toolCallId: "first", toolName: "bash" },
    { type: "tool_execution_start", toolCallId: "second", toolName: "bash" },
    { type: "tool_execution_end", toolCallId: "second", toolName: "bash", isError: true, result: { structuredContent: { exit_code: 2 } } },
    { type: "tool_execution_end", toolCallId: "first", toolName: "bash", result: { structuredContent: { exit_code: 0 } } },
  ];
  assert.deepEqual(extractToolCalls(events), [
    { tool: "bash", exitCode: 0, isError: false },
    { tool: "bash", exitCode: 2, isError: true },
  ]);
});

test("start 缺失时仍保留 end 的成功或失败状态", () => {
  const events: PiEvent[] = [
    { type: "tool_execution_end", toolCallId: "end-only", toolName: "bash", isError: true },
  ];
  assert.deepEqual(extractToolCalls(events), [{ tool: "bash", isError: true }]);
  assert.match(formatEvidence(extractToolCalls(events)), /成功 0 次；失败 1 次；结果未知 0 次/);
});

test("只有 start 没有 end 时结果未知", () => {
  const calls = extractToolCalls([
    { type: "tool_execution_start", toolCallId: "unfinished", toolName: "bash" },
  ]);
  assert.deepEqual(calls, [{ tool: "bash" }]);
  assert.match(formatEvidence(calls), /成功 0 次；失败 0 次；结果未知 1 次/);
});

test("匿名计数保留退出码与错误标记的判定优先级", () => {
  const text = formatEvidence([
    { tool: "bash", exitCode: 0, isError: false },
    { tool: "bash", exitCode: 0, isError: true },
    { tool: "bash", exitCode: 2, isError: false },
    { tool: "bash", isError: false },
    { tool: "read", exitCode: 0 },
  ]);
  assert.equal(text, "匿名执行结果：成功 1 次；失败 2 次；结果未知 1 次。");
});

test("加载与文件读取不成为评委质量证据", () => {
  const events: PiEvent[] = [
    { type: "tool_execution_start", toolCallId: "read", toolName: "read", args: { path: "/Users/person/pending/data-analysis/SKILL.md" } },
    { type: "tool_execution_end", toolCallId: "read", toolName: "read", isError: false },
  ];
  assert.equal(formatEvidence(extractToolCalls(events)), "");
});

test("无关事件与缺少 toolCallId 的事件被忽略", () => {
  const events: PiEvent[] = [
    { type: "session", version: 3, id: "x" },
    { type: "message_start", message: { role: "user" } },
    { type: "turn_end" },
    { type: "tool_execution_start", toolName: "bash" },
    { type: "tool_execution_end", toolCallId: "", toolName: "bash" },
  ];
  assert.deepEqual(extractToolCalls(events), []);
  assert.equal(formatEvidence([]), "");
});

test("匿名证据默认统计全部工具调用，保留第16条之后的失败", () => {
  const events: PiEvent[] = Array.from({ length: 30 }, (_, i) => ({
    type: "tool_execution_start",
    toolCallId: `c${i}`,
    toolName: i === 0 ? "read" : "bash",
    args: { command: `echo ${i}`, path: "/private/SKILL.md" },
  }));
  events.push({ type: "tool_execution_end", toolCallId: "c29", toolName: "bash", isError: true });
  assert.equal(extractToolCalls(events).length, 30);
  assert.match(formatEvidence(extractToolCalls(events)), /成功 0 次；失败 1 次；结果未知 28 次/);
  const calls = extractToolCalls(events, { maxCalls: 5 });
  assert.equal(calls.length, 5);
  assert.equal(calls[0]!.tool, "read");
  assert.match(formatEvidence(calls), /结果未知 4 次/);
});

test("读取临时事件文件只输出匿名计数，不改写原事件", () => {
  const root = mkdtempSync(join(tmpdir(), "evidence-"));
  try {
    const raw = JSON.stringify([
      { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "python /Users/person/data-analysis/calc.py" } },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "bash", result: { structuredContent: { exit_code: 0, output: "variant Skill(data-analysis)" } } },
    ]);
    writeFileSync(join(root, "events.json"), raw);
    assert.equal(loadEvidenceFromDir(root), "匿名执行结果：成功 1 次；失败 0 次；结果未知 0 次。");
    assert.equal(readFileSync(join(root, "events.json"), "utf8"), raw);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("事件文件缺失或无效时不提供执行证据", () => {
  const root = mkdtempSync(join(tmpdir(), "evidence-"));
  try {
    assert.equal(loadEvidenceFromDir(root), "");
    writeFileSync(join(root, "events.json"), "not JSON");
    assert.equal(loadEvidenceFromDir(root), "");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
