---
name: skill-eval-flow
description: 一键评估一个 Agent Skill（SKILL.md）是否被模型真实激活、激活后是否带来实际增益。当用户说「评估/测评这个 skill」「跑一轮 skill 评估」「帮我测这个 SKILL.md 有没有用」时使用。编排 skill-eval CLI 完成对照实验，最终产出测评报告。
agent_created: true
---

# skill-eval-flow — Skill 评估状态机

编排 `skill-eval` CLI，把「评估一个 SKILL.md」跑成一个五状态工作流。
本 skill 只做编排：确定性检查交给脚本，实验执行交给 CLI，AI 判断只出现在两处——
生成套件（S2）与解读报告（S4）。

## 全局规则（任何状态都必须遵守）

1. **失败即数据**：单次运行失败、超时、空输出都计入分母，禁止选择性重跑。
2. **失败要留痕**：任何状态失败都保留已有产物，把报错原文呈现给用户，不静默吞掉。
3. **断言先于结果**：生成套件时不看任何运行输出，避免自证。
4. **真实运行**：所有结论必须来自真实模型调用，不用静态检查或回放冒充。

## 默认参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| 被评模型 | `minimax-cn/MiniMax-M2.7` | 便宜；用户指定则以用户为准 |
| 评委模型 | 同被评模型 | 报告会自动标注自我偏好风险 |
| repeat | 2 | 每用例重复次数 |
| judgeRepeat | 2 | 评委轮数，≥2 才有位置偏好探测 |
| pi 隔离 HOME | `~/.skill-eval/pi-home` | preflight 会自动准备 |
| 运行目录 | `~/.skill-eval/runs/<YYYYMMDD-HHmmss>-<skill名>/` | 套件、产物、报告都在这里 |

---

## S0 收集输入

从用户消息中提取：**被测 SKILL.md 路径**（必需）、模型（可选）、repeat（可选）、
用户自带套件（可选）。

- 路径缺失时用 AskUserQuestion 询问，不要猜。
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

check 通过后、进入 S3 之前，用 AskUserQuestion 确认：

- 展示套件摘要：任务数、断言总数、任务分层（典型/边界/对抗各几个）
- 展示预估调用量：`任务数 × 2 × repeat` 次模型运行 + `任务数 × repeat × judgeRepeat` 次评判
- 选项：「开始评估」/「先看看套件全文」/「取消」

用户在此前明确说过「全自动」「直接跑」「不用问我」时跳过 G1。

## S3 对照评估

```bash
skill-eval eval \
  --suite <运行目录>/suite.json \
  --skill <被测SKILL.md绝对路径> \
  --model <模型> \
  --home ~/.skill-eval/pi-home \
  --repeat <n> --judge-repeat <n> \
  --out <运行目录>
```

用 run_in_background 执行并等待完成，把 CLI 的进度输出（`[run]`/`[judge]` 行）
精简转述给用户。完成后进入 S4。

## S4 解读报告

1. 读 `<运行目录>/REPORT.md` 与 `summary.json`。
2. 用 present_files 呈现 `REPORT.md`（必须，这是最终交付物）。
3. 给用户一段不超过 15 行的解读，包含：
   - verdict（有效 / 无效 / 结论不足）及含义
   - 激活率与胜率（分母写清）
   - 断言通过率对比（baseline vs skill）
   - 分歧条数及性质（规则与评委冲突时以规则为准）
   - 下一步建议：无效 → 改 description 或断言；结论不足 → 指出是激活率还是胜率不达标

报告缺失时呈现 `summary.json` 与 cases 目录并说明异常，不伪造结论。

---

## 异常速查

| 症状 | 含义 | 处理 |
|---|---|---|
| 所有运行 1 秒内 failed，stderr 含 `broker denied delete` 或 `EEXIST ... .lock` | 宿主 IDE 的 fs hook 干扰 pi | CLI 已内置剥离逻辑；重跑 preflight 清残留锁目录后重试一次 |
| 激活率 0% 但回答质量好 | skill 的 description 没写清触发条件 | 建议用户改 description，写「什么时候该用」 |
| 胜率波动大 | repeat 或 judgeRepeat 太小 | 建议提到 repeat 3 / judgeRepeat 2 |
| verdict = 结论不足 | 激活率与胜率只达标其一 | 看报告第 4 节对照表定位是哪个不够 |
