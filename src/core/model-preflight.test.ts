import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { preflightModels } from "./model-preflight.ts";
import { resolvePiRuntime } from "./isolation.ts";

test("模型预检包含配置与缓存均未列出的 Pi 内置精确型号", { skip: process.platform !== "darwin" }, async () => {
  const fixture = makeFixture();
  try {
    const report = await preflightModels({ models: ["fixture/Target"], judgeModel: "review/Reviewer", home: fixture.home, pathEnv: fixture.bin });
    assert.equal(report.valid, true, JSON.stringify(report));
    assert.equal(report.models.find(row => row.requested === "fixture/Target")?.model?.id, "Target");
    assert.equal(report.providerCalls, "NOT_RUN");
    assert.equal(report.remoteAvailability, "NOT_RUN");
    assert.equal(report.authValidity, "UNKNOWN");
    assert.equal(report.billing, "UNKNOWN");
    assert.equal(report.executionAuthorized, false);
  } finally { fixture.cleanup(); }
});

test("旧缓存与其他自定义型号不覆盖内置目标的 API 身份", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    writeFileSync(join(f.configDir, "models.json"), JSON.stringify({ providers: { fixture: { api: "openai-completions", models: [{ id: "Other", api: "openai-completions", baseUrl: "https://fixture.invalid/v1" }] } } }));
    writeFileSync(join(f.configDir, "models-store.json"), JSON.stringify({ fixture: { lastModified: 0, models: [{ provider: "fixture", id: "Target", api: "openai-completions", baseUrl: "https://stale.invalid/v1", contextWindow: 9000, maxTokens: 1000 }] } }));
    const report = await preflightModels({ models: ["fixture/Target"], home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, true, JSON.stringify(report));
    assert.equal(report.models[0]?.model?.api, "anthropic-messages");
    assert.equal(report.models[0]?.model?.baseUrl, "https://fixture.invalid/anthropic");
  } finally { f.cleanup(); }
});

test("预检记录 SDK 最终覆盖结果，并包含较新缓存追加型号", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    writeFileSync(join(f.configDir, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "Target", api: "openai-completions", baseUrl: "https://custom.invalid/v2", contextWindow: 65536, maxTokens: 7777, reasoning: false }] } } }));
    writeFileSync(join(f.configDir, "models-store.json"), JSON.stringify({ fixture: { lastModified: 2000, models: [{ provider: "fixture", id: "CacheOnly", api: "anthropic-messages", baseUrl: "https://catalog.invalid/api", contextWindow: 123000, maxTokens: 3333, reasoning: true }] } }));
    const report = await preflightModels({ models: ["fixture/Target", "fixture/CacheOnly"], home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, true, JSON.stringify(report));
    const target = report.models.find(row => row.requested === "fixture/Target")?.model;
    assert.equal(target?.api, "openai-completions");
    assert.equal(target?.baseUrl, "https://custom.invalid/v2");
    assert.equal(target?.contextWindow, 65536);
    assert.equal(target?.maxTokens, 7777);
    assert.equal(target?.reasoning, false);
    assert.equal(report.models.find(row => row.requested === "fixture/CacheOnly")?.model?.maxTokens, 3333);
  } finally { f.cleanup(); }
});

test("缺失、近似、错误 provider、裸 ID 与大小写变体不能冒充精确型号", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    for (const requested of ["fixture/Target-preview", "other/Target", "Target", "fixture/target"]) {
      const report = await preflightModels({ models: [requested], home: f.home, pathEnv: f.bin });
      assert.equal(report.valid, false, `${requested}: ${JSON.stringify(report)}`);
      assert.equal(report.executionAuthorized, false);
      assert.ok(report.errors.length > 0 || report.models.some(row => row.error));
    }
  } finally { f.cleanup(); }
});

test("缺失评委使整份预检失败，即使被评模型存在", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    const report = await preflightModels({ models: ["fixture/Target"], judgeModel: "review/Missing", home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, false, JSON.stringify(report));
    assert.equal(report.models.find(row => row.requested === "fixture/Target")?.model?.id, "Target");
    assert.ok(report.models.find(row => row.requested === "review/Missing")?.error);
  } finally { f.cleanup(); }
});

test("非法配置失败关闭，不以 SDK 的内置回退掩盖问题且不泄露配置", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    const module = join(f.packageRoot, "dist", "core", "model-runtime.js");
    writeFileSync(module, readFileSync(module, "utf8").replace("getError() { return undefined; }", "getError() { return 'PRIVATE_CONFIG_VALUE'; }"));
    const report = await preflightModels({ models: ["fixture/Target"], home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, false);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_CONFIG_VALUE"));
    writeFileSync(join(f.configDir, "models.json"), '{"providers":PRIVATE_PARSE_VALUE');
    const parsed = await preflightModels({ models: ["fixture/Target"], home: f.home, pathEnv: f.bin });
    assert.equal(parsed.valid, false);
    assert.ok(!JSON.stringify(parsed).includes("PRIVATE_PARSE_VALUE"));
  } finally { f.cleanup(); }
});

test("无效缓存不能静默退回内置目录", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    writeFileSync(join(f.configDir, "models-store.json"), '{"fixture":PRIVATE_CACHE_VALUE');
    const report = await preflightModels({ models: ["fixture/Target"], home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, false);
    assert.ok(!JSON.stringify(report).includes("PRIVATE_CACHE_VALUE"));
  } finally { f.cleanup(); }
});

test("worker 无权读取认证或创建锁，原配置保持原样", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    const module = join(f.packageRoot, "dist", "core", "model-runtime.js");
    const source = readFileSync(module, "utf8");
    const guarded = source.replace("import { readFileSync } from 'node:fs';", "import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';");
    writeFileSync(module, guarded.replace("const config = JSON.parse(readFileSync(options.modelsPath, 'utf8'));", `
    const denied = action => { try { action(); return false; } catch (e) { return e.code === 'EPERM' || e.code === 'EACCES'; } };
    const auth = options.modelsPath.replace(/models\\.json$/, 'auth.json');
    if (!denied(() => readFileSync(auth))) throw Error('Credential file was readable');
    if (!denied(() => writeFileSync(options.modelsPath, '{}'))) throw Error('Config file was writable');
    if (!denied(() => mkdirSync(options.modelsPath.replace(/models\\.json$/, 'models-store.json.lock')))) throw Error('Source lock could be created');
    const config = JSON.parse(readFileSync(options.modelsPath, 'utf8'));
    `));
    const names = readdirSync(f.configDir).sort();
    const modelsBefore = readFileSync(join(f.configDir, "models.json"), "utf8");
    const cacheBefore = readFileSync(join(f.configDir, "models-store.json"), "utf8");
    const report = await preflightModels({ models: ["fixture/Target"], home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, true, JSON.stringify(report));
    assert.deepEqual(readdirSync(f.configDir).sort(), names);
    assert.equal(readFileSync(join(f.configDir, "models.json"), "utf8"), modelsBefore);
    assert.equal(readFileSync(join(f.configDir, "models-store.json"), "utf8"), cacheBefore);
    assert.equal(readFileSync(join(f.configDir, "auth.json"), "utf8"), "DO_NOT_READ_AUTH_FILE");
  } finally { f.cleanup(); }
});

test("选择的 home 决定配置来源，不被另一个 home 的目录覆盖", { skip: process.platform !== "darwin" }, async () => {
  const first = makeFixture(), second = makeFixture();
  try {
    for (const [f, maxTokens] of [[first, 1111], [second, 2222]] as const) writeFileSync(join(f.configDir, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "Target", api: "anthropic-messages", baseUrl: "https://fixture.invalid/anthropic", contextWindow: 50000, maxTokens }] } } }));
    const a = await preflightModels({ models: ["fixture/Target"], home: first.home, pathEnv: first.bin });
    const b = await preflightModels({ models: ["fixture/Target"], home: second.home, pathEnv: first.bin });
    assert.equal(a.valid, true, JSON.stringify(a));
    assert.equal(b.valid, true, JSON.stringify(b));
    assert.equal(a.models[0]?.model?.maxTokens, 1111);
    assert.equal(b.models[0]?.model?.maxTokens, 2222);
  } finally { first.cleanup(); second.cleanup(); }
});

test("URL 私密部分脱敏并明确标记，不额外阻断精确型号命中", { skip: process.platform !== "darwin" }, async () => {
  const f = makeFixture();
  try {
    writeFileSync(join(f.configDir, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "Target", api: "anthropic-messages", baseUrl: "https://PRIVATE_URL_USER:PRIVATE_URL_SECRET@fixture.invalid/api?key=PRIVATE_QUERY_SECRET#PRIVATE_FRAGMENT_SECRET" }] } } }));
    const report = await preflightModels({ models: ["fixture/Target"], home: f.home, pathEnv: f.bin });
    assert.equal(report.valid, true, JSON.stringify(report));
    assert.equal(report.models[0]?.model?.baseUrl, "https://fixture.invalid/api");
    assert.equal(report.models[0]?.model?.baseUrlRedacted, true);
    for (const value of ["PRIVATE_URL_USER", "PRIVATE_URL_SECRET", "PRIVATE_QUERY_SECRET", "PRIVATE_FRAGMENT_SECRET", "?key=", "#PRIVATE", "@fixture.invalid"]) assert.ok(!JSON.stringify(report).includes(value), value);
  } finally { f.cleanup(); }
});

test("真实已安装 Pi SDK 离线合并目录包含 Flash，不依赖显式配置或缓存列出它", { skip: process.platform !== "darwin" }, async context => {
  try { resolvePiRuntime(); } catch { context.skip("本机未安装 Pi；不安装依赖或访问 Provider"); return; }
  const f = makeFixture();
  try {
    writeFileSync(join(f.configDir, "models.json"), JSON.stringify({ providers: { "minimax-cn": { api: "openai-completions", models: [{ id: "MiniMax-M3", api: "openai-completions", baseUrl: "https://api.minimaxi.com/v1" }] } } }));
    writeFileSync(join(f.configDir, "models-store.json"), JSON.stringify({ "minimax-cn": { lastModified: 0, models: [] } }));
    const report = await preflightModels({ models: ["minimax-cn/MiniMax-M3.1-Flash"], judgeModel: "xiaomi-token-plan-cn/mimo-v2.6-flash", home: f.home });
    assert.equal(report.valid, true, JSON.stringify(report));
    assert.equal(report.models.find(row => row.requested === "minimax-cn/MiniMax-M3.1-Flash")?.model?.api, "anthropic-messages");
    assert.equal(report.models.find(row => row.requested === "xiaomi-token-plan-cn/mimo-v2.6-flash")?.model?.api, "openai-completions");
    assert.equal(report.providerCalls, "NOT_RUN");
    assert.equal(report.executionAuthorized, false);
    assert.equal(readFileSync(join(f.configDir, "auth.json"), "utf8"), "DO_NOT_READ_AUTH_FILE");
  } finally { f.cleanup(); }
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-model-preflight-"));
  const packageRoot = join(root, "node_modules", "offline-model-pi");
  const bin = join(root, "bin");
  const home = join(root, "source-home");
  const configDir = join(home, ".pi", "agent");
  for (const dir of [join(packageRoot, "dist", "bundle"), join(packageRoot, "dist", "core"), bin, configDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "offline-model-pi", version: "1.0.0", type: "module", bin: { pi: "dist/bundle/cli.js" } }));
  const entry = join(packageRoot, "dist", "bundle", "cli.js");
  writeFileSync(entry, "#!/usr/bin/env node\nthrow new Error('The pi CLI must never run in a model preflight');\n");
  chmodSync(entry, 0o755);
  symlinkSync(entry, join(bin, "pi"));
  writeFileSync(join(configDir, "models.json"), JSON.stringify({ providers: { fixture: { models: [{ id: "Other", api: "openai-completions", baseUrl: "https://fixture.invalid/v1" }] } } }));
  writeFileSync(join(configDir, "models-store.json"), JSON.stringify({ fixture: { lastModified: 0, models: [{ id: "Old", provider: "fixture", api: "openai-completions", baseUrl: "https://fixture.invalid/v1" }] } }));
  writeFileSync(join(configDir, "auth.json"), "DO_NOT_READ_AUTH_FILE");
  writeFileSync(join(packageRoot, "dist", "core", "model-runtime.js"), `
import { readFileSync } from 'node:fs';
const builtins = [
  { provider: 'fixture', id: 'Target', api: 'anthropic-messages', baseUrl: 'https://fixture.invalid/anthropic', contextWindow: 1000000, maxTokens: 32000, reasoning: true },
  { provider: 'review', id: 'Reviewer', api: 'openai-completions', baseUrl: 'https://review.invalid/v1', contextWindow: 128000, maxTokens: 4096, reasoning: false }
];
export class ModelRuntime {
  static async create(options) {
    if (options.refreshOnCreate !== false || options.allowModelNetwork !== false || !options.credentials || !options.modelsStore) throw Error('Unsafe model runtime construction');
    const config = JSON.parse(readFileSync(options.modelsPath, 'utf8'));
    return new ModelRuntime(config);
  }
  constructor(config) { this.config = config; this.dynamic = new Map(); }
  getError() { return undefined; }
  getProvider(id) {
    if (!builtins.some(m => m.provider === id) && !this.config.providers[id]) return undefined;
    return { id, getModels: () => this.getModels(id), refreshModels: async context => {
      if (context.allowNetwork !== false) throw Error('Network refresh is forbidden');
      await context.publish({ update: () => { this.dynamic.set(id, context.stored?.lastModified > 1000 ? context.stored.models : []); } });
    } };
  }
  getModels(id) {
    const rows = new Map(builtins.filter(m => m.provider === id).map(m => [m.id, m]));
    for (const m of this.dynamic.get(id) ?? []) rows.set(m.id, m);
    for (const m of this.config.providers[id]?.models ?? []) rows.set(m.id, { provider: id, contextWindow: 128000, maxTokens: 4096, reasoning: false, ...m });
    return [...rows.values()];
  }
  getModel(provider, id) { return this.getModels(provider).find(m => m.id === id); }
  refresh() { throw Error('ModelRuntime.refresh must not run'); }
  getAvailable() { throw Error('Credential availability must not run'); }
  checkAuth() { throw Error('Authentication must not run'); }
}
`);
  return { root, packageRoot, bin, home, configDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
