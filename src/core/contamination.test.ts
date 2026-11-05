import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectContamination,
  isInsideSkillDir,
  isMetadataFile,
} from "./contamination.ts";

const SKILL_DIR = "/Users/huangbo/Dev/Projects/skill-eval/pending/data-analysis";
const SKILL_MD = `${SKILL_DIR}/SKILL.md`;

test("isInsideSkillDir 命中 skill 目录内的文件", () => {
  assert.equal(isInsideSkillDir(`${SKILL_DIR}/SKILL.md`, SKILL_DIR), true);
  assert.equal(isInsideSkillDir(`${SKILL_DIR}/references/method.md`, SKILL_DIR), true);
  assert.equal(isInsideSkillDir(`${SKILL_DIR}/scripts/calc.py`, SKILL_DIR), true);
  assert.equal(isInsideSkillDir(SKILL_DIR, SKILL_DIR), true);
});

test("isInsideSkillDir 不误伤同前缀的兄弟目录", () => {
  // data-analysis-extra 不是 data-analysis 的子目录
  assert.equal(
    isInsideSkillDir("/Users/huangbo/.../data-analysis-extra/x.md", SKILL_DIR),
    false,
  );
  assert.equal(isInsideSkillDir("/Users/huangbo/.../other/SKILL.md", SKILL_DIR), false);
});

test("isInsideSkillDir 处理末尾斜杠", () => {
  assert.equal(isInsideSkillDir(`${SKILL_DIR}/`, `${SKILL_DIR}/`), true);
  assert.equal(isInsideSkillDir(`${SKILL_DIR}/a.md`, `${SKILL_DIR}/`), true);
});

test("isMetadataFile 认出泄漏 skill 路径的元数据文件", () => {
  assert.equal(isMetadataFile("/anywhere/suite.json"), true);
  assert.equal(isMetadataFile("/anywhere/suite.yaml"), true);
  assert.equal(isMetadataFile("/anywhere/suite.yml"), true);
  assert.equal(isMetadataFile("/anywhere/output.md"), false);
  assert.equal(isMetadataFile("/anywhere/suite.json.bak"), false);
});

test("detectContamination 检出 baseline 读取 skill 文件", () => {
  const report = detectContamination(
    ["/tmp/x.md", `${SKILL_DIR}/SKILL.md`, `${SKILL_DIR}/scripts/calc.py`],
    SKILL_MD,
    SKILL_DIR,
  );
  assert.equal(report.contaminated, true);
  assert.equal(report.reasons.includes("skill-file-read"), true);
  assert.equal(report.hits.length, 2);
});

test("detectContamination 检出读取 suite.json（元数据泄漏路径）", () => {
  // 实测的真实污染路径：模型先 find 到运行目录的 suite.json，
  // 从中读到 skill.path 绝对路径，再去读 skill 全文。
  const report = detectContamination(
    ["/Users/huangbo/.skill-eval/runs/xxx/suite.json"],
    SKILL_MD,
    SKILL_DIR,
  );
  assert.equal(report.contaminated, true);
  assert.equal(report.reasons.includes("metadata-file-read"), true);
});

test("detectContamination 对干净的 baseline 不误报", () => {
  const report = detectContamination(
    ["/tmp/case/clean.csv", "/tmp/case/report.md", "/tmp/case/output.md"],
    SKILL_MD,
    SKILL_DIR,
  );
  assert.equal(report.contaminated, false);
  assert.equal(report.hits.length, 0);
  assert.equal(report.reasons.length, 0);
});

test("detectContamination 空输入安全", () => {
  const report = detectContamination([], SKILL_MD, SKILL_DIR);
  assert.equal(report.contaminated, false);
  assert.deepEqual(report.hits, []);
});

test("detectContamination 没有 skill 目录信息时仍能检出元数据文件", () => {
  const report = detectContamination(["/run/suite.json"], "", "");
  assert.equal(report.contaminated, true);
  assert.equal(report.reasons.includes("metadata-file-read"), true);
});

test("detectContamination 去重命中路径", () => {
  const report = detectContamination(
    [`${SKILL_DIR}/SKILL.md`, `${SKILL_DIR}/SKILL.md`],
    SKILL_MD,
    SKILL_DIR,
  );
  assert.equal(report.hits.length, 1);
});
