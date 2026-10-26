import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectActivation, summarizeActivation, parseFrontmatter } from "./activation.ts";

/** 创建一个临时 skill 文件，返回其路径。 */
function makeSkill(name: string, description: string): string {
  const dir = mkdtempSync(join(tmpdir(), "skill-eval-act-"));
  const skillDir = join(dir, name);
  mkdirSync(skillDir, { recursive: true });
  const path = join(skillDir, "SKILL.md");
  writeFileSync(path, `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n内容正文。\n`, "utf8");
  return path;
}

test("工具调用读取 skill 判定为激活", () => {
  const path = makeSkill("json-only", "结构化输出");
  const result = detectActivation({
    skillPaths: [path],
    readPaths: [path],
    output: "任意输出",
  });
  assert.equal(result.activated, true);
  assert.equal(result.status, "activated");
  assert.equal(result.readSkillPaths.length, 1);
});

test("只有关键词命中而无工具取证判定为弱激活", () => {
  const path = makeSkill("json-only", "结构化输出");
  const result = detectActivation({
    skillPaths: [path],
    readPaths: [],
    output: "这次使用 json-only 模式输出",
  });
  assert.equal(result.activated, false);
  assert.equal(result.status, "weak");
  assert.ok(result.matchedKeywords.length > 0);
});

test("既无工具取证也无关键词判定为未激活", () => {
  const path = makeSkill("json-only", "结构化输出");
  const result = detectActivation({
    skillPaths: [path],
    readPaths: [],
    output: "普通回答",
  });
  assert.equal(result.activated, false);
  assert.equal(result.status, "not_activated");
});

test("读取其他文件不算激活目标 skill", () => {
  const path = makeSkill("json-only", "结构化输出");
  const result = detectActivation({
    skillPaths: [path],
    readPaths: ["/tmp/other-file.md"],
    output: "任意输出",
  });
  assert.equal(result.activated, false);
});

test("关闭关键词信号后弱激活不再成立", () => {
  const path = makeSkill("json-only", "结构化输出");
  const result = detectActivation({
    skillPaths: [path],
    readPaths: [],
    output: "这次使用 json-only 模式输出",
    keywordSignal: false,
  });
  assert.equal(result.status, "not_activated");
});

test("多 skill 时任一被读取即视为激活", () => {
  const a = makeSkill("alpha", "甲能力");
  const b = makeSkill("beta", "乙能力");
  const result = detectActivation({
    skillPaths: [a, b],
    readPaths: [b],
    output: "",
  });
  assert.equal(result.activated, true);
  assert.deepEqual(result.readSkillPaths, [b]);
});

test("summarizeActivation 弱激活不计入激活率分子", () => {
  const activated = { activation: { activated: true, status: "activated" as const, matchedKeywords: [], readSkillPaths: [], evidence: [] } };
  const weak = { activation: { activated: false, status: "weak" as const, matchedKeywords: ["x"], readSkillPaths: [], evidence: [] } };
  const none = { activation: { activated: false, status: "not_activated" as const, matchedKeywords: [], readSkillPaths: [], evidence: [] } };

  const summary = summarizeActivation([activated, weak, none]);
  assert.equal(summary.total, 3);
  assert.equal(summary.activated, 1);
  assert.equal(summary.weak, 1);
  assert.equal(summary.notActivated, 1);
  assert.equal(summary.activationRate, 1 / 3);
});

test("parseFrontmatter 解析 name 与 description", () => {
  const values = parseFrontmatter('---\nname: foo\ndescription: "描述文本"\n---\n正文');
  assert.equal(values.name, "foo");
  assert.equal(values.description, "描述文本");
});

test("parseFrontmatter 对无 frontmatter 返回空对象", () => {
  assert.deepEqual(parseFrontmatter("没有 frontmatter"), {});
});
