/**
 * 人工盲审抽检与评委一致性校准（Human-Judge Calibration）。
 *
 * 工作流：
 * 1. `skill-eval calibrate --run <dir> --export <sheet.json>`
 *    从已完成跑批导出匿名盲审表 `sheet.json`（打乱 A/B 顺序，隐藏 baseline/skill 身份），
 *    同时把映射密钥写入 `<run>/calibration-key.json`。
 * 2. 人工在 `sheet.json` 的每条记录填入 `"humanVerdict": "A" | "B" | "tie"`。
 * 3. `skill-eval calibrate --run <dir> --score <sheet.json>`
 *    对照映射密钥换算回标准 win/tie/loss，计算一致率、Cohen's κ 与评委乐观偏差，
 *    并把校准摘要写入 `<run>/calibration-result.json`（后续 `report` 可直接读取渲染）。
 */

import { createHash } from "node:crypto";
import { DELIVERABLE_SNAPSHOT, readScoringOutput } from "./deliverable.ts";
import { cohensKappa } from "./stats.ts";
import type { Verdict } from "./judge.ts";
import type { EvaluationSummary, EvalTask } from "./runner.ts";

const SCORING_CARRIER_VERSION = 1;

export interface BlindReviewItem {
  itemId: string;
  taskId: string;
  attempt: number;
  prompt: string;
  expectedPoints: string[];
  outputA: string;
  outputB: string;
  /** 人工填写：`"A"`（A 更好）、`"B"`（B 更好）或 `"tie"`（相当）。未填为空串。 */
  humanVerdict: "" | "A" | "B" | "tie";
  notes: string;
}

export interface BlindReviewSheet {
  runId: string;
  scoringCarrierVersion?: number;
  instructions: string;
  items: BlindReviewItem[];
  unavailable?: Array<Pick<BlindReviewItem, "itemId" | "taskId" | "attempt"> & { reason: string }>;
}

export interface CalibrationKeyEntry {
  itemId: string;
  taskId: string;
  attempt: number;
  /** true 表示输出 A 是装了 skill 的变体，B 是 baseline。 */
  aIsVariant: boolean;
  judgeVerdict: Exclude<Verdict, "not_judged">;
}

export interface CalibrationAnswerKey {
  runId: string;
  scoringCarrierVersion?: number;
  entries: CalibrationKeyEntry[];
  unavailableCount?: number;
}

export interface CalibrationResult {
  runId: string;
  totalItems: number;
  reviewedCount: number;
  unavailableCount?: number;
  agreementRate: number | null;
  kappa: number | null;
  judgeWinRate: number | null;
  humanWinRate: number | null;
  /** (judgeWinRate - humanWinRate) * 100：正值说明模型评委相对人工存在乐观偏置。 */
  optimismBiasPp: number | null;
  disagreements: Array<{
    itemId: string;
    taskId: string;
    attempt: number;
    judgeVerdict: "win" | "tie" | "loss";
    humanVerdict: "win" | "tie" | "loss";
    notes: string;
  }>;
}

function deterministicCoinFlip(seed: string): boolean {
  const byte = createHash("sha256").update(seed, "utf8").digest()[0] ?? 0;
  return byte % 2 === 1;
}

export function exportCalibrationSheet(
  summary: EvaluationSummary,
  tasks?: EvalTask[],
  limit?: number,
  runRoot?: string,
): { blindSheet: BlindReviewSheet; answerKey: CalibrationAnswerKey } {
  const taskDefinitions = tasks ?? summary.manifest?.tasks ?? summary.tasks;
  const taskMap = new Map((taskDefinitions ?? []).map((t) => [t.id, t]));
  const resultMap = new Map(summary.results.map((r) => [r.id, r]));

  const judgedPairs = summary.pairwise.filter(
    (p): p is typeof p & { verdict: Exclude<Verdict, "not_judged"> } => p.verdict !== "not_judged",
  );
  const selected = typeof limit === "number" && limit > 0 ? judgedPairs.slice(0, limit) : judgedPairs;

  const items: BlindReviewItem[] = [];
  const entries: CalibrationKeyEntry[] = [];
  const unavailable: NonNullable<BlindReviewSheet["unavailable"]> = [];

  for (const pair of selected) {
    const item = { itemId: `${pair.taskId}#${pair.attempt}`, taskId: pair.taskId, attempt: pair.attempt };
    const baseRow = resultMap.get(pair.baselineResultId);
    const varRow = resultMap.get(pair.variantResultId);
    if (!baseRow || !varRow) {
      unavailable.push({ ...item, reason: "缺少成对运行记录" });
      continue;
    }
    const taskDef = taskMap.get(pair.taskId);
    const deliverablePath = taskDef?.deliverablePath;
    if ((taskDefinitions && !taskDef) || (!deliverablePath && [baseRow, varRow].some(row =>
      row.deliverable || row.evidenceHashes?.[DELIVERABLE_SNAPSHOT]
    ))) {
      unavailable.push({ ...item, reason: "无法确定冻结评分载体" });
      continue;
    }
    const baseOutput = readScoringOutput(runRoot, deliverablePath, baseRow);
    const varOutput = readScoringOutput(runRoot, deliverablePath, varRow);
    if (baseOutput === undefined || varOutput === undefined) {
      unavailable.push({ ...item, reason: "评分交付快照缺失或无法核验" });
      continue;
    }
    const aIsVariant = deterministicCoinFlip(`${summary.runId}::${item.itemId}`);

    items.push({
      ...item,
      prompt: taskDef?.prompt ?? "（未在摘要中附带原始 prompt，请对照套件文件查看）",
      expectedPoints: taskDef?.expectedPoints ?? [],
      outputA: aIsVariant ? varOutput : baseOutput,
      outputB: aIsVariant ? baseOutput : varOutput,
      humanVerdict: "",
      notes: "",
    });

    entries.push({
      ...item,
      aIsVariant,
      judgeVerdict: pair.verdict,
    });
  }

  return {
    blindSheet: {
      runId: summary.runId,
      scoringCarrierVersion: SCORING_CARRIER_VERSION,
      instructions:
        "请在每条 items 的 humanVerdict 字段填写 'A'（输出 A 更好）、'B'（输出 B 更好）或 'tie'（质量相当），保存后运行 skill-eval calibrate --run <dir> --score <本文件>。",
      items,
      unavailable,
    },
    answerKey: {
      runId: summary.runId,
      scoringCarrierVersion: SCORING_CARRIER_VERSION,
      entries,
      unavailableCount: unavailable.length,
    },
  };
}

export function evaluateCalibration(
  blindSheet: BlindReviewSheet,
  answerKey: CalibrationAnswerKey,
): CalibrationResult {
  if (blindSheet.runId !== answerKey.runId || blindSheet.scoringCarrierVersion !== answerKey.scoringCarrierVersion) {
    throw new Error("盲审表与映射密钥的运行身份或评分载体版本不匹配，请重新导出同一份盲审表及密钥");
  }
  const keyMap = new Map(answerKey.entries.map((e) => [e.itemId, e]));

  const judgeLabels: Array<"win" | "tie" | "loss"> = [];
  const humanLabels: Array<"win" | "tie" | "loss"> = [];
  const disagreements: CalibrationResult["disagreements"] = [];

  for (const item of blindSheet.items) {
    if (item.humanVerdict !== "A" && item.humanVerdict !== "B" && item.humanVerdict !== "tie") {
      continue;
    }
    const key = keyMap.get(item.itemId);
    if (!key) continue;

    let humanCanonical: "win" | "tie" | "loss";
    if (item.humanVerdict === "tie") {
      humanCanonical = "tie";
    } else if (
      (item.humanVerdict === "A" && key.aIsVariant) ||
      (item.humanVerdict === "B" && !key.aIsVariant)
    ) {
      humanCanonical = "win";
    } else {
      humanCanonical = "loss";
    }

    judgeLabels.push(key.judgeVerdict);
    humanLabels.push(humanCanonical);

    if (key.judgeVerdict !== humanCanonical) {
      disagreements.push({
        itemId: item.itemId,
        taskId: key.taskId,
        attempt: key.attempt,
        judgeVerdict: key.judgeVerdict,
        humanVerdict: humanCanonical,
        notes: item.notes ?? "",
      });
    }
  }

  const reviewedCount = judgeLabels.length;
  const unavailableCount = answerKey.unavailableCount ?? 0;
  if (reviewedCount === 0) {
    return {
      runId: answerKey.runId,
      totalItems: answerKey.entries.length,
      reviewedCount: 0,
      unavailableCount,
      agreementRate: null,
      kappa: null,
      judgeWinRate: null,
      humanWinRate: null,
      optimismBiasPp: null,
      disagreements: [],
    };
  }

  const agreed = judgeLabels.filter((v, idx) => v === humanLabels[idx]).length;
  const agreementRate = agreed / reviewedCount;
  const kappa = cohensKappa(judgeLabels.map((j, idx) => [j, humanLabels[idx]!] as const));
  const judgeWinRate = judgeLabels.filter((v) => v === "win").length / reviewedCount;
  const humanWinRate = humanLabels.filter((v) => v === "win").length / reviewedCount;
  const optimismBiasPp = Math.round((judgeWinRate - humanWinRate) * 1000) / 10;

  return {
    runId: answerKey.runId,
    totalItems: answerKey.entries.length,
    reviewedCount,
    unavailableCount,
    agreementRate,
    kappa,
    judgeWinRate,
    humanWinRate,
    optimismBiasPp,
    disagreements,
  };
}
