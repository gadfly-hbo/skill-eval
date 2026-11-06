# data-analysis 1.9.0 两题阳性校验：真实执行报告

**结论：STOPPED，阳性校验 NOT_COMPLETED。** 本次只启动了第一个 baseline 会话；模型成功响应四次，随后工具访问沙箱外目录被拒，控制器停止。P 侧和评委均未运行，不能判断阳性校验通过，也不能形成 data-analysis 的效用结论。

## 身份、授权与范围

- 执行代码：已提交的 `d66cad89f8191806e504fa6a4faefd968b7fb63b`，源码未修改。
- 唯一入口：`node --experimental-strip-types src/cli/positive-probe.ts --execute --authorize-real-provider`，仅调用一次，退出码 1。
- 运行 ID：`da190-20261106-frozen-v1-positive`；沿用原模型、两题、repeat=1、judgeRepeat=2 和匿名展示顺序。
- 被评模型：`minimax-cn/MiniMax-M3.1-Flash`；评委：`xiaomi-token-plan-cn/mimo-v2.6-flash`。
- 阳性 P 是合成工作流校验包，身份为 `sha256:6cfa4c90b816ce377fefbb20077cf64967f2855f621b5169d83a9c0c1f1ab8a5`；它不等于对原 data-analysis 1.9.0 的效果复测。
- 原 `FREEZE.json` SHA256：`0dc6b4a4dcafb51b862a8143ab5eb103c309712ad5adfc0ec05b4e621b10cea7`；套件语义哈希：`sha256:ca5b80a7bd839627`。
- 运行配置创建时间：2026-11-06 15:51:07.227 UTC；最终控制记录文件时间：15:51:15.433 UTC。

范围仍为最多 **8 个会话、US$1 保守等价预算**。未改变冻结包、输出限额或判断规则，未选择性重跑，未启动主复测，也未归档候选。授权记录保存在 `.local/controlled-positive-real-20261106/authorization.json`。

## 实际进度与停止原因

| 计划会话 | 实际状态 |
| --- | --- |
| baseline / da-positive-json | FAILED；4 个真实 HTTP 请求 |
| baseline / da-positive-digest | NOT_RUN |
| P / da-positive-json | NOT_RUN |
| P / da-positive-digest | NOT_RUN |
| da-positive-json / 评委 round-001 | NOT_RUN |
| da-positive-json / 评委 round-002 | NOT_RUN |
| da-positive-digest / 评委 round-001 | NOT_RUN |
| da-positive-digest / 评委 round-002 | NOT_RUN |

baseline 尝试以原生 bash 的 `ls` 访问仓库根目录和会话工作区以外的父目录，沙箱返回 `Operation not permitted`。首个结构化失败工具退出码为 1，触发 `SESSION_EVENT_FAILURE`；另一个并发工具随后在清理中被中止。没有第五次 HTTP 请求或第二个会话。

更早的一条复合命令也出现过 `ls` 访问被拒，但后续 `cat` 成功使整条命令退出 0，原生事件为 `isError=false`。已提交入口按结构化工具错误停止，并不解析所有 stderr 文本；本次没有改判据或补跑来隐藏这个边界。

这是本地工具隔离边界上的失败。四次 Provider 调用均成功，未观察到鉴权拒绝或配额错误。失败的 baseline 没有最终输出，断言保存为 null；P 激活、P 脚本交付、成对胜率和四轮评委全部标为未运行。

## 鉴权与模型权限

| 项目 | 本次证据与结论 |
| --- | --- |
| MiniMax 鉴权 | 4 次 HTTP 200 及有效原始 SSE，确认这些请求的凭证被接受 |
| MiniMax 精确型号权限 | 请求和响应型号均为 `MiniMax-M3.1-Flash`，确认当时可调用该型号 |
| MiniMax 余额及剩余配额 | UNKNOWN；未查询账户接口，成功四次不能证明后续额度 |
| MiMo 鉴权、型号权限及 Token Plan Credits | NOT_RUN / UNKNOWN；评委未进入，不作推断 |
| 远端权重修订 | UNKNOWN；型号字符串不是远端权重版本证明 |
| 实际账户账单 | UNKNOWN；本次不另发账户查询或探测请求 |

## 原始 usage 与费用

四个请求均取得正常终止的原始 SSE usage，账本全部结算。下表按请求编号追溯到首个 case 内的 `wire-baseline-da-positive-json-1-rN.json`：

| 请求 | 未缓存输入 | 缓存读取 | 输出 | 全部 tokens | 保守预算等价 US$ |
| --- | ---: | ---: | ---: | ---: | ---: |
| r1 | 1,667 | 128 | 82 | 1,877 | 0.000318450 |
| r2 | 239 | 1,795 | 30 | 2,064 | 0.000323100 |
| r3 | 2,782 | 2,034 | 193 | 5,009 | 0.000838200 |
| r4 | 336 | 4,816 | 222 | 5,374 | 0.000906000 |
| 合计 | **5,024** | **8,773** | **527** | **14,324** | **0.002385750** |

缓存写入实测为 0。预算按冻结价表将所有输入及缓存读取以未缓存输入价计算：`13,797 × 0.15 / 1,000,000 + 527 × 0.60 / 1,000,000 = US$0.002385750`。每次发送前预留 US$0.152457600，成功结算后释放差额；本次无失败请求全额预留扣减，未结算预留为 0，剩余额度 **US$0.997614250**，后续调用已停止。

原 SDK `usage.cost.total` 合计 **US$0.0011962385**，它使用不同的本地目录价和缓存折扣，仅作为原始估算字段保留，不参与预算判定。两种数字均不能冒充实际账户实付金额。

## 证据、保留及限制

真实运行原始目录为 `runs/da190-20261106-frozen-v1-positive/`，保留运行清单、目录锁、控制状态、失败结果、输出、完整事件、4 份 wire JSON 及 4 份部分 SSE，共 23 个文件。该目录被 Git 忽略，未上传。调用日志、授权、保护清单及全部产物哈希另存 `.local/controlled-positive-real-20261106/`。脱敏逐会话及逐请求清单见 [机器可读报告](validation/2026-11-06-controlled-positive-real-run.json)。

独立只读复核已将原始 wire、事件和账本逐一核对。**1,398/1,398 个既有受保护文件的 SHA256 和模式未变**，原冻结锚点和 67 个负载未变，原主实验及消融运行目录仍不存在。旧报告、判定和离线 STOPPED 夹具均保留；本次没有提交或推送新报告。

原记录存在两个展示限制，均未追溯改写：SDK 末尾的零 usage `aborted` 助手事件是本地中止事件，不是第五次 Provider 调用；旧 `metrics.toolCalls=14` 含声明与启动的双计，原始事件实际有 7 个工具启动。`controlled-execution.json` 中继承自运行前描述的 `providerCalls=NOT_RUN` 也不是动态执行计数，实际调用以四份 HTTP 原始证据和本报告为准。

本次闭合了 MiniMax 当时的鉴权及精确型号可调用性，并验证预算结算和结构化异常后的停止；阳性敏感度、P 的真实激活与交付、评委可用性和 data-analysis 1.9.0 的实际增益仍未验证。当前记录保持停止，不自动修复或重跑。
