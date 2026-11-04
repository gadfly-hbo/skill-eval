# Handoff：首个 skill 测评（新 session 用）

> 写给即将开始的首个 skill 测评 session。
> 目标：用**新流程**（待测评暂存区 + 优化建议 + 增益门槛）跑通一次完整测评。

---

## 一、一句话任务

在 `~/Dev/Projects/skill-eval/pending/` 里放一个待测 skill，然后对它跑一轮完整测评，
产出报告；通过了就归档，没通过就拿到可执行的优化建议。

---

## 二、当前状态（已核实，2026-11-04 10:53）

| 项 | 状态 |
| --- | --- |
| 仓库 | `~/Dev/Projects/skill-eval`，`origin/main` = `0247142`，工作区干净 |
| 待测评区 | `~/Dev/Projects/skill-eval/pending/` **已存在且为空** |
| 归档区 | `archive/data-analysis/1.8.0__20261101-1435`（历史产物，不动它） |
| skill 同步 | `~/.agents/skills/` 与 `~/.workbuddy/skills/` 均与仓库一致 |
| pi 隔离 HOME | `~/.skill-eval/pi-home` 已就绪（含 auth.json） |
| 测试 | 169 项全通过，typecheck 干净 |
| 示例套件 | `suites/example-suite.json`（`json-contract` 格式参考）、`examples/sample-run/`（真实跑批产物） |
| 套件规范 | `skills/skill-eval-flow/references/suite-design.md` |

**新流程的三个关键点**（与旧流程不同，别照旧习惯做）：

1. **待测评区是常驻投放入口** —— skill 文件夹可以直接拖进 `pending/`，
   不必先敲 `pending --skill` 登记。拖进来的会被自动识别（有 `SKILL.md` 就算），
   来源标为「（手动投放）」
2. **归档有三道关** —— 结论（`effective`）+ **增益 ≥ 10pp** + 不得落在 `skills/` 下
3. **报告第 8 节是优化建议** —— 没通过时会给四种失败模式的归因与改法；
   结论从原来的第 8 节顺延到第 9 节

---

## 三、操作流程

### Step 1 — 放 skill 进待测评区

把待测 skill 的**整个文件夹**拖进：

```
~/Dev/Projects/skill-eval/pending/
```

（`pending/` 里应该长这样：`pending/<skill名>/SKILL.md` + 附属文件）

确认它被识别了：

```bash
cd ~/Dev/Projects/skill-eval
node --experimental-strip-types src/cli/main.ts pending --repo . 
```

输出里应出现该 skill，来源是「（手动投放）」。

> 也可以用命令登记：`pending --repo . --skill <SKILL.md 绝对路径>`
> —— 区别是登记会**复制**一份副本（源目录不受影响），
> 而拖入的是真实目录（归档移出时会连目录一起删，本体已在 archive/ 里）。

### Step 2 — 写评估套件

**这是整个流程里唯一需要动脑的一步**，规范见
`skills/skill-eval-flow/references/suite-design.md`（必读，尤其「断言必须有区分度」）。

核心原则：**断言要针对 skill 的契约，而不是模型本来就会做的事**。

理由：阴性对照实验证明断言整体灵敏度只有 51.9% —— 27 条断言中 13 条
baseline 不装 skill 也能全过。断言写的是「模型本来就能做对」的事，
测出来的增益就是假的。

套件放 `suites/<名字>.json`，最小结构：

```json
{
  "id": "my-skill-eval",
  "name": "我的 skill 评估",
  "version": 1,
  "skill": { "path": "../pending/<skill名>/SKILL.md", "version": "<skill版本>" },
  "repeat": 2,
  "judgeRepeat": 2,
  "tasks": [
    {
      "id": "task-1",
      "prompt": "给模型的任务描述",
      "kind": "scored",
      "expectedPoints": ["..."],
      "assertions": [
        { "kind": "mustMatch", "pattern": "...", "note": "这条断言在测什么" }
      ]
    }
  ]
}
```

### Step 3 — 跑

```bash
cd ~/Dev/Projects/skill-eval
node --experimental-strip-types src/cli/main.ts eval \
  --suite suites/<名字>.json \
  --model minimax-cn/MiniMax-M3.1-Flash \
  --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash \
  --home ~/.skill-eval/pi-home \
  --repeat 2 --judge-repeat 2
```

要加自动归档就在末尾加 `--archive-to .`（评估完直接入库，一条命令搞定）

> **`--home` 必须给**，且要用 `~/.skill-eval/pi-home`——
> 否则 pi 的锁文件会和全局配置打架，所有用例 1 秒内 failed 且没有模型输出。
> 这是踩过的坑，别省。
>
> 不给 `--out` 时产物默认落在 `runs/<run-id>/`（`runs/` 已被 gitignore，不会误入版本库）。
> 想固定位置就加 `--out ~/.skill-eval/runs/<日期>-<skill名>`。

### Step 4 — 看报告

```bash
# 报告路径（runs/<run-id>/REPORT.md，或 --out 指定的位置）
cat runs/<run-id>/REPORT.md
```

**没通过时看第 8 节「优化建议」**，它按四种失败模式归类：

| 模式 | 含义 | 改法 |
| --- | --- | --- |
| 契约未落地 | baseline 稳过，装了 skill 反而失败 | 把约束从「描述」改成「可执行的硬性步骤或模板」 |
| 契约无效 | 装了 skill 也没满足 | 约束超出模型能力，或表述有歧义 |
| 约束不稳 | 同一条断言时过时不过 | 加强约束强度，或拆成多条独立断言 |
| 未触发 | 模型压根没读 skill | 改 frontmatter description，写清「什么时候该用」 |

**注意**：baseline 本来就能过的断言**不会**列进建议——那些不是 skill 的问题。

### Step 5 — 归档（通过了才做）

```bash
node --experimental-strip-types src/cli/main.ts archive \
  --run runs/<run-id> \
  --repo ~/Dev/Projects/skill-eval \
  --skill <被测SKILL.md路径>
```

成功后会：
- 把 skill 存进 `archive/<skill名>/<版本标识>/`（附属文件一起复制）
- **自动把它从 `pending/` 里移出**（`pending/` 文件夹本身保留）
- `latest.json` 记录 verdict / gainPp / lowGain / provisional

**如果被增益门拦下**（报错文案：`拒绝归档：断言增益未达标`）：
先看第 8 节的优化建议，改完 skill 再评。
确实是样本问题才加 `--allow-low-gain` 放行（会标 `lowGain=true`）。

---

## 四、给新 session 的注意事项

**别踩这些坑**（都是本轮实际踩过的）：

- **别在仓库根目录跑 `report --suite-file`** —— `cases/` 缺失时会用空报告覆盖好报告。
  现在有守卫会拒绝（退出码 1），但别去试
- **别把 `archive/` 放进 `skills/` 下** —— 会被 agent 自动扫描，污染后续评估，命令会拒绝
- **别用 `rm -rf` 清 `pending/` 或 home 下的锁目录** —— 沙箱会拦截；用 `/tmp` 下的隔离 HOME
- **默认超时 480s** —— 重量级 skill 要 156~317s，别调到 180s，会把「慢但有效」误杀成无效
- **失败、超时、空输出全部计入分母** —— 不要选择性重跑

**判定优先级**：规则断言（代码判定）> 成对评委（模型判定）。冲突时以规则为准，但分歧要记录。

**已知限制**（写报告时该标注的）：
- 评委与被评同模型存在自我偏好风险
- repeat=2 是小样本，胜率波动大时建议提到 3
- 阴性对照只在 data-analysis 一个 skill 家族验证过
- 优化建议是规则归类，不生成具体改写文本

---

## 五、想深入了解时

| 想知道 | 看哪 |
| --- | --- |
| 完整流程状态机 | `skills/skill-eval-flow/SKILL.md` |
| 套件怎么写 | `skills/skill-eval-flow/references/suite-design.md` |
| 命令参数 | `node --experimental-strip-types src/cli/main.ts --help` |
| 报告怎么读 | `docs/使用手册.md` 第 2 节 |
| 判定怎么下 | `docs/使用手册.md` 第 3 节 |
| 阴性对照实验 | `experiments/negative-control-2026-11-01/阴性对照验证报告.md` |

---

## 六、一句话启动语（贴给新 session）

```
用 skill-eval 流程评估这个 skill：~/Dev/Projects/skill-eval/pending/<skill名>/SKILL.md
套件写在 suites/<名字>.json，先按 suite-design.md 的规范设计断言
```
