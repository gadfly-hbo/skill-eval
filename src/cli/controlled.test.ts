import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { resolvePiRuntime } from "../core/isolation.ts";

const cli = fileURLToPath(new URL("./main.ts", import.meta.url));
const repo = dirname(dirname(dirname(cli)));
const subject = "minimax-cn/MiniMax-M3.1-Flash";
const judge = "xiaomi-token-plan-cn/mimo-v2.6-flash";

function fixture(tasks = [{ id: "scored", prompt: "Offline fixture", kind: "scored" }]) {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-controlled-cli-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const skill = join(root, "candidate", "SKILL.md");
  const suite = join(root, "suite.json");
  const out = join(root, "must-not-create");
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(dirname(skill));
  writeFileSync(skill, "---\nname: offline-fixture\ndescription: Offline fixture\n---\nFixture\n");
  writeFileSync(suite, JSON.stringify({ id: "controlled-cli-fixture", repeat: 1, judgeRepeat: 2, tasks }));
  // A tripwire executable has no native SDK catalog. Guards must fail before even trying discovery.
  const marker = join(root, "PI_WAS_STARTED");
  const pi = join(bin, "pi");
  writeFileSync(pi, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected');process.exit(99);\n`);
  chmodSync(pi, 0o755);
  const denyFetch = join(root, "deny-fetch.mjs");
  writeFileSync(denyFetch, "globalThis.fetch = async () => { throw new Error('OFFLINE_NETWORK_DENIED'); };\n");
  const run = (args: string[], extraEnv: Record<string, string> = {}) => spawnSync(process.platform === "darwin" ? "/usr/bin/sandbox-exec" : process.execPath,
    [...(process.platform === "darwin" ? ["-p", "(version 1)(allow default)(deny network*)", process.execPath] : []), "--import", denyFetch, "--experimental-strip-types", cli, ...args], {
      cwd: repo, encoding: "utf8", timeout: 20000,
      env: { PATH: bin, HOME: home, LANG: "en_US.UTF-8", ...extraEnv },
    });
  const evalArgs = ["eval", "--suite", suite, "--skill", skill, "--model", subject, "--judge-model", judge, "--home", home, "--out", out];
  return { root, home, suite, out, marker, run, evalArgs, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function assertBlocked(f: ReturnType<typeof fixture>, result: ReturnType<ReturnType<typeof fixture>["run"]>, pattern: RegExp) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, pattern);
  assert.equal(existsSync(f.out), false, "guard must not create a run root or freeze a candidate");
  assert.equal(existsSync(f.marker), false, "guard must not invoke Pi");
  assert.deepEqual(readdirSync(f.home), [], "guard must not read/copy/create real auth configuration");
}

test("eval 大于8个计划会话仍进入精确模型预检", () => {
  const f = fixture([
    { id: "scored", prompt: "Scored fixture", kind: "scored" },
    { id: "diagnostic1", prompt: "Diagnostic fixture one", kind: "diagnostic" },
    { id: "diagnostic2", prompt: "Diagnostic fixture two", kind: "diagnostic" },
  ]);
  try {
    assertBlocked(f, f.run([...f.evalArgs, "--judge-repeat", "1"]), /模型预检|Pi.*运行时|SDK|package\.json/);
    assertBlocked(f, f.run([...f.evalArgs, "--judge-repeat", "7"]), /模型预检|Pi.*运行时|SDK|package\.json/);
  } finally { f.cleanup(); }
});

test("eval 单元素 --models 与普通选型均须精确目录核验", () => {
  const f = fixture([
    { id: "scored", prompt: "Scored fixture", kind: "scored" },
    { id: "diagnostic", prompt: "Diagnostic fixture", kind: "diagnostic" },
  ]);
  try {
    for (const extra of [[], ["--models", subject]]) {
      const result = f.run([...f.evalArgs, ...extra]);
      assertBlocked(f, result, /模型预检|Pi.*运行时|SDK|package\.json/);
      assert.doesNotMatch(result.stderr, /超过.*8|最多.*8|会话.*超/);
    }
  } finally { f.cleanup(); }
});

test("eval 明确报告单模型入口的能力范围", () => {
  const f = fixture();
  try {
    assertBlocked(f, f.run([...f.evalArgs, "--models", `${subject},${subject}`]), /只接受单个被评模型/);
  } finally { f.cleanup(); }
});

test("eval 未指定评委仍沿用被评模型，明确拒绝不支持的 profile 而不换模型", () => {
  const f = fixture();
  try {
    const args = [...f.evalArgs];
    args.splice(args.indexOf("--judge-model"), 2);
    const result = f.run(args);
    assertBlocked(f, result, /评委|judge/i);
    assert.match(result.stderr, /mimo-v2\.6-flash/);
    assert.doesNotMatch(result.stderr, /模型预检未通过/);
  } finally { f.cleanup(); }
});

test("eval 不允许非正整数重复次数绕过会话规划", () => {
  const f = fixture();
  try {
    for (const key of ["repeat", "judge-repeat"]) {
      for (const value of ["0", "-1", "0.5", "NaN", "Infinity", ""]) {
        assertBlocked(f, f.run([...f.evalArgs, `--${key}=${value}`]), /正整数/);
      }
      assertBlocked(f, f.run([...f.evalArgs, `--${key}`]), /正整数/);
    }
    const suite = JSON.parse(readFileSync(f.suite, "utf8"));
    writeFileSync(f.suite, JSON.stringify({ ...suite, repeat: 0.5 }));
    assertBlocked(f, f.run(f.evalArgs), /正整数/);
  } finally { f.cleanup(); }
});

test("eval/report 退役额外建议调用，原始记录不变且不生成派生目录", () => {
  const f = fixture();
  try {
    const historical = join(f.root, "historical");
    mkdirSync(historical);
    const original = "Historical bytes must be preserved.\n";
    writeFileSync(join(historical, "summary.json"), original);
    for (const command of [f.evalArgs, ["report", "--run", historical]]) {
      for (const flag of ["--llm-advice", "--llm-advice=true", "--llm-advice=false"]) {
        assertBlocked(f, f.run([...command, flag]), /llm-advice.*退役/);
      }
    }
    assert.equal(readFileSync(join(historical, "summary.json"), "utf8"), original);
    assert.deepEqual(readdirSync(historical), ["summary.json"]);
  } finally { f.cleanup(); }
});

test("eval 非空历史目录保护优先于预算规划及 SDK 发现", () => {
  const f = fixture();
  try {
    mkdirSync(f.out);
    writeFileSync(join(f.out, "KEEP"), "History\n");
    const result = f.run([...f.evalArgs, "--repeat", "99"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /非空.*禁止覆盖历史/);
    assert.equal(readFileSync(join(f.out, "KEEP"), "utf8"), "History\n");
    assert.deepEqual(readdirSync(f.out), ["KEEP"]);
    assert.equal(existsSync(f.marker), false);
  } finally { f.cleanup(); }
});

test("CLI help 说明原生模型能力和不设预算或默认超时", () => {
  const f = fixture();
  try {
    const result = f.run(["help"]);
    assert.equal(result.status, 0);
    assert(result.stdout.includes(subject));
    assert(result.stdout.includes(judge));
    assert.match(result.stdout, /原生上下文和输出上限/);
    assert.match(result.stdout, /不设预算封顶/);
    assert.match(result.stdout, /诊断题与全部评委轮次/);
    assert.match(result.stdout, /默认不设/);
    assert.doesNotMatch(result.stdout, /最多 8 会话|US\$1 等价预算|默认 480000|默认 300000/);
  } finally { f.cleanup(); }
});

function installedRuntime(): ReturnType<typeof resolvePiRuntime> | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const runtime = resolvePiRuntime();
    return runtime.args[0] && existsSync(join(runtime.readOnlyRoots[0]!, "dist/index.js")) ? runtime : undefined;
  } catch { return undefined; }
}
const nativeRuntime = installedRuntime();

for (const scenario of ["complete", "judge401"] as const) test(scenario === "complete"
  ? "普通 eval CLI 离线贯通原编排、原生隔离 worker、双角色共享账本及报告"
  : "普通 eval CLI 评委最终401失败不连坐其余冻结轮次，partial非零退出", {
  skip: nativeRuntime ? false : "Installed native Pi SDK and macOS sandbox required",
  timeout: 60_000,
}, () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-native-cli-offline-"));
  try {
    const home = join(root, "home"), bin = join(root, "bin"), out = join(root, "run");
    const config = join(home, ".pi/agent"), skill = join(root, "candidate", "SKILL.md");
    mkdirSync(config, { recursive: true }); mkdirSync(bin); mkdirSync(dirname(skill));
    // The only credentials visible to this test process are literal fake fixture keys.
    const fakeAuth = JSON.stringify({ "minimax-cn": { type: "api_key", key: "fixture-only" }, "xiaomi-token-plan-cn": { type: "api_key", key: "fixture-only" } });
    writeFileSync(join(config, "auth.json"), fakeAuth, { mode: 0o600 });
    symlinkSync(nativeRuntime!.args[0]!, join(bin, "pi"));
    writeFileSync(skill, "---\nname: offline-native-fixture\ndescription: Explicit offline test resource.\n---\nFixture body.\n");
    const suite = join(root, "suite.json");
    writeFileSync(suite, JSON.stringify({ id: "offline-native-cli", repeat: 1, judgeRepeat: 2, tasks: [
      { id: "scored", prompt: "Reply with the fixture phrase.", assertions: [{ kind: "mustContain", value: "OFFLINE FIXTURE" }] },
      { id: "diagnostic", kind: "diagnostic", prompt: "Reply with the fixture phrase again.", assertions: [{ kind: "mustContain", value: "OFFLINE FIXTURE" }] },
    ] }));
    const calls = join(root, "fixture-calls.jsonl"), timers = join(root, "fixture-timers.jsonl"), preload = join(root, "memory-fetch.mjs");
    writeFileSync(preload, `
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net'; import http from 'node:http'; import https from 'node:https';
const forbidden = () => { throw Error('REAL_NETWORK_FORBIDDEN_IN_OFFLINE_CLI'); };
net.connect = net.createConnection = http.request = http.get = https.request = https.get = forbidden;
syncBuiltinESMExports();
const calls = ${JSON.stringify(calls)};
const originalSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = (callback, ms, ...args) => {
  appendFileSync(${JSON.stringify(timers)}, JSON.stringify(ms) + '\\n');
  return originalSetTimeout(callback, ms, ...args);
};
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(String(init?.body));
  const isSubject = String(url) === 'https://api.minimaxi.com/anthropic/v1/messages?beta=true';
  const isJudge = String(url) === 'https://token-plan-cn.xiaomimimo.com/v1/chat/completions';
  const headers = new Headers(init?.headers);
  if ((!isSubject && !isJudge) || body.model !== (isSubject ? 'MiniMax-M3.1-Flash' : 'mimo-v2.6-flash') ||
      headers.get(isSubject ? 'x-api-key' : 'authorization') !== (isSubject ? 'fixture-only' : 'Bearer fixture-only')) forbidden();
  appendFileSync(calls, JSON.stringify({ role: isSubject ? 'subject' : 'judge', model: body.model, maxOutputTokens:body.max_tokens??body.max_completion_tokens, thinking:body.thinking }) + '\\n');
  if (!isSubject && ${JSON.stringify(scenario)} === 'judge401') return new Response('OFFLINE_HTTP_401_FIXTURE', {status:401});
  let stream;
  if (isSubject) {
    const events = [
      { type:'message_start', message:{id:'offline-fixture',type:'message',role:'assistant',model:body.model,content:[],usage:{input_tokens:100,output_tokens:0}} },
      { type:'content_block_start', index:0, content_block:{type:'text',text:''} },
      { type:'content_block_delta', index:0, delta:{type:'text_delta',text:'OFFLINE FIXTURE'} },
      { type:'content_block_stop', index:0 },
      { type:'message_delta', delta:{stop_reason:'end_turn'}, usage:{output_tokens:20} }, { type:'message_stop' }
    ];
    stream = events.map(e => 'event: '+e.type+'\\ndata: '+JSON.stringify(e)+'\\n\\n').join('');
  } else {
    const answer = JSON.stringify({verdict:'tie',scoreA:80,scoreB:80,confidence:1,reason:'Both outputs contain the identical fixture phrase.'});
    const chunks = [
      {id:'offline-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{role:'assistant',content:answer},finish_reason:null}]},
      {id:'offline-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[{index:0,delta:{},finish_reason:'stop'}]},
      {id:'offline-fixture',object:'chat.completion.chunk',created:1,model:body.model,choices:[],usage:{prompt_tokens:100,completion_tokens:20,total_tokens:120}}
    ];
    stream = chunks.map(e => 'data: '+JSON.stringify(e)+'\\n\\n').join('')+'data: [DONE]\\n\\n';
  }
  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
};
`);
    // macOS nested sandboxing is unsupported; the parent has hard network guards,
    // while every native SDK/tool worker is isolated by the product's network-denied OS sandbox.
    const result = spawnSync(process.execPath, ["--import", preload, "--experimental-strip-types", cli,
      "eval", "--suite", suite, "--skill", skill, "--model", subject, "--judge-model", judge,
      "--home", home, "--out", out, ...(scenario === "judge401" ? ["--timeout", "10000", "--judge-timeout", "10000"] : [])], {
      cwd: repo, encoding: "utf8", timeout: 55_000,
      env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, LANG: "en_US.UTF-8", NODE_DISABLE_COMPILE_CACHE: "1" },
    });
    assert.equal(result.error, undefined);
    const summary = JSON.parse(readFileSync(join(out, "summary.json"), "utf8"));
    const ledger = JSON.parse(readFileSync(join(out, "budget-ledger.json"), "utf8"));
    if (scenario === "judge401") {
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.equal(summary.status, "partial");
      assert.equal(summary.results.length, 4);
      assert.equal(ledger.state, "open");
      assert.equal(ledger.stoppedReason, null);
      assert.equal(ledger.sessions.length, 8);
      assert(ledger.requests.length >= 8);
      assert.equal(ledger.sessions.at(-1).state, "failed");
      assert.equal(ledger.requests.at(-1).state, "failed");
      assert.equal(ledger.chargedNanoUsd, null, "failed requests have UNKNOWN fees, not fabricated zero or full-window charges");
      assert.equal(ledger.knownChargedNanoUsd, 108000);
      assert(ledger.unknownRequests >= 4);
      assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, ledger.requests.length);
      const statuses = JSON.parse(readFileSync(join(out, "execution-status.json"), "utf8"));
      assert.equal(statuses.stopped, false);
      const notRun = statuses.sessions.filter((row: { status: string }) => row.status === "NOT_RUN");
      assert.equal(notRun.length, 0);
      assert(notRun.every((row: object) => !("usage" in row) && !("cost" in row)));
      const firstJudge = summary.pairwise[0];
      assert.equal(firstJudge.judgeRuns.length, 2);
      assert.equal(firstJudge.verdict, "not_judged");
      assert(firstJudge.judgeRuns[0].error, "failed judge must retain an error code");
      const judgeDir = join(out, "pairwise", firstJudge.variantResultId);
      const judgePlan = JSON.parse(readFileSync(join(judgeDir, "judge-plan.json"), "utf8"));
      const failure = JSON.parse(readFileSync(join(judgeDir, judgePlan.rounds[0].dirName, "failure-evidence.json"), "utf8"));
      assert(failure.firstCause, "SDK terminal failure retains a final cause");
      const failedWire = readdirSync(join(judgeDir, judgePlan.rounds[0].dirName)).find(name => /^wire-.*\.json$/.test(name) && !name.endsWith(".request.json"))!;
      assert.equal(JSON.parse(readFileSync(join(judgeDir, judgePlan.rounds[0].dirName, failedWire), "utf8")).response.status, 401, "raw HTTP status remains authoritative");
      assert.equal(readFileSync(join(config, "auth.json"), "utf8"), fakeAuth);
      return;
    }
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.equal(summary.status, "success", JSON.stringify({ stderr: result.stderr, results: summary.results.map((row: { id: string; status: string; error: string | null }) => ({ id: row.id, status: row.status, error: row.error })), budgetState: ledger.state, stoppedReason: ledger.stoppedReason }));
    assert.equal(summary.results.length, 4);
    assert(summary.results.every((row: { status: string; output: string; isolation: { verified: boolean }; assertions: { passed: number } }) => row.status === "success" && row.output === "OFFLINE FIXTURE" && row.isolation.verified && row.assertions.passed === 1));
    assert.equal(summary.pairwise.length, 2);
    assert(summary.pairwise.every((pair: { verdict: string; judgeRuns: { verdict: string }[] }) => pair.verdict === "tie" && pair.judgeRuns.length === 2 && pair.judgeRuns.every(judge => judge.verdict === "tie")));
    assert.equal(ledger.state, "open");
    assert.equal(ledger.sessions.length, 8);
    assert.equal(ledger.sessions.filter((row: { role: string }) => row.role === "subject").length, 4);
    assert.equal(ledger.sessions.filter((row: { role: string }) => row.role === "judge").length, 4);
    assert(ledger.sessions.every((row: { state: string }) => row.state === "completed"));
    assert.equal(ledger.chargedNanoUsd, 186400, "raw fixture usage must include both subjects and judges");
    assert.equal(ledger.reservedNanoUsd, 0);
    assert(ledger.requests.length >= 8);
    const captured = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line));
    assert.equal(captured.length, ledger.requests.length);
    assert(captured.filter(row => row.role === "subject").every(row => row.maxOutputTokens === 524288 && row.thinking?.type === "adaptive"));
    assert(captured.filter(row => row.role === "judge").every(row => row.maxOutputTokens === 131072 && row.thinking?.type === "enabled"));
    assert.equal(ledger.policy.maxNanoUsd, null);
    assert.equal(ledger.policy.maxSessions, null);
    assert.equal(JSON.parse(readFileSync(join(out, "controlled-execution.json"), "utf8")).plannedSessions, 8);
    const timerValues = existsSync(timers) ? readFileSync(timers, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];
    assert(!timerValues.includes(480_000) && !timerValues.includes(300_000) && !timerValues.includes(120_000), "Host must not impose an unrequested sample deadline");
    assert.match(readFileSync(join(out, "REPORT.md"), "utf8"), /激活|activation/i);
    assert.equal(readFileSync(join(config, "auth.json"), "utf8"), fakeAuth);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
