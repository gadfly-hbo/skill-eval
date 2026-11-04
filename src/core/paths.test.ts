import { test } from "node:test";
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join, isAbsolute, resolve } from "node:path";

import { expandTilde } from "./paths.ts";

/**
 * 入库产物经过脱敏后，skill 路径会写成 `~/...`。
 * 这些测试固化「~ 必须展开」这条规则——否则复跑会静默指向错误路径。
 */

test("展开 ~ 为 home 目录", () => {
  assert.equal(expandTilde("~"), homedir());
});

test("展开 ~/ 前缀的路径", () => {
  assert.equal(expandTilde("~/.workbuddy/skills/data-analysis/SKILL.md"),
    join(homedir(), ".workbuddy/skills/data-analysis/SKILL.md"));
});

test("非 ~ 开头的路径原样返回", () => {
  assert.equal(expandTilde("/abs/path/SKILL.md"), "/abs/path/SKILL.md");
  assert.equal(expandTilde("relative/path.md"), "relative/path.md");
});

test("~user 形式不做展开（避免误解析）", () => {
  assert.equal(expandTilde("~otheruser/x"), "~otheruser/x");
});

test("脱敏后的套件路径能解析到真实 skill", () => {
  const suiteDir = "experiments/data-analysis-2026-10-27";
  const raw = "~/.workbuddy/skills/data-analysis/SKILL.md";
  const expanded = expandTilde(raw);
  const resolved = isAbsolute(expanded) ? expanded : resolve(suiteDir, expanded);
  assert.equal(resolved, join(homedir(), ".workbuddy/skills/data-analysis/SKILL.md"));
  // 关键：不能落进仓库目录里。
  assert.ok(!resolved.includes("/experiments/"));
});
