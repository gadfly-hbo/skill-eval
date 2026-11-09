# data-analysis 1.9.0 两题阳性校验 v2：真实执行报告

**已先提交并推送 v2，再执行唯一一次新计划；执行结果为 STOPPED，阳性判定 NOT_COMPLETED。** 第一个 baseline 会话发生工具越界错误，其余七个会话未运行。没有补跑旧 P、混用新旧输出、选择性重跑或启动主复测。

## 交付与执行身份

- 已推送提交：[dc032df40f6deea558d97fc6c05125c620714412](https://github.com/gadfly-hbo/skill-eval/commit/dc032df40f6deea558d97fc6c05125c620714412)，远端 `main` 已核对。
- 提交前 `npm run check`：类型检查通过，**465/465 测试通过，0 失败、0 跳过**。提交范围为 20 个公开文件，私有材料与原始运行目录未上传。
- 实际入口：`node --experimental-strip-types src/cli/positive-probe-v2.ts --execute --authorize-real-provider`，调用一次，退出码 1。
- 新 runId：`da190-20261107-controlled-v2-positive`；使用新目录，原 v1 STOPPED 记录保持原样。
- 原模型不变：subject `minimax-cn/MiniMax-M3.1-Flash`，judge `xiaomi-token-plan-cn/mimo-v2.6-flash`。
- 原两题、P 包身份、repeat=1、judgeRepeat=2、judgeSeed 及展示顺序不变；最多 8 会话、US$1 等价预算及严格隔离／异常即停规则不变。

准备阶段计划中 `NOT_RUN` 和未授权字段保留为当时快照；后续授权及实际执行分别保存在追加的交付记录与本次真实报告中，不追改历史。

## 实际进度与首次失败

| 会话 | 状态 |
| --- | --- |
| baseline / da-positive-json | FAILED；同一会话内 9 次真实 HTTP 请求 |
| baseline / da-positive-digest | NOT_RUN |
| P / da-positive-json | NOT_RUN |
| P / da-positive-digest | NOT_RUN |
| 第一题两个评委会话 | NOT_RUN |
| 第二题两个评委会话 | NOT_RUN |

**9 次 HTTP 请求发生在 1 个会话内，不是 9 个会话。** 未超过 8 会话上限；停止后没有第十次 HTTP 请求或第二个会话。

首因取证为 `TOOL_EXECUTION_FAILED`，原始事件索引 **532**，工具 `bash`，退出码 **1**。命令尝试 `cd` 到会话工作区的父目录，并列举 `..`、`../..`、`../../..`；沙箱返回 `Operation not permitted`。控制器以 `SESSION_EVENT_FAILURE` 停止，后续 worker 级联和助手中止没有覆盖首因。

索引 350 另有一条最终退出 0、输出包含拒绝文字的观察记录。它按已保留规则只作非权威观察，不通过文本匹配新增 fatal 条件。失败 baseline 最终输出为空，断言为 null。P 激活、P 交付及评委均未运行，不能形成阳性或 skill 效果结论。

## 共享说明的实际证据

九份真实请求的 system 都恰好包含一份固定 v2 环境说明，SHA256 为 `c0a36bffc30d4934ddc77a15d574db78226c852b7eff4dfcd0a0fe3447be23e0`。因此这次失败不能归为附言漏传：**baseline 收到说明后，本次仍发生了向外探索。**

P 侧没有运行，不能宣称本次真实 B/P 对称已经测完；对称性仍由先前离线测试支持。一次失败也不能推出 v2 总体比 v1 更差，或该说明在所有场景均无效。当前记录不被修成通过，也不自动调整提示后重跑。

## 鉴权、模型权限、usage 与费用

九个请求均为 HTTP 200，请求及响应型号精确为 `MiniMax-M3.1-Flash`，输出限额均为 4096。可以确认这些请求当时的 MiniMax 鉴权及精确型号调用权限；远端权重修订和剩余额度仍未知。MiMo 评委未调用，其鉴权、模型权限及 Token Plan Credits 继续为 UNKNOWN。

| 原始 usage | 合计 |
| --- | ---: |
| 未缓存输入 | 6,239 |
| 缓存读取 | 34,432 |
| 缓存写入 | 0 |
| 输出 | 1,284 |
| 全部 tokens | **41,955** |

九个请求全部取得有效原始 SSE usage 并正常结算，没有失败请求的全额预留扣减。按固定价表将缓存及未缓存输入均按输入最高价计算：

`40,671 × US$0.15 / 1,000,000 + 1,284 × US$0.60 / 1,000,000 = US$0.006871050`

本次预算等价费用为 **US$0.006871050**，未结算预留为 **0**，剩余等价预算 **US$0.993128950**。停止原因是工具越界，不是预算耗尽、超时或 Provider 错误。

SDK `usage.cost.total` 合计约 **US$0.0022124618**，包含本地目录价和缓存折扣，仅是估算字段，不参与预算控制。**实际账户扣费未知**，本次没有额外查询账单或配额。旧 v1 的费用保持在旧账本中，未与本次输出或判定混用。

## 保留与独立复核

本次 35 个原始产物保留在 `runs/da190-20261107-controlled-v2-positive/`，包括新运行清单、执行修订、首次失败证据、完整事件、九份 wire JSON 和九份部分 SSE。该目录被 Git 忽略。授权、命令输出、完整产物哈希及保护清单另存 `.local/controlled-positive-v2-20261107/delivery-and-real-20261107/real/`。

执行前已有的 **1,469/1,469 文件内容和模式未变**；旧失败 23 份产物、原 FREEZE 锚点和 67 个负载未变，主实验及消融目录仍不存在。源代码在提交后未修改。独立只读审阅已核对九份 HTTP、固定附言、usage、费用、首次失败和剩余七行未运行；审阅本身没有发起 Provider 请求。

脱敏逐次清单与证据指纹见 [机器可读真实结果](validation/2026-11-07-controlled-positive-v2-real-run.json)。本次新结果报告尚未提交或推送；原始记录和私有真值均未上传。
