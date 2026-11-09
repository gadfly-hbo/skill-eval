import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
  const section = skill.split("### 二次测评：优先复用仓库里已有的套件")[1]?.split("### 判据冻结纪律")[0];
  assert.ok(section);
  assert.match(section, /同一计划复评时复用原冻结版本和哈希/);
  assert.match(section, /新计划，先筛出与候选路径及题数相符的版本，再按整数 `N` 选择最高版本/);
  assert.match(section, /v1\/v2\/v3\/v4 同时匹配时，新计划选 v4/);
});

test("测评流程分开匿名换位、评委冲突、计分分母和补充诊断", () => {
  const skill = readFileSync(new URL("../../skills/skill-eval-flow/SKILL.md", import.meta.url), "utf8");
  const section = skill.split("## S4 解读报告")[1]?.split("## S5 ")[0];
  assert.ok(section);
  assert.match(section, /`winRate`.*`ruleAdjustedWinRate`.*`scoredJudged`/);
  assert.match(section, /`rawVerdict` 只表示匿名展示时 B 相对 A 的结果/);
  assert.match(section, /`rawVerdict: "win"`、`swapped: true`、`verdict: "loss"`、`labelConflict: null`.*未发生标签冲突/);
  assert.match(section, /仅将 `pairwise\[\]\.judgeRuns\[\]` 中非空的 `labelConflict` 计作标签冲突/);
  assert.match(section, /分歧 7 处、从 2\/8 降到 0\/8 时，报告 7 处分歧和 2 次移除，分别列数/);
  assert.match(section, /正向激活和负向误触发，各列命中数\/相应的运行数/);
  assert.match(section, /断言条目通过率，写明通过数\/条目数及计分或诊断范围/);
  assert.match(section, /确认 Skill 需要修改时.*转交 OptraCall.*失败证据、修改的文件或段落、改成什么行为、用哪条断言或用例验收/);
  assert.match(section, /只有证据确认候选违反要求时，才给 Skill 改写建议/);
  assert.match(section, /冻结用例指定文件时，核对其相对路径和 `deliverable\.md` 评分副本，否则核对 `output\.md`/);
  assert.match(section, /引用状态行的实际位置及冻结要求，分别说明文件存在、位置合规和正文满足契约的证据/);
  assert.match(section, /补充诊断单列输入、是否含诊断题和通过数\/断言条目数/);
  assert.match(section, /归因仍需候选违反冻结要求的证据/);
});

test("正式测评使用固化口径，原样交付故障并把改写建议限于已核实的候选问题", () => {
  const skill = readFileSync(new URL("../../skills/skill-eval-flow/SKILL.md", import.meta.url), "utf8");
  const scope = skill.split("### 正式测评边界")[1]?.split("## 用户怎么用")[0];
  assert.ok(scope);
  assert.match(scope, /正式分数与判定以固化版本生成的报告为准/);
  assert.match(scope, /Qoder 只评价被测 Skill/);
  assert.match(scope, /不得质疑或修改测评器、替换冻结判据、另行计分或自行重跑/);
  assert.match(scope, /测评器复盘和升级单独授权/);
  assert.match(scope, /原样报告命令退出状态、错误和证据路径/);
  assert.match(skill, /已选的现有套件校验不通过 → 保留错误并停止/);
  assert.match(skill, /收到修订版并获得新运行授权后，按原冻结口径复测/);
  assert.doesNotMatch(skill, /改用源码直跑|确认题集误判后另存新版|不通过 → 按报错修正后重新生成/);
});

test("正式测评只静态审阅候选检查脚本，直接交付原生报告", () => {
  const flow = new URL("../../skills/skill-eval-flow/", import.meta.url);
  const skill = readFileSync(new URL("SKILL.md", flow), "utf8");
  assert.doesNotMatch(skill, /S3\.5|run-gate\.sh|gate-report\.md/);
  assert.equal(existsSync(new URL("scripts/run-gate.sh", flow)), false);
  assert.match(skill, /Qoder 对候选文件的直接操作限于静态审阅，包括候选自带的检查脚本/);
  assert.match(skill, /完成后进入 S4/);
  assert.match(skill, /读 `<运行目录>\/REPORT\.md` 与 `summary\.json`/);
  assert.match(skill, /呈现 `REPORT\.md`/);
});
