import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repo, "src/cli/main.ts");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-model-preflight-cli-"));
  const bin = join(root, "bin");
  const packageRoot = join(root, "node_modules", "offline-pi-fixture");
  const home = join(root, "home");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(packageRoot, "dist/core"), { recursive: true });
  mkdirSync(join(home, ".pi/agent"), { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "offline-pi-fixture", version: "1.0.0", type: "module", bin: { pi: "cli.mjs" } }));
  const entry = join(packageRoot, "cli.mjs");
  writeFileSync(entry, "#!/usr/bin/env node\nthrow new Error('MODEL_INVOCATION_TRIPWIRE');\n");
  chmodSync(entry, 0o755);
  symlinkSync(entry, join(bin, "pi"));
  symlinkSync(process.execPath, join(bin, "node"));
  // This is a synthetic SDK boundary, never the installed Pi CLI or a Provider.
  writeFileSync(join(packageRoot, "dist/core/model-runtime.js"), `
import {readFileSync} from 'node:fs';
const model = id => ({provider:'fixture',id,api:'anthropic-messages',baseUrl:'https://offline.invalid/anthropic',reasoning:false,input:['text'],contextWindow:4096,maxTokens:512,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}});
export class ModelRuntime {
  static async create(options) {
    if(options.refreshOnCreate !== false || options.allowModelNetwork !== false) throw Error('Unsafe SDK options');
    const config = options.modelsPath ? JSON.parse(readFileSync(options.modelsPath,'utf8')) : {};
    const ids = ['subject','judge',...(config.providers?.fixture?.models??[]).map(x=>x.id)];
    return {
      getError:()=>undefined,
      getProvider:provider=>provider==='fixture'?{refreshModels:async ctx=>{
        if(ctx.allowNetwork!==false)throw Error('Network enabled');
        await ctx.publish({update:()=>{}});
      }}:undefined,
      getModel:(provider,id)=>provider==='fixture'&&ids.includes(id)?model(id):undefined,
    };
  }
}
`);
  const env = { PATH: bin, HOME: home, LANG: "en_US.UTF-8" };
  const run = (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(process.execPath, ["--experimental-strip-types", cli, ...args], { cwd: repo, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 20000 });
  return { root, bin, home, env, run, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("preflight 公开命令确认两种精确模型且保持只读/未授权口径", { skip: process.platform !== "darwin" }, () => {
  const f = fixture();
  try {
    const result = f.run(["preflight", "--model", "fixture/subject", "--judge-model", "fixture/judge", "--home", f.home]);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, "LOCAL_MODEL_IDENTITIES_CONFIRMED");
    assert.equal(report.valid, true);
    assert.deepEqual(report.models.map((m: { role: string; requested: string }) => [m.role, m.requested]), [["subject", "fixture/subject"], ["judge", "fixture/judge"]]);
    assert.equal(report.providerCalls, "NOT_RUN");
    assert.equal(report.remoteAvailability, "NOT_RUN");
    assert.equal(report.authValidity, "UNKNOWN");
    assert.equal(report.executionAuthorized, false);
    assert.equal(existsSync(join(f.home, ".pi/agent/models-store.json")), false);
    assert.equal(existsSync(join(f.home, ".pi/agent/auth.json")), false);
  } finally { f.cleanup(); }
});

test("preflight --models/--judge-model/--home 优先于环境与 --model", { skip: process.platform !== "darwin" }, () => {
  const f = fixture();
  try {
    const selectedHome = join(f.root, "selected-home");
    mkdirSync(join(selectedHome, ".pi/agent"), { recursive: true });
    const models = JSON.stringify({ providers: { fixture: { models: [{ id: "second" }] } } });
    writeFileSync(join(selectedHome, ".pi/agent/models.json"), models);
    const result = f.run(["preflight", "--models", "fixture/subject,fixture/second", "--model", "fixture/wrong", "--judge-model", "fixture/judge", "--home", selectedHome], { SKILL_EVAL_MODEL: "fixture/env-wrong", SKILL_EVAL_JUDGE_MODEL: "fixture/env-judge-wrong", SKILL_EVAL_PI_HOME: f.home });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.models.filter((m: { role: string }) => m.role === "subject").map((m: { requested: string }) => m.requested), ["fixture/subject", "fixture/second"]);
    assert(report.models.filter((m: { role: string }) => m.role === "judge").every((m: { requested: string }) => m.requested === "fixture/judge"));
    assert.equal(readFileSync(join(selectedHome, ".pi/agent/models.json"), "utf8"), models);
  } finally { f.cleanup(); }
});

test("preflight 支持环境选择，未指定评委时沿用被评模型", { skip: process.platform !== "darwin" }, () => {
  const f = fixture();
  try {
    const result = f.run(["preflight"], { SKILL_EVAL_MODEL: "fixture/subject", SKILL_EVAL_PI_HOME: f.home });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report.models.map((m: { requested: string }) => m.requested), ["fixture/subject", "fixture/subject"]);
    const overridden = f.run(["preflight"], { SKILL_EVAL_MODEL: "fixture/subject", SKILL_EVAL_JUDGE_MODEL: "fixture/judge", SKILL_EVAL_PI_HOME: f.home });
    assert.equal(overridden.status, 0, overridden.stderr);
    assert.equal(JSON.parse(overridden.stdout).models.find((m: { role: string }) => m.role === "judge").requested, "fixture/judge");
  } finally { f.cleanup(); }
});

test("preflight 显式缺值参数不能静默回退到环境或被评模型", { skip: process.platform !== "darwin" }, () => {
  const f = fixture();
  try {
    for (const args of [["--model"], ["--model="], ["--models=,,"], ["--judge-model"], ["--judge-model="], ["--home"], ["--home="]]) {
      const result = f.run(["preflight", ...args], { SKILL_EVAL_MODEL: "fixture/subject", SKILL_EVAL_JUDGE_MODEL: "fixture/judge", SKILL_EVAL_PI_HOME: f.home });
      assert.equal(result.status, 1, `${JSON.stringify(args)} silently changed model/config selection`);
      assert.match(result.stderr, /参数|值|模型/);
      assert(!result.stdout.includes("LOCAL_MODEL_IDENTITIES_CONFIRMED"));
    }
  } finally { f.cleanup(); }
});

test("eval 精确模型缺失即阻断，不创建运行目录或调用 Pi", { skip: process.platform !== "darwin" }, () => {
  const f = fixture();
  try {
    const skill = join(f.root, "candidate/SKILL.md");
    mkdirSync(dirname(skill));
    writeFileSync(skill, "---\nname: offline-fixture\ndescription: Offline fixture\n---\nFixture\n");
    const suite = join(f.root, "suite.json");
    writeFileSync(suite, JSON.stringify({ id: "offline-cli-test", tasks: [{ id: "task", prompt: "fixture task", assertions: [{ kind: "mustContain", value: "answer" }] }] }));
    const out = join(f.root, "must-not-create");
    const result = f.run(["eval", "--suite", suite, "--skill", skill, "--models", "fixture/subject,fixture/missing", "--judge-model", "fixture/judge", "--home", f.home, "--out", out]);
    assert.equal(result.status, 1);
    assert.equal(existsSync(out), false, "full matrix must be checked before any case or run root");
    assert(!result.stderr.includes("MODEL_INVOCATION_TRIPWIRE"));
    assert.match(result.stderr, /fixture\/missing/);
  } finally { f.cleanup(); }
});

function flowFixture() {
  const f = fixture();
  const argsPath = join(f.root, "flow-args.json");
  const entry = join(f.bin, "skill-eval");
  // The extension-less executable is CommonJS, keeping the test independent of repo package scope.
  writeFileSync(entry, `#!${process.execPath}\nconst {writeFileSync}=require('node:fs');writeFileSync(process.env.FLOW_ARGS_FILE,JSON.stringify(process.argv.slice(2)));console.log(JSON.stringify({valid:process.env.FLOW_MODEL_RESULT==='pass',providerCalls:'NOT_RUN'}));process.exitCode=process.env.FLOW_MODEL_RESULT==='pass'?0:1;\n`);
  chmodSync(entry, 0o755);
  writeFileSync(join(f.home, ".pi/agent/auth.json"), '{"offlineFixture":true}');
  const runFlow = (args: string[], extra: Record<string, string> = {}) => spawnSync("/bin/bash", [join(repo, "skills/skill-eval-flow/scripts/preflight.sh"), ...args], { cwd: repo, encoding: "utf8", timeout: 20000, env: { ...f.env, PATH: f.bin + ":/usr/bin:/bin", FLOW_ARGS_FILE: argsPath, ...extra } });
  return { ...f, argsPath, runFlow };
}

test("flow 模型预检失败不得输出 PREFLIGHT_OK", () => {
  const f = flowFixture();
  try {
    const result = f.runFlow([], { FLOW_MODEL_RESULT: "fail" });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stdout, /PREFLIGHT_FAIL/);
    assert(!result.stdout.includes("PREFLIGHT_OK"));
    assert.equal(JSON.parse(readFileSync(f.argsPath, "utf8"))[0], "preflight");
  } finally { f.cleanup(); }
});

test("flow 使用显式模型和HOME，未提供时才使用环境/工作流默认", () => {
  const f = flowFixture();
  try {
    const selectedHome = join(f.root, "flow-selected-home");
    const result = f.runFlow(["--models", "fixture/subject,fixture/second", "--judge-model", "fixture/judge", "--home", selectedHome], { FLOW_MODEL_RESULT: "pass", SKILL_EVAL_MODEL: "fixture/wrong", SKILL_EVAL_JUDGE_MODEL: "fixture/wrong-judge", SKILL_EVAL_PI_HOME: join(f.root, "wrong-home") });
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(f.argsPath, "utf8"));
    assert.deepEqual(args, ["preflight", "--models", "fixture/subject,fixture/second", "--judge-model", "fixture/judge", "--home", selectedHome]);
    assert.equal(existsSync(join(selectedHome, ".pi/agent/auth.json")), true);
    assert.equal(existsSync(join(f.root, "wrong-home")), false);
    const defaults = f.runFlow([], { FLOW_MODEL_RESULT: "pass" });
    assert.equal(defaults.status, 0, defaults.stderr);
    assert.deepEqual(JSON.parse(readFileSync(f.argsPath, "utf8")), ["preflight", "--model", "minimax-cn/MiniMax-M3.1-Flash", "--judge-model", "xiaomi-token-plan-cn/mimo-v2.6-flash", "--home", join(f.home, ".skill-eval/pi-home")]);
  } finally { f.cleanup(); }
});

test("flow 拒绝缺值/空值参数且不触发模型检查或配置复制", () => {
  const f = flowFixture();
  try {
    for (const args of [["--home"], ["--home="], ["--models="], ["--judge-model", "--home", "elsewhere"]]) {
      const result = f.runFlow(args, { FLOW_MODEL_RESULT: "pass" });
      assert.equal(result.status, 1, `${JSON.stringify(args)}: ${result.stdout}`);
      assert.match(result.stdout, /PREFLIGHT_FAIL/);
      assert(!result.stdout.includes("PREFLIGHT_OK"));
      assert.equal(existsSync(f.argsPath), false);
    }
    assert.equal(existsSync(join(f.home, ".skill-eval/pi-home")), false);
  } finally { f.cleanup(); }
});
