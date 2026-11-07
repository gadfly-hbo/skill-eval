#!/usr/bin/env node
/**
 * skill-eval 的 bin 入口包装器。
 *
 * 为什么需要它：npm 在 `npm link` 时会把 package.json 的 `bin` 指向的文件
 * **复制**到全局 bin 目录，并按包名去掉扩展名。于是
 * `src/cli/main.ts` 被复制成 `skill-eval`（丢失 `.ts` 后缀）。
 *
 * node 对无扩展名文件不会剥离 TypeScript 类型语法，于是入口直接抛
 * `SyntaxError: Unexpected identifier 'EvalTask'`。
 *
 * 更糟的是：这个错误发生在宿主 IDE（CodeBuddy / WorkBuddy）注入的
 * `NODE_OPTIONS --require .../node-language-shim.cjs` 环境下，
 * **stderr 被 shim 吞掉、退出码仍返回 0**——
 * 命令看起来「跑过了」，实际什么都没执行。
 *
 * 所以这里用一个 `.mjs` 包装器：显式带 `--experimental-strip-types`
 * 调用真正的入口，并把错误码透传出去。
 */

import { spawn } from "node:child_process";
import { constants } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const entry = join(here, "..", "src", "cli", "main.ts");

if (!existsSync(entry)) {
  process.stderr.write(`找不到 skill-eval 入口：${entry}\n`);
  process.exit(70);
}

const child = spawn(
  process.execPath,
  ["--experimental-strip-types", "--no-warnings", entry, ...process.argv.slice(2)],
  { stdio: "inherit" },
);

const forward = (signal) => child.kill(signal);
process.on("SIGINT", forward);
process.on("SIGTERM", forward);
child.once("error", (error) => {
  process.stderr.write(`skill-eval 启动失败：${error.message}\n`);
  process.exitCode = 70;
});
child.once("close", (code, signal) => {
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  process.exitCode ??= signal ? 128 + constants.signals[signal] : code ?? 1;
});
