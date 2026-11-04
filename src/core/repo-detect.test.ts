import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isRepoRoot,
  findRepoRootUpward,
  repoRootFromInstall,
  detectRepoRoot,
} from "./repo-detect.ts";

/** 造一个假的 skill-eval 仓库：同时有 skills/ 与 package.json。 */
function makeRepo(root: string): string {
  mkdirSync(join(root, "skills"), { recursive: true });
  writeFileSync(join(root, "package.json"), "{}", "utf8");
  return root;
}

test("isRepoRoot 需要同时有 skills/ 与 package.json", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-detect-"));
  makeRepo(root);
  assert.equal(isRepoRoot(root), true);

  mkdirSync(join(root, "skills-only"), { recursive: true });
  assert.equal(isRepoRoot(join(root, "skills-only")), false);

  rmSync(root, { recursive: true, force: true });
});

test("findRepoRootUpward 从子目录找到仓库根", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-detect-"));
  makeRepo(root);
  const deep = join(root, "src", "cli");
  mkdirSync(deep, { recursive: true });

  assert.equal(findRepoRootUpward(deep), root);

  rmSync(root, { recursive: true, force: true });
});

test("findRepoRootUpward 找不到时返回 null", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-detect-"));
  const deep = join(root, "a", "b", "c");
  mkdirSync(deep, { recursive: true });

  assert.equal(findRepoRootUpward(deep, 2), null);

  rmSync(root, { recursive: true, force: true });
});

test("repoRootFromInstall 从 <仓库>/src/cli/main.ts 反推仓库根", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-detect-"));
  makeRepo(root);
  const cliPath = join(root, "src", "cli", "main.ts");

  assert.equal(repoRootFromInstall(cliPath), root);

  rmSync(root, { recursive: true, force: true });
});

test("repoRootFromInstall 位置不对时返回 null", () => {
  const root = mkdtempSync(join(tmpdir(), "repo-detect-"));
  const cliPath = join(root, "somewhere", "else", "main.ts");

  assert.equal(repoRootFromInstall(cliPath), null);

  rmSync(root, { recursive: true, force: true });
});

test("detectRepoRoot 优先用环境变量", () => {
  const envRepo = mkdtempSync(join(tmpdir(), "repo-detect-env-"));
  makeRepo(envRepo);
  const cwdRepo = mkdtempSync(join(tmpdir(), "repo-detect-cwd-"));
  makeRepo(cwdRepo);

  const detected = detectRepoRoot({
    startDir: cwdRepo,
    env: { SKILL_EVAL_REPO: envRepo },
    cliFilePath: join(cwdRepo, "src", "cli", "main.ts"),
  });

  assert.equal(detected, envRepo);

  rmSync(envRepo, { recursive: true, force: true });
  rmSync(cwdRepo, { recursive: true, force: true });
});

test("detectRepoRoot 环境变量指向不存在的路径时忽略它", () => {
  const cwdRepo = mkdtempSync(join(tmpdir(), "repo-detect-cwd-"));
  makeRepo(cwdRepo);

  const detected = detectRepoRoot({
    startDir: cwdRepo,
    env: { SKILL_EVAL_REPO: "/definitely/not/here" },
    cliFilePath: join(cwdRepo, "src", "cli", "main.ts"),
  });

  assert.equal(detected, cwdRepo, "环境变量无效时应退回向上探测");

  rmSync(cwdRepo, { recursive: true, force: true });
});

test("detectRepoRoot cwd 不是仓库时退回安装位置反推", () => {
  // 这正是 agent 场景：cwd 是会话工作区，不是 skill-eval 仓库。
  const installRepo = mkdtempSync(join(tmpdir(), "repo-detect-install-"));
  makeRepo(installRepo);
  const workdir = mkdtempSync(join(tmpdir(), "repo-detect-work-"));

  const detected = detectRepoRoot({
    startDir: workdir,
    env: {},
    cliFilePath: join(installRepo, "src", "cli", "main.ts"),
  });

  assert.equal(detected, installRepo, "必须能从任意 cwd 落到 skill-eval 仓库");

  rmSync(installRepo, { recursive: true, force: true });
  rmSync(workdir, { recursive: true, force: true });
});

test("detectRepoRoot 三层都失败时返回 null", () => {
  const workdir = mkdtempSync(join(tmpdir(), "repo-detect-work-"));

  const detected = detectRepoRoot({
    startDir: workdir,
    env: {},
    cliFilePath: join(workdir, "nowhere", "main.ts"),
  });

  assert.equal(detected, null);

  rmSync(workdir, { recursive: true, force: true });
});
