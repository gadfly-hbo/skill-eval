import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSandboxCommand } from "./isolation.ts";

export const DELIVERABLE_SNAPSHOT = "deliverable.md";
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

export type DeliverableEvidence =
  | { path: string; status: "present" }
  | { path: string; status: "missing" | "invalid"; reason: string };

export function validDeliverablePath(path: unknown): path is string {
  return typeof path === "string" && /^(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.md(?![\s\S])/.test(path);
}

/** Read one declared regular UTF-8 file after the worker has exited. */
export function readDeliverable(root: string, path: string): {
  evidence: DeliverableEvidence;
  bytes?: Buffer;
  text?: string;
} {
  const invalid = (reason: string) => ({ evidence: { path, status: "invalid" as const, reason } });
  if (!validDeliverablePath(path)) return invalid("交付物路径无效");
  let fd: number | undefined;
  try {
    if (!lstatSync(root).isDirectory()) return invalid("工作区不是普通目录");
    const parts = path.split("/");
    let file = root;
    for (const directory of parts.slice(0, -1)) {
      file = join(file, directory);
      if (!lstatSync(file).isDirectory()) return invalid("交付路径经过非普通目录");
    }
    file = join(file, parts.at(-1)!);
    const before = lstatSync(file);
    if (!before.isFile() || before.nlink !== 1) return invalid("交付物必须是无链接的普通文件");
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.dev !== before.dev || stat.ino !== before.ino) {
      return invalid("交付物身份在采集时变化");
    }
    if (stat.size > MAX_EVIDENCE_BYTES) return invalid("交付物超过 8 MiB 证据采集上限");
    const buffer = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const size = readSync(fd, buffer, length, buffer.length - length, null);
      if (!size) break;
      length += size;
    }
    if (length !== stat.size) return invalid("交付物大小在采集时变化");
    const bytes = buffer.subarray(0, length);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!text.trim()) return invalid("交付物为空");
    return { evidence: { path, status: "present" }, bytes, text };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { evidence: { path, status: "missing", reason: "未生成约定的交付文件" } };
    }
    return invalid("无法读取交付物或文件不是有效 UTF-8");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Freeze the workspace permission before the Agent can change its directory tree. */
export function prepareDeliverableRead(root: string, path: string): () => ReturnType<typeof readDeliverable> {
  const executable = realpathSync(process.execPath);
  const source = fileURLToPath(import.meta.url);
  const packageFile = fileURLToPath(new URL("../../package.json", import.meta.url));
  const isolationSource = fileURLToPath(new URL("./isolation.ts", import.meta.url));
  const launch = buildSandboxCommand({
    command: executable, workspaceRoot: root, readOnlyRoots: [executable, source, isolationSource, packageFile],
    args: ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", `
      const { readDeliverable } = await import(${JSON.stringify(import.meta.url)});
      const { evidence, bytes } = readDeliverable(process.argv[1], process.argv[2]);
      if (bytes) process.stdout.write(bytes);
      else {
        process.stderr.write(evidence.reason);
        process.exitCode = evidence.status === "missing" ? 2 : 3;
      }
    `, root, path],
  });
  launch.args[1] += "\n(deny network*)\n(deny file-write*)";
  return () => {
    const result = spawnSync(launch.command, launch.args, {
      cwd: root, env: { PATH: "/usr/bin:/bin", NODE_DISABLE_COMPILE_CACHE: "1" },
      maxBuffer: MAX_EVIDENCE_BYTES + 1, timeout: 10_000,
    });
    if (result.status === 2 || result.status === 3) {
      return { evidence: { path, status: result.status === 2 ? "missing" : "invalid", reason: result.stderr.toString("utf8") } };
    }
    if (result.error || result.status !== 0 || !result.stdout.length) throw new Error("隔离交付物采集器执行失败");
    const bytes = result.stdout;
    return { evidence: { path, status: "present" }, bytes, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  };
}

export function readVerifiedDeliverable(caseDir: string, expected: string | undefined): string | undefined {
  if (!expected) return undefined;
  const { bytes, text } = readDeliverable(caseDir, DELIVERABLE_SNAPSHOT);
  return bytes && createHash("sha256").update(bytes).digest("hex") === expected ? text : undefined;
}
