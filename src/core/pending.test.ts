import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  registerPending,
  readPendingState,
  prunePendingAfterArchive,
  pendingRootFor,
  PENDING_META_FILE,
} from "./pending.ts";

/**
 * 待测评暂存区：候选池语义。
 *
 * 核心约定：pending/ 存的是 skill 副本（源目录不受影响），测评通过后
 * 整个副本移出，pending 空了就删掉目录。
 */

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "pending-test-"));
}

function makeSkill(root: string, name: string): string {
  const dir = join(root, "src", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${name}\n---\n# ${name}\n`, "utf8");
  writeFileSync(join(dir, "references.md"), "参考\n", "utf8");
  return join(dir, "SKILL.md");
}

test("pendingRootFor 默认落在仓库下的 pending/", () => {
  assert.equal(pendingRootFor("/repo"), "/repo/pending");
});

test("pendingRootFor 可显式指定", () => {
  assert.equal(pendingRootFor("/repo", "/other/place"), "/other/place");
});

test("registerPending 复制 skill 树进暂存区", () => {
  const repo = makeRepo();
  const skillPath = makeSkill(repo, "demo");

  const outcome = registerPending({ repoRoot: repo, skillPath });

  assert.equal(outcome.alreadyThere, false);
  assert.equal(outcome.fileCount, 2);
  assert.ok(existsSync(join(outcome.skillDir, "SKILL.md")));
  assert.ok(existsSync(join(outcome.skillDir, "references.md")));
  assert.ok(existsSync(join(outcome.skillDir, PENDING_META_FILE)));

  rmSync(repo, { recursive: true, force: true });
});

test("registerPending 不动源 skill 目录", () => {
  const repo = makeRepo();
  const skillPath = makeSkill(repo, "demo");

  registerPending({ repoRoot: repo, skillPath });

  // 源目录必须完好——skill 通常装在 agent 自动扫描的位置，不能被搬走。
  assert.ok(existsSync(skillPath));
  assert.ok(existsSync(join(repo, "src", "demo", "references.md")));

  rmSync(repo, { recursive: true, force: true });
});

test("registerPending 记录脱敏后的来源路径", () => {
  const repo = makeRepo();
  const skillPath = makeSkill(repo, "demo");

  const outcome = registerPending({ repoRoot: repo, skillPath });
  const meta = JSON.parse(readFileSync(join(outcome.skillDir, PENDING_META_FILE), "utf8"));

  assert.equal(meta.skill, "demo");
  assert.equal(meta.sourcePath.includes("/Users/"), false, "来源路径必须脱敏");

  rmSync(repo, { recursive: true, force: true });
});

test("registerPending 重复登记不重复拷贝", () => {
  const repo = makeRepo();
  const skillPath = makeSkill(repo, "demo");

  const first = registerPending({ repoRoot: repo, skillPath });
  const second = registerPending({ repoRoot: repo, skillPath });

  assert.equal(first.alreadyThere, false);
  assert.equal(second.alreadyThere, true);
  assert.equal(second.fileCount, 0);

  rmSync(repo, { recursive: true, force: true });
});

test("readPendingState 列出待测评 skill", () => {
  const repo = makeRepo();
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "a") });
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "b") });

  const state = readPendingState({ repoRoot: repo });

  assert.equal(state.exists, true);
  assert.equal(state.skills.length, 2);
  assert.deepEqual(state.skills.map((s) => s.name).sort(), ["a", "b"]);

  rmSync(repo, { recursive: true, force: true });
});

test("readPendingState 在暂存区不存在时返回空", () => {
  const repo = makeRepo();
  const state = readPendingState({ repoRoot: repo });
  assert.equal(state.exists, false);
  assert.equal(state.skills.length, 0);
  rmSync(repo, { recursive: true, force: true });
});

test("prunePendingAfterArchive 移出已归档的 skill", () => {
  const repo = makeRepo();
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "done") });
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "waiting") });

  const outcome = prunePendingAfterArchive({
    repoRoot: repo,
    movedSkillNames: ["done"],
  });

  assert.deepEqual(outcome.removed, ["done"]);
  assert.equal(outcome.remaining, 1);
  assert.equal(outcome.pendingRootDeleted, false);

  const state = readPendingState({ repoRoot: repo });
  assert.deepEqual(state.skills.map((s) => s.name), ["waiting"]);
  assert.equal(state.skills[0]?.name, "waiting");
  assert.equal(state.skills[0]?.name, "waiting");

  rmSync(repo, { recursive: true, force: true });
});

test("prunePendingAfterArchive 在暂存区清空后删除整个目录", () => {
  const repo = makeRepo();
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "only") });

  const outcome = prunePendingAfterArchive({
    repoRoot: repo,
    movedSkillNames: ["only"],
  });

  assert.deepEqual(outcome.removed, ["only"]);
  assert.equal(outcome.remaining, 0);
  assert.equal(outcome.pendingRootDeleted, true, "暂存区清空后应删除目录，不留空壳");
  assert.equal(existsSync(pendingRootFor(repo)), false);

  rmSync(repo, { recursive: true, force: true });
});

test("prunePendingAfterArchive 在暂存区不存在时安全返回", () => {
  const repo = makeRepo();
  const outcome = prunePendingAfterArchive({
    repoRoot: repo,
    movedSkillNames: ["whatever"],
  });
  assert.deepEqual(outcome.removed, []);
  assert.equal(outcome.pendingRootDeleted, false);
  rmSync(repo, { recursive: true, force: true });
});

test("暂存区不参与归档——留在里面的 skill 不会被移走", () => {
  const repo = makeRepo();
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "archived") });
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "untested") });

  prunePendingAfterArchive({ repoRoot: repo, movedSkillNames: ["archived"] });

  const state = readPendingState({ repoRoot: repo });
  assert.equal(state.skills.length, 1);
  assert.equal(state.skills[0]?.name, "untested", "没测过的 skill 必须留在暂存区");

  rmSync(repo, { recursive: true, force: true });
});
