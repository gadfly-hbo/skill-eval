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
  ensurePendingRoot,
  adoptManualSkill,
  isSkillDir,
  PENDING_META_FILE,
} from "./pending.ts";

/**
 * 待测评暂存区：常驻投放入口。
 *
 * 核心约定：
 * - pending/ **常驻存在**——用户要能直接找到它、把 skill 文件夹拖进去
 * - 允许手动投放：拖进来的 skill 没有登记元信息，工具要能识别并补写
 * - 登记是复制（源目录不受影响），测评通过后从暂存区移出
 * - 移出后暂存区**本身保留**，它是常驻入口
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

test("prunePendingAfterArchive 移出已归档的 skill 后保留暂存区目录", () => {
  const repo = makeRepo();
  registerPending({ repoRoot: repo, skillPath: makeSkill(repo, "only") });

  const outcome = prunePendingAfterArchive({
    repoRoot: repo,
    movedSkillNames: ["only"],
  });

  assert.deepEqual(outcome.removed, ["only"]);
  assert.equal(outcome.remaining, 0);
  assert.equal(outcome.pendingRootDeleted, false);
  assert.equal(
    existsSync(pendingRootFor(repo)),
    true,
    "暂存区是常驻的投放入口，清空后也必须保留目录",
  );

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

// ---- 常驻投放入口 ----

test("ensurePendingRoot 创建暂存区目录", () => {
  const repo = makeRepo();

  const outcome = ensurePendingRoot({ repoRoot: repo });

  assert.equal(outcome.created, true);
  assert.ok(existsSync(join(repo, "pending")), "目录必须真实存在，用户才能往里放 skill");
  assert.equal(outcome.pendingRoot, pendingRootFor(repo));

  rmSync(repo, { recursive: true, force: true });
});

test("ensurePendingRoot 已存在时不重复创建", () => {
  const repo = makeRepo();
  ensurePendingRoot({ repoRoot: repo });

  const second = ensurePendingRoot({ repoRoot: repo });

  assert.equal(second.created, false);
  assert.equal(second.pendingRoot, pendingRootFor(repo));

  rmSync(repo, { recursive: true, force: true });
});

test("ensurePendingRoot 支持自定义位置", () => {
  const repo = makeRepo();
  const custom = join(repo, "custom-inbox");

  const outcome = ensurePendingRoot({ repoRoot: repo, pendingRoot: custom });

  assert.ok(existsSync(custom));
  assert.equal(outcome.pendingRoot, custom);

  rmSync(repo, { recursive: true, force: true });
});

test("isSkillDir 依据 SKILL.md 判定", () => {
  const repo = makeRepo();
  const skillPath = makeSkill(repo, "demo");

  assert.equal(isSkillDir(join(repo, "src", "demo")), true);
  assert.equal(isSkillDir(join(repo, "src")), false);
  assert.ok(existsSync(skillPath));

  rmSync(repo, { recursive: true, force: true });
});

test("手动投放的 skill 会被识别并补写登记信息", () => {
  const repo = makeRepo();
  ensurePendingRoot({ repoRoot: repo });

  // 模拟用户直接把 skill 文件夹拖进暂存区——没有登记元信息。
  const manualDir = join(repo, "pending", "manual-skill");
  mkdirSync(manualDir, { recursive: true });
  writeFileSync(join(manualDir, "SKILL.md"), "---\nname: manual-skill\n---\n", "utf8");

  const state = readPendingState({ repoRoot: repo });

  assert.equal(state.skills.length, 1);
  assert.equal(state.skills[0]?.name, "manual-skill");
  assert.ok(state.skills[0]?.meta, "手动投放的 skill 也必须有登记信息");
  assert.equal(state.skills[0]?.meta?.sourcePath, "（手动投放）");
  assert.ok(
    existsSync(join(manualDir, PENDING_META_FILE)),
    "补写的登记信息要落盘，归档流程才能识别它",
  );

  rmSync(repo, { recursive: true, force: true });
});

test("手动投放的非 skill 目录不被登记", () => {
  const repo = makeRepo();
  ensurePendingRoot({ repoRoot: repo });

  mkdirSync(join(repo, "pending", "just-a-folder"), { recursive: true });
  writeFileSync(join(repo, "pending", "just-a-folder", "note.txt"), "随便放的\n", "utf8");

  const state = readPendingState({ repoRoot: repo });

  assert.equal(state.skills[0]?.meta, null, "没有 SKILL.md 的目录不算 skill");

  rmSync(repo, { recursive: true, force: true });
});

test("adoptManualSkill 不覆盖已有的登记信息", () => {
  const repo = makeRepo();
  ensurePendingRoot({ repoRoot: repo });

  const manualDir = join(repo, "pending", "manual-skill");
  mkdirSync(manualDir, { recursive: true });
  writeFileSync(join(manualDir, "SKILL.md"), "---\nname: manual-skill\n---\n", "utf8");
  writeFileSync(
    join(manualDir, PENDING_META_FILE),
    JSON.stringify({ skill: "manual-skill", sourcePath: "~/somewhere/SKILL.md", registeredAt: "2026-01-01T00:00:00.000Z" }),
    "utf8",
  );

  const meta = adoptManualSkill({ pendingRoot: join(repo, "pending"), skillDir: manualDir });

  assert.equal(meta?.sourcePath, "~/somewhere/SKILL.md", "已有登记信息不能被覆盖");

  rmSync(repo, { recursive: true, force: true });
});

test("手动投放的 skill 也能被归档流程移出", () => {
  const repo = makeRepo();
  ensurePendingRoot({ repoRoot: repo });

  const manualDir = join(repo, "pending", "manual-skill");
  mkdirSync(manualDir, { recursive: true });
  writeFileSync(join(manualDir, "SKILL.md"), "---\nname: manual-skill\n---\n", "utf8");

  const outcome = prunePendingAfterArchive({
    repoRoot: repo,
    movedSkillNames: ["manual-skill"],
  });

  assert.deepEqual(outcome.removed, ["manual-skill"]);
  assert.equal(existsSync(manualDir), false);

  rmSync(repo, { recursive: true, force: true });
});
