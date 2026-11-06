/** File access boundaries for pi and all of its child tools. No unsandboxed fallback. */
import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export interface PiIsolationOptions {
  /** Frozen candidate packages, read only. Baseline must pass an empty list. */
  skillRoots?: string[];
  /** Additional explicit runtime dependencies, never an evaluation/repository ancestor. */
  runtimeRoots?: string[];
}

export interface IsolationVerification {
  verified: boolean;
  issues: string[];
  backend?: string;
}

export function canonicalPath(path: string, cwd = process.cwd()): string {
  const absolute = resolve(cwd, path);
  // Resolve existing ancestors too, so a not-yet-created child of a symlink is canonical.
  let ancestor = absolute;
  const tail: string[] = [];
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) {
    tail.unshift(basename(ancestor));
    ancestor = dirname(ancestor);
  }
  return join(realpathSync(ancestor), ...tail);
}

function contains(root: string, path: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

const SYSTEM_READ_ROOTS = [
  "/System/Library", "/usr/lib", "/usr/share", "/bin", "/sbin", "/usr/bin", "/usr/sbin",
  "/Library/Apple", "/Library/Developer/CommandLineTools", "/private/var/db/timezone",
];
const SYSTEM_READ_FILES = [
  "/",
  "/dev/null", "/dev/zero", "/dev/random", "/dev/urandom", "/dev/tty",
  "/private/etc/hosts", "/private/etc/resolv.conf", "/private/etc/localtime", "/private/etc/services",
  "/private/etc/protocols", "/private/etc/ssl/cert.pem",
];

function quoted(path: string): string {
  // Sandbox profiles use quoted strings; JSON encoding escapes quotes and newlines.
  return JSON.stringify(path);
}

export function buildSandboxCommand(options: {
  command: string;
  args: string[];
  workspaceRoot: string;
  readOnlyRoots?: string[];
  platform?: NodeJS.Platform;
}): { command: string; args: string[] } {
  if ((options.platform ?? process.platform) !== "darwin" || !existsSync("/usr/bin/sandbox-exec")) {
    throw new Error("隔离后端不可用：当前仅支持 macOS sandbox-exec，已阻止启动 pi");
  }
  const workspace = canonicalPath(options.workspaceRoot);
  if (workspace === sep || workspace === canonicalPath(homedir())) {
    throw new Error("隔离任务目录不能是文件系统根目录或用户 HOME");
  }
  const readRoots = [...new Set((options.readOnlyRoots ?? []).map((path) => canonicalPath(path)))];
  for (const root of readRoots) {
    if (contains(root, workspace)) throw new Error(`只读运行依赖不得包含任务或其父目录：${root}`);
    if (!existsSync(root)) throw new Error(`隔离只读路径不存在：${root}`);
  }
  const selectors = [
    ...SYSTEM_READ_ROOTS.filter(existsSync).map((path) => `(subpath ${quoted(canonicalPath(path))})`),
    ...SYSTEM_READ_FILES.filter(existsSync).map((path) => `(literal ${quoted(canonicalPath(path))})`),
    ...readRoots.map((path) => `(${statSync(path).isDirectory() ? "subpath" : "literal"} ${quoted(path)})`),
  ];
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process*)", "(allow sysctl-read)", "(allow mach-lookup)", "(allow ipc-posix*)",
    // Provider networking remains available; this boundary controls filesystem access.
    "(allow network*)", "(allow file-read-metadata)", "(allow file-map-executable)",
    `(allow file-read* ${selectors.join(" ")})`,
    `(allow file-read* file-write* (subpath ${quoted(workspace)}))`,
    '(allow file-write* (literal "/dev/null") (literal "/dev/tty"))',
  ].join("\n");
  return { command: "/usr/bin/sandbox-exec", args: ["-p", profile, options.command, ...options.args] };
}

/** Copy only model/auth configuration; never load global settings, extensions or history. */
export function preparePiIsolation(options: {
  workspaceRoot: string;
  home?: string;
  sourceEnv?: NodeJS.ProcessEnv;
}): { env: NodeJS.ProcessEnv; home: string; configDir: string; cleanup: () => void } {
  const source = options.sourceEnv ?? process.env;
  const home = mkdtempSync(join(resolve(options.workspaceRoot), ".pi-home-"));
  const configDir = join(home, ".pi", "agent");
  const cleanup = () => rmSync(home, { recursive: true, force: true });
  try {
    mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const sourceConfig = join(options.home ?? source.HOME ?? homedir(), ".pi", "agent");
    for (const name of ["auth.json", "models.json", "models-store.json"]) {
      const path = join(sourceConfig, name);
      if (existsSync(path)) {
        copyFileSync(path, join(configDir, name), constants.COPYFILE_EXCL);
        chmodSync(join(configDir, name), 0o600);
      }
    }
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(source)) {
      if (/^(?:PATH|LANG|LC_ALL|LC_CTYPE|TZ|TERM|https?_proxy|all_proxy|no_proxy|HTTPS?_PROXY|ALL_PROXY|NO_PROXY)$/.test(key) ||
          /^[A-Z][A-Z0-9_]*_(?:API_KEY|AUTH_TOKEN|BASE_URL|ENDPOINT)$/.test(key)) env[key] = value;
    }
    env.HOME = home;
    env.PI_CODING_AGENT_DIR = configDir;
    env.TMPDIR = join(home, "tmp");
    env.XDG_CONFIG_HOME = join(home, ".config");
    env.XDG_CACHE_HOME = join(home, ".cache");
    mkdirSync(env.TMPDIR, { recursive: true });
    return { env, home, configDir, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/** Additional roots must describe installed runtimes, never an arbitrary user directory. */
export function validateRuntimeRoots(roots: string[]): string[] {
  return roots.map((path) => {
    const root = canonicalPath(path);
    const system = SYSTEM_READ_ROOTS
      .filter(existsSync).some((base) => contains(canonicalPath(base), root));
    const installedInterpreter = /^\/(?:opt\/homebrew|usr\/local)\/Cellar\/[^/]+\/[^/]+(?:\/.*)?$/.test(root) ||
      /^\/Library\/Frameworks\/[^/]+\.framework(?:\/.*)?$/.test(root);
    const npmPackage = /\/node_modules\/(?:@[^/]+\/)?[^/]+$/.test(root) && existsSync(join(root, "package.json"));
    if (!system && !installedInterpreter && !npmPackage) throw new Error(`额外运行依赖必须是安装的运行时或 npm 包，不能放开用户目录：${root}`);
    return root;
  });
}

/** Execute an offline access probe under the exact profile used by the upcoming pi process. */
export function verifySandboxCommand(command: { command: string; args: string[] }, workspaceRoot: string): IsolationVerification {
  const workspace = canonicalPath(workspaceRoot);
  const outside = mkdtempSync(join(dirname(workspace), ".isolation-private-"));
  const inside = mkdtempSync(join(workspace, ".isolation-probe-"));
  try {
    const secret = join(outside, "answer.txt");
    writeFileSync(secret, "ISOLATION_PRIVATE_SENTINEL");
    symlinkSync(secret, join(inside, "escape"));
    const script = `const f=require('node:fs'),p=require('node:path');const i=process.argv[1],o=process.argv[2];const denied=(action)=>{try{action();return false}catch(e){return e.code==='EPERM'||e.code==='EACCES'}};f.writeFileSync(p.join(i,'output'),'ok');const checks=[f.readFileSync(p.join(i,'output'),'utf8')==='ok',denied(()=>f.readFileSync(p.join(o,'answer.txt'))),denied(()=>f.readFileSync(p.join(i,'escape'))),denied(()=>f.writeFileSync(p.join(o,'outside'),'bad'))];console.log(JSON.stringify(checks));process.exitCode=checks.every(Boolean)?0:1;`;
    const result = spawnSync(command.command, [...command.args.slice(0, 2), realpathSync(process.execPath), "-e", script, inside, outside], {
      cwd: workspace, encoding: "utf8", timeout: 10000,
      // Probe must not inherit preloads, credentials or arbitrary host hooks.
      env: { PATH: "/usr/bin:/bin", HOME: inside },
    });
    if (result.status !== 0 || result.stdout.trim() !== "[true,true,true,true]") {
      return { verified: false, issues: ["实际访问探针未通过；已阻止 pi 启动"], backend: "macos-sandbox-exec" };
    }
    return { verified: true, issues: [], backend: "macos-sandbox-exec" };
  } catch {
    return { verified: false, issues: ["无法完成实际访问探针；已阻止 pi 启动"], backend: "macos-sandbox-exec" };
  } finally {
    rmSync(inside, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
}

/** Resolve the installed CLI rather than granting access to the whole PATH or npm tree. */
export function resolvePiRuntime(pathEnv = process.env.PATH ?? ""): { command: string; args: string[]; readOnlyRoots: string[] } {
  let entry: string | undefined;
  for (const directory of pathEnv.split(":")) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, "pi");
    try { accessSync(candidate, constants.X_OK); entry = realpathSync(candidate); break; } catch { /* next PATH entry */ }
  }
  if (!entry) throw new Error("找不到 pi 可执行文件，已阻止启动");
  let packageRoot = dirname(entry);
  while (!existsSync(join(packageRoot, "package.json")) && dirname(packageRoot) !== packageRoot) packageRoot = dirname(packageRoot);
  if (packageRoot === sep) throw new Error("无法确定 pi 安装包边界，已阻止启动");
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { name?: string; bin?: string | Record<string, string> };
  const declaredEntry = typeof manifest.bin === "object" ? manifest.bin.pi : manifest.name === "pi" ? manifest.bin : undefined;
  if (typeof declaredEntry !== "string" || canonicalPath(join(packageRoot, declaredEntry)) !== entry) {
    throw new Error("pi 安装包未声明当前 pi 入口，已阻止扩大运行时读取范围");
  }
  const node = realpathSync(process.execPath);
  const isNode = /\.[cm]?js$/.test(entry) || /^#!.*\bnode\b/.test(readFileSync(entry, "utf8").slice(0, 200));
  return { command: isNode ? node : entry, args: isNode ? [entry] : [], readOnlyRoots: [packageRoot, node] };
}
