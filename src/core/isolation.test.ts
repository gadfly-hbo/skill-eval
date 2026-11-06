import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { buildSandboxCommand, preparePiIsolation, validateRuntimeRoots, verifySandboxCommand } from "./isolation.ts";

test("不支持隔离的平台明确阻断，不能降级为未沙箱启动", () => {
  assert.throws(() => buildSandboxCommand({ command: process.execPath, args: [], workspaceRoot: tmpdir(), platform: "linux" }), /隔离后端不可用/);
});

test("真实子进程只读任务与指定 skill，拒绝私有材料、其他运行及符号链接逃逸", { skip: process.platform !== "darwin" }, () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-sandbox-"));
  try {
    const workspace = join(root, "cases", "case-1");
    const other = join(root, "cases", "case-2");
    const skill = join(root, "candidate");
    for (const dir of [workspace, other, skill]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(root, "suite.json"), "PRIVATE ANSWER");
    writeFileSync(join(other, "output.md"), "OTHER OUTPUT");
    writeFileSync(join(workspace, "input.txt"), "TASK INPUT");
    writeFileSync(join(skill, "SKILL.md"), "TARGET SKILL");
    symlinkSync(join(root, "suite.json"), join(workspace, "leak"));
    const script = `const fs=require('node:fs');const p=require('node:path');const w=process.argv[1],s=process.argv[2],r=process.argv[3];const probe=(f)=>{try{return fs.readFileSync(f,'utf8')}catch{return 'DENIED'}};const write=(f)=>{try{fs.writeFileSync(f,'changed');return 'WROTE'}catch{return 'DENIED'}};console.log(JSON.stringify({input:probe(p.join(w,'input.txt')),skill:probe(p.join(s,'SKILL.md')),private:probe(p.join(r,'suite.json')),other:probe(p.join(r,'cases/case-2/output.md')),symlink:probe(p.join(w,'leak')),workspaceWrite:write(p.join(w,'output.txt')),skillWrite:write(p.join(s,'SKILL.md')),parentWrite:write(p.join(r,'outside.txt'))}));`;
    const command = buildSandboxCommand({ command: process.execPath, args: ["-e", script, workspace, skill, root], workspaceRoot: workspace, readOnlyRoots: [skill, dirname(process.execPath)] });
    assert.deepEqual(verifySandboxCommand(command, workspace), { verified: true, issues: [], backend: "macos-sandbox-exec" });
    const result = spawnSync(command.command, command.args, { cwd: workspace, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { input: "TASK INPUT", skill: "TARGET SKILL", private: "DENIED", other: "DENIED", symlink: "DENIED", workspaceWrite: "WROTE", skillWrite: "DENIED", parentWrite: "DENIED" });
    const bash = buildSandboxCommand({ command: "/bin/bash", args: ["--noprofile", "--norc", "-c", 'cat "$1"', "probe", join(root, "suite.json")], workspaceRoot: workspace, readOnlyRoots: [skill] });
    const childTool = spawnSync(bash.command, bash.args, { cwd: workspace, encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", HOME: workspace } });
    assert.equal(childTool.status, 1, childTool.stderr);
    assert.equal(childTool.stdout, "");
    assert.match(childTool.stderr, /not permitted|denied/i);
    assert.equal(readFileSync(join(skill, "SKILL.md"), "utf8"), "TARGET SKILL");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pi 配置复制到任务内，仅复制必要文件，清除宿主注入与任意环境", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-pi-config-"));
  try {
    const workspace = join(root, "workspace");
    const sourceHome = join(root, "source-home");
    mkdirSync(join(sourceHome, ".pi", "agent"), { recursive: true });
    mkdirSync(workspace);
    writeFileSync(join(sourceHome, ".pi", "agent", "auth.json"), "{}");
    writeFileSync(join(sourceHome, ".pi", "agent", "settings.json"), '{"extensions":["private-extension"]}');
    const config = preparePiIsolation({ workspaceRoot: workspace, home: sourceHome, sourceEnv: { PATH: process.env.PATH, NODE_OPTIONS: "--require=/private/inject.js", PRIVATE_ANSWER: "secret", OPENAI_API_KEY: "test-key" } });
    assert.ok(config.env.HOME?.startsWith(join(workspace, ".pi-home-")));
    assert.equal(config.env.PI_CODING_AGENT_DIR, join(config.home, ".pi", "agent"));
    assert.equal(config.env.NODE_OPTIONS, undefined);
    assert.equal(config.env.PRIVATE_ANSWER, undefined);
    assert.equal(config.env.OPENAI_API_KEY, "test-key");
    assert.equal(readFileSync(join(config.env.PI_CODING_AGENT_DIR!, "auth.json"), "utf8"), "{}");
    assert.throws(() => readFileSync(join(config.env.PI_CODING_AGENT_DIR!, "settings.json")), /ENOENT/);
    config.cleanup();
    assert.throws(() => readFileSync(join(config.env.PI_CODING_AGENT_DIR!, "auth.json")), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("不能通过额外运行依赖放开 HOME、仓库或父目录", () => {
  assert.throws(() => validateRuntimeRoots([process.cwd()]), /不能放开用户目录/);
  assert.throws(() => validateRuntimeRoots([dirname(process.cwd())]), /不能放开用户目录/);
  assert.throws(() => validateRuntimeRoots(["/opt/homebrew/Cellar"]), /不能放开用户目录/);
  assert.throws(() => validateRuntimeRoots(["/usr/local/Cellar"]), /不能放开用户目录/);
  assert.throws(() => validateRuntimeRoots(["/Library/Frameworks"]), /不能放开用户目录/);
});

test("配置准备中途失败也清理已复制的认证文件", () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-config-error-"));
  try {
    const workspace = join(root, "workspace");
    const sourceHome = join(root, "source-home");
    mkdirSync(workspace);
    mkdirSync(join(sourceHome, ".pi", "agent", "models.json"), { recursive: true });
    writeFileSync(join(sourceHome, ".pi", "agent", "auth.json"), "{}");
    assert.throws(() => preparePiIsolation({ workspaceRoot: workspace, home: sourceHome }));
    assert.deepEqual(readdirSync(workspace), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("访问探针遇到未隔离执行器必须失败", { skip: process.platform !== "darwin" }, () => {
  const workspace = mkdtempSync(join(tmpdir(), "skill-eval-unconfined-probe-"));
  try {
    // Ignoring the profile is a broken backend; the sentinel must detect it.
    assert.equal(verifySandboxCommand({ command: "/usr/bin/env", args: [] }, workspace).verified, false);
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test("当前沙箱允许本地 Python 标准库计算且拒绝读取评测私有文件", { skip: process.platform !== "darwin" || !existsSync("/usr/bin/python3") }, () => {
  const root = mkdtempSync(join(tmpdir(), "skill-eval-python-"));
  try {
    const workspace = join(root, "workspace");
    mkdirSync(workspace);
    const secret = join(root, "private-answer.txt");
    writeFileSync(secret, "PRIVATE");
    const script = [
      "import json, csv, decimal, statistics, sys",
      "rows = list(csv.DictReader(['value', '1', '2', '3']))",
      "values = [decimal.Decimal(row['value']) for row in rows]",
      "try:", "    open(sys.argv[1]).read()", "    denied = False",
      "except PermissionError:", "    denied = True",
      "print(json.dumps({'total': float(sum(values)), 'mean': float(statistics.mean(values)), 'privateDenied': denied}))",
    ].join("\n");
    writeFileSync(join(workspace, "calc.py"), script);
    const command = buildSandboxCommand({ command: "/usr/bin/python3", args: ["calc.py", secret], workspaceRoot: workspace });
    const result = spawnSync(command.command, command.args, { cwd: workspace, encoding: "utf8", timeout: 10000, env: { PATH: "/usr/bin:/bin", HOME: workspace, TMPDIR: workspace } });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { total: 6, mean: 2, privateDenied: true });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
