/**
 * EFC（反馈效率系数）评分。
 *
 * 移植自 pi-xanthil 的 `efc-scoring.ts`，剥离产品耦合。
 *
 * 用途：衡量「一次运行换回多少有效信息」。
 * 在 win rate 相同的情况下，EFC 高的 variant 更值得保留——
 * 因为它用更少的算力达到了同样的结论质量。
 *
 * 四个因子相乘：
 * - information 信息量：调用了工具 / 有输出 / 至少成功
 * - validity   有效性：通过断言 > 仅断言失败 > 运行时失败 > 超时
 * - relevance  相关性：输出不重复（signature 去重）
 * - memory     记忆：是否产生了计划变更或写入
 */

export type EfcValidity = "passing" | "assertion" | "runtime" | "timeout";
export type EfcMemorySignal = "written" | "changed_plan" | "none" | "unknown";

export interface EfcRunInput {
  status: "success" | "failed";
  validity?: EfcValidity;
  hasOutput?: boolean;
  toolCalls?: number;
  memorySignal?: EfcMemorySignal;
  signature?: string;
  totalTokens?: number;
}

export interface EfcDifficulty {
  minSteps: number;
  toolAmbiguity: number;
  stateTracking: number;
  observationNoise: number;
  oracleVisibility: number;
}

export interface EfcScore {
  efc: number;
  /** 按难度归一化后的分数。 */
  normalized: number;
  /** 每次消耗计算量换回的 EFC。 */
  eta: number;
  cRaw: number;
  eventCount: number;
  difficulty: number;
  factors: {
    information: number;
    validity: number;
    relevance: number;
    memory: number;
  };
}

const TOOL_CALL_TOKEN_WEIGHT = 1000;

export function defaultDifficulty(): EfcDifficulty {
  return { minSteps: 1, toolAmbiguity: 1, stateTracking: 1, observationNoise: 0, oracleVisibility: 0.5 };
}

/** 难度越高，同等 EFC 的价值越大。 */
export function computeDifficulty(profile: EfcDifficulty): number {
  const raw =
    profile.minSteps *
    profile.toolAmbiguity *
    profile.stateTracking *
    (1 + profile.observationNoise) *
    (1 - profile.oracleVisibility);
  return Math.max(0.001, raw);
}

export function scoreEfcRuns(runs: EfcRunInput[], difficulty: EfcDifficulty = defaultDifficulty()): EfcScore {
  const totalTokens = runs.reduce((acc, run) => acc + Math.max(0, run.totalTokens ?? 0), 0);
  const totalToolCalls = runs.reduce((acc, run) => acc + Math.max(0, run.toolCalls ?? 0), 0);
  const cRaw = totalTokens + totalToolCalls * TOOL_CALL_TOKEN_WEIGHT;

  const seen = new Set<string>();
  let rawEfc = 0;
  const sums = { information: 0, validity: 0, relevance: 0, memory: 0 };

  for (const run of runs) {
    const information = scoreInformation(run);
    const validity = scoreValidity(run);
    const relevance = scoreRelevance(run, seen);
    const memory = scoreMemory(run.memorySignal ?? "unknown");
    rawEfc += information * validity * relevance * memory;
    sums.information += information;
    sums.validity += validity;
    sums.relevance += relevance;
    sums.memory += memory;
  }

  const eventCount = runs.length;
  const computedDifficulty = computeDifficulty(difficulty);

  return {
    efc: round3(rawEfc),
    normalized: round3(rawEfc / computedDifficulty),
    eta: cRaw > 0 ? round6(rawEfc / cRaw) : 0,
    cRaw,
    eventCount,
    difficulty: round3(computedDifficulty),
    factors: {
      information: round3(eventCount ? sums.information / eventCount : 0),
      validity: round3(eventCount ? sums.validity / eventCount : 0),
      relevance: round3(eventCount ? sums.relevance / eventCount : 0),
      memory: round3(eventCount ? sums.memory / eventCount : 0),
    },
  };
}

function scoreInformation(run: EfcRunInput): number {
  if ((run.toolCalls ?? 0) > 0) return 1;
  if (run.hasOutput) return run.status === "success" ? 0.85 : 0.45;
  return run.status === "success" ? 0.55 : 0.3;
}

function scoreValidity(run: EfcRunInput): number {
  if (run.validity === "passing") return 1;
  if (run.validity === "assertion") return 0.42;
  if (run.validity === "runtime") return 0.12;
  if (run.validity === "timeout") return 0.06;
  return run.status === "success" ? 1 : 0.12;
}

function scoreRelevance(run: EfcRunInput, seen: Set<string>): number {
  const signature = run.signature?.trim();
  if (!signature) return 1;
  if (seen.has(signature)) return 0.2;
  seen.add(signature);
  return 1;
}

function scoreMemory(signal: EfcMemorySignal): number {
  if (signal === "written") return 1;
  if (signal === "changed_plan") return 0.75;
  if (signal === "none") return 0.1;
  return 0.5;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
