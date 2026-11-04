/**
 * 仓库根目录探测。
 *
 * 为什么要多层兜底：agent 的工作目录通常是**会话工作区**（如
 * `~/WorkBuddy/<项目名>`），而不是 skill-eval 仓库。只靠「从 cwd 向上找」
 * 会失败——而失败的后果是「用户明明把 skill 放进 pending/ 了，agent 却说找不到」。
 *
 * 探测顺序（先到先得）：
 * 1. 显式 `--repo`（由调用方处理，优先级最高）
 * 2. 环境变量 `SKILL_EVAL_REPO`
 * 3. 从给定目录向上找含 `skills/` + `package.json` 的目录
 * 4. 从 skill-eval 自身安装位置反推（`<仓库>/src/cli/` 上溯两层）
 *
 * 第 4 层保证「在任何地方发起评估」都能落到 skill-eval 仓库的待测评区。
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** 判定一个目录是否是 skill-eval 仓库根：同时有 skills/ 与 package.json。 */
export function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, "skills")) && existsSync(join(dir, "package.json"));
}

/**
 * 从给定目录向上寻找仓库根。
 *
 * @param startDir 起始目录
 * @param maxDepth 最多向上找几层
 * @returns 找到则返回绝对路径，否则 null
 */
export function findRepoRootUpward(startDir: string, maxDepth = 8): string | null {
  let current = resolve(startDir);
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (isRepoRoot(current)) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * 从 skill-eval 自身的安装位置反推仓库根。
 *
 * CLI 入口位于 `<仓库>/src/cli/main.ts`，上溯两层就是仓库根。
 * 装成全局命令（npm link）后这个相对关系依然成立。
 *
 * @param cliFilePath CLI 入口文件的绝对路径
 */
export function repoRootFromInstall(cliFilePath: string): string | null {
  // <仓库>/src/cli/main.ts → <仓库>
  const candidate = resolve(dirname(cliFilePath), "..", "..");
  return isRepoRoot(candidate) ? candidate : null;
}

/**
 * 完整的仓库根探测。
 *
 * @param startDir 起始目录（通常是 process.cwd()）
 * @param env 环境变量（便于测试）
 * @param cliFilePath CLI 入口文件路径（用于第 4 层兜底）
 */
export function detectRepoRoot(options: {
  startDir: string;
  env?: Record<string, string | undefined>;
  cliFilePath: string;
}): string | null {
  const env = options.env ?? process.env;

  const fromEnv = env.SKILL_EVAL_REPO;
  if (fromEnv && existsSync(resolve(fromEnv))) {
    return resolve(fromEnv);
  }

  return findRepoRootUpward(options.startDir) ?? repoRootFromInstall(options.cliFilePath);
}
