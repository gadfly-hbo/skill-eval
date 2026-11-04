/**
 * 把本机实验产物导入仓库，作为可复现的实验记录。
 *
 * 背景：阴性对照实验、套件设计等产物散落在 ~/.skill-eval/ 下，
 * 而 runs/ 在 .gitignore 内，实验结论没有版本记录。本脚本负责
 * 把关键产物脱敏后放进 experiments/，让结论可追溯、可复现。
 *
 * 脱敏复用归档模块的既有实现（src/core/archive.ts），
 * 保证「归档进仓库的东西不含用户名」这条规则只有一处实现。
 *
 * 用法：
 *   node --experimental-strip-types scripts/import-experiment.ts
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

import { redactHomeInText } from "../src/core/archive.ts";
import { evaluateOverwriteGuard } from "../src/core/report-quality.ts";

const HOME = homedir();
const NC_ROOT = join(HOME, ".skill-eval", "negative-control");
const REPO = resolve(import.meta.dirname, "..");
const EXPERIMENTS = join(REPO, "experiments");

/** 跑批目录里体积最大的 cases/ 是模型原始输出，入库只留可复算的元数据。 */
const SKIP_DIRS = new Set(["cases", "pairwise"]);
const KEEP_FILES = ["REPORT.md", "summary.json"];

/** 允许入库的单个文件大小上限（字节）。summary.json 约 160K，留足余量。 */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** 需要脱敏的文本扩展名。二进制文件跳过脱敏。 */
const TEXT_EXTENSIONS = new Set([".json", ".md", ".txt", ".jsonl", ".yaml", ".yml", ".csv"]);

type ImportItem = {
  /** 目标相对目录（相对 experiments/） */
  dest: string;
  /** 源目录 */
  src?: string;
  /** 源文件（单文件导入） */
  file?: string;
  /** 目标文件名（单文件导入时生效） */
  destName?: string;
  /** 文本文件：是否脱敏 */
  text?: boolean;
};

function copyTreeFiltered(src: string, dest: string): { files: number; skipped: string[] } {
  const skipped: string[] = [];
  let files = 0;
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    if (entry.name === ".DS_Store") continue;
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        skipped.push(entry.name);
        continue;
      }
      const sub = copyTreeFiltered(from, to);
      files += sub.files;
      skipped.push(...sub.skipped.map((s) => `${entry.name}/${s}`));
    } else if (entry.isFile()) {
      if (statSync(from).size > MAX_FILE_BYTES) {
        skipped.push(entry.name);
        continue;
      }
      // 文本文件统一脱敏——summary.json 里也记录了 skill 绝对路径。
      const ext = extname(entry.name).toLowerCase();
      if (TEXT_EXTENSIONS.has(ext)) {
        const redacted = redactHomeInText(readFileSync(from, "utf8"));
        // 质量守恒：降级报告不得覆盖完整报告。
        if (entry.name === "REPORT.md") {
          const guard = evaluateOverwriteGuard(
            redacted,
            existsSync(to) ? readFileSync(to, "utf8") : null,
          );
          if (guard.blocked) {
            skipped.push(`${entry.name}（${guard.reason}）`);
            continue;
          }
        }
        writeFileSync(to, redacted, "utf8");
      } else {
        cpSync(from, to);
      }
      files += 1;
    }
  }
  return { files, skipped };
}

function importItem(item: ImportItem): void {
  const destDir = join(EXPERIMENTS, item.dest);
  mkdirSync(destDir, { recursive: true });

  if (item.src) {
    const result = copyTreeFiltered(item.src, destDir);
    const note = result.skipped.length ? `（跳过大体积产物：${result.skipped.join(", ")}）` : "";
    process.stdout.write(`  ✓ ${item.dest}  ${result.files} 个文件${note}\n`);
  }

  if (item.file) {
    if (!existsSync(item.file)) {
      process.stderr.write(`  ! 源文件不存在，跳过：${item.file}\n`);
      return;
    }
    const raw = readFileSync(item.file, "utf8");
    const text = item.text === false ? raw : redactHomeInText(raw);
    const name = item.destName ?? basename(item.file);
    const target = join(destDir, name);
    // 质量守恒：降级报告不得覆盖完整报告。
    if (name === "REPORT.md") {
      const guard = evaluateOverwriteGuard(
        text,
        existsSync(target) ? readFileSync(target, "utf8") : null,
      );
      if (guard.blocked) {
        process.stdout.write(`  ! ${item.dest}/${name} ${guard.reason}\n`);
        return;
      }
    }
    writeFileSync(target, text, "utf8");
    process.stdout.write(`  ✓ ${item.dest}/${name}\n`);
  }
}

function main(): void {
  // 会话工作区路径——用 HOME 推导，不写死绝对路径（脚本要能换机器跑）。
  const WORKSPACE = join(homedir(), "WorkBuddy", "skill评估");
  // 本轮 deep-research 测评的运行目录。
  const DR_RUN = join(homedir(), ".skill-eval", "runs", "20261104-114333-deep-research");

  const items: ImportItem[] = [
    // 阴性对照实验：三组对比的核心产物。
    {
      dest: "negative-control-2026-11-01/run-original",
      src: join(NC_ROOT, "run-original-t480"),
    },
    {
      dest: "negative-control-2026-11-01/run-broken",
      src: join(NC_ROOT, "run-broken2"),
    },
    {
      dest: "negative-control-2026-11-01/broken-skill",
      src: join(NC_ROOT, "data-analysis-broken"),
    },
    {
      dest: "negative-control-2026-11-01",
      file: join(NC_ROOT, "suite-broken.json"),
      destName: "suite-broken.json",
    },
    {
      dest: "negative-control-2026-11-01",
      file: join(WORKSPACE, "阴性对照验证报告.md"),
      destName: "阴性对照验证报告.md",
    },
    {
      dest: "negative-control-2026-11-01",
      file: join(WORKSPACE, "口径复算结果.txt"),
      destName: "口径复算结果.txt",
    },
    {
      dest: "negative-control-2026-11-01",
      file: join(WORKSPACE, "评委侧Token统计.txt"),
      destName: "评委侧Token统计.txt",
    },
    // data-analysis 首轮真实测评。
    {
      dest: "data-analysis-2026-10-27",
      file: join(WORKSPACE, "suite-data-analysis.json"),
      destName: "suite-data-analysis.json",
    },
    {
      dest: "data-analysis-2026-10-27",
      file: join(WORKSPACE, "主报告_REPORT.md"),
      destName: "REPORT.md",
    },
    {
      dest: "data-analysis-2026-10-27",
      file: join(WORKSPACE, "观测偏差复核_附录.md"),
      destName: "观测偏差复核_附录.md",
    },
    // deep-research 测评（2026-11-04）：套件 + 报告 + 汇总。
    // cases/ 与 pairwise/ 体积大，不入库——需要时按报告里的复现命令重跑。
    {
      dest: "deep-research-2026-11-04/run",
      src: DR_RUN,
    },
    {
      dest: "deep-research-2026-11-04",
      file: join(DR_RUN, "suite.json"),
      destName: "suite.json",
    },
  ];

  process.stdout.write("导入实验产物到 experiments/\n");
  for (const item of items) importItem(item);

  // 证据目录体积提示：cases/ 与 pairwise/ 未入库，需要时用
  // `skill-eval eval` 重新跑批复现（命令见各目录 README）。
  const readme = join(EXPERIMENTS, "README.md");
  if (!existsSync(readme)) {
    writeFileSync(
      readme,
      [
        "# 实验记录",
        "",
        "本目录保存本仓库产出的关键实验结论，作为可追溯、可复现的记录。",
        "",
        "## 目录",
        "",
        "| 目录 | 内容 | 日期 |",
        "|---|---|---|",
        "| `negative-control-2026-11-01/` | 阴性对照实验：验证工具自身具备区分能力 | 2026-11-01 |",
        "| `data-analysis-2026-10-27/` | data-analysis skill 首轮真实测评 | 2026-10-27 |",
        "",
        "## 复现",
        "",
        "每个目录下的 `REPORT.md` 记录了完整的复现命令（模型、评委模型、repeat 参数）。",
        "原始跑批产物体积较大（单次 20M+），未纳入版本控制；",
        "需要完整证据时按报告中的命令重新跑批即可复现同样结果。",
        "",
        "## 脱敏",
        "",
        "所有文本产物入库前均经过 `src/core/archive.ts` 的 `redactHomeInText` 处理，",
        "用户目录统一替换为 `~`。",
        "",
      ].join("\n"),
      "utf8",
    );
    process.stdout.write("  ✓ README.md\n");
  }

  // 清理可能残留的空目录。
  for (const dir of [join(EXPERIMENTS, "negative-control-2026-11-01")]) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory() && readdirSync(p).length === 0) rmSync(p, { recursive: true, force: true });
    }
  }
}

main();
