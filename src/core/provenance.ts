import { createHash } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { isNoise } from "./skill-files.ts";

export interface SkillIdentity {
  schemaVersion: 1;
  entry: string;
  hash: string;
  files: Array<{ path: string; sha256: string; executable: boolean }>;
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/** 包身份覆盖路径、全部有效文件内容及可执行位；不依赖安装位置。 */
export function identifySkill(skillPath: string): SkillIdentity {
  const entryPath = resolve(skillPath);
  const root = dirname(entryPath);
  const files: SkillIdentity["files"] = [];
  if (lstatSync(root).isSymbolicLink()) throw new Error("skill 包目录不得为符号链接");
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (isNoise(entry.name)) continue;
      const path = join(dir, entry.name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error(`skill 包包含符号链接：${relative(root, path)}`);
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile()) files.push({
        path: relative(root, path).split(sep).join("/"),
        sha256: sha256(readFileSync(path)),
        executable: Boolean(stat.mode & 0o111),
      });
      else throw new Error(`skill 包包含非普通文件：${relative(root, path)}`);
    }
  };
  walk(root);
  const entry = basename(entryPath);
  if (!files.some((file) => file.path === entry)) throw new Error("skill 入口未包含在包文件清单中");
  return { schemaVersion: 1, entry, hash: `sha256:${sha256(JSON.stringify({ entry, files }))}`, files };
}

export function assertSkillIdentity(skillPath: string, expected: SkillIdentity): void {
  if (identifySkill(skillPath).hash !== expected.hash) throw new Error("候选身份哈希不匹配：当前 skill 包不是这次运行冻结的候选");
}

/** 只复制冻结清单中的文件；模型侧只读由进程访问策略强制执行。 */
export function freezeSkill(skillPath: string, snapshotDir: string): { identity: SkillIdentity; skillPath: string } {
  const identity = identifySkill(skillPath);
  const sourceRoot = dirname(resolve(skillPath));
  const target = resolve(snapshotDir);
  const rel = relative(sourceRoot, target);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..")) throw new Error("skill 快照不得位于源包目录内");
  if (existsSync(target)) throw new Error("skill 快照目标已存在，禁止覆盖");
  mkdirSync(target, { recursive: true });
  for (const file of identity.files) {
    const dest = join(target, file.path);
    mkdirSync(dirname(dest), { recursive: true });
    const content = readFileSync(join(sourceRoot, file.path));
    if (sha256(content) !== file.sha256) throw new Error("冻结期间 skill 内容发生变化，拒绝启动评估");
    writeFileSync(dest, content, { flag: "wx" });
    chmodSync(dest, file.executable ? 0o555 : 0o444);
  }
  const frozenPath = join(target, identity.entry);
  assertSkillIdentity(frozenPath, identity);
  assertSkillIdentity(skillPath, identity);
  return { identity, skillPath: frozenPath };
}
