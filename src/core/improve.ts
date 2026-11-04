/**
 * 未通过 skill 的优化建议。
 *
 * 目的：测评没通过时，报告不能只说「没通过」，要指出**具体该改哪里**——
 * 否则用户拿到报告也不知道下一步做什么。
 *
 * 归因方法：拿 skill 侧与 baseline 侧的逐条断言结果做对比，按失败模式分类：
 *
 * | 模式 | 特征 | 含义 |
 * |---|---|---|
 * | `contract-missing` | baseline 过了、skill 侧没过 | **真问题**：skill 声称的契约没落到输出里 |
 * | `no-effect` | 两侧都没过 | skill 根本没起作用（触发或内容无效） |
 * | `regression` | baseline 过了、skill 侧过了但评委判输 | 规则没破但质量下降 |
 * | `unstable` | 同一断言在多次重复里时过时不过 | 契约强度不够稳 |
 *
 * 关键判断：**baseline 也过的断言不算 skill 的问题**——那是模型本来就会做的，
 * 写进优化建议会误导用户去改不该改的地方（阴性对照实验测得断言整体灵敏度
 * 只有 51.9%，这类断言占了一半）。
 *
 * 建议生成不调用模型——纯规则归类，保证确定性、可复算、零成本。
 */

import type { AssertionOutcome } from "./assertions.ts";
import type { RunResult } from "./runner.ts";

/** 失败模式分类。 */
export type FailureMode =
  | "contract-missing"
  | "no-effect"
  | "regression"
  | "unstable"
  | "activation-missing";

/** 单条失败断言的归因结果。 */
export interface FailureDiagnosis {
  /** 断言类型（mustMatch / jsonSchema / …）。 */
  kind: string;
  /** 断言说明（来自套件的 note）。 */
  note: string;
  /** 失败原因原文。 */
  detail: string;
  /** 归类到哪条用例。 */
  taskId: string;
  /** 失败模式。 */
  mode: FailureMode;
  /** 优化建议（人话，可直接执行）。 */
  advice: string;
}

/** 整体诊断结论。 */
export interface ImprovementAdvice {
  /** 逐条诊断。 */
  diagnoses: FailureDiagnosis[];
  /** 按模式归类的建议（按优先级排序）。 */
  byMode: Array<{ mode: FailureMode; count: number; advice: string }>;
  /** 激活率过低导致的整体判断。 */
  activationIssue: string | null;
  /** 一句话总结。 */
  summary: string;
}

/** 各失败模式的建议文案。 */
const MODE_ADVICE: Record<FailureMode, string> = {
  "contract-missing":
    "skill 声称的约束没有落到输出里。把该条约束从「描述」改成「可执行的硬性步骤或模板」——" +
    "明确写出要出现什么、放在哪个位置、用什么格式。",
  "no-effect":
    "这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束" +
    "（而不是靠模型自己推测），必要时补成明确的红线条目。",
  regression:
    "规则断言没破，但相对 baseline 评委判输——输出质量下降。通常是 skill 的约束挤占了内容空间，" +
    "或措辞让模型过度套模板。检查是否过度规定了格式而削弱了实质内容。",
  unstable:
    "同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则" +
    "（给出可判定的具体条件），并考虑补一条示例。",
  "activation-missing":
    "skill 没被模型读取，输出根本没走 skill 的约束。优先改 frontmatter 的 description——" +
    "写清「什么场景下该用我」，而不是罗列功能。",
};

/** 模式的中文名。 */
const MODE_LABEL: Record<FailureMode, string> = {
  "contract-missing": "契约未落地",
  "no-effect": "契约无效",
  regression: "质量倒退",
  unstable: "约束不稳",
  "activation-missing": "未触发",
};

/**
 * 生成优化建议。
 *
 * @param results 全部运行结果（含 baseline 与 skill 两侧）
 * @param activationRate skill 侧激活率
 * @param verdict 结论等级。用于措辞——结论为 `effective` 时不应说「skill 未通过」。
 */
export function buildImprovementAdvice(
  results: RunResult[],
  activationRate: number,
  verdict?: "effective" | "ineffective" | "inconclusive",
): ImprovementAdvice {
  const baselineRows = results.filter((r) => r.variantId === "baseline" && r.assertions);
  const variantRows = results.filter((r) => r.variantId !== "baseline" && r.assertions);

  // 断言在 baseline 侧的表现：按 (taskId, 断言索引) 聚合。
  // key 用 taskId + 断言序号，保证同一用例的同一条断言能对上。
  const baselineByKey = new Map<string, boolean[]>();
  for (const row of baselineRows) {
    const outcomes = row.assertions?.outcomes ?? [];
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      if (!outcome) continue;
      const key = `${row.taskId}#${i}`;
      const list = baselineByKey.get(key) ?? [];
      list.push(outcome.passed);
      baselineByKey.set(key, list);
    }
  }

  // skill 侧的表现：同样聚合，记录每次重复的结果。
  const variantByKey = new Map<
    string,
    { outcomes: AssertionOutcome[]; passes: boolean[]; taskId: string }
  >();
  for (const row of variantRows) {
    const outcomes = row.assertions?.outcomes ?? [];
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i];
      if (!outcome) continue;
      const key = `${row.taskId}#${i}`;
      const entry = variantByKey.get(key) ?? {
        outcomes: [],
        passes: [],
        taskId: row.taskId,
      };
      entry.outcomes.push(outcome);
      entry.passes.push(outcome.passed);
      variantByKey.set(key, entry);
    }
  }

  const diagnoses: FailureDiagnosis[] = [];

  for (const [key, entry] of variantByKey) {
    // skill 侧全过 → 不是问题。
    if (entry.passes.every(Boolean)) continue;

    const basePasses = baselineByKey.get(key) ?? [];
    const baselineAllPass = basePasses.length > 0 && basePasses.every(Boolean);
    const baselineAnyPass = basePasses.some(Boolean);
    // skill 侧自身是否不稳定——多次重复里时过时不过。
    const skillMixed = entry.passes.some(Boolean);

    let mode: FailureMode;
    if (baselineAllPass) {
      // baseline 稳过、skill 侧有失败——真问题，skill 把本来能做对的事做坏了。
      mode = "contract-missing";
    } else if (skillMixed || baselineAnyPass) {
      // 有一侧时过时不过——契约强度不够或存在歧义。
      mode = "unstable";
    } else {
      // 两侧都从未通过——skill 没起作用。
      mode = "no-effect";
    }

    const outcome = entry.outcomes.find((o) => !o.passed) ?? entry.outcomes[0];
    if (!outcome) continue;
    diagnoses.push({
      kind: outcome.kind,
      note: outcome.note ?? "",
      detail: outcome.detail,
      taskId: entry.taskId,
      mode,
      advice: MODE_ADVICE[mode],
    });
  }

  // 按模式归类计数，优先级：真问题 > 不稳 > 无效 > 倒退。
  const modePriority: FailureMode[] = [
    "contract-missing",
    "unstable",
    "no-effect",
    "regression",
    "activation-missing",
  ];
  const counts = new Map<FailureMode, number>();
  for (const d of diagnoses) counts.set(d.mode, (counts.get(d.mode) ?? 0) + 1);

  const byMode = modePriority
    .filter((mode) => (counts.get(mode) ?? 0) > 0)
    .map((mode) => ({
      mode,
      count: counts.get(mode)!,
      advice: MODE_ADVICE[mode],
    }));

  // 激活率过低是另一类问题——改内容没用，得先改 description。
  const activationIssue =
    activationRate < 0.6
      ? `激活率仅 ${(activationRate * 100).toFixed(1)}%（未达 60% 门槛）：skill 大部分时候没被模型读取，` +
        `输出根本没走 skill 的约束。此时改正文收效有限，应先改 frontmatter 的 description——` +
        `写清「什么场景该用我」。`
      : null;

  // 总结：先看激活率，再看失败条数。
  //
  // 措辞必须与结论等级一致：结论为 `effective`（通过）时，
  // 断言失败只代表「还有可加固的契约」，不是「skill 没通过」。
  // 此前无论结论如何都写「skill 未通过」，导致通过的报告里出现
  // 「判定：有效」紧接「skill 未通过：28 条断言失败」的自相矛盾。
  const passed = verdict === "effective";
  let summary: string;
  if (activationIssue) {
    summary =
      `首要问题是激活率不足（${(activationRate * 100).toFixed(1)}%）：` +
      `模型多数时候没读它，输出不受约束。此时改正文收效有限，应先改 frontmatter 的 description——` +
      `写清「什么场景该用我」。`;
  } else if (diagnoses.length === 0) {
    summary =
      "规则断言全部通过，没有可加固的契约——如需确认稳定性，可增加 repeat 后复跑。";
  } else {
    const top = byMode[0];
    summary =
      (passed ? "skill 已通过测评，但仍有可加固的契约：" : "skill 未通过：") +
      `${diagnoses.length} 条断言失败，其中 ${top ? top.count : 0} 条属于「${top ? MODE_LABEL[top.mode] : "未知"}」。` +
      `优先处理这一类，其余见下方明细。`;
  }

  return { diagnoses, byMode, activationIssue, summary };
}
