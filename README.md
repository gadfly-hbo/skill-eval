# skill-eval

独立评估 Agent Skill（`SKILL.md`）的实际价值：不是看它写得好不好，而是**测它是否真被激活、激活后是否真让输出变好**。

本仓库提供一条可复现的对照实验流水线：

```
baseline（不装 skill）  ┐
                        ├─→ 同一任务 · 同一模型 · 重复 N 次 → pairwise judge → 规则断言 → 报告
variant（装 skill）     ┘
```

## 核心方法

评估一个 skill 要同时回答三个问题，缺一不可：

| 问题 | 测量方式 | 失败意味着 |
| --- | --- | --- |
| **是否被激活** | 事件流工具调用 + 输出关键词双重取证 | skill 写得再漂亮，不被触发就是死代码 |
| **激活后是否更好** | 与 baseline 成对比较，模型评委给 win/tie/loss | skill 只是让回答更长 |
| **是否稳定有效** | 重复运行后的激活率与胜率分布 | 一次侥幸赢不算有效 |

关键约束：

- **对照隔离**。baseline 与 variant 使用独立工作目录与独立会话，互不污染。
- **同源同参**。两侧模型、任务、重复次数完全一致，唯一变量是是否加载 skill。
- **判定分层**。规则断言（客观、可复算）优先于模型评委（主观）；两者不一致时以规则为准并记录分歧。
- **证据留痕**。每次运行的完整事件流、输出、usage 均落盘，可复核可回放。
- **失败保留**。崩溃、超时、判失败都计入分母，不做选择性重跑。

## 快速开始

```bash
npm install
npm run check                    # 类型检查 + 单元测试

# 跑一个真实评估（需要本机 pi CLI 且已配置模型）
npm run eval -- eval \
  --suite suites/example-suite.json \
  --skill path/to/skill/SKILL.md \
  --model minimax-cn/MiniMax-M3.1-Flash \
  --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash \
  --repeat 3 \
  --out runs/exp-001
```

### pi 配置隔离

pi CLI 会用 `~/.pi/agent/` 下的锁文件，且并发运行会争用。评估时建议用隔离 HOME：

```bash
bash scripts/setup-pi-home.sh      # 默认建在 ~/.skill-eval/pi-home

npm run eval -- eval --suite ... --home ~/.skill-eval/pi-home
```

### 常用命令

```bash
# 只校验套件结构，不调用模型
npm run eval -- check --suite suites/example-suite.json

# 从原始产物重算并重新生成报告（汇总逻辑修正后用这个）
npm run eval -- report --run runs/exp-001 --suite-file suites/example-suite.json

# 把通过测评的 skill 快照存进仓库 archive/
npm run eval -- archive --run runs/exp-001 --repo .

# 一条命令跑完直接入库：评估 + 归档
npm run eval -- eval --suite suites/example-suite.json --model <被评模型> --archive-to .

# 查看回归门禁阈值
npm run eval -- threshold
```

## 仓库结构

```text
src/
├── core/          评估内核（无业务耦合，可单测）
│   ├── runner.ts        对照实验编排
│   ├── activation.ts    激活检测（工具取证 + 关键词取证）
│   ├── judge.ts         成对评委与多轮聚合
│   ├── assertions.ts    规则断言判定
│   ├── efc.ts           反馈效率 EFC 评分
│   ├── regression.ts    回归门禁
│   ├── archive.ts       通过测评的 skill 归档
│   └── pi.ts            pi CLI 适配层
├── cli/           命令行入口
└── report/        Markdown 报告生成
schemas/           JSON Schema（套件定义、运行结果）
suites/            评估套件定义
skills/            工具自身的 skill（skill-eval-flow）
archive/           通过测评的 skill 快照（版本化存档）
examples/          示例 skill、示例套件、参考报告
governance/        治理记录（方法来源、角色与模式变更）
```

## 示例

`examples/sample-run/REPORT.md` 是一份真实运行产出的报告（`minimax-cn/MiniMax-M2.7`，3 用例 × 2 变体 × 2 重复）：

| 指标 | baseline | 装 skill 后 |
| --- | --- | --- |
| 激活率 | — | 100% |
| 断言通过率 | 0% | 100% |
| 胜率 | — | 66.7% |
| 平均耗时 | 12.3s | 10.1s |

典型证据：baseline 把 `answer` 写成嵌套对象（违反契约），装 skill 后稳定输出 `{"answer": "...", "confidence": 0.86}` 扁平契约——而且**更快更省 token**。

## 与其他仓库的关系

- `~/Dev/Projects/agent-eval`：评测**数据与决策 Agent** 的完整治理范式（方案→执行→审核分离、证据层级、独立性声明）。本仓库借鉴其治理严谨性。
- `~/Dev/Projects/pi-xanthil`：已有生产级 skill 评估实现（`server/src/skill-evaluation-*.ts`）。本仓库移植其核心方法并剥离产品耦合，作为独立、可复用的评估工具。

方法来源与取舍见 [governance/方法来源.md](governance/方法来源.md)。

## 工作规则

见 [AGENTS.md](AGENTS.md)。
