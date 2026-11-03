---
name: skill-eval-flow
description: 一键评估一个 Agent Skill（SKILL.md）是否被模型真实激活、激活后是否带来实际增益。当用户说「评估/测评这个 skill」「跑一轮 skill 评估」「帮我测这个 SKILL.md 有没有用」时使用。编排 skill-eval CLI 完成对照实验，最终产出测评报告。
agent_created: true
---

# skill-eval-flow — Skill 评估状态机

编排 `skill-eval` CLI，把「评估一个 SKILL.md」跑成一个五状态工作流。
本 skill 只做编排：确定性检查交给脚本，实验执行交给 CLI，AI 判断只出现在两处——
生成套件（S2）与解读报告（S4）。

## 环境适配（先读）

本 skill 遵循 Agent Skills 规范，可被任何实现了该规范的 agent 加载。
指令中出现的宿主能力名按以下规则降级：

| 指令中的能力 | WorkBuddy | 其他 agent |
|---|---|---|
| 询问用户 | `AskUserQuestion` 工具 | 直接用自然语言向用户提问，等待回答 |
| 后台执行长命令 | `run_in_background` | 前台执行并等待（评估全程 2–10 分钟） |
| 呈现报告文件 | `present_files` | 在回复中给出报告文件的绝对路径 |

不确定宿主是否支持某能力时，选降级方案，不要因为工具不存在而中断流程。

## 全局规则（任何状态都必须遵守）

1. **失败即数据**：单次运行失败、超时、空输出都计入分母，禁止选择性重跑。
2. **失败要留痕**：任何状态失败都保留已有产物，把报错原文呈现给用户，不静默吞掉。
3. **断言先于结果**：生成套件时不看任何运行输出，避免自证。
4. **真实运行**：所有结论必须来自真实模型调用，不用静态检查或回放冒充。

## 默认参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` | 用户指定则以用户为准 |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` | 与被评模型不同 provider，避免自我偏好 |
| repeat | 2 | 每用例重复次数 |
| judgeRepeat | 2 | 评委轮数，≥2 才有位置偏好探测 |
| pi 隔离 HOME | `~/.skill-eval/pi-home` | preflight 会自动准备 |
| 运行目录 | `~/.skill-eval/runs/<YYYYMMDD-HHmmss>-<skill名>/` | 套件、产物、报告都在这里 |
| 归档仓库 | 评估所在项目的 git 仓库根目录 | 通过 `skills/` + `package.json` 探测，也可用 `--repo` 指定 |
| 归档根目录 | `<仓库>/archive/` | 必须在 `skills/` 之外，否则会被 agent 自动扫描 |

---

## S0 收集输入

从用户消息中提取：**被测 SKILL.md 路径**（必需）、模型（可选）、repeat（可选）、
用户自带套件（可选）。

- 路径缺失时询问用户（WorkBuddy 用 AskUserQuestion），不要猜。
- 路径存在性立即验证；不存在则报错终止，不进入下一状态。
- 模型、repeat 未给时用默认值，不回问。

产出：一份参数清单，进入 S1。

## S1 环境自检

执行 `scripts/preflight.sh`（相对本 skill 目录）：

```bash
bash <本skill目录>/scripts/preflight.sh
```

脚本检查：node ≥ 22、`skill-eval` 在 PATH、`pi` 可用、pi 隔离 HOME 就绪
（缺失时自动创建并从 `~/.pi/agent/` 复制认证文件、清理残留 `*.lock` 目录）。

- 退出码 0 → 进入 S2。
- 退出码非 0 → 按脚本输出的提示修复后重试 1 次；仍失败则把脚本报错原文给用户，终止。
- pi 未认证（`~/.pi/agent/auth.json` 不存在）不可自动修复：提示用户先运行一次 pi 完成认证，终止。

## S2 套件就绪

分两路：

- **用户自带套件** → 直接 `skill-eval check --suite <路径>`。
- **需要生成** → 先读 `references/suite-design.md`（相对本 skill 目录），严格按其规范
  从被测 SKILL.md 提取契约并生成 3–5 个任务，写入 `<运行目录>/suite.json`，再跑 check。

```bash
skill-eval check --suite <运行目录>/suite.json
```

check 不通过 → 按报错修正后重新生成，最多 2 次；仍不通过则把校验报错给用户，转人工。

### G1 门控（花钱前确认）

check 通过后、进入 S3 之前，向用户确认（WorkBuddy 用 AskUserQuestion）：

- 展示套件摘要：任务数、断言总数、任务分层（典型/边界/对抗各几个）
- 展示预估调用量：`任务数 × 2 × repeat` 次模型运行 + `任务数 × repeat × judgeRepeat` 次评判
- 选项：「开始评估」/「先看看套件全文」/「取消」

用户在此前明确说过「全自动」「直接跑」「不用问我」时跳过 G1。

## S3 对照评估

```bash
skill-eval eval \
  --suite <运行目录>/suite.json \
  --skill <被测SKILL.md绝对路径> \
  --model <被评模型> \
  --judge-model <评委模型> \
  --home ~/.skill-eval/pi-home \
  --repeat <n> --judge-repeat <n> \
  --out <运行目录>
```

后台执行并等待完成（WorkBuddy 用 run_in_background；其他 agent 前台等待即可），
把 CLI 的进度输出（`[run]`/`[judge]` 行）精简转述给用户。完成后进入 S4。

## S4 解读报告

1. 读 `<运行目录>/REPORT.md` 与 `summary.json`。
2. 呈现 `REPORT.md`（WorkBuddy 用 present_files；其他 agent 在回复中给出绝对路径）。这是最终交付物。
3. 给用户一段不超过 15 行的解读，包含：
   - verdict（有效 / 无效 / 结论不足）及含义
   - 激活率与胜率（分母写清）
   - 断言通过率对比（baseline vs skill）
   - 分歧条数及性质（规则与评委冲突时以规则为准）
   - 下一步建议：无效 → 改 description 或断言；结论不足 → 指出是激活率还是胜率不达标

报告缺失时呈现 `summary.json` 与 cases 目录并说明异常，不伪造结论。

## S5 归档（verdict 有效时）

评估结论为 `effective` 时，把这份通过测评的 skill 快照存进项目仓库。

### G2 门控（花钱后确认）

先看 verdict：

- `effective` → 继续归档
- `inconclusive` → 询问用户是否放行（放行会标记 `provisional=true`）；用户不明确就跳过归档
- `ineffective` → **不归档**，告知用户被证伪的 skill 不进归档区

用户在本轮明确说过「全自动」「不用问」时跳过 G2。

### 执行归档

```bash
skill-eval archive \
  --run <运行目录> \
  --skill <被测SKILL.md绝对路径> \
  --repo <项目仓库路径> \
  [--suite <套件id> --suite-version <版本> --skill-version <版本>]
```

`--run` 是主入口——归档必须绑定某一次评估的产物，只给 skill 路径无法确定对应的
verdict 与内容哈希。CLI 会自行从运行产物反推 skill 路径，`--skill` 可省略。

产出结构：

```
archive/<skill名>/
  <版本标识>/          # 版本标识 = <frontmatter版本>__<时间戳>
    SKILL.md           # skill 本体快照
    references/ scripts/   # 附属文件一并复制（缺了 skill 跑不起来）
    ARCHIVE.md         # 元信息卡：哈希、模型、结论、复现命令
    REPORT.md          # 评估报告副本，使归档目录自包含
  latest.json          # 当前版本指针
```

要点：

- **版本标识**默认取 frontmatter 的 `version` 字段 + 时间戳（如 `1.8.0__20261103-2303`）；
  frontmatter 没写版本则退化为纯时间戳
- **幂等**：内容哈希相同则跳过，不产生重复归档
- **不改原文件**：只读复制，绝不修改被测 skill
- **不自动 commit**：归档后把变更摘要告诉用户，由用户决定是否提交

归档完成后向用户汇报：归档路径、版本标识、内容哈希、复制文件数。

---

## 异常速查

| 症状 | 含义 | 处理 |
|---|---|---|
| 所有运行 1 秒内 failed，stderr 含 `broker denied delete` 或 `EEXIST ... .lock` | 宿主 IDE 的 fs hook 干扰 pi | CLI 已内置剥离逻辑；重跑 preflight 清残留锁目录后重试一次 |
| 激活率 0% 但回答质量好 | skill 的 description 没写清触发条件 | 建议用户改 description，写「什么时候该用」 |
| 胜率波动大 | repeat 或 judgeRepeat 太小 | 建议提到 repeat 3 / judgeRepeat 2 |
| verdict = 结论不足 | 激活率与胜率只达标其一 | 看报告第 4 节对照表定位是哪个不够 |
| 重量级 skill 的运行被判 failed | 触发了超时（默认 480s），不是 skill 无效 | 用 `--timeout` 调大重跑；报告中必须标注「超时」而非「无效」 |
| 断言通过率很高但增益很低 | 断言写的是模型本来就会做的事，无区分度 | 用阴性对照定位哪些断言 baseline 也能过，见下节 |
| 归档报「拒绝归档：评估结论为无效」 | 该 skill 被证伪，不应进归档区 | 正常行为，不重试。改 description 后重新评估 |
| 归档报「位于 skills/ 下」 | 归档目标会被 agent 自动扫描，污染后续评估 | 换 `--archive-root` 到仓库的 `archive/` 目录 |
| 归档后 git 里有大量二进制/大文件 | 被测 skill 含大体积附属文件 | 确认是否该入版本库；必要时在 `.gitignore` 排除特定子目录 |

---

## 阴性对照（可选，验证工具可信度）

当用户问「这个工具测出来的结论可信吗」「skill-eval 能区分好坏 skill 吗」，
或用户对某次评估结果高度怀疑时，执行阴性对照实验。

**原理**：Agent Skill 的文本可二分——**触发契约**（frontmatter 的 description，决定何时该用）
与**行为契约**（正文的行为约束/输出格式/红线，决定用了之后该长什么样）。
只剥离行为契约、保留触发契约后重跑：

- 若断言通过率**回落至 baseline 水平** → 断言确实在度量 skill 的契约，测出的增益是真实的
- 若仍**接近原版水平** → 工具无区分能力，此前结论不可信

**做法**：

1. 复制被测 SKILL.md，删掉行为契约部分（红线、输出格式、流程、参考文档），
   **保留** frontmatter 触发词与 description 的触发信号
2. 用**同一套件**（断言一条不改）指向破坏版 skill 跑一轮
3. 破坏版必须仍保持**高激活率**（接近 100%）——否则说明连触发契约也被剥掉了，实验无效
4. 三组数据并列判定：

```bash
node --experimental-strip-types <仓库>/scripts/negative-control-compare.ts \
  --original <原版run-dir> --broken <破坏版run-dir>
```

**判定阈值**：原版增益 ≥ 10pp 且破坏版增益 < 10pp → 工具具备区分能力。

**注意**：破坏版残留的少量增益是正常的——模型在有 skill 提示后会自发守纪律更多。
关键是**没有假阳性**，即不存在「破坏版通过但原版不通过」的断言。
