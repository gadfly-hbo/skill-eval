# 新 session 启动 prompt

> 下面三段任选一段，贴进新 session 的第一条消息。
> 全部以 `/skill:skill-eval-flow` 开头——skill 会自动被加载。

---

## 版本 A：最简（推荐）

```
/skill:skill-eval-flow
```

**能跑的前提**：待测 skill 已经在 `~/Dev/Projects/skill-eval/pending/` 里。
（如果不在，agent 会告诉你往哪放。）

---

## 版本 B：显式指定路径

```
/skill:skill-eval-flow ~/Dev/Projects/skill-eval/pending/deep-research/SKILL.md
```

适合明确知道要测哪个 skill 的情况。

---

## 版本 C：带上下文（首次测评建议用）

```
/skill:skill-eval-flow

这是本项目的首次 skill 测评，目标 skill 是 deep-research（已在 pending/ 里）。

几点说明：
1. 套件请你按 references/suite-design.md 的规范自动生成，重点是断言要有区分度——
   不要写「模型本来就会做的事」，否则测出来的增益是假的
2. 全自动跑完，不要中途问我要不要开始
3. 跑完把报告给我；如果没通过，把第 8 节的优化建议讲清楚：
   首要问题是什么、哪类失败最多、具体改哪条约束
4. 评估目录用 ~/.skill-eval/pi-home 做 pi 隔离 HOME
```

---

## 启动后会发生什么

| 阶段 | 做什么 | 你需要做什么 |
| --- | --- | --- |
| S0 | 查 `pending/` 自动发现待测 skill | 不用管 |
| S1 | 环境自检（pi 隔离 HOME、node 版本） | 不用管 |
| S2 | **自动生成套件**（读 suite-design.md 提取契约） | 不用管 |
| S3 | 跑对照实验（baseline vs skill），2–10 分钟 | 等着就行 |
| S4 | 解读报告 + 传达优化建议 | 读结论 |
| S5 | 通过则归档，并从 `pending/` 移出该 skill | 不用管 |

**会回头问你的情况**（只有这两种）：

- `pending/` 里有**多个** skill → 问你测哪个
- 结论是「结论不足」或**增益 < 10pp** → 问你是否放行归档
  （这是真实的不确定：「归档一个没测准的 skill」比多问一句代价更大）

---

## 首次测评的预期

`pending/` 里现在有一个 **`deep-research`**（来源标记「（手动投放）」），
带 `agents/` 与 `references/` 子目录，frontmatter 里红线写得比较硬。

按这套流程跑，首轮大概会看到：

- **激活率** —— description 写得很细（列了「深度调研、行业研究、竞品分析…」等触发词），
  预期不低
- **断言增益** —— 这是关键。deep-research 的红线是「引用真实」「不冒充检索」这类，
  写断言时要对着这些红线写，别写「报告结构完整」这种模型本来就会做的事
- **耗时** —— 这个 skill 重（要检索、可能要委派子角色），
  单次运行可能到 156~317s。默认超时 480s，**别调低**

如果没通过，报告会给出四种失败模式之一的归因：
契约未落地 / 契约无效 / 约束不稳 / 未触发。照着改完再跑一轮即可。

---

## 遇到问题怎么办

| 症状 | 处理 |
| --- | --- |
| agent 说「找不到待测 skill」 | 确认文件在 `~/Dev/Projects/skill-eval/pending/<skill名>/SKILL.md` |
| 所有运行 1 秒内 failed | `--home` 没给或给错了，必须用 `~/.skill-eval/pi-home` |
| 报告里模型名是「（未记录）」 | 属正常——重生成报告时从旧报告回填，首次生成没有旧报告可回填 |
| 想看完整流程定义 | `skills/skill-eval-flow/SKILL.md` |
| 想看套件设计规范 | `skills/skill-eval-flow/references/suite-design.md` |
| 想看报告怎么读 | `docs/使用手册.md` 第 2 节 |
