/**
 * 激活检测。
 *
 * 与 pi-xanthil 的关键差异：pi-xanthil 以「输出关键词匹配」为主判据，
 * 本仓库以「工具调用取证」为主判据。
 *
 * 原因（实测 pi CLI v1.2.0）：`--skill` 只把 skill 的 name/description/path
 * 写进 system prompt，模型必须主动 `read` 该文件，内容才进入上下文。
 * 若模型没读但回答里碰巧出现 skill 关键词，关键词优先策略会误判为激活。
 *
 * 判定分级：
 * - `tool_call`     强证据：事件流中确实读取了目标 skill 路径 → 激活
 * - `output_keyword` 弱证据：输出含关键词但无工具取证 → 弱激活，单独统计
 * - 无证据 → 未激活
 */

import { readFileSync, existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

export type ActivationEvidenceKind = "tool_call" | "output_keyword";

export interface ActivationEvidence {
  kind: ActivationEvidenceKind;
  /** 证据来源细节：读取路径或命中的关键词。 */
  value: string;
  /** 该证据归属于哪个 skill 路径。 */
  skillPath: string;
}

export type ActivationStatus = "activated" | "weak" | "not_activated";

export interface ActivationResult {
  status: ActivationStatus;
  /** 强证据成立时为 true。仅强证据计入激活率分子。 */
  activated: boolean;
  /** 命中关键词（弱证据）。 */
  matchedKeywords: string[];
  /** 被实际读取的 skill 路径。 */
  readSkillPaths: string[];
  evidence: ActivationEvidence[];
}

export interface ActivationInput {
  /** 被加载的 skill 路径列表。 */
  skillPaths: string[];
  /** 模型读取过的文件路径（来自工具调用取证）。 */
  readPaths: string[];
  /** 模型最终输出。 */
  output: string;
  /** 是否启用弱证据（关键词）判定。默认 true。 */
  keywordSignal?: boolean;
}

/**
 * 检测 skill 是否被真正激活。
 *
 * 只统计传入的 skillPaths——被测 skill 之外的路径不参与判定，
 * 避免模型读了别的文件被误判。
 */
export function detectActivation(input: ActivationInput): ActivationResult {
  const evidence: ActivationEvidence[] = [];
  const readSkillPaths = new Set<string>();
  const matchedKeywords = new Set<string>();

  const readSet = new Set(input.readPaths.map((path) => resolve(path)));
  const output = input.output.toLowerCase();

  for (const skillPath of input.skillPaths) {
    const resolved = resolve(skillPath);

    // 强证据：模型确实读取了该 skill 文件。
    if (readSet.has(resolved)) {
      readSkillPaths.add(skillPath);
      evidence.push({ kind: "tool_call", value: resolved, skillPath });
      continue; // 已有强证据，不必再看关键词。
    }

    // 弱证据：输出中出现 skill 自身的标识词，但模型从未读取该文件。
    if (input.keywordSignal !== false) {
      for (const keyword of extractActivationKeywords(skillPath)) {
        if (keyword.length < 3) continue;
        if (output.includes(keyword.toLowerCase())) {
          matchedKeywords.add(keyword);
          evidence.push({ kind: "output_keyword", value: keyword, skillPath });
        }
      }
    }
  }

  const activated = readSkillPaths.size > 0;
  const weak = !activated && matchedKeywords.size > 0;

  return {
    status: activated ? "activated" : weak ? "weak" : "not_activated",
    activated,
    matchedKeywords: [...matchedKeywords],
    readSkillPaths: [...readSkillPaths],
    evidence,
  };
}

/**
 * 从 skill 文件提取可用于弱证据匹配的关键词。
 *
 * 刻意保守：只用 frontmatter 的 name/description 与目录名，
 * 不用正文全文（正文词太泛，误报率高）。
 */
export function extractActivationKeywords(skillPath: string): string[] {
  const keywords = new Set<string>();

  const dirName = basename(dirname(skillPath));
  if (dirName) keywords.add(dirName);
  const slug = dirName.replace(/[-_]+/g, " ").trim();
  if (slug && slug !== dirName) keywords.add(slug);

  if (!existsSync(skillPath)) return [...keywords];

  try {
    const content = readFileSync(skillPath, "utf8");
    const frontmatter = parseFrontmatter(content);
    if (frontmatter.name) keywords.add(frontmatter.name.trim());
    if (frontmatter.description) {
      // description 往往很长，只取前几个词作为短语匹配目标。
      const words = frontmatter.description
        .split(/[\s,，。、:：;；]+/)
        .map((word) => word.trim())
        .filter((word) => word.length >= 3);
      for (const word of words.slice(0, 8)) keywords.add(word);
    }
  } catch {
    // 取证失败不应让评估运行失败。
  }

  return [...keywords].filter((keyword) => keyword.length >= 3 && !isGenericKeyword(keyword));
}

function isGenericKeyword(keyword: string): boolean {
  return /^(name|description|when|using|skill|markdown|content|frontmatter|the|and|for|with|that|this|from|please|need|task|output|input)$/i.test(
    keyword,
  );
}

/** 解析 YAML frontmatter 的扁平 key-value（够用即可，不引入 YAML 依赖）。 */
export function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---")) return {};
  const end = content.indexOf("\n---", 3);
  if (end < 0) return {};

  const values: Record<string, string> = {};
  for (const line of content.slice(3, end).split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match?.[1]) continue;
    values[match[1]] = unquote(match[2] ?? "");
  }
  return values;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * 汇总一组运行的激活统计。
 *
 * 激活率只统计强证据。弱激活单独报告，不混入激活率分子——
 * 否则「模型没读 skill 但碰巧说对」会被算作成功。
 */
export function summarizeActivation(results: Array<{ activation: ActivationResult }>): {
  total: number;
  activated: number;
  weak: number;
  notActivated: number;
  activationRate: number;
  weakRate: number;
} {
  const total = results.length;
  const activated = results.filter((row) => row.activation.activated).length;
  const weak = results.filter((row) => row.activation.status === "weak").length;
  const notActivated = total - activated - weak;

  return {
    total,
    activated,
    weak,
    notActivated,
    activationRate: total > 0 ? activated / total : 0,
    weakRate: total > 0 ? weak / total : 0,
  };
}
