/**
 * 路径处理工具。
 *
 * 入库的实验产物经过脱敏后，用户目录会写成 `~/.workbuddy/...`。
 * 路径解析若不展开 `~`，会被当成相对路径解析到仓库里，
 * 报「skill 不存在」或静默指向错误文件。
 */

import { homedir } from "node:os";
import { join } from "node:path";

/**
 * 展开 `~` 开头的路径。
 *
 * - `~` → home 目录
 * - `~/a/b` → `<home>/a/b`
 * - 其它路径原样返回
 */
export function expandTilde(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}
