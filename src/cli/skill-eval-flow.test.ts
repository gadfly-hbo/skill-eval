import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { evaluateAssertion } from "../core/assertions.ts";
import { checkSuite, loadSuite } from "../core/suite.ts";

test("decision-review v2 从公式提取答复行末的客单价", () => {
  const suitePath = fileURLToPath(new URL("../../suites/decision-review-v2.json", import.meta.url));
  const suite = loadSuite(suitePath);
  assert.equal(suite.version, "2");
  assert.equal(checkSuite(suite).valid, true);
  const task = suite.tasks.find(item => item.id === "pure-data-query-misfire");
  assert.equal(task?.kind, "diagnostic");
  assert.equal(task?.shouldActivate, false);
  const numeric = task?.assertions?.find(item => item.kind === "numeric");
  assert.ok(numeric);

  const accepted = [
    "客单价 = 销售额 ÷ 订单数 = 126,000 ÷ 420 = **300 元/单**。",
    "客单价 = 126,000 元 ÷ 420 单 = **300 元/单**\n\n计算口径为昨天的成交订单。",
    "**客单价 ≈ 300 元/单**\n\n计算：126,000 元 ÷ 420 单。",
    "客单价：**300 元/单**",
    "客单价 **300** 元/单",
    "客单价300元",
    "300 元/单",
    "300",
  ];
  for (const output of accepted) {
    assert.equal(evaluateAssertion(output, numeric).passed, true, output);
  }

  const rejected = [
    "客单价 = 126,000 元 ÷ 420 单",
    "客单价 = 126,000 ÷ 300",
    "客单价 = 300 元 × 2 = 600 元/单",
    "客单价 = 300,000 元 ÷ 420 单 = 714.29 元/单。",
    "客单价 = 126,000 ÷ 420 = **301 元/单**。",
    "客单价 = -300 元/单",
    "客单价 = 3000 元/单",
  ];
  for (const output of rejected) {
    assert.equal(evaluateAssertion(output, numeric).passed, false, output);
  }
});

test("测评流程的宿主问答覆盖三种档位各自的消融选项", () => {
  const skill = readFileSync(new URL("../../skills/skill-eval-flow/SKILL.md", import.meta.url), "utf8");
  const section = skill.split("### 0.2 选择档位和消融")[1]?.split("## S1 ")[0];
  const payload = section?.match(/```json\n([\s\S]+?)\n```/)?.[1];
  assert.ok(payload);
  const { questions } = JSON.parse(payload) as {
    questions: Array<{ header: string; options: Array<{ label: string }> }>;
  };
  assert.deepEqual(questions.map(question => question.header), ["测评档位", "消融"]);
  const [tier, ablation] = questions;
  assert.ok(tier && ablation);
  assert.deepEqual(tier.options.map(option => option.label), ["高", "中", "低"]);
  assert.deepEqual(ablation.options.map(option => option.label), ["增加", "不增加"]);
});

test("测评流程仅为兼容的新计划选最新版题集，复评核对冻结版本和哈希", () => {
  const skill = readFileSync(new URL("../../skills/skill-eval-flow/SKILL.md", import.meta.url), "utf8");
  const section = skill.split("### 二次测评：优先复用仓库里已有的套件")[1]?.split("### 断言修订纪律")[0];
  assert.ok(section);
  assert.match(section, /同一计划复评时复用原冻结版本和哈希/);
  assert.match(section, /新计划，先筛出与候选路径及题数相符的版本，再按整数 `N` 选择最高版本/);
  assert.match(section, /v1\/v2\/v3 同时匹配时，新计划选 v3/);
});

test("测评流程分开匿名换位、评委冲突、计分分母和补充诊断", () => {
  const skill = readFileSync(new URL("../../skills/skill-eval-flow/SKILL.md", import.meta.url), "utf8");
  const section = skill.split("## S4 解读报告")[1]?.split("## S5 ")[0];
  assert.ok(section);
  assert.match(section, /`winRate`.*`ruleAdjustedWinRate`.*`scoredJudged`/);
  assert.match(section, /`rawVerdict` 只表示匿名展示时 B 相对 A 的结果/);
  assert.match(section, /`rawVerdict: "win"`、`swapped: true`、`verdict: "loss"`、`labelConflict: null`.*未发生标签冲突/);
  assert.match(section, /仅将 `pairwise\[\]\.judgeRuns\[\]` 中非空的 `labelConflict` 计作标签冲突/);
  assert.match(section, /正向激活和负向误触发，各列命中数\/相应的运行数/);
  assert.match(section, /断言条目通过率，写明通过数\/条目数及计分或诊断范围/);
  assert.match(section, /原始输出符合行为契约而断言失败时.*另存新版并离线复验/);
  assert.match(skill, /补充诊断单列输入、是否含诊断题和通过数\/断言条目数/);
  assert.match(skill, /不能单独确定首要原因或排除题集、候选问题/);
});
