/**
 * 评估套件加载、内容指纹（suiteHash）与静态/实证质量体检（checkSuite）。
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_REPEAT } from "./thresholds.ts";
import { analyzeAssertionSensitivity } from "./sensitivity.ts";
import type { Assertion } from "./assertions.ts";
import type { EvaluationSummary, EvalTask } from "./runner.ts";
import { validDeliverablePath } from "./deliverable.ts";

export interface SuiteFile {
  id: string;
  name?: string;
  description?: string;
  version?: string;
  skill?: {
    path?: string;
    version?: string;
    note?: string;
  };
  contextPrefix?: string;
  repeat?: number;
  judgeRepeat?: number;
  tasks: EvalTask[];
}

export interface SuiteCheckStats {
  taskCount: number;
  scoredCount: number;
  diagnosticCount: number;
  negativeTriggerCount: number;
  assertionCount: number;
  negativeAssertionCount: number;
}

export interface SuiteCheckReport {
  valid: boolean;
  suiteHash: string;
  stats: SuiteCheckStats;
  errors: string[];
  warnings: string[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const out: Record<string, unknown> = {};
    for (const k of sortedKeys) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) {
        out[k] = canonicalize(v);
      }
    }
    return out;
  }
  return value;
}

/**
 * 计算套件判据指纹（suiteHash）。
 *
 * 只把会影响运行与判分语义的字段纳入哈希（id / contextPrefix / tasks 及其 prompt、assertions、kind、shouldActivate 等），
 * 忽略 name / description / version / skill.path 等纯展示或路径字段，
 * 以便准确检测「两轮评估是否悄悄改过题目或断言」。
 */
export function hashSuite(suite: SuiteFile): string {
  const payload = canonicalize({
    id: suite.id,
    contextPrefix: suite.contextPrefix ?? null,
    tasks: suite.tasks.map((t) => ({
      id: t.id,
      prompt: t.prompt,
      kind: t.kind ?? "scored",
      shouldActivate: t.shouldActivate ?? true,
      expectedPoints: t.expectedPoints ?? [],
      rubric: t.rubric ?? null,
      assertions: t.assertions ?? [],
      deliverablePath: t.deliverablePath,
    })),
  });
  const digest = createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `sha256:${digest}`;
}

/** 加载并做基础结构校验。 */
export function loadSuite(suitePath: string): SuiteFile {
  const absolute = resolve(suitePath);
  if (!existsSync(absolute)) {
    throw new Error(`套件文件不存在: ${absolute}`);
  }
  const parsed = JSON.parse(readFileSync(absolute, "utf8")) as SuiteFile;

  if (!parsed.id) throw new Error("套件缺少 id 字段");
  if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
    throw new Error("套件缺少 tasks 或 tasks 为空");
  }
  const seen = new Set<string>();
  for (const task of parsed.tasks) {
    if (!task.id) throw new Error("存在缺少 id 的用例");
    if (seen.has(task.id)) throw new Error(`用例 id 重复: ${task.id}`);
    seen.add(task.id);
    if (!task.prompt || !task.prompt.trim()) throw new Error(`用例 ${task.id} 缺少 prompt`);
    if (task.deliverablePath !== undefined && !validDeliverablePath(task.deliverablePath)) {
      throw new Error(`用例 ${task.id} 的 deliverablePath 必须是工作区内的相对 Markdown 路径`);
    }
  }

  return parsed;
}

function compileRegex(pattern: string, flags?: string): { regex: RegExp | null; error?: string } {
  try {
    return { regex: new RegExp(pattern, flags ?? "") };
  } catch (err) {
    return { regex: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function countCaptureGroups(pattern: string, flags?: string): number {
  try {
    const probe = new RegExp(`${pattern}|`, flags ?? "");
    const m = probe.exec("");
    return m ? m.length - 1 : 0;
  } catch {
    return 0;
  }
}

function lintAssertion(
  taskId: string,
  index: number,
  assertion: Assertion,
  errors: string[],
  warnings: string[],
): { isNegative: boolean } {
  const loc = `${taskId}#${index + 1} (${assertion.kind})`;
  let isNegative = false;

  switch (assertion.kind) {
    case "mustMatch": {
      const { regex, error } = compileRegex(assertion.pattern, assertion.flags);
      if (!regex) {
        errors.push(`${loc} 无效正则 "${assertion.pattern}": ${error}`);
      } else if (regex.test("")) {
        warnings.push(`${loc} 正则 "${assertion.pattern}" 可匹配空字符串（恒真断言，无区分度）`);
      }
      for (const eq of assertion.equivalentPatterns ?? []) {
        const eqRes = compileRegex(eq, assertion.flags);
        if (!eqRes.regex) {
          errors.push(`${loc} equivalentPatterns 含无效正则 "${eq}": ${eqRes.error}`);
        }
      }
      break;
    }

    case "mustNotMatch": {
      isNegative = true;
      const { regex, error } = compileRegex(assertion.pattern, assertion.flags);
      if (!regex) {
        errors.push(`${loc} 无效正则 "${assertion.pattern}": ${error}`);
      } else if (regex.test("")) {
        errors.push(`${loc} mustNotMatch 正则 "${assertion.pattern}" 匹配空字符串，会导致任何输出必败`);
      }
      for (const eq of assertion.equivalentPatterns ?? []) {
        const eqRes = compileRegex(eq, assertion.flags);
        if (!eqRes.regex) {
          errors.push(`${loc} equivalentPatterns 含无效正则 "${eq}": ${eqRes.error}`);
        }
      }
      break;
    }

    case "mustContain": {
      if (!assertion.value || assertion.value.length === 0) {
        errors.push(`${loc} mustContain 的 value 不能为空`);
      }
      break;
    }

    case "mustNotContain": {
      isNegative = true;
      if (!assertion.value || assertion.value.length === 0) {
        errors.push(`${loc} mustNotContain 的 value 不能为空`);
      }
      break;
    }

    case "numeric": {
      const { regex, error } = compileRegex(assertion.pattern);
      if (!regex) {
        errors.push(`${loc} 无效正则 "${assertion.pattern}": ${error}`);
      } else if (countCaptureGroups(assertion.pattern) < 1) {
        errors.push(`${loc} numeric 正则 "${assertion.pattern}" 缺少捕获组 (...)，运行时无法提取数值`);
      }
      break;
    }

    case "jsonSchema": {
      if (!assertion.schema || typeof assertion.schema !== "object") {
        errors.push(`${loc} jsonSchema 缺少有效的 schema 对象`);
      }
      break;
    }
  }

  return { isNegative };
}

/**
 * 套件静态质量检查 + 可选历史运行灵敏度联合体检。
 */
export function checkSuite(
  suite: SuiteFile,
  empiricalSummary?: EvaluationSummary,
): SuiteCheckReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  let scoredCount = 0;
  let diagnosticCount = 0;
  let negativeTriggerCount = 0;
  let assertionCount = 0;
  let negativeAssertionCount = 0;

  for (const task of suite.tasks) {
    if (task.deliverablePath !== undefined && !validDeliverablePath(task.deliverablePath)) {
      errors.push(`用例 ${task.id} 的 deliverablePath 必须是工作区内的相对 Markdown 路径`);
    }
    const kind = task.kind ?? "scored";
    if (kind === "scored") scoredCount += 1;
    else diagnosticCount += 1;

    if (task.shouldActivate === false) {
      negativeTriggerCount += 1;
    }

    const assertions = task.assertions ?? [];
    assertionCount += assertions.length;

    if (kind === "scored" && task.shouldActivate !== false && assertions.length === 0) {
      warnings.push(`计分用例 "${task.id}" 未配置规则断言，将完全依赖模型评委主观打分`);
    }

    assertions.forEach((assertion, idx) => {
      const res = lintAssertion(task.id, idx, assertion, errors, warnings);
      if (res.isNegative) negativeAssertionCount += 1;
    });
  }

  if (suite.repeat !== undefined && suite.repeat < DEFAULT_REPEAT) {
    warnings.push(
      `套件 repeat=${suite.repeat} 小于推荐最小值 ${DEFAULT_REPEAT}，小样本下单次随机波动即可翻转胜负`,
    );
  }

  if (assertionCount === 0) {
    warnings.push("该套件没有任何规则断言，将完全依赖模型评委判定，且小样本下可能因置信区间不足被判为 inconclusive");
  } else if (negativeAssertionCount === 0) {
    warnings.push("套件全部为正向断言，缺少负向红线断言（mustNotMatch / mustNotContain），难以拦截幻觉与套话");
  }

  if (negativeTriggerCount === 0) {
    warnings.push("套件未包含负向误触发测试（shouldActivate: false），无法检测 description 过泛导致的乱触发");
  }

  if (empiricalSummary) {
    const sens = analyzeAssertionSensitivity(empiricalSummary, suite.tasks);
    if (sens.insensitiveCount > 0) {
      warnings.push(
        `实证灵敏度体检：${sens.insensitiveCount}/${sens.totalAssertions} 条断言在 baseline 下通过率 ≥ 80%（无区分度白送断言）`,
      );
    }
    if (sens.zeroDiscriminationTasks.length > 0) {
      warnings.push(
        `实证零区分度用例：${sens.zeroDiscriminationTasks.join(", ")} 的全部断言在 baseline 下均已 ≥ 80% 通过，建议改严或移为 diagnostic`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    suiteHash: hashSuite(suite),
    stats: {
      taskCount: suite.tasks.length,
      scoredCount,
      diagnosticCount,
      negativeTriggerCount,
      assertionCount,
      negativeAssertionCount,
    },
    errors,
    warnings,
  };
}
