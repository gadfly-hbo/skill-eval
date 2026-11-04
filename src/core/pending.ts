/**
 * 待测评 skill 暂存区（pending）。
 *
 * 用途：作为「候选池」——尚未测评的 skill 放在这里，等测评通过后
 * 整个目录被移入 `archive/`。
 *
 * 与 archive 的关系：
 * - `pending/<skill名>/` 是待测评 skill 的位置
 * - 测评通过 → 该目录从 pending 移入 archive（移动，不是复制）
 * - pending 里剩下的都是没测过的，不该随归档一起走
 *
 * 设计约束：
 * - **暂存区常驻存在**——用户要能直接往里放 skill 文件夹，
 *   所以目录不能「用完就删」，否则用户永远找不到该往哪放
 * - **允许手动投放**——用户拖进来的 skill 没有 `.pending-meta.json`，
 *   工具必须能识别并处理，不能假设每个 skill 都经过登记
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
 * 确保暂存区目录存在。
 *
 * 暂存区是**常驻**的：用户要能直接找到它、把 skill 文件夹拖进去。
 * 所以必须能主动创建，而不是只在登记时顺带创建。
 */
export function ensurePendingRoot(options: {
  repoRoot: string;
  pendingRoot?: string | undefined;
}): { pendingRoot: string; created: boolean } {
  const pendingRoot = pendingRootFor(options.repoRoot, options.pendingRoot);
  if (existsSync(pendingRoot)) {
    return { pendingRoot, created: false };
  }
  mkdirSync(pendingRoot, { recursive: true });
  return { pendingRoot, created: true };
}

/**
 * 判断暂存区里的一个目录是不是一个 skill。
 *
 * 用户可以直接把 skill 文件夹拖进暂存区，这种目录没有登记元信息。
 * 判定依据是里面有 SKILL.md——这是 skill 的硬性标志。
 */
export function isSkillDir(dir: string): boolean {
  return existsSync(join(dir, "SKILL.md"));
}

/**
 * 为手动投放的 skill 补写登记元信息。
 *
 * 用户拖进来的目录没有来源记录，补上后才能追溯「它从哪来」；
 * 来源未知时记为「手动投放」而不是编一个路径。
 */
export function adoptManualSkill(options: {
  pendingRoot: string;
  skillDir: string;
  now?: number | undefined;
}): PendingMeta | null {
  const metaPath = join(options.skillDir, PENDING_META_FILE);
  if (existsSync(metaPath)) {
    try {
      return JSON.parse(readFileSync(metaPath, "utf8")) as PendingMeta;
    } catch {
      // 元信息损坏就重写，不阻断流程
    }
  }

  if (!isSkillDir(options.skillDir)) return null;

  const meta: PendingMeta = {
    skill: basename(options.skillDir),
    sourcePath: "（手动投放）",
    registeredAt: new Date(options.now ?? Date.now()).toISOString(),
  };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");
  return meta;
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
 *
 * 用户可能直接往暂存区里拖 skill 文件夹，这类目录没有登记元信息——
 * 这里补写一份（来源记为「手动投放」），让后续处理有统一依据。
 */
export function readPendingState(options: {
  repoRoot: string;
  pendingRoot?: string | undefined;
  adopt?: boolean | undefined;
}): PendingState {
  const pendingRoot = pendingRootFor(options.repoRoot, options.pendingRoot);
  if (!existsSync(pendingRoot)) {
    return { pendingRoot, exists: false, skills: [] };
  }

  const skills: Array<{ name: string; meta: PendingMeta | null }> = [];
  for (const entry of readdirSync(pendingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = join(pendingRoot, entry.name);
    const metaPath = join(skillDir, PENDING_META_FILE);
    let meta: PendingMeta | null = null;
    if (existsSync(metaPath)) {
      try {
        // 读文件失败不该让整个状态查询崩掉。
        meta = JSON.parse(readFileSync(metaPath, "utf8")) as PendingMeta;
      } catch {
        meta = null;
      }
    } else if (options.adopt !== false && isSkillDir(skillDir)) {
      // 手动投放的 skill：补一份登记信息，否则它无法被归档流程识别。
      meta = adoptManualSkill({ pendingRoot, skillDir });
    }
    skills.push({ name: entry.name, meta });
  }

  return { pendingRoot, exists: true, skills };
}

/**
 * 把暂存区里已归档的 skill 移出。
 *
 * 语义：测评通过 → 该 skill 目录从 pending 移入 archive → pending 里不再留它。
 *
 * **暂存区本身保持存在**——它是常驻的投放入口，用户随时要往里放新 skill，
 * 不能因为清空就删掉（那样用户下次又找不到该往哪放）。
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

  const rest = readdirSync(pendingRoot, { withFileTypes: true }).filter(
    (e) => e.isDirectory() && e.name !== ".git",
  );

  // 暂存区是常驻入口——即使空了也保留目录本身。
  return { removed, remaining: rest.length, pendingRootDeleted: false };
}
