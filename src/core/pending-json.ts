/**
 * 待测评区的 JSON 视图（给 agent 解析用）。
 *
 * `pending` 命令的人类可读表格对 agent 来说不如结构化输出可靠——
 * agent 要靠它**自动发现**待测 skill，才能实现「用户只做两步」：
 * 把 skill 放进 pending/，然后调用评估 skill。
 *
 * 这个模块只做纯转换，不碰文件系统，方便单测。
 */

import { join } from "node:path";

import type { PendingState } from "./pending.ts";

/** 单个待测 skill 的 JSON 视图。 */
export interface PendingSkillJson {
  /** skill 名称（目录名）。 */
  name: string;
  /** SKILL.md 的绝对路径——agent 直接拿它当 `--skill` 参数。 */
  skillPath: string;
  /** 来源路径（已脱敏），手动投放的记为「（手动投放）」。 */
  source: string | null;
  /** 登记时间。 */
  registeredAt: string | null;
}

/** 待测评区的 JSON 视图。 */
export interface PendingJson {
  /** 待测评区根目录。 */
  pendingRoot: string;
  /** 待测评区是否存在。 */
  exists: boolean;
  /** 待测 skill 列表。 */
  skills: PendingSkillJson[];
}

/**
 * 把待测评区状态转成 JSON 视图。
 *
 * `skillPath` 始终按 `<pendingRoot>/<name>/SKILL.md` 拼——
 * 不检查文件是否真的存在，因为待测区里的目录可能正在被编辑。
 */
export function toPendingJson(state: PendingState): PendingJson {
  return {
    pendingRoot: state.pendingRoot,
    exists: state.exists,
    skills: state.skills.map((item) => ({
      name: item.name,
      skillPath: join(state.pendingRoot, item.name, "SKILL.md"),
      source: item.meta?.sourcePath ?? null,
      registeredAt: item.meta?.registeredAt ?? null,
    })),
  };
}

/**
 * 从 JSON 视图里挑出「唯一待测的 skill」。
 *
 * agent 的自动发现逻辑依赖这个判断：
 * - 返回 skill → 直接开始评估
 * - 返回 null 且列表非空 → 有多个，得问用户
 * - 返回 null 且列表为空 → 没有可测的，得让用户先放
 */
export function pickSoleSkill(json: PendingJson): PendingSkillJson | null {
  return json.skills.length === 1 ? json.skills[0]! : null;
}
