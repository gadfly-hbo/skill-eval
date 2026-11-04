/**
 * 待测评 skill 暂存区（pending）。
 *
 * 用途：作为「候选池」——尚未测评的 skill 放在这里，等测评通过后
 * 整个目录被移入 `archive/`，暂存区清空后删除。
 *
 * 与 archive 的关系：
 * - `pending/<skill名>/` 是待测评 skill 的**副本**（源 skill 目录不受影响）
 * - 测评通过 → 该副本从 pending 移入 archive（移动，不是复制）
 * - pending 里剩下的都是没测过的，不该随归档一起走
 *
 * 设计约束：
 * - 暂存区必须能自证内容：每个 skill 副本要带上来源信息，方便追溯
 * - 移出后不能留空壳目录——pending 空了就整体删掉
 * - 绝对路径必须脱敏（暂存区可能进公开仓库）
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { copySkillTree, redactHomePath } from "./archive.ts";

/** 暂存区默认目录名。 */
export const PENDING_DIR_NAME = "pending";

/** 暂存区里记录来源信息的文件名。 */
export const PENDING_META_FILE = ".pending-meta.json";

/** 待测评 skill 的登记信息。 */
export interface PendingMeta {
  /** skill 名称（目录名）。 */
  skill: string;
  /** 来源路径（脱敏后）。 */
  sourcePath: string;
  /** 登记时间。 */
  registeredAt: string;
  /** 内容哈希，与归档保持同一算法。 */
  skillHash?: string;
}

/** 暂存区状态。 */
export interface PendingState {
  /** 暂存区根目录。 */
  pendingRoot: string;
  /** 暂存区是否存在。 */
  exists: boolean;
  /** 待测评 skill 列表。 */
  skills: Array<{ name: string; meta: PendingMeta | null }>;
}

/**
 * 计算暂存区路径。
 *
 * 暂存区与归档区同级，默认 `<仓库>/pending`。
 */
export function pendingRootFor(repoRoot: string, pendingRoot?: string | undefined): string {
  return pendingRoot ? resolve(pendingRoot) : join(resolve(repoRoot), PENDING_DIR_NAME);
}

/**
 * 把 skill 登记进待测评暂存区。
 *
 * 复制而非移动——源 skill 通常装在 `~/.workbuddy/skills/` 下，
 * 那是被 agent 自动扫描的位置，不能因为登记就被搬走。
 */
export function registerPending(options: {
  repoRoot: string;
  skillPath: string;
  pendingRoot?: string | undefined;
  now?: number | undefined;
  skillHash?: string | undefined;
}): { pendingRoot: string; skillDir: string; fileCount: number; alreadyThere: boolean } {
  const pendingRoot = pendingRootFor(options.repoRoot, options.pendingRoot);
  const skillDir = dirname(resolve(options.skillPath));
  const skillName = basename(skillDir);
  const destDir = join(pendingRoot, skillName);

  if (existsSync(destDir)) {
    return { pendingRoot, skillDir: destDir, fileCount: 0, alreadyThere: true };
  }

  mkdirSync(pendingRoot, { recursive: true });
  const { fileCount } = copySkillTree(skillDir, destDir);

  const meta: PendingMeta = {
    skill: skillName,
    sourcePath: redactHomePath(resolve(options.skillPath)),
    registeredAt: new Date(options.now ?? Date.now()).toISOString(),
    ...(options.skillHash ? { skillHash: options.skillHash } : {}),
  };
  writeFileSync(join(destDir, PENDING_META_FILE), JSON.stringify(meta, null, 2), "utf8");

  return { pendingRoot, skillDir: destDir, fileCount, alreadyThere: false };
}

/**
 * 读取暂存区状态。
 */
export function readPendingState(options: {
  repoRoot: string;
  pendingRoot?: string | undefined;
}): PendingState {
  const pendingRoot = pendingRootFor(options.repoRoot, options.pendingRoot);
  if (!existsSync(pendingRoot)) {
    return { pendingRoot, exists: false, skills: [] };
  }

  const skills: Array<{ name: string; meta: PendingMeta | null }> = [];
  for (const entry of readdirSync(pendingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(pendingRoot, entry.name, PENDING_META_FILE);
    let meta: PendingMeta | null = null;
    if (existsSync(metaPath)) {
      try {
        // 读文件失败不该让整个状态查询崩掉。
        meta = JSON.parse(readFileSync(metaPath, "utf8")) as PendingMeta;
      } catch {
        meta = null;
      }
    }
    skills.push({ name: entry.name, meta });
  }

  return { pendingRoot, exists: true, skills };
}

/**
 * 把暂存区里已归档的 skill 移出，并清理空的暂存区。
 *
 * 语义：测评通过 → 该 skill 的暂存副本移入 archive → pending 里不再留它
 * → pending 空了就把整个目录删掉。
 *
 * @param movedSkillNames 刚被归档的 skill 名称列表
 * @returns 被移出的 skill 名与剩余待测 skill 数
 */
export function prunePendingAfterArchive(options: {
  repoRoot: string;
  movedSkillNames: string[];
  pendingRoot?: string | undefined;
}): { removed: string[]; remaining: number; pendingRootDeleted: boolean } {
  const pendingRoot = pendingRootFor(options.repoRoot, options.pendingRoot);
  const removed: string[] = [];

  if (!existsSync(pendingRoot)) {
    return { removed, remaining: 0, pendingRootDeleted: false };
  }

  for (const name of options.movedSkillNames) {
    const dir = join(pendingRoot, name);
    if (!existsSync(dir)) continue;
    rmSync(dir, { recursive: true, force: true });
    removed.push(name);
  }

  // 暂存区空了就把整个目录删掉——不留空壳。
  const rest = readdirSync(pendingRoot, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && e.name !== ".git",
  );
  let pendingRootDeleted = false;
  if (rest.length === 0) {
    rmSync(pendingRoot, { recursive: true, force: true });
    pendingRootDeleted = true;
  }

  return { removed, remaining: rest.length, pendingRootDeleted };
}
