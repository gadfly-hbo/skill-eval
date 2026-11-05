import assert from "node:assert/strict";
import { test } from "node:test";

import { extractToolCalls, formatEvidence } from "./evidence.ts";
import type { PiEvent } from "./pi.ts";

test("提取 bash 调用并带上退出码与结果摘要", () => {
  const events: PiEvent[] = [
    {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "python3 scripts/calc.py period --base-start 2026-02-01" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
      result: {
        structuredContent: { output: '{"day_ratio":"53.57%"}', exit_code: 0 },
      },
      isError: false,
    },
  ];

  const calls = extractToolCalls(events);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.tool, "bash");
  assert.match(calls[0]!.action, /calc\.py/);
  assert.match(calls[0]!.action, /\[脚本: calc\.py\]/);
  assert.equal(calls[0]!.exitCode, 0);
  assert.match(calls[0]!.outputExcerpt ?? "", /53\.57%/);
});

test("识别执行过的脚本名，便于评委核实「已用脚本复算」的声明", () => {
  const events: PiEvent[] = [
    {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "cd /tmp && python3 /abs/path/scripts/quality_check.py --data da.csv" },
    },
  ];
  const calls = extractToolCalls(events);
  assert.match(calls[0]!.action, /脚本: quality_check\.py/);
});

test("read 调用只保留路径末两段，避免长路径淹没评委", () => {
  const events: PiEvent[] = [
    {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "read",
      args: { path: "/Users/huangbo/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md" },
    },
  ];
  const calls = extractToolCalls(events);
  assert.equal(calls[0]!.tool, "read");
  assert.match(calls[0]!.action, /…\/data-analysis\/SKILL\.md$/);
  assert.doesNotMatch(calls[0]!.action, /huangbo/);
});

test("bash 报错时标记 isError 并保留退出码", () => {
  const events: PiEvent[] = [
    {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "python3 scripts/calc.py compare --label x" },
    },
    {
      type: "tool_execution_end",
      toolCallId: "c1",
      toolName: "bash",
      result: { structuredContent: { output: "syntax error near unexpected token", exit_code: 2 } },
      isError: true,
    },
  ];
  const calls = extractToolCalls(events);
  assert.equal(calls[0]!.isError, true);
  assert.equal(calls[0]!.exitCode, 2);
});

test("只有 start 没有 end 时仍保留该次调用", () => {
  const events: PiEvent[] = [
    {
      type: "tool_execution_start",
      toolCallId: "c1",
      toolName: "bash",
      args: { command: "python3 scripts/calc.py trend" },
    },
  ];
  const calls = extractToolCalls(events);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.exitCode, undefined);
});

test("无关事件类型被忽略", () => {
  const events: PiEvent[] = [
    { type: "session", version: 3, id: "x" },
    { type: "message_start", message: { role: "user" } },
    { type: "turn_end" },
  ];
  assert.deepEqual(extractToolCalls(events), []);
  assert.equal(formatEvidence([]), "");
});

test("格式化输出包含序号、工具名、退出码与结果摘要", () => {
  const text = formatEvidence([
    { tool: "bash", action: "python3 scripts/calc.py period", exitCode: 0, outputExcerpt: "OK" },
    { tool: "read", action: "…/data-analysis/SKILL.md", exitCode: 0 },
  ]);
  assert.match(text, /1\. \[bash\]/);
  assert.match(text, /2\. \[read\]/);
  assert.match(text, /退出码 0/);
  assert.match(text, /结果：OK/);
});

test("超过 maxCalls 时截断", () => {
  const events: PiEvent[] = Array.from({ length: 30 }, (_, i) => ({
    type: "tool_execution_start",
    toolCallId: `c${i}`,
    toolName: "bash",
    args: { command: `echo ${i}` },
  }));
  assert.equal(extractToolCalls(events, { maxCalls: 5 }).length, 5);
});
