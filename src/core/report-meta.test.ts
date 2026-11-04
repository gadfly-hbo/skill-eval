import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverMetaFromReport, mergeMeta } from "./report-meta.ts";

const SAMPLE = `# Skill 评估报告：data-analysis-negative-control

> 运行标识 \`run-20261101-133545-0888c7a8\` · 生成于 2026-11-01T14:07:10.005Z

## 1. 候选身份

| 项 | 值 |
| --- | --- |
| 被测 skill | \`~/.skill-eval/negative-control/data-analysis-broken/SKILL.md\` |
| 内容哈希 | \`sha256:d77055a82fc344f7\` |
| 版本标识 | 1.8.0-broken |
| 套件 | data-analysis-negative-control (v1) |

## 2. 运行配置

| 项 | 值 |
| --- | --- |
| pi 隔离 HOME | \`/tmp/nc-pi-home\` |
`;

test("从报告反解出全部候选身份", () => {
  const meta = recoverMetaFromReport(SAMPLE);
  assert.equal(meta.skillPath, "~/.skill-eval/negative-control/data-analysis-broken/SKILL.md");
  assert.equal(meta.skillHash, "sha256:d77055a82fc344f7");
  assert.equal(meta.skillVersion, "1.8.0-broken");
  assert.equal(meta.suiteId, "data-analysis-negative-control");
  assert.equal(meta.suiteVersion, "1");
  assert.equal(meta.piHome, "/tmp/nc-pi-home");
});

test("套件无版本号时 version 为 null", () => {
  const meta = recoverMetaFromReport("| 套件 | my-suite |\n");
  assert.equal(meta.suiteId, "my-suite");
  assert.equal(meta.suiteVersion, null);
});

test("缺少对应行时返回 null，不猜", () => {
  const meta = recoverMetaFromReport("## 1. 候选身份\n\n| 项 | 值 |\n| --- | --- |\n");
  assert.equal(meta.skillPath, null);
  assert.equal(meta.skillHash, null);
  assert.equal(meta.suiteId, null);
  assert.equal(meta.piHome, null);
});

test("占位符「（未记录）」不算有效值", () => {
  const meta = recoverMetaFromReport(
    "| 被测 skill | `（未记录）` |\n| 套件 | （未记录） (v（未记录）) |\n",
  );
  assert.equal(meta.skillPath, null);
  assert.equal(meta.suiteId, null);
  assert.equal(meta.suiteVersion, null);
});

test("pi 隔离 HOME 为「—」时视为未使用", () => {
  const meta = recoverMetaFromReport("| pi 隔离 HOME | — |\n");
  assert.equal(meta.piHome, null);
});

test("显式值优先于回填值", () => {
  const recovered = recoverMetaFromReport(SAMPLE);
  const merged = mergeMeta({ skillPath: "/explicit/path/SKILL.md" }, recovered);
  assert.equal(merged.skillPath, "/explicit/path/SKILL.md");
  assert.equal(merged.skillHash, "sha256:d77055a82fc344f7");
});

test("显式值为空或占位符时回退到回填值", () => {
  const recovered = recoverMetaFromReport(SAMPLE);
  assert.equal(mergeMeta({ skillPath: "" }, recovered).skillPath, recovered.skillPath);
  assert.equal(
    mergeMeta({ skillPath: "（未记录）" }, recovered).skillPath,
    recovered.skillPath,
  );
});

test("显式值为 undefined 时回退到回填值", () => {
  const recovered = recoverMetaFromReport(SAMPLE);
  assert.equal(mergeMeta({ suiteId: undefined }, recovered).suiteId, recovered.suiteId);
});

test("两边都没有时为 null", () => {
  const merged = mergeMeta({}, recoverMetaFromReport(""));
  assert.equal(merged.skillPath, null);
  assert.equal(merged.suiteId, null);
});

test("回填不修改传入的 recovered 对象", () => {
  const recovered = recoverMetaFromReport(SAMPLE);
  const before = { ...recovered };
  mergeMeta({ skillPath: "/other/SKILL.md" }, recovered);
  assert.deepEqual(recovered, before);
});
