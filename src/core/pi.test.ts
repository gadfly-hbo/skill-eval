import { test } from "node:test";
import assert from "node:assert/strict";
import { disableHostDeleteGuard } from "./pi.ts";

/**
 * 宿主 IDE（CodeBuddy / WorkBuddy）通过 NODE_OPTIONS 注入 fs shim，
 * 会让 pi 的锁目录维护失败并导致进程崩溃。这些测试固化剥离规则。
 */

test("剥离宿主的 node-language-shim 注入", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_OPTIONS:
      '--require="/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/vendor/shim/node-language-shim.cjs"',
  };
  disableHostDeleteGuard(env);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test("剥离 genie-safe-delete 注入", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_OPTIONS: '--require="/some/path/genie-safe-delete.cjs"',
  };
  disableHostDeleteGuard(env);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test("剥离 node-safe-delete-shim 与 node-brokered-fs-shim 注入", () => {
  for (const name of ["node-safe-delete-shim.cjs", "node-brokered-fs-shim.cjs"]) {
    const env: NodeJS.ProcessEnv = { NODE_OPTIONS: `--require="/opt/shim/${name}"` };
    disableHostDeleteGuard(env);
    assert.equal(env.NODE_OPTIONS, undefined, name);
  }
});

test("保留与宿主无关的 NODE_OPTIONS 参数", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_OPTIONS:
      '--require="/opt/shim/node-language-shim.cjs" --max-old-space-size=4096 --trace-warnings',
  };
  disableHostDeleteGuard(env);
  assert.equal(env.NODE_OPTIONS, "--max-old-space-size=4096 --trace-warnings");
});

test("无 NODE_OPTIONS 时不报错", () => {
  const env: NodeJS.ProcessEnv = {};
  disableHostDeleteGuard(env);
  assert.equal(env.NODE_OPTIONS, undefined);
});

test("兜底关闭删除保护并清理 bulk guard 变量", () => {
  const env: NodeJS.ProcessEnv = {
    CODEBUDDY_SAFE_DELETE_ENABLED: "1",
    CODEBUDDY_SAFE_DELETE_BULK_GUARD: "/tmp/guard",
    CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR: "/tmp/state",
    CODEBUDDY_SAFE_DELETE_SANDBOX: "1",
  };
  disableHostDeleteGuard(env);
  assert.equal(env.CODEBUDDY_SAFE_DELETE_ENABLED, "0");
  assert.equal(env.CODEBUDDY_SAFE_DELETE_BULK_GUARD, undefined);
  assert.equal(env.CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR, undefined);
  assert.equal(env.CODEBUDDY_SAFE_DELETE_SANDBOX, undefined);
});

test("不使用引号的 --require 形式同样被剥离", () => {
  const env: NodeJS.ProcessEnv = {
    NODE_OPTIONS: "--require=/opt/shim/node-language-shim.cjs",
  };
  disableHostDeleteGuard(env);
  assert.equal(env.NODE_OPTIONS, undefined);
});
