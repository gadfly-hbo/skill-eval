import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectMetrics, disableHostDeleteGuard, emptyMetrics, runPi } from "./pi.ts";
import { canonicalPath, resolvePiRuntime } from "./isolation.ts";

test("只有成功完成的 read 才计为内容读取，失败和未完成读取不计", () => {
  const metrics = emptyMetrics();
  collectMetrics(metrics, { type: "tool_execution_start", toolCallId: "ok", toolName: "read", args: { path: "/candidate/SKILL.md" } });
  assert.deepEqual(metrics.readPaths, []);
  collectMetrics(metrics, { type: "tool_execution_end", toolCallId: "ok", toolName: "read", isError: false });
  assert.deepEqual(metrics.readPaths, ["/candidate/SKILL.md"]);
  collectMetrics(metrics, { type: "tool_execution_start", toolCallId: "bad", toolName: "read", args: { path: "/candidate/missing.md" } });
  collectMetrics(metrics, { type: "tool_execution_end", toolCallId: "bad", toolName: "read", isError: true });
  collectMetrics(metrics, { type: "tool_execution_start", toolCallId: "pending", toolName: "read", args: { path: "/candidate/pending.md" } });
  assert.deepEqual(metrics.readPaths, ["/candidate/SKILL.md"]);
});

test("没有明确成功结果或重复 end 不能增加读取证据", () => {
  const metrics = emptyMetrics();
  collectMetrics(metrics, { type: "tool_execution_start", toolCallId: "x", toolName: "read", args: { path: "/candidate/SKILL.md" } });
  collectMetrics(metrics, { type: "tool_execution_end", toolCallId: "x", toolName: "read" });
  collectMetrics(metrics, { type: "tool_execution_end", toolCallId: "x", toolName: "read", isError: false });
  assert.deepEqual(metrics.readPaths, []);
});

test("read 路径以实际任务 cwd 归一化，不能用评估器自身 cwd", () => {
  const metrics = emptyMetrics();
  collectMetrics(metrics, { type: "tool_execution_start", toolCallId: "x", toolName: "read", args: { path: "../candidate/SKILL.md" } }, "/tmp/task/case");
  collectMetrics(metrics, { type: "tool_execution_end", toolCallId: "x", toolName: "read", isError: false }, "/tmp/task/case");
  assert.deepEqual(metrics.readPaths, [canonicalPath("/tmp/task/candidate/SKILL.md")]);
});

test("runPi 离线假 CLI 端到端：隔离、成功 read、失败 read 与配置清理", { skip: process.platform !== "darwin" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-fake-pi-"));
  const previousPath = process.env.PATH;
  try {
    const workspace = join(root, "workspace");
    const skillRoot = join(root, "candidate");
    const packageRoot = join(root, "node_modules", "offline-pi-fixture");
    const bin = join(root, "bin");
    const sourceHome = join(root, "empty-home");
    for (const dir of [workspace, skillRoot, packageRoot, bin, sourceHome]) mkdirSync(dir, { recursive: true });
    const skillPath = join(skillRoot, "SKILL.md");
    writeFileSync(skillPath, "OFFLINE_SKILL_FIXTURE");
    const privatePath = join(root, "private-answer.txt");
    writeFileSync(privatePath, "PRIVATE");
    const entry = join(packageRoot, "cli.mjs");
    writeFileSync(join(packageRoot, "package.json"), '{"name":"offline-pi-fixture","type":"module","bin":{"pi":"cli.mjs"}}');
    writeFileSync(entry, `#!/usr/bin/env node
import * as fs from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const skillPath = args[args.indexOf('--skill') + 1];
const privatePath = JSON.parse(args.at(-1)).privatePath;
const emit = (event) => process.stdout.write(JSON.stringify(event) + '\\n');
emit({type:'tool_execution_start', toolCallId:'read-skill', toolName:'read', args:{path:skillPath}});
const skill = fs.readFileSync(skillPath, 'utf8');
emit({type:'tool_execution_end', toolCallId:'read-skill', toolName:'read', isError:false, result:{content:[{type:'text',text:skill}]}});
emit({type:'tool_execution_start', toolCallId:'read-private', toolName:'read', args:{path:privatePath}});
let denied = false;
try { fs.readFileSync(privatePath); } catch (error) { denied = error.code === 'EPERM' || error.code === 'EACCES'; }
emit({type:'tool_execution_end', toolCallId:'read-private', toolName:'read', isError:denied});
emit({type:'tool_execution_start', toolCallId:'unfinished', toolName:'read', args:{path:join(process.cwd(),'unfinished.md')}});
const configDir = process.env.PI_CODING_AGENT_DIR;
const authAbsent = !fs.existsSync(join(configDir, 'auth.json'));
const fixtureAuthCopied = !authAbsent && JSON.parse(fs.readFileSync(join(configDir, 'auth.json'),'utf8')).offlineFixture === true;
const fixtureModelsCopied = fs.existsSync(join(configDir, 'models.json')) && JSON.parse(fs.readFileSync(join(configDir, 'models.json'),'utf8')).offlineFixture === true;
const settingsAbsent = !fs.existsSync(join(configDir, 'settings.json'));
fs.mkdirSync(join(configDir, 'auth.json.lock'));
const output = JSON.stringify({denied, authAbsent, fixtureAuthCopied, fixtureModelsCopied, settingsAbsent, lockCreated:fs.existsSync(join(configDir,'auth.json.lock')), configDir, disabled:['--no-skills','--no-context-files','--no-extensions','--no-prompt-templates','--no-themes'].every(flag=>args.includes(flag))});
emit({type:'message_end', message:{role:'assistant',content:[{type:'text',text:output}],usage:{totalTokens:7,cost:{total:0}}}});
`);
    chmodSync(entry, 0o755);
    symlinkSync(entry, join(bin, "pi"));
    // A PATH containing only this fixture prevents falling through to the installed real pi.
    process.env.PATH = bin;
    assert.equal(resolvePiRuntime().args[0], canonicalPath(entry));
    const result = await runPi({ workspaceRoot: workspace, sessionId: "offline-fixture", prompt: JSON.stringify({ privatePath }), home: sourceHome, model: "offline/fixture", skillPaths: [skillPath], isolation: { skillRoots: [skillRoot] }, timeoutMs: 5000 });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.isolation, { verified: true, issues: [], backend: "macos-sandbox-exec" });
    assert.deepEqual(result.metrics.readPaths, [canonicalPath(skillPath)]);
    assert.equal(result.events.length, 6);
    const output = JSON.parse(result.metrics.output);
    assert.deepEqual({ ...output, configDir: undefined }, { denied: true, authAbsent: true, fixtureAuthCopied: false, fixtureModelsCopied: false, settingsAbsent: true, lockCreated: true, configDir: undefined, disabled: true });
    assert.equal(existsSync(output.configDir), false);
    assert.deepEqual(readdirSync(workspace).filter((name) => name.startsWith(".pi-home-") || name.startsWith(".isolation-probe-")), []);
    assert.deepEqual(readdirSync(sourceHome), []);
    // This auth data is a synthetic fixture created here, never a user's credential source.
    const sourceConfig = join(sourceHome, ".pi", "agent");
    mkdirSync(sourceConfig, { recursive: true });
    const fixtureConfig = '{"offlineFixture":true}';
    writeFileSync(join(sourceConfig, "auth.json"), fixtureConfig);
    writeFileSync(join(sourceConfig, "models.json"), fixtureConfig);
    writeFileSync(join(sourceConfig, "settings.json"), '{"extensions":["must-not-load"]}');
    const configuredWorkspace = join(root, "configured-workspace");
    const configured = await runPi({ workspaceRoot: configuredWorkspace, sessionId: "offline-config-fixture", prompt: JSON.stringify({ privatePath }), home: sourceHome, model: "offline/fixture", skillPaths: [skillPath], isolation: { skillRoots: [skillRoot] }, timeoutMs: 5000 });
    assert.equal(configured.exitCode, 0, configured.stderr);
    assert.equal(configured.isolation.verified, true);
    const configuredOutput = JSON.parse(configured.metrics.output);
    assert.equal(configuredOutput.authAbsent, false);
    assert.equal(configuredOutput.fixtureAuthCopied, true);
    assert.equal(configuredOutput.fixtureModelsCopied, true);
    assert.equal(configuredOutput.settingsAbsent, true);
    assert.equal(configuredOutput.lockCreated, true);
    assert.equal(existsSync(configuredOutput.configDir), false);
    assert.equal(readFileSync(join(sourceConfig, "auth.json"), "utf8"), fixtureConfig);
    assert.equal(existsSync(join(sourceConfig, "auth.json.lock")), false);
    assert.equal(readFileSync(skillPath, "utf8"), "OFFLINE_SKILL_FIXTURE");
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    rmSync(root, { recursive: true, force: true });
  }
});

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
