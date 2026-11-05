import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateGain } from "./gain.ts";
import {
  archiveSkill,
  buildVersion,
  collectArchiveInput,
  copySkillTree,
  formatTimestamp,
  hashSkillFile,
  isNoise,
  readFrontmatterVersion,
  redactHomeInText,
  redactHomePath,
  renderArchivedReport,
  renderArchiveCard,
  assertArchiveTargetSafe,
  type ArchiveInput,
} from "./archive.ts";

/**
 * 归档模块测试。
 *
 * 重点固化三类规则：
 * 1. 版本标识的生成规则（frontmatter 版本 + 时间戳）
 * 2. 噪声过滤与幂等（同一份内容不重复归档）
 * 3. 安全校验（归档目标不得落在 skills/ 下——否则会污染后续评估）
 */

function makeTmpDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `skill-eval-archive-${prefix}-`));
}

/** 造一个最小可用的 skill 目录。 */
function makeSkill(root: string, name = "demo-skill", version?: string): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "references"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });

  const fm = version ? `---\nname: ${name}\nversion: ${version}\n---\n` : `---\nname: ${name}\n---\n`;
  writeFileSync(join(dir, "SKILL.md"), `${fm}\n# demo\n`, "utf8");
  writeFileSync(join(dir, "references", "methods.md"), "方法库\n", "utf8");
  writeFileSync(join(dir, "scripts", "calc.py"), "print(1)\n", "utf8");
  writeFileSync(join(dir, ".DS_Store"), "junk", "utf8");
  writeFileSync(join(dir, "_skillhub_meta.json"), '{"platform":"x"}', "utf8");
  writeFileSync(join(dir, "run.log"), "log", "utf8");
  return dir;
}

/** 造一个最小可用的运行目录。 */
function makeRun(root: string, opts: { verdict?: string; passed?: number; total?: number } = {}): string {
  const dir = join(root, "run-1");
  mkdirSync(dir, { recursive: true });
  const passed = opts.passed ?? 4;
  const total = opts.total ?? 4;
  const allPassed = passed === total;

  writeFileSync(
    join(dir, "summary.json"),
    JSON.stringify(
      {
        runId: "run-test-1",
        model: "provider/model-a",
        judgeModel: "provider/model-b",
        repeat: 1,
        judgeRepeat: 1,
        status: "success",
        results: [
          {
            variantId: "baseline",
            skillPaths: [],
            status: "success",
            totalTokens: 100,
            totalCost: 0.01,
            durationSec: 5,
            activation: { activated: false, status: "not_activated" },
            assertions: { total, passed, failed: total - passed, allPassed, outcomes: [] },
          },
          {
            variantId: "skill",
            skillPaths: ["/somewhere/demo-skill/SKILL.md"],
            status: "success",
            totalTokens: 200,
            totalCost: 0.02,
            durationSec: 10,
            activation: { activated: true, status: "activated" },
            assertions: { total, passed: total, failed: 0, allPassed: true, outcomes: [] },
          },
        ],
        pairwise: [{ variantId: "skill", taskId: "t1", attempt: 1, verdict: "win" }],
        variantSummaries: [
          {
            variantId: "baseline",
            total: 1,
            success: 1,
            failed: 0,
            activationRate: 0,
            assertionPassRate: allPassed ? 1 : 0,
            winRate: null,
            win: 0,
            tie: 0,
            loss: 0,
            notJudged: 0,
          },
          {
            variantId: "skill",
            total: 1,
            success: 1,
            failed: 0,
            activationRate: 1,
            assertionPassRate: 1,
            winRate: 1,
            win: 1,
            tie: 0,
            loss: 0,
            notJudged: 0,
          },
        ],
        taskSummaries: [],
        disagreements: [],
        totalCost: 0.03,
        totalTokens: 300,
        suiteMeta: {
          suiteId: "suite-demo",
          suiteVersion: "1.0",
          skillVersion: "2.3.4",
          skillPath: "/somewhere/demo-skill/SKILL.md",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(dir, "REPORT.md"), "# 评估报告\n\n结论 effective\n", "utf8");
  return dir;
}

// ---------------------------------------------------------------- 版本标识

test("formatTimestamp 输出 YYYYMMDD-HHMM", () => {
  const ts = new Date(2026, 10, 3, 23, 7).getTime();
  assert.equal(formatTimestamp(ts), "20261103-2307");
});

test("buildVersion 组合 frontmatter 版本与时间戳", () => {
  const root = makeTmpDir("ver");
  const skillDir = makeSkill(root, "demo-skill", "1.2.3");
  const ts = new Date(2026, 10, 3, 23, 7).getTime();
  assert.equal(buildVersion(join(skillDir, "SKILL.md"), ts), "1.2.3__20261103-2307");
  rmSync(root, { recursive: true, force: true });
});

test("buildVersion 在 frontmatter 无版本时退化为纯时间戳", () => {
  const root = makeTmpDir("nover");
  const skillDir = makeSkill(root, "demo-skill");
  const ts = new Date(2026, 10, 3, 23, 7).getTime();
  assert.equal(buildVersion(join(skillDir, "SKILL.md"), ts), "20261103-2307");
  rmSync(root, { recursive: true, force: true });
});

test("readFrontmatterVersion 读取 version 字段", () => {
  const root = makeTmpDir("fm");
  const skillDir = makeSkill(root, "demo-skill", "9.9.9");
  assert.equal(readFrontmatterVersion(join(skillDir, "SKILL.md")), "9.9.9");
  rmSync(root, { recursive: true, force: true });
});

test("readFrontmatterVersion 在无 version 时返回 null", () => {
  const root = makeTmpDir("nofm");
  const skillDir = makeSkill(root, "demo-skill");
  assert.equal(readFrontmatterVersion(join(skillDir, "SKILL.md")), null);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 噪声过滤

test("isNoise 识别系统噪声与平台元数据", () => {
  assert.equal(isNoise(".DS_Store"), true);
  assert.equal(isNoise("node_modules"), true);
  assert.equal(isNoise("__pycache__"), true);
  assert.equal(isNoise("_skillhub_meta.json"), true);
  assert.equal(isNoise("debug.log"), true);
  assert.equal(isNoise("SKILL.md"), false);
  assert.equal(isNoise("methods.md"), false);
  assert.equal(isNoise("calc.py"), false);
});

test("copySkillTree 复制附属文件并跳过噪声", () => {
  const root = makeTmpDir("copy");
  const skillDir = makeSkill(root, "demo-skill");
  const dest = join(root, "dest");

  const { fileCount, skippedNoise } = copySkillTree(skillDir, dest);

  assert.equal(fileCount, 3, "SKILL.md + references/methods.md + scripts/calc.py");
  assert.ok(skippedNoise >= 3, ".DS_Store / _skillhub_meta.json / run.log 都应被跳过");
  assert.ok(existsSync(join(dest, "SKILL.md")));
  assert.ok(existsSync(join(dest, "references", "methods.md")), "子目录必须被递归创建");
  assert.ok(existsSync(join(dest, "scripts", "calc.py")));
  assert.equal(existsSync(join(dest, ".DS_Store")), false);
  assert.equal(existsSync(join(dest, "_skillhub_meta.json")), false);
  assert.equal(existsSync(join(dest, "run.log")), false);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 安全校验

test("assertArchiveTargetSafe 拒绝落在 skills/ 下的目标", () => {
  const repo = makeTmpDir("repo");
  assert.throws(
    () => assertArchiveTargetSafe(join(repo, "skills", "demo-skill", "v1"), repo),
    /skills\/ 下/,
  );
  rmSync(repo, { recursive: true, force: true });
});

test("assertArchiveTargetSafe 放行 archive/ 下的目标", () => {
  const repo = makeTmpDir("repo2");
  assert.doesNotThrow(() => assertArchiveTargetSafe(join(repo, "archive", "demo-skill", "v1"), repo));
  rmSync(repo, { recursive: true, force: true });
});

test("assertArchiveTargetSafe 放行与 skills 同级的其他目录", () => {
  const repo = makeTmpDir("repo3");
  assert.doesNotThrow(() => assertArchiveTargetSafe(join(repo, "archive", "x"), repo));
  assert.doesNotThrow(() => assertArchiveTargetSafe(join(repo, "suites", "x"), repo));
  rmSync(repo, { recursive: true, force: true });
});

test("assertArchiveTargetSafe 在没有 repoRoot 时也拒绝 skills 路径段", () => {
  // 绕过场景：用户只传 --archive-root <某处>/skills/x，没给 --repo。
  assert.throws(
    () => assertArchiveTargetSafe("/tmp/whatever/skills/bad/skill-name/v1"),
    /skills\/ 下/,
  );
  assert.throws(
    () => assertArchiveTargetSafe("/tmp/whatever/skills/v1"),
    /skills\/ 下/,
  );
});

test("assertArchiveTargetSafe 放行不含 skills 段的绝对路径", () => {
  assert.doesNotThrow(() => assertArchiveTargetSafe("/tmp/whatever/archive/skill-name/v1"));
  assert.doesNotThrow(() => assertArchiveTargetSafe("/tmp/my-skills-store/archive/v1"));
});

// ---------------------------------------------------------------- 元信息收集

test("collectArchiveInput 从运行产物提取元信息", () => {
  const root = makeTmpDir("collect");
  const skillDir = makeSkill(root, "demo-skill", "2.3.4");
  const runDir = makeRun(root, { passed: 2, total: 4 });

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  assert.equal(input.runId, "run-test-1");
  assert.equal(input.model, "provider/model-a");
  assert.equal(input.judgeModel, "provider/model-b");
  assert.equal(input.suiteId, "suite-demo");
  assert.equal(input.suiteVersion, "1.0");
  assert.equal(input.skillVersion, "2.3.4");
  assert.equal(input.activationRate, 1);
  assert.equal(input.winRate, 1);
  // 条目累计口径：baseline 2/4 = 50%，skill 4/4 = 100%
  assert.equal(input.baselineAssertionRate, 0.5);
  assert.equal(input.variantAssertionRate, 1);
  // 整轮全过口径：baseline 1 次运行不全过 = 0%，skill 全过 = 100%
  assert.equal(input.baselineAllPassedRate, 0);
  assert.equal(input.variantAllPassedRate, 1);
  assert.equal(input.assertionTotal, 8, "baseline 4 条 + skill 4 条");
  assert.match(input.skillHash, /^sha256:[0-9a-f]{16}$/);
  rmSync(root, { recursive: true, force: true });
});

test("collectArchiveInput 的 skillHash 与文件实际内容一致", () => {
  const root = makeTmpDir("hash");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root);
  const skillPath = join(skillDir, "SKILL.md");

  const input = collectArchiveInput({
    runDir,
    skillPath,
    verdict: "effective",
    verdictReason: "测试",
  });

  assert.equal(input.skillHash, hashSkillFile(skillPath));
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 路径脱敏

test("redactHomePath 把用户目录替换成 ~", () => {
  assert.equal(redactHomePath("/Users/alice/.workbuddy/skills/x/SKILL.md"), "~/.workbuddy/skills/x/SKILL.md");
  assert.equal(redactHomePath("/Users/bob/skills/y"), "~/skills/y");
});

test("redactHomePath 不改动非用户路径", () => {
  assert.equal(redactHomePath("/opt/tools/x"), "/opt/tools/x");
  assert.equal(redactHomePath("relative/path"), "relative/path");
});

test("redactHomeInText 脱敏正文中的用户目录", () => {
  const text = "| 被测 skill | `/Users/alice/skills/x/SKILL.md` |\n";
  const out = redactHomeInText(text);
  assert.equal(out.includes("/Users/alice"), false);
  assert.match(out, /~\/skills\/x\/SKILL\.md/);
});

test("renderArchivedReport 把证据目录改写为归档内位置", () => {
  const report = [
    "| 证据目录 | `/Users/alice/.skill-eval/runs/x` |",
    "报告由 skill-eval 生成 · 证据目录 `/Users/alice/.skill-eval/runs/x`",
  ].join("\n");

  const out = renderArchivedReport(report);

  assert.equal(out.includes("/Users/alice"), false, "用户名必须脱敏");
  assert.match(out, /本目录/);
  assert.equal(out.includes(".skill-eval/runs/x"), false, "不应残留原始证据目录");
});

// ---------------------------------------------------------------- 元信息卡

test("renderArchiveCard 包含结论、哈希与复现命令", () => {
  const input: ArchiveInput = {
    runDir: "/run",
    runId: "run-1",
    skillPath: "/somewhere/demo-skill/SKILL.md",
    skillHash: "sha256:abcdef0123456789",
    verdict: "effective",
    verdictReason: "激活率 100.0%，胜率 80.0%",
    model: "provider/model-a",
    judgeModel: "provider/model-b",
    suiteId: "suite-demo",
    suiteVersion: "1.0",
    skillVersion: "1.0",
    activationRate: 1,
    winRate: 0.8,
    baselineAssertionRate: 0.4,
    variantAssertionRate: 0.95,
    assertionTotal: 58,
    baselineAllPassedRate: 0.3,
    variantAllPassedRate: 0.9,
    reportPath: "/run/REPORT.md",
    archivedAt: "2026-11-03T15:00:00.000Z",
    reproduceCommand: "skill-eval eval --suite s.json",
    gainCheck: evaluateGain(0.4, 0.95),
  };

  const card = renderArchiveCard(input, "1.0__20261103-2300");

  assert.match(card, /effective/);
  assert.match(card, /sha256:abcdef0123456789/);
  assert.match(card, /skill-eval eval --suite s\.json/);
  assert.match(card, /激活率 \| 100\.0%/);
  assert.match(card, /条目累计/);
  assert.match(card, /整轮全过/);
  assert.match(card, /1\.0__20261103-2300/);
  assert.equal(card.includes("/Users/"), false, "绝对路径中的用户名必须脱敏");
});

// ---------------------------------------------------------------- 归档主流程

test("archiveSkill 归档完整 skill 树并写索引", () => {
  const root = makeTmpDir("arch");
  const skillDir = makeSkill(root, "demo-skill", "1.2.3");
  const runDir = makeRun(root);
  const archiveRoot = join(root, "archive");

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  const result = archiveSkill({
    input,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "1.2.3__20261103-2300",
  });

  assert.equal(result.skipped, false);
  assert.equal(result.fileCount, 3);
  assert.ok(existsSync(join(result.versionDir, "SKILL.md")));
  assert.ok(existsSync(join(result.versionDir, "ARCHIVE.md")));
  assert.ok(existsSync(join(result.versionDir, "REPORT.md")), "报告必须复制进归档目录使其自包含");
  assert.ok(existsSync(join(result.archiveRoot, "latest.json")));

  const index = JSON.parse(readFileSync(join(result.archiveRoot, "latest.json"), "utf8"));
  assert.equal(index.version, "1.2.3__20261103-2300");
  assert.equal(index.verdict, "effective");
  assert.equal(index.provisional, false);
  assert.equal(index.skillHash, input.skillHash);

  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 归档内容与源文件逐字节一致", () => {
  const root = makeTmpDir("bytes");
  const skillDir = makeSkill(root, "demo-skill", "1.2.3");
  const runDir = makeRun(root);
  const archiveRoot = join(root, "archive");
  const skillPath = join(skillDir, "SKILL.md");

  const input = collectArchiveInput({
    runDir,
    skillPath,
    verdict: "effective",
    verdictReason: "测试",
  });

  const result = archiveSkill({
    input,
    runDir,
    skillPath,
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  assert.equal(
    readFileSync(join(result.versionDir, "SKILL.md"), "utf8"),
    readFileSync(skillPath, "utf8"),
  );
  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 对同内容幂等——重复归档不产生新版本", () => {
  const root = makeTmpDir("idem");
  const skillDir = makeSkill(root, "demo-skill", "1.2.3");
  const runDir = makeRun(root);
  const archiveRoot = join(root, "archive");
  const skillPath = join(skillDir, "SKILL.md");

  const input = collectArchiveInput({
    runDir,
    skillPath,
    verdict: "effective",
    verdictReason: "测试",
  });

  const first = archiveSkill({
    input,
    runDir,
    skillPath,
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });
  const second = archiveSkill({
    input,
    runDir,
    skillPath,
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  assert.equal(first.skipped, false);
  assert.equal(second.skipped, true, "同哈希同版本应跳过");
  assert.equal(second.versionDir, first.versionDir);
  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 同版本不同内容不覆盖原目录", () => {
  const root = makeTmpDir("conflict");
  const skillDir = makeSkill(root, "demo-skill", "1.2.3");
  const runDir = makeRun(root);
  const archiveRoot = join(root, "archive");
  const skillPath = join(skillDir, "SKILL.md");

  const input = collectArchiveInput({
    runDir,
    skillPath,
    verdict: "effective",
    verdictReason: "测试",
  });

  const first = archiveSkill({
    input,
    runDir,
    skillPath,
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  // 改内容 → 哈希变化
  writeFileSync(skillPath, "---\nname: demo-skill\nversion: 1.2.4\n---\n\n# 改过了\n", "utf8");
  const changed = collectArchiveInput({
    runDir,
    skillPath,
    verdict: "effective",
    verdictReason: "测试",
  });
  assert.notEqual(changed.skillHash, input.skillHash);

  const second = archiveSkill({
    input: changed,
    runDir,
    skillPath,
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  assert.equal(second.skipped, false);
  assert.notEqual(second.versionDir, first.versionDir, "不同内容必须另起版本目录");
  assert.equal(
    readFileSync(join(first.versionDir, "SKILL.md"), "utf8"),
    "---\nname: demo-skill\nversion: 1.2.3\n---\n\n# demo\n",
    "原目录内容不得被覆盖",
  );
  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 拒绝把归档写进 skills/ 下", () => {
  const root = makeTmpDir("unsafe");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root);

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  assert.throws(
    () =>
      archiveSkill({
        input,
        runDir,
        skillPath: join(skillDir, "SKILL.md"),
        archiveRoot: join(root, "skills", "archived"),
        repoRoot: root,
        version: "v1",
      }),
    /skills\/ 下/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 在没有 repoRoot 时仍拒绝 skills 路径段", () => {
  const root = makeTmpDir("unsafe2");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root);

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  assert.throws(
    () =>
      archiveSkill({
        input,
        runDir,
        skillPath: join(skillDir, "SKILL.md"),
        archiveRoot: join(root, "skills", "bad"),
        version: "v1",
      }),
    /skills\/ 下/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 把 inconclusive 标记为 provisional", () => {
  const root = makeTmpDir("prov");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root);
  const archiveRoot = join(root, "archive");

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "inconclusive",
    verdictReason: "结论不足",
  });

  const result = archiveSkill({
    input,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  assert.equal(result.provisional, true);
  const index = JSON.parse(readFileSync(join(result.archiveRoot, "latest.json"), "utf8"));
  assert.equal(index.provisional, true);
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------- 增益门槛

test("collectArchiveInput 计算出断言增益并判定是否达标", () => {
  const root = makeTmpDir("gain");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  // baseline 4 条过 2 条（50%），skill 侧全过（100%）→ 增益 50pp，达标。
  const runDir = makeRun(root, { passed: 2, total: 4 });

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  assert.equal(input.baselineAssertionRate, 0.5);
  assert.equal(input.variantAssertionRate, 1);
  assert.equal(input.gainCheck.gainPp, 50);
  assert.equal(input.gainCheck.passed, true);
  assert.equal(input.gainCheck.thresholdPp, 10);

  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 在增益未达标时标记 lowGain", () => {
  const root = makeTmpDir("lowgain");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  // baseline 与 skill 侧同样通过率 → 增益 0，不达标。
  const runDir = makeRun(root, { passed: 4, total: 4 });
  const archiveRoot = join(root, "archive");

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  const result = archiveSkill({
    input,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  assert.equal(result.lowGain, true);
  const index = JSON.parse(readFileSync(join(result.archiveRoot, "latest.json"), "utf8"));
  assert.equal(index.lowGain, true);
  assert.equal(index.gainPp, 0);
  assert.equal(index.gainThresholdPp, 10);

  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 在增益达标时不标记 lowGain", () => {
  const root = makeTmpDir("gainok");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root, { passed: 2, total: 4 });
  const archiveRoot = join(root, "archive");

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  const result = archiveSkill({
    input,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  assert.equal(result.lowGain, false);
  const index = JSON.parse(readFileSync(join(result.archiveRoot, "latest.json"), "utf8"));
  assert.equal(index.lowGain, false);
  assert.equal(index.gainPp, 50);

  rmSync(root, { recursive: true, force: true });
});

test("ARCHIVE.md 记录增益门槛判定结果", () => {
  const root = makeTmpDir("gaincard");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root, { passed: 2, total: 4 });
  const archiveRoot = join(root, "archive");

  const input = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "测试",
  });

  const result = archiveSkill({
    input,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });

  const card = readFileSync(join(result.versionDir, "ARCHIVE.md"), "utf8");
  assert.match(card, /增益门槛/);
  assert.match(card, /50\.0 pp/);
  assert.match(card, /10 pp/);
  assert.match(card, /达标/);

  rmSync(root, { recursive: true, force: true });
});

test("archiveSkill 对 partial 跑批强制标记 provisional=true，并检测跨版本套件哈希漂移", () => {
  const root = makeTmpDir("drift-partial");
  const skillDir = makeSkill(root, "demo-skill", "1.0");
  const runDir = makeRun(root, { passed: 2, total: 4 });
  const archiveRoot = join(root, "archive");

  const input1 = collectArchiveInput({
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    verdict: "effective",
    verdictReason: "v1 通过",
    suiteHash: "sha256:1111111111111111",
    expensive: true,
  });
  const res1 = archiveSkill({
    input: input1,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "v1",
  });
  assert.equal(res1.expensive, true);
  assert.equal(res1.suiteDrift, false);

  // 修改 skill 内容并更换 suiteHash + runStatus="partial"
  writeFileSync(join(skillDir, "SKILL.md"), "---\nversion: 1.1\n---\n# v2\n", "utf8");
  const input2: ArchiveInput = {
    ...collectArchiveInput({
      runDir,
      skillPath: join(skillDir, "SKILL.md"),
      verdict: "effective",
      verdictReason: "部分超时但显式放行",
      suiteHash: "sha256:2222222222222222",
    }),
    runStatus: "partial",
  };
  const res2 = archiveSkill({
    input: input2,
    runDir,
    skillPath: join(skillDir, "SKILL.md"),
    archiveRoot,
    repoRoot: root,
    version: "v2",
  });
  assert.equal(res2.provisional, true);
  assert.equal(res2.suiteDrift, true);

  const latest = JSON.parse(readFileSync(join(res2.archiveRoot, "latest.json"), "utf8"));
  assert.equal(latest.provisional, true);
  assert.equal(latest.suiteDrift, true);
  assert.equal(latest.suiteHash, "sha256:2222222222222222");

  rmSync(root, { recursive: true, force: true });
});

