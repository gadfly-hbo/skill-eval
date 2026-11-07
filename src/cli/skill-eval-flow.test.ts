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
