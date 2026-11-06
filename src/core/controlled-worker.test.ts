import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildSandboxCommand, resolvePiRuntime } from "./isolation.ts";

type Request = { type: string; requestId: string; url: string; body: string; headers: Record<string, string> };
type Fixture = "normal" | "broker-error" | "length" | "tool-error" | "python" | "read-skill" | "outside-read" | "missing-definition";
// Parent-side test guard: every HTTP response must come from an explicit fixture.
globalThis.fetch = async () => { throw new Error("REAL_PROVIDER_FORBIDDEN_IN_OFFLINE_TEST"); };

const subject = "minimax-cn/MiniMax-M3.1-Flash", judge = "xiaomi-token-plan-cn/mimo-v2.6-flash";

function installedRuntime(): ReturnType<typeof resolvePiRuntime> | undefined {
  if (process.platform !== "darwin") return undefined;
  try {
    const runtime = resolvePiRuntime();
    return existsSync(join(runtime.readOnlyRoots[0]!, "dist", "index.js")) ? runtime : undefined;
  } catch { return undefined; }
}
const runtime = installedRuntime();
const skip = runtime ? false : "Installed native Pi SDK and macOS sandbox are required";

function responseBody(model: string, fixture: Fixture, resourcePath?: string): string {
  const id = model.slice(model.indexOf("/") + 1);
  if (model === subject) {
    if (["tool-error", "python", "read-skill", "outside-read"].includes(fixture)) {
      const tool = fixture === "python"
        ? { name: "bash", input: { command: `/usr/bin/python3 -c 'import json,sys; print(json.dumps({"version": sys.version.split()[0]}))'` } }
        : { name: "read", input: { path: resourcePath ?? "__missing_offline_fixture__.txt" } };
      const events = [
        { type: "message_start", message: { id: "offline-fixture", type: "message", role: "assistant", model: id, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
        { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "offline-tool", name: tool.name, input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } },
        { type: "content_block_stop", index: 0 },
        { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 3 } },
        { type: "message_stop" },
      ];
      return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
    }
    const events = [
      { type: "message_start", message: { id: "offline-fixture", type: "message", role: "assistant", model: id, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: fixture === "missing-definition" ? "当前材料未定义所请求的流程，缺少流程规则。" : "OFFLINE FIXTURE" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: fixture === "length" ? "max_tokens" : "end_turn", stop_sequence: null }, usage: { output_tokens: 3 } },
      { type: "message_stop" },
    ];
    return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  }
  const chunks = [
    { id: "offline-fixture", object: "chat.completion.chunk", created: 1, model: id, choices: [{ index: 0, delta: { role: "assistant", content: "OFFLINE FIXTURE" }, finish_reason: null }] },
    { id: "offline-fixture", object: "chat.completion.chunk", created: 1, model: id, choices: [{ index: 0, delta: {}, finish_reason: fixture === "length" ? "length" : "stop" }] },
    { id: "offline-fixture", object: "chat.completion.chunk", created: 1, model: id, choices: [], usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 } },
  ];
  return chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
}

async function runFixture(model: string, fixture: Fixture, changes: { maxOutputTokens?: number; model?: Record<string, unknown>; skill?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), "controlled-native-offline-"));
  const candidate = mkdtempSync(join(tmpdir(), "controlled-native-candidate-"));
  const privateRoot = mkdtempSync(join(tmpdir(), "controlled-native-private-"));
  const skillPath = join(candidate, "SKILL.md");
  writeFileSync(skillPath, "---\nname: explicit-offline-resource\ndescription: Local resource for the offline read fixture.\n---\nEXPLICIT_RESOURCE_BODY_CANARY\n");
  mkdirSync(join(privateRoot, ".local"));
  const privatePath = join(privateRoot, ".local", "private.txt");
  writeFileSync(privatePath, "PRIVATE_RESOURCE_MUST_NOT_BE_READ");
  const worker = join(root, "controlled-worker.mts");
  // A standalone .mts needs no permission to read the repository package.json.
  copyFileSync(fileURLToPath(new URL("./controlled-worker.ts", import.meta.url)), worker);
  const configDir = join(root, ".pi", "agent");
  mkdirSync(configDir, { recursive: true });
  if (changes.model) {
    const [provider, id] = model.split("/");
    writeFileSync(join(configDir, "models.json"), JSON.stringify({ providers: { [provider!]: { models: [{ id, ...changes.model }] } } }));
  }
  const authPath = join(configDir, "auth.json");
  writeFileSync(authPath, "CREDENTIAL_CANARY_MUST_NOT_BE_READ");
  writeFileSync(join(root, "AGENTS.md"), "CONTEXT_CANARY_MUST_NOT_BE_LOADED");
  mkdirSync(join(root, ".pi", "skills", "unwanted"), { recursive: true });
  writeFileSync(join(root, ".pi", "skills", "unwanted", "SKILL.md"), "---\nname: unwanted\ndescription: SKILL_CANARY_MUST_NOT_BE_LOADED\n---\nUnwanted skill.");
  const command = buildSandboxCommand({ command: runtime!.command, args: ["--experimental-strip-types", worker], workspaceRoot: root, readOnlyRoots: [...runtime!.readOnlyRoots, ...(changes.skill ? [candidate] : [])] });
  command.args[1] += `\n(deny network*)\n(deny file-read* (literal ${JSON.stringify(authPath)}))`;
  const child = spawn(command.command, command.args, {
    cwd: root, stdio: ["pipe", "pipe", "pipe", "ipc"],
    env: { HOME: root, PATH: "/usr/bin:/bin", PI_OFFLINE: "1", NODE_DISABLE_COMPILE_CACHE: "1" },
  });
  let stdout = "", stderr = "";
  const requests: Request[] = [];
  child.stdout!.on("data", chunk => { stdout += chunk; });
  child.stderr!.on("data", chunk => { stderr += chunk; });
  child.on("message", value => {
    const request = value as Request;
    requests.push(request);
    if (fixture === "broker-error") {
      child.send({ type: "response-error", requestId: request.requestId, code: "OFFLINE_FIXTURE_REJECTED" });
    } else {
      child.send({ type: "response", requestId: request.requestId, status: 200, headers: { "content-type": "text/event-stream" }, body: responseBody(model, ["python", "read-skill"].includes(fixture) && requests.length > 1 ? "normal" : fixture, fixture === "read-skill" ? skillPath : fixture === "outside-read" ? privatePath : undefined) });
    }
  });
  child.stdin!.end(JSON.stringify({ sdkRoot: runtime!.readOnlyRoots[0], workspaceRoot: root, home: root, sessionId: "offline-fixture-session", prompt: "Reply to this offline fixture.", model, skillPaths: changes.skill ? [skillPath] : [], maxOutputTokens: changes.maxOutputTokens ?? (model === subject ? 4096 : 1024) }));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    return { code, requests, stderr, stdout, skillPath, events: stdout.trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) as any[] };
  } finally {
    clearTimeout(timeout);
    rmSync(root, { recursive: true, force: true });
    rmSync(candidate, { recursive: true, force: true });
    rmSync(privateRoot, { recursive: true, force: true });
  }
}

for (const model of [subject, judge]) {
  test(`native SDK ${model} uses broker-only HTTP and enforces final wire output cap offline`, { skip, timeout: 25_000 }, async () => {
    const result = await runFixture(model, "normal");
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(result.stderr, "");
    assert.equal(result.requests.length, 1, "No retries, compaction or warming requests");
    const request = result.requests[0]!;
    assert.equal(request.type, "request");
    assert.equal(request.requestId, "offline-fixture-session-r1");
    const payload = JSON.parse(request.body);
    assert.equal(payload.model, model.split("/")[1]);
    assert.equal(payload.stream, true);
    assert.equal(payload[model === subject ? "max_tokens" : "max_completion_tokens"], model === subject ? 4096 : 1024);
    assert.equal(payload[model === subject ? "max_completion_tokens" : "max_tokens"], undefined);
    assert.ok(!request.body.includes("CANARY_MUST_NOT_BE_LOADED"));
    assert.ok(!result.stdout.includes("CREDENTIAL_CANARY"));
    assert.ok(Object.values(request.headers).some(value => value.includes("controlled-broker-placeholder")));
    assert.ok(result.events.some(event => event.type === "provider_stream_event"));
    const message = result.events.find(event => event.type === "message_end" && event.message?.role === "assistant")?.message;
    assert.equal(message?.usage.input, 10);
    assert.equal(message?.usage.output, 3);
    assert.equal(message?.stopReason, "stop");
    if (model === judge) assert.equal(message.usage.cost.total, 0, "Native subscription cost is not a cash accounting source");
  });
}

test("native SDK broker failures abort without retrying or succeeding with empty output", { skip, timeout: 25_000 }, async () => {
  const result = await runFixture(subject, "broker-error");
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.ok(result.events.some(event => event.type === "controlled_error"));
});

test("native SDK truncated judge output aborts the controlled session", { skip, timeout: 25_000 }, async () => {
  const result = await runFixture(judge, "length");
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.ok(result.events.some(event => event.type === "controlled_error" && event.code === "WORKER_ASSISTANT_FAILED"));
});

test("native SDK tool failures abort before any model continuation request", { skip, timeout: 25_000 }, async () => {
  const result = await runFixture(subject, "tool-error");
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.ok(result.events.some(event => event.type === "tool_execution_end" && event.isError === true));
  assert.ok(result.events.some(event => event.type === "controlled_error" && event.code === "WORKER_TOOL_FAILED"));
});

test("native worker refuses unapproved ids and model-bound cap changes before HTTP", { skip, timeout: 25_000 }, async () => {
  for (const [model, cap] of [[subject, 4095], [judge, 1025], ["minimax-cn/MiniMax-M3", 4096]] as const) {
    const result = await runFixture(model, "normal", { maxOutputTokens: cap });
    assert.equal(result.code, 1);
    assert.equal(result.requests.length, 0);
  }
});

test("native worker refuses descriptor drift in API, endpoint, context, reasoning and output capacity", { skip, timeout: 25_000 }, async () => {
  for (const model of [subject, judge]) {
    for (const changed of [
      { api: model === subject ? "openai-completions" : "anthropic-messages" },
      { baseUrl: "https://unapproved.invalid/v1" },
      { contextWindow: 1000 },
      { reasoning: false },
      { maxTokens: model === subject ? 4095 : 1023 },
    ]) {
      const result = await runFixture(model, "normal", { model: changed });
      assert.equal(result.code, 1, JSON.stringify(changed));
      assert.equal(result.requests.length, 0, JSON.stringify(changed));
    }
  }
});

test("native bash keeps the system Python shim cache in its workspace without polluting JSON output", { skip, timeout: 25_000 }, async () => {
  const result = await runFixture(subject, "python");
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.requests.length, 2);
  const end = result.events.find(event => event.type === "tool_execution_end" && event.toolName === "bash");
  assert.equal(end?.isError, false);
  assert.equal(end.result.structuredContent.exit_code, 0);
  const output = end.result.content.filter((part: any) => part.type === "text").map((part: any) => part.text).join("\n");
  assert.match(JSON.parse(output).version, /^3\./);
});

test("native baseline exposes no skill while the variant reads only its explicit package", { skip, timeout: 25_000 }, async () => {
  const baseline = await runFixture(subject, "normal", {});
  const variant = await runFixture(subject, "read-skill", { skill: true });
  assert.equal(baseline.code, 0, baseline.stdout + baseline.stderr);
  assert.equal(variant.code, 0, variant.stdout + variant.stderr);
  const system = (request: Request) => JSON.parse(request.body).system.map((block: { text: string }) => block.text).join("\n") as string;
  assert.ok(!system(baseline.requests[0]!).includes("explicit-offline-resource"));
  assert.ok(system(variant.requests[0]!).includes(variant.skillPath));
  assert.equal(variant.requests.length, 2);
  const read = variant.events.find(event => event.type === "tool_execution_end" && event.toolName === "read");
  assert.equal(read?.isError, false);
  assert.ok(JSON.stringify(read.result).includes("EXPLICIT_RESOURCE_BODY_CANARY"));
});

test("native worker rejects private resources outside the workspace and stops before a repair request", { skip, timeout: 25_000 }, async () => {
  const result = await runFixture(subject, "outside-read", { skill: true });
  assert.equal(result.code, 1);
  assert.equal(result.requests.length, 1);
  assert.ok(result.events.some(event => event.type === "tool_execution_end" && event.isError === true));
  assert.ok(!result.stdout.includes("PRIVATE_RESOURCE_MUST_NOT_BE_READ"));
});

test("native worker permits a normal missing-definition answer without weakening the tool failure gate", { skip, timeout: 25_000 }, async () => {
  const result = await runFixture(subject, "missing-definition", {});
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.equal(result.requests.length, 1);
  assert.ok(!result.events.some(event => event.type === "controlled_error"));
  const message = result.events.find(event => event.type === "message_end" && event.message?.role === "assistant")?.message;
  assert.ok(message.content.some((block: any) => block.type === "text" && block.text.includes("缺少流程规则")));
});
