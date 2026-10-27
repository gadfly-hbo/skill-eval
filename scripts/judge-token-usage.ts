/**
 * 统计评委侧（pairwise judge）的 token 与成本消耗。
 *
 * 背景：summary.json 的 totalTokens / totalCost 只汇总了「被评侧」（results[]），
 * 评委侧的消耗保存在 pairwise/<组>/{forward,reversed}/events.json 里，
 * 必须从 agent_end 事件的 messages[].usage 自行提取。
 */

import fs from "node:fs";
import path from "node:path";

const RUN_DIR =
  process.argv[2] ?? path.join(process.env.HOME ?? ".", ".skill-eval/runs/20261027-234757-data-analysis-r2");

interface Cost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  reasoning?: number;
  cost?: Cost;
}

function extractUsage(eventsPath: string): Usage {
  const events = JSON.parse(fs.readFileSync(eventsPath, "utf8")) as any[];
  const acc: Usage = {};
  for (const ev of events) {
    if (ev?.type !== "agent_end") continue;
    for (const msg of ev.messages ?? []) {
      const u = msg?.usage as Usage | undefined;
      if (!u) continue;
      acc.input = (acc.input ?? 0) + (u.input ?? 0);
      acc.output = (acc.output ?? 0) + (u.output ?? 0);
      acc.cacheRead = (acc.cacheRead ?? 0) + (u.cacheRead ?? 0);
      acc.cacheWrite = (acc.cacheWrite ?? 0) + (u.cacheWrite ?? 0);
      acc.totalTokens = (acc.totalTokens ?? 0) + (u.totalTokens ?? 0);
      acc.reasoning = (acc.reasoning ?? 0) + (u.reasoning ?? 0);
      acc.cost = {
        input: (acc.cost?.input ?? 0) + (u.cost?.input ?? 0),
        output: (acc.cost?.output ?? 0) + (u.cost?.output ?? 0),
        cacheRead: (acc.cost?.cacheRead ?? 0) + (u.cost?.cacheRead ?? 0),
        cacheWrite: (acc.cost?.cacheWrite ?? 0) + (u.cost?.cacheWrite ?? 0),
        total: (acc.cost?.total ?? 0) + (u.cost?.total ?? 0),
      };
    }
  }
  return acc;
}

const summary = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "summary.json"), "utf8")) as {
  results: { variantId: string; totalTokens: number; totalCost: number }[];
  pairwise: { taskId: string; attempt: number; variantId: string; verdict: string }[];
  totalTokens: number;
  totalCost: number;
};

// 1) 被评侧
const evaluated = summary.results.reduce(
  (acc, r) => {
    acc.tokens += r.totalTokens ?? 0;
    acc.cost += r.totalCost ?? 0;
    if (r.variantId === "baseline") {
      acc.baseline.tokens += r.totalTokens ?? 0;
      acc.baseline.cost += r.totalCost ?? 0;
    } else {
      acc.skill.tokens += r.totalTokens ?? 0;
      acc.skill.cost += r.totalCost ?? 0;
    }
    return acc;
  },
  {
    tokens: 0,
    cost: 0,
    baseline: { tokens: 0, cost: 0 },
    skill: { tokens: 0, cost: 0 },
  },
);

// 2) 评委侧
const pwDir = path.join(RUN_DIR, "pairwise");
const groups = fs.readdirSync(pwDir).filter((d) => fs.statSync(path.join(pwDir, d)).isDirectory());
const rows: {
  group: string;
  direction: "forward" | "reversed";
  usage: Usage;
  inAggregate: boolean;
}[] = [];

for (const g of groups) {
  for (const dir of ["forward", "reversed"] as const) {
    const evPath = path.join(pwDir, g, dir, "events.json");
    if (!fs.existsSync(evPath)) continue;
    rows.push({ group: g, direction: dir, usage: extractUsage(evPath), inAggregate: dir === "forward" });
  }
}

const sum = (sel: (r: (typeof rows)[number]) => boolean) =>
  rows.filter(sel).reduce(
    (a, r) => {
      a.tokens += r.usage.totalTokens ?? 0;
      a.cost += r.usage.cost?.total ?? 0;
      a.input += r.usage.input ?? 0;
      a.output += r.usage.output ?? 0;
      a.cacheRead += r.usage.cacheRead ?? 0;
      a.cacheWrite += r.usage.cacheWrite ?? 0;
      a.reasoning += r.usage.reasoning ?? 0;
      a.n += 1;
      return a;
    },
    { tokens: 0, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, n: 0 },
  );

const all = sum(() => true);
const fwd = sum((r) => r.direction === "forward");
const rev = sum((r) => r.direction === "reversed");

const fmt = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => "$" + n.toFixed(6);

console.log("=".repeat(96));
console.log("评委侧（pairwise judge）token 与成本");
console.log("=".repeat(96));
console.log(`评委轮次总数        ${all.n}  （10 组 × forward/reversed，judgeRepeat=2）`);
console.log(`评委 token 合计     ${fmt(all.tokens)}`);
console.log(`评委成本合计        ${usd(all.cost)}`);
console.log(`  ├ 输入            ${fmt(all.input)}`);
console.log(`  ├ 输出            ${fmt(all.output)}`);
console.log(`  ├ 缓存读取        ${fmt(all.cacheRead)}`);
console.log(`  └ 缓存写入        ${fmt(all.cacheWrite)}`);
console.log();
console.log(`  forward 轮（参与主判定聚合）  ${fwd.n} 次  token ${fmt(fwd.tokens)}  ${usd(fwd.cost)}  均 ${fmt(Math.round(fwd.tokens / fwd.n))}`);
console.log(`  reversed 轮（位置偏好探测，不参与聚合） ${rev.n} 次  token ${fmt(rev.tokens)}  ${usd(rev.cost)}  均 ${fmt(Math.round(rev.tokens / rev.n))}`);
console.log();

console.log("=".repeat(96));
console.log("两侧总账");
console.log("=".repeat(96));
console.log(`被评侧（20 次 eval 运行）`);
console.log(`  baseline   ${fmt(evaluated.baseline.tokens).padStart(10)} token  ${usd(evaluated.baseline.cost)}`);
console.log(`  skill      ${fmt(evaluated.skill.tokens).padStart(10)} token  ${usd(evaluated.skill.cost)}`);
console.log(`  小计       ${fmt(evaluated.tokens).padStart(10)} token  ${usd(evaluated.cost)}`);
console.log();
console.log(`评委侧（${all.n} 次评委调用）`);
console.log(`  合计       ${fmt(all.tokens).padStart(10)} token  ${usd(all.cost)}`);
console.log();
const grand = evaluated.tokens + all.tokens;
const grandCost = evaluated.cost + all.cost;
console.log(`总计         ${fmt(grand).padStart(10)} token  ${usd(grandCost)}`);
console.log(`  被评侧占比  ${((evaluated.tokens / grand) * 100).toFixed(1)}%`);
console.log(`  评委侧占比  ${((all.tokens / grand) * 100).toFixed(1)}%`);
console.log();
console.log(`summary.json 记录的 totalTokens  ${fmt(summary.totalTokens)}  （仅被评侧，= results 累加 ${fmt(evaluated.tokens)}）`);
console.log(`summary.json 记录的 totalCost    ${usd(summary.totalCost)}  （仅被评侧，= results 累加 ${usd(evaluated.cost)}）`);
console.log(`→ 报告中的「总 token / 总成本」未含评委侧，真实开销约为其 ${(grand / evaluated.tokens).toFixed(2)} 倍`);

console.log();
console.log("=".repeat(96));
console.log("逐组明细");
console.log("=".repeat(96));
console.log(`${"组".padEnd(42)}${"方向".padEnd(11)}${"token".padStart(10)}${"成本".padStart(14)}`);
for (const r of rows.sort((a, b) => a.group.localeCompare(b.group) || a.direction.localeCompare(b.direction))) {
  console.log(
    `${r.group.padEnd(42)}${r.direction.padEnd(11)}${fmt(r.usage.totalTokens ?? 0).padStart(10)}${usd(r.usage.cost?.total ?? 0).padStart(14)}`,
  );
}
