import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEGRADED_MARKER,
  evaluateOverwriteGuard,
  isDegradedReport,
} from "./report-quality.ts";

/** 完整报告：标题有 skill 名，元信息表全部有值。 */
const COMPLETE_REPORT = [
  "# Skill 评估报告：deep-research",
  "",
  "> 运行标识 `run-20261104-114333` · 生成于 2026-11-04T02:37:49.871Z",
  "",
  "| 被测 skill | `~/.skill-eval/pending/deep-research/SKILL.md` |",
  "| 内容哈希 | `sha256:4d4847581b82fbb6` |",
  "| 版本标识 | 1.0.0 |",
  "| 套件 | deep-research-suite (v1) |",
].join("\n");

/** 降级报告：`report --suite-file` 重算后元信息丢失的产物。 */
const DEGRADED_REPORT = [
  `# Skill 评估报告：${DEGRADED_MARKER}`,
  "",
  "> 运行标识 `run-broken2` · 生成于 2026-11-04T02:30:25.668Z",
  "",
  "| 被测 skill | `（未记录）` |",
  "| 内容哈希 | `（未记录）` |",
  "| 版本标识 | （未记录） |",
  "| 套件 | （未记录） (v（未记录）) |",
].join("\n");

test("isDegradedReport 识别标题带占位符的报告", () => {
  assert.equal(isDegradedReport(DEGRADED_REPORT), true);
});

test("isDegradedReport 识别元信息表大面积占位的报告", () => {
  const noTitleMarker = [
    "# Skill 评估报告：some-skill",
    "",
    `| 被测 skill | \`${DEGRADED_MARKER}\` |`,
    `| 内容哈希 | \`${DEGRADED_MARKER}\` |`,
    `| 版本标识 | ${DEGRADED_MARKER} |`,
  ].join("\n");
  assert.equal(isDegradedReport(noTitleMarker), true);
});

test("isDegradedReport 不误判完整报告", () => {
  assert.equal(isDegradedReport(COMPLETE_REPORT), false);
});

test("isDegradedReport 容忍个别说明性占位符", () => {
  // 正常报告里个别字段缺失是允许的，不应整体判为降级。
  const minorGap = [
    "# Skill 评估报告：some-skill",
    "",
    `| 被测 skill | \`${DEGRADED_MARKER}\` |`,
    "| 内容哈希 | `sha256:abc` |",
    "| 版本标识 | 1.0.0 |",
  ].join("\n");
  assert.equal(isDegradedReport(minorGap), false);
});

test("evaluateOverwriteGuard 目标不存在时放行", () => {
  const verdict = evaluateOverwriteGuard(DEGRADED_REPORT, null);
  assert.equal(verdict.blocked, false);
  assert.equal(verdict.reason, null);
});

test("evaluateOverwriteGuard 源为完整版时放行覆盖", () => {
  const verdict = evaluateOverwriteGuard(COMPLETE_REPORT, DEGRADED_REPORT);
  assert.equal(verdict.blocked, false);
});

test("evaluateOverwriteGuard 降级源不得覆盖完整目标", () => {
  const verdict = evaluateOverwriteGuard(DEGRADED_REPORT, COMPLETE_REPORT);
  assert.equal(verdict.blocked, true);
  assert.ok(verdict.reason);
});

test("evaluateOverwriteGuard 降级源覆盖降级目标放行", () => {
  // 同级覆盖不产生信息损失，无需拦截。
  const verdict = evaluateOverwriteGuard(DEGRADED_REPORT, DEGRADED_REPORT);
  assert.equal(verdict.blocked, false);
});
