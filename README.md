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

## 当前判定策略与历史记录

可信度修复使用 `paired-task-v2` 策略：运行前冻结完整 skill 包、任务与运行矩阵；归档只接受内容身份一致的冻结快照。
真实运行目前要求 macOS `sandbox-exec`，每次调用先执行本地访问探针；缺少隔离后端或探针失败会阻止启动，不回退到未隔离执行。

显著性推断以**任务簇**为单位：任务内先平均配对重复，任务间等权，使用保守的 95% Hoeffding 区间（假设任务之间独立）。
断言条目累计率仍展示为描述指标；复制断言或增加同任务的重复次数都不会增加独立样本数。
小套件可能得到 `inconclusive`，不应通过复制题目或放宽门槛制造显著性。

`report` 将复核保存到 `analyses/<analysis-id>/`，保留来源和判据指纹，不覆盖原报告与摘要。
已有实验与归档属于各自原判据下的历史记录，下面的历史数字未追溯修改；
缺少冻结清单、访问隔离证据或明确评委协议的旧运行，在新策略复核中标为未验证，不能借给当前候选归档（`--force` 也不能替换身份）。

本次修复、回归覆盖及未验证项见 [离线修复验证记录](docs/离线修复验证-2026-11-06.md)。

## 快速开始

```bash
npm install
npm run check                    # 类型检查 + 单元测试

# 另行授权后跑两题受控冒烟（需要本机 Pi SDK 和模型配置）
npm run eval -- eval \
  --suite suites/controlled-example.json \
  --skill examples/json-contract-skill/SKILL.md \
  --model minimax-cn/MiniMax-M3.1-Flash \
  --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash \
  --repeat 1 --judge-repeat 2 \
  --out runs/exp-001
```

### 离线模型预检

```bash
npm run eval -- preflight \
  --model minimax-cn/MiniMax-M3.1-Flash \
  --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash \
  --home ~/.skill-eval/pi-home
```

预检在禁止网络与文件写入的进程中复用 Pi SDK，将内置目录、动态缓存和 `models.json` 合并后，精确查询 `provider/id`。它不运行 pi CLI，不读取认证文件，不刷新鉴权或模型缓存，也不接受模糊匹配/备用型号。`eval` 在建立运行目录前执行同样的检查。

`LOCAL_MODEL_IDENTITIES_CONFIRMED` 仅表示本地模型身份可解析，远端权限、模型修订、计费配额与真实调用授权仍未验证。端点摘要会移除 URL 凭证、查询串和片段，并以 `baseUrlRedacted` 标明；它不构成远端路由验证。

本次内置目录漏检的修正与离线验证见 [模型预检更正记录](docs/模型预检更正-2026-11-06.md)；原冻结包及历史判定保留。

### 一套编排，一层受控执行

真实执行统一使用上面的 `eval`：原 `runner` 负责 B/P、断言、匿名双轮评委和报告，共享受控层负责每次 HTTP 的预留、usage 结算、OS 隔离及首次失败取证。当前成本配置固定被评模型 `minimax-cn/MiniMax-M3.1-Flash`、评委 `xiaomi-token-plan-cn/mimo-v2.6-flash`，每次完整运行最多 **8 会话、US$1 保守等价预算**；不自动换模型。

计划会话数为 `任务数 × repeat × (2 + judgeRepeat)`，诊断任务与全部评委轮次也计算在内。上面的两题示例恰为 8 会话，只用于检查链路，不足以判定 skill 有效。超限、其他模型组合、多模型实际跑批以及额外付费 `--llm-advice` 都在创建运行目录前拒绝。

每个 HTTP 请求先持久化最坏费用预留，再派发并从原始 usage 结算；失败或 usage 不明时保留预留并停止。模型和工具进程禁止联网，凭证仅留在父进程。SDK 成本只是估计；共享 `budget-ledger.json` 覆盖 subject 和 judge 的保守等价费用，不代表账户账单封顶。

任何执行、超时、工具错误、空输出或评委解析异常都会停整批。完整矩阵先写入 `execution-status.json`，未执行项保持 `NOT_RUN`，不产生虚构输出、零 usage 或真实评委票；任务断言不通过仍按原规则计分。原始事件、输出、失败首因保存在模型可写 `workspace/` 的父目录。

v1/v2 阳性专用入口和候选/日期/历史目录硬编码编排已退役，旧源码可在提交 `dc032df` 查看。原冻结包、两次失败运行和公开报告均保留：[v1 真实记录](docs/阳性校验真实执行-data-analysis-1.9.0-2026-11-06.md)、[v2 准备记录](docs/阳性校验受控入口-v2-2026-11-07.md)。本次收敛不续跑这些目录，不改冻结包，也不启动主复测。

`npm run check` 的标准测试入口使用临时空 HOME，清除凭证环境变量，并拒绝真实网络；原生会话用显式假响应及假凭证测试，工具进程仍保持自身 OS 隔离。

### pi 配置隔离

`--home` 指定父进程读取的 Pi 模型目录与认证配置。每个模型会话另建无真实凭证的临时 HOME。可预先准备独立的来源配置：

```bash
bash scripts/setup-pi-home.sh      # 默认建在 ~/.skill-eval/pi-home

npm run eval -- eval --suite ... --home ~/.skill-eval/pi-home
```

### 常用命令

```bash
# 只校验套件结构、正则合法性、恒真断言与白送断言（可选结合 --run）
npm run eval -- check --suite suites/example-suite.json

# 当前真实执行限于单模型成本配置；历史多模型结果仍可离线报告/比较

# 阴性对照元评估：剥离行为契约后验证工具与套件的区分能力
npm run eval -- verify --generate-broken path/to/SKILL.md --out /tmp/broken-skill
npm run eval -- verify --original runs/orig --broken runs/broken

# 导出匿名盲审表并校准评委一致性（Cohen's κ 与乐观偏置）
npm run eval -- calibrate --run runs/exp-001 --export /tmp/blind.json --suite-file suites/example-suite.json
npm run eval -- calibrate --run runs/exp-001 --score /tmp/blind.json

# 从原始产物重算，另存派生报告 analyses/<id>/（原记录不覆盖）
npm run eval -- report --run runs/exp-001 --suite-file suites/example-suite.json

# 把通过测评的 skill 快照存进仓库 archive/
npm run eval -- archive --run runs/exp-001 --repo .

# 未测的 skill 先放进待测评暂存区（通过归档后自动移出）
npm run eval -- pending --repo . --skill ~/.workbuddy/skills/my-skill/SKILL.md

# 只把目录建出来，然后直接把 skill 文件夹拖进去
npm run eval -- pending --repo . --init

# 查看待测评区里有哪些 skill（--json 给 agent 解析用）
npm run eval -- pending --repo .

# 一条命令跑完直接入库：评估 + 归档
npm run eval -- eval --suite suites/controlled-example.json --model minimax-cn/MiniMax-M3.1-Flash --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash --repeat 1 --archive-to .

# 查看回归门禁阈值
npm run eval -- threshold
```

> 归档有三道关：结论（`effective` 才放行）、结论不足需 `--allow-inconclusive`、
> **断言增益需 ≥ 10pp**（`--allow-low-gain` 可放行，但会标 `lowGain=true`）。
> 增益门槛来自阴性对照实验——断言整体灵敏度只有 51.9%，只看绝对通过率会把
> 「模型本来就能做对」误当成 skill 的功劳。

**没通过测的 skill 也有去处**：报告第 8 节会按四种失败模式（契约未落地 /
契约无效 / 约束不稳 / 未触发）给出可执行的优化建议，改完可原地复评。
待测评暂存区 `pending/` 是**常驻的投放入口**——skill 文件夹可以直接拖进去，
测评通过的 skill 会从里面移走进 `archive/`，但**文件夹本身保留**；
**没通过的 skill 会刻意留在里面等二次测评**。

> `pending/` 的位置跟着 `--repo` 走：评估某个项目的 skill 时应指向那个项目的仓库，
> 这样待测队列和归档都在同一个项目里。需要换位置用 `--pending-root <dir>`。

## 仓库结构

```text
src/
├── core/          评估内核（无业务耦合，可单测）
│   ├── runner.ts        唯一对照实验编排、停批及 NOT_RUN
│   ├── execution.ts     subject/judge 共用受控会话与账本
│   ├── verdict.ts       综合结论判定引擎（覆盖率/超时惩罚/规则纠偏/置信区间/成本分级）
│   ├── thresholds.ts    全局判定与展示阈值单一真相来源
│   ├── stats.ts         任务级保守区间、描述性比例区间与 Cohen's κ
│   ├── activation.ts    激活检测（工具取证含包内附属文件 + 正负向触发分离）
│   ├── judge.ts         成对评委、头尾保留采样与多轮聚合
│   ├── assertions.ts    规则断言判定
│   ├── sensitivity.ts   白送断言（baseline ≥ 80%）与零区分度用例筛查
│   ├── suite.ts         套件加载、内容哈希（suiteHash）与静态质量检查
│   ├── verify.ts        阴性对照元评估（契约剥离与区分能力检验）
│   ├── calibration.ts   人工匿名盲审导出与评委校准
│   ├── matrix.ts        多模型矩阵评估汇总与分化识别
│   ├── cost.ts          可解释成本效率评级（lean / moderate / expensive / runaway）
│   ├── regression.ts    回归门禁（含 suiteHash 漂移拦截）
│   ├── archive.ts       通过测评的 skill 归档（含 partial 拦截与套件漂移告警）
│   ├── gain.ts          任务等权配对增益、完整覆盖核验与描述性条目率
│   ├── provenance.ts    完整 skill 包身份与冻结快照
│   ├── run-manifest.ts  冻结运行清单、原始产物哈希与完整性核验
│   ├── isolation.ts     进程文件访问边界及每次启动前的本地探针
│   ├── improve.ts       激活感知归因、跨用例根因合并与 SKILL.md 定位建议
│   ├── pending.ts       待测评暂存区管理
│   ├── paths.ts         路径处理（~ 展开）
│   └── pi.ts            pi CLI 适配层
├── cli/           命令行入口
└── report/        Markdown 报告生成
schemas/           JSON Schema（套件定义、运行结果）
suites/            评估套件定义
skills/            工具自身的 skill（skill-eval-flow）
archive/           通过测评的 skill 快照（版本化存档）
pending/           待测评暂存区（候选池，未测 skill 放这里）
experiments/       实验记录（阴性对照验证、真实测评产物）
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

## 实验记录

`experiments/` 保存本工具产出的关键实验结论，让结论可追溯、可复现：

| 目录 | 内容 |
| --- | --- |
| `negative-control-2026-11-01/` | 阴性对照实验——验证工具自身具备区分能力 |
| `data-analysis-2026-10-27/` | data-analysis skill 首轮真实测评（含套件定义） |

阴性对照实验用**契约二分法**构造反例：只剥离被测 skill 的行为契约、保留触发契约，若断言通过率回落至 baseline 水平，则证明断言确实在度量 skill 契约。实测三组单调分离：

| 组别 | 断言通过率 | 增益 | 激活率 |
| --- | --- | --- | --- |
| baseline（不装 skill） | 50.0%（29/58） | — | 0% |
| **原版 skill** | **100.0%**（58/58） | **+50.0 pp** | 100% |
| **破坏版 skill**（契约剥离） | 75.9%（44/58） | **+8.6 pp** | 100% |

破坏版激活率仍为 100%，证明变量控制成立（只改了内容、没改触发机制）；0 条假阳性。完整分析见 [experiments/negative-control-2026-11-01/阴性对照验证报告.md](experiments/negative-control-2026-11-01/阴性对照验证报告.md)。

> 该实验同时暴露了一条重要结论：**必须用增益（差值）判定，不能用绝对通过率**。断言整体灵敏度仅 51.9%，skill 完全无效时通过率仍可达 75.9%。

复现命令见各目录下的 `REPORT.md`。入库产物均经 `redactHomeInText` 脱敏（用户目录统一替换为 `~`），套件里的 `~` 路径由 CLI 自动展开，可直接复跑。

## 与其他仓库的关系

- `~/Dev/Projects/agent-eval`：评测**数据与决策 Agent** 的完整治理范式（方案→执行→审核分离、证据层级、独立性声明）。本仓库借鉴其治理严谨性。
- `~/Dev/Projects/pi-xanthil`：已有生产级 skill 评估实现（`server/src/skill-evaluation-*.ts`）。本仓库移植其核心方法并剥离产品耦合，作为独立、可复用的评估工具。

方法来源与取舍见 [governance/方法来源.md](governance/方法来源.md)。

## 工作规则

见 [AGENTS.md](AGENTS.md)。
