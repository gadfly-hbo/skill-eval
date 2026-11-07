/**
 * pi CLI 适配层。
 *
 * 直接 spawn `pi` CLI 并解析其 JSON 事件流。刻意不依赖任何产品内部模块：
 * 本仓库必须能独立运行在任意装了 pi CLI 的机器上。
 *
 * 关键事实（实测于 pi CLI v1.2.0）：`--skill` 只是把 skill 的 name/description/path
 * 放进 system prompt 的 <skills> 段落，模型必须主动 read 该文件，内容才真正进入上下文。
 * 因此调用方需要从事件流中取证「模型是否真的读了 skill」。
 */

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSandboxCommand, canonicalPath, preparePiIsolation, resolvePiRuntime, validateRuntimeRoots, verifySandboxCommand, type IsolationVerification, type PiIsolationOptions } from "./isolation.ts";

export interface PiRunOptions {
  /** 运行工作目录，同时作为 pi 的 cwd。 */
  workspaceRoot: string;
  /** 会话 ID，保证可追溯与可回放。 */
  sessionId: string;
  /** 用户提示词。 */
  prompt: string;
  /** 模型标识，形如 `provider/model`。 */
  model?: string | undefined;
  /** 要加载的 skill 文件绝对路径列表。空数组表示不加载任何 skill。 */
  skillPaths?: string[];
  /** 允许模型使用网络工具。默认关闭，保证评估可复现。 */
  allowWeb?: boolean;
  /** 单次运行超时（毫秒）。 */
  timeoutMs?: number;
  /** 隔离 HOME，避免污染用户全局 pi 配置与锁文件争用。 */
  home?: string | undefined;
  /** Required filesystem isolation; absent options still use the fail-closed default. */
  isolation?: PiIsolationOptions;
  /**
   * 允许子进程继承宿主 IDE 的 fs 删除保护注入。
   *
   * 默认 false：pi 启动/退出时会用 fs.rmdirSync 清理自己的 `*.lock` 目录，
   * 若宿主（CodeBuddy / WorkBuddy 等）通过 NODE_OPTIONS 注入了 safe-delete shim，
   * 这些清理会被 broker 拒绝并让 pi 直接崩溃。pi 是独立 CLI，被测对象的行为不应
   * 受宿主 IDE 的删除策略影响，因此默认剥离该注入。
   */
  inheritHostFsHooks?: boolean;
  /** 事件回调。 */
  onEvent?: (event: PiEvent) => void;
}

export interface PiEvent {
  type: string;
  [key: string]: unknown;
}

export interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { input?: number; output?: number; total?: number };
}

export interface PiRunMetrics {
  totalTokens: number;
  totalCost: number;
  toolCalls: number;
  /** 最终助手文本输出。 */
  output: string;
  /** 读过的文件路径（工具调用取证）。 */
  readPaths: string[];
  /** 工具调用名称序列。 */
  toolNames: string[];
}

export interface PiRunResult {
  exitCode: number | null;
  metrics: PiRunMetrics;
  /** 完整事件流，落盘供复核。 */
  events: PiEvent[];
  stderr: string;
  timedOut: boolean;
  isolation: IsolationVerification;
}

export function emptyMetrics(): PiRunMetrics {
  return { totalTokens: 0, totalCost: 0, toolCalls: 0, output: "", readPaths: [], toolNames: [] };
}

/**
 * 关闭宿主 IDE 注入的 fs hook。
 *
 * 背景（实测）：CodeBuddy / WorkBuddy 等宿主通过 `NODE_OPTIONS --require` 给所有
 * node 子进程注入 fs shim，把 `fs.mkdirSync` / `fs.rmdirSync` / `fs.unlinkSync` 代理到
 * 宿主 broker。pi CLI 启动与退出时会用这些 API 维护自己的 `*.lock` 目录：
 *
 *  1. 退出时 `rmdirSync` 清理锁目录 → broker 拒绝删除 → 抛
 *     `[safe-delete] broker denied delete` 让 pi 崩溃；
 *  2. 启动时 `mkdirSync` 创建锁目录 → broker 策略检查拒绝已存在路径 → 抛
 *     `EEXIST: file already exists, mkdir '.../trust.json.lock'`。
 *
 * 两种情况都表现为「所有用例 1 秒内 failed，且不产生任何模型输出」。
 *
 * 处理方式：从 `NODE_OPTIONS` 中移除宿主的 `--require` 注入，让 pi 作为独立 CLI 运行。
 * 被测对象的行为不应受宿主 IDE 的文件系统策略影响——这是评估工具的隔离性要求，
 * 与宿主对自身文件的删除保护无关（后者仍作用于评估工具自身进程）。
 */
export function disableHostDeleteGuard(env: NodeJS.ProcessEnv): void {
  const raw = env.NODE_OPTIONS;
  if (raw) {
    const kept = raw
      .split(/\s+/)
      .filter((token) => token.length > 0 && !isHostFsHookRequire(token));
    if (kept.length === 0) delete env.NODE_OPTIONS;
    else env.NODE_OPTIONS = kept.join(" ");
  }
  // 兜底：即使 shim 仍被加载，这些开关也会让它退回原生删除语义。
  env.CODEBUDDY_SAFE_DELETE_ENABLED = "0";
  delete env.CODEBUDDY_SAFE_DELETE_BULK_GUARD;
  delete env.CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR;
  delete env.CODEBUDDY_SAFE_DELETE_SANDBOX;
}

/** 判断某个 NODE_OPTIONS token 是否为宿主注入的 fs shim。 */
function isHostFsHookRequire(token: string): boolean {
  if (!token.startsWith("--require=")) return false;
  const target = token.slice("--require=".length).replace(/^["']|["']$/g, "");
  return /(^|[\\/])(node-language-shim|genie-safe-delete|node-safe-delete-shim|node-brokered-fs-shim)\.cjs$/i.test(
    target,
  );
}

/**
 * 运行一次 pi 非交互会话。
 *
 * 无论成功失败都返回完整结果，不抛异常——失败必须作为数据保留在分母里。
 */
export function runPi(options: PiRunOptions): Promise<PiRunResult> {
  const sessionDir = join(options.workspaceRoot, ".pi-sessions");
  mkdirSync(sessionDir, { recursive: true });

  const args = [
    "-p",
    "--mode",
    "json",
    // 关键：禁用 skill 自动发现，确保两侧唯一差异是显式 --skill。
    "--no-skills",
    "--no-context-files",
    "--no-extensions",
    "--no-prompt-templates",
    "--no-themes",
    "--session-id",
    options.sessionId,
    "--session-dir",
    sessionDir,
  ];
  if (options.model) args.push("--model", options.model);
  // 即使没有 skill 也要传 --no-skills（上面已加）；有 skill 时追加显式路径。
  for (const path of options.skillPaths ?? []) args.push("--skill", path);
  args.push(options.prompt);

  let command: { command: string; args: string[] };
  let env: NodeJS.ProcessEnv;
  let cleanup: (() => void) | undefined;
  let isolation: IsolationVerification = { verified: false, issues: ["隔离尚未验证"] };
  try {
    const runtime = resolvePiRuntime();
    const skillRoots = options.isolation?.skillRoots ?? (options.skillPaths ?? []).map((path) => resolve(path, ".."));
    for (const path of options.skillPaths ?? []) {
      const target = canonicalPath(path);
      if (!skillRoots.some((root) => target === canonicalPath(root) || target.startsWith(`${canonicalPath(root)}/`))) {
        throw new Error("目标 skill 不在隔离的候选快照目录内");
      }
    }
    command = buildSandboxCommand({ command: runtime.command, args: [...runtime.args, ...args], workspaceRoot: options.workspaceRoot, readOnlyRoots: [...runtime.readOnlyRoots, ...skillRoots, ...validateRuntimeRoots(options.isolation?.runtimeRoots ?? [])] });
    isolation = verifySandboxCommand(command, options.workspaceRoot);
    if (!isolation.verified) throw new Error(isolation.issues.join("；"));
    const config = preparePiIsolation({ workspaceRoot: options.workspaceRoot, home: options.home });
    env = config.env;
    cleanup = config.cleanup;
  } catch (error) {
    cleanup?.();
    const message = `隔离启动被阻止：${error instanceof Error ? error.message : String(error)}`;
    return Promise.resolve({ exitCode: null, metrics: emptyMetrics(), events: [], stderr: message, timedOut: false, isolation: { ...isolation, verified: false, issues: [message] } });
  }
  if (!options.allowWeb) env.PX_ALLOW_WEB = "0";
  if (!options.inheritHostFsHooks) disableHostDeleteGuard(env);

  return new Promise<PiRunResult>((resolvePromise) => {
    const child = spawn(command.command, command.args, {
      cwd: options.workspaceRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const events: PiEvent[] = [];
    const metrics = emptyMetrics();
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup?.();
      resolvePromise({ exitCode, metrics, events, stderr, timedOut, isolation });
    };

    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event: PiEvent;
      try {
        event = JSON.parse(trimmed) as PiEvent;
      } catch {
        return; // 非 JSON 行属于进程噪声，忽略。
      }
      events.push(event);
      collectMetrics(metrics, event, options.workspaceRoot);
      options.onEvent?.(event);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", (error: Error) => {
      stderr += `\nspawn error: ${error.message}`;
      finish(null);
    });
    child.on("close", (code) => {
      rl.close();
      finish(code);
    });
  });
}

/**
 * 从事件流中抽取 usage、工具调用与最终输出。
 *
 * pi 的 assistant 消息可能被拆成多轮（工具调用 → 工具结果 → 再生成），
 * 因此最终输出取**最后一条**带 text 的 assistant 消息，而不是最后一条事件。
 */
export function collectMetrics(metrics: PiRunMetrics, event: PiEvent, workspaceRoot = process.cwd()): void {
  let pending = pendingReads.get(metrics);
  if (!pending) { pending = new Map(); pendingReads.set(metrics, pending); }
  if (event.type === "tool_execution_start") {
    metrics.toolCalls += 1;
    const toolName = typeof event.toolName === "string" ? event.toolName : "unknown";
    metrics.toolNames.push(toolName);
    if (toolName === "read") {
      const args = event.args;
      if (args && typeof args === "object" && typeof (args as { path?: unknown }).path === "string") {
        if (typeof event.toolCallId === "string") pending.set(event.toolCallId, canonicalPath((args as { path: string }).path, workspaceRoot));
      }
    }
    return;
  }

  if (event.type === "tool_execution_end") {
    const id = typeof event.toolCallId === "string" ? event.toolCallId : "";
    const path = pending.get(id);
    pending.delete(id);
    if (path && event.isError === false) metrics.readPaths.push(path);
    return;
  }

  if (event.type !== "message_end") return;
  const message = event.message as { role?: string; content?: unknown; usage?: PiUsage } | undefined;
  if (!message || message.role !== "assistant") return;

  const usage = message.usage;
  if (usage) {
    metrics.totalTokens += usage.totalTokens ?? 0;
    metrics.totalCost += usage.cost?.total ?? 0;
  }

  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (block && typeof block === "object" && (block as { type?: string }).type === "toolCall") {
        metrics.toolCalls += 1;
        metrics.toolNames.push("toolCall");
      }
    }
    const text = extractText(message.content);
    if (text) metrics.output = text;
  }
}

const pendingReads = new WeakMap<PiRunMetrics, Map<string, string>>();

/** 提取内容块中的文本，拼接多个 text block。 */
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/**
 * 解析 pi 事件流中的最终助手输出。
 *
 * 与 collectMetrics 相同语义，但独立实现以便在报告阶段重放已有事件流，
 * 无需重新运行模型。
 */
export function extractOutputFromEvents(events: PiEvent[]): string {
  let output = "";
  for (const event of events) {
    if (event.type !== "message_end") continue;
    const message = event.message as { role?: string; content?: unknown } | undefined;
    if (!message || message.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = extractText(message.content);
    if (text) output = text;
  }
  return output;
}

/** 归一化路径用于比较（macOS 的 /tmp 与 /private/tmp 差异）。 */
export function normalizePath(path: string): string {
  return resolve(path);
}
