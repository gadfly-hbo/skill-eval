# Handoff：首个 skill 测评（新 session 用）

> 写给即将开始的首个 skill 测评 session。
> 目标：用**两步**跑通一次完整测评。

---

## 一、启动 prompt（贴给新 session 的第一条消息）

三选一。**推荐版本 C**（首次测评，信息全一点）。

**A. 最简**
```
/skill:skill-eval-flow
```

**B. 显式路径**
```
/skill:skill-eval-flow ~/Dev/Projects/skill-eval/pending/deep-research/SKILL.md
```

**C. 带上下文（首次测评建议）**
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

## 二、用户视角：只有两步

**第 1 步**：把待测 skill 的**整个文件夹**拖进

```
~/Dev/Projects/skill-eval/pending/
```

**第 2 步**：调用 skill-eval-flow（就是上面那条启动 prompt）

**就这样。** 套件生成、环境自检、跑批、归档、报告解读全在流程内部自动完成——
用户不用写套件、不用敲命令、不用指定模型。

> 唯一会回头问用户的情况：`pending/` 里有**多个** skill 时，
> agent 会列出来问要评哪个。

---

## 三、当前状态（已核实，2026-11-04 11:05）

| 项 | 状态 |
| --- | --- |
| 仓库 | `~/Dev/Projects/skill-eval`，`origin/main` = `f5651f6`，工作区干净 |
| 待测评区 | `~/Dev/Projects/skill-eval/pending/` 存在，**已有 1 个 skill 待测** |
| 待测 skill | `deep-research`（来源「（手动投放）」，带 `agents/` 与 `references/`） |
| 归档区 | `archive/data-analysis/1.8.0__20261101-1435`（历史产物，不动它） |
| skill 同步 | `~/.agents/skills/` 与 `~/.workbuddy/skills/` 与仓库一致 |
| 全局命令 | `skill-eval` 已 npm link，任意 cwd 都能定位待测评区 |
| pi 隔离 HOME | `~/.skill-eval/pi-home` 已就绪（含 auth.json） |
| preflight | 实测 `PREFLIGHT_OK`（node / CLI / pi / 隔离 HOME 四项全过） |
| 测试 | 186 项全通过，typecheck 干净 |

---

## 四、给新 session 的执行要点

### 自动发现待测 skill

```bash
skill-eval pending --json
```

`skills[].skillPath` 就是待测 SKILL.md 的绝对路径。

- 只有一个 skill → 直接用
- 多个 → 列清单问用户（AskUserQuestion）
- 空的 → 告诉用户往 `pending/` 里放，并给出绝对路径，终止

**不用指定 `--repo`** —— CLI 会依次尝试：`SKILL_EVAL_REPO` 环境变量 →
cwd 向上探测 → 从 skill-eval 自身安装位置反推。
新 session 的 cwd 是会话工作区不是 skill-eval 仓库，第三层兜底能保证找得到。

### 流程内部会做的事

| 阶段 | 做什么 | 需要用户 |
| --- | --- | --- |
| S0 | 发现待测 skill（查 pending） | 否 |
| S1 | 环境自检（preflight.sh） | 否 |
| S2 | **自动生成套件**（读 suite-design.md 提取契约） | 否 |
| G1 | 花钱前确认 | **默认跳过** |
| S3 | 跑对照实验（2–10 分钟） | 否 |
| S4 | 解读报告 + 传达优化建议 | 否 |
| S5 | 归档 + 从 pending 移出 | 仅 inconclusive 时问 |

**G1 门控默认跳过** —— 用户调用这个 skill 就表达了运行意图，再问一次是多余的一步。
只在预估调用量超 30 次模型运行、用户说过「先看套件」、或本轮已问过用户时才问。

**G2/G3 仍会问**（inconclusive 或增益不足）—— 那是真实的不确定，
「归档一个没测准的 skill」比「多问一句」代价更大。

### 命令（agent 内部执行）

```bash
cd ~/Dev/Projects/skill-eval

skill-eval eval \
  --suite <运行目录>/suite.json \
  --skill <待测SKILL.md绝对路径> \
  --model minimax-cn/MiniMax-M3.1-Flash \
  --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash \
  --home ~/.skill-eval/pi-home \
  --repeat 2 --judge-repeat 2 \
  --out <运行目录>
```

---

## 五、报告怎么读

**没通过时看第 8 节「优化建议」**，它按四种失败模式归类：

| 模式 | 含义 | 改法 |
| --- | --- | --- |
| 契约未落地 | baseline 稳过，装了 skill 反而失败 | 把约束从「描述」改成「可执行的硬性步骤或模板」 |
| 契约无效 | 装了 skill 也没满足 | 约束超出模型能力，或表述有歧义 |
| 约束不稳 | 同一条断言时过时不过 | 加强约束强度，或拆成多条独立断言 |
| 未触发 | 模型压根没读 skill | 改 frontmatter description，写清「什么时候该用」 |

**注意**：baseline 本来就能过的断言**不会**列进建议——那些不是 skill 的问题。

**传达优化建议时必须包含**：首要问题是什么、哪类失败最多、
具体改哪条约束（引用报告里的断言说明）、二次测评的注意事项
（保持同一套件与模型，只改 skill 内容）。

---

## 六、别踩这些坑（都是实际踩过的）

- **`--home` 必须给**，且用 `~/.skill-eval/pi-home`——不给的话 pi 锁文件跟全局配置
  打架，所有用例 1 秒内 failed 且没有模型输出
- **别在仓库根目录跑 `report --suite-file`** —— `cases/` 缺失时会用空报告覆盖好报告。
  现在有守卫会拒绝（退出码 1），但别去试
- **别把 `archive/` 放进 `skills/` 下** —— 会被 agent 自动扫描，污染后续评估
- **别用 `rm -rf` 清 `pending/` 或 home 下的锁目录** —— 沙箱会拦截
- **默认超时 480s** —— deep-research 这类重 skill 可能要 156~317s，别调到 180s
- **失败、超时、空输出全部计入分母** —— 不要选择性重跑
- **判定优先级**：规则断言 > 成对评委。冲突时以规则为准，但分歧要记录

**已知限制**（写报告时该标注的）：
- 评委与被评同模型存在自我偏好风险
- repeat=2 是小样本，胜率波动大时建议提到 3
- 阴性对照只在 data-analysis 一个 skill 家族验证过
- 优化建议是规则归类，不生成具体改写文本

---

## 七、想深入了解时

| 想知道 | 看哪 |
| --- | --- |
| 完整流程状态机 | `skills/skill-eval-flow/SKILL.md` |
| 套件怎么写 | `skills/skill-eval-flow/references/suite-design.md` |
| 启动 prompt 完整版 | `docs/启动prompt-新session.md` |
| 命令参数 | `skill-eval --help` |
| 报告怎么读 | `docs/使用手册.md` 第 2 节 |
| 判定怎么下 | `docs/使用手册.md` 第 3 节 |
| 阴性对照实验 | `experiments/negative-control-2026-11-01/阴性对照验证报告.md` |
