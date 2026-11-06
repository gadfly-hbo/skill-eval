import { test } from "node:test";
import assert from "node:assert/strict";
import { rebuildVariantsForRecompute } from "./main.ts";
import type { EvaluationSummary } from "../core/runner.ts";

test("rebuildVariantsForRecompute：非 baseline 变体必须带非空 skillPaths（空数组会让重算误判 baseline）", () => {
  // 回归自 2026-11-06 归档 run2：commandArchive 曾把所有变体重建成 skillPaths: []，
  // runner 的 isBaseline（skillPaths.length === 0）把 skill 侧当 baseline，
  // pairCoverage / winRateLowerBound 被置 null → decideVerdict 误拦为 inconclusive。
  const stored = {
    variantSummaries: [
      { variantId: "baseline", variantLabel: "Baseline" },
      { variantId: "skill", variantLabel: "Skill" },
    ],
  } as unknown as EvaluationSummary;

  const variants = rebuildVariantsForRecompute(stored, "/tmp/skill/SKILL.md");

  assert.equal(variants.length, 2);
  assert.deepEqual(variants[0]!.skillPaths, [], "baseline 必须不带 skill");
  assert.deepEqual(
    variants[1]!.skillPaths,
    ["/tmp/skill/SKILL.md"],
    "skill 侧必须带非空 skillPaths——这正是 isBaseline 判定所依赖的不变量",
  );
  // 与 runner.ts 的 isBaseline 语义显式耦合：length === 0 即 baseline。
  assert.notEqual(variants[1]!.skillPaths.length, 0);
});

test("rebuildVariantsForRecompute：保留 variantId/label，容忍缺失 variantSummaries", () => {
  const stored = {} as unknown as EvaluationSummary;
  assert.deepEqual(rebuildVariantsForRecompute(stored, "/tmp/s/SKILL.md"), []);
});
