# Skill 评估报告：data-analysis-negative-control

> 运行标识 `run-20261101-133545-0888c7a8` · 生成于 2026-11-01T14:07:10.005Z

## 结论摘要

**判定：结论不足** — 激活率 100.0%、胜率 22.2%，两项未同时达标。建议用更多重复次数与多轮评委复核。

| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |
| --- | --- | --- | --- |
| 激活率 | — | 100.0% | 触发充分 |
| 胜率 | — | 22.2% | 无提升甚至倒退 |
| 断言通过率 | 50.0% | 60.0% | 略有改善 |
| 平均耗时 | 30.3s | 46.9s | 变慢，需关注成本 |
| 平均 token | 12993 | 65942 | 增加 |

## 1. 候选身份

| 项 | 值 |
| --- | --- |
| 被测 skill | `~/.skill-eval/negative-control/data-analysis-broken/SKILL.md` |
| 内容哈希 | `sha256:d77055a82fc344f7` |
| 版本标识 | 1.8.0-broken |
| 套件 | data-analysis-negative-control (v1) |

## 2. 运行配置

| 项 | 值 |
| --- | --- |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |
| 每用例重复 | 2 次 |
| 评委轮数 | 2 轮（含位置偏好探测） |
| 用例数 | 5 |
| 总运行次数 | 20 |
| 总耗时 | 1884.0s |
| 总 token | 789,347 |
| 总成本 | $0.0837 |
| pi 隔离 HOME | `/tmp/nc-pi-home` |
| 证据目录 | `~/.skill-eval/negative-control/run-broken2` |

## 3. 证据层级

- **真实模型运行**：本报告全部数字来自真实 pi 模型调用，非回放、非静态检查。
- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对。
- **规则断言**：由代码判定，客观可复算，优先级高于模型评委。
- **成对评委**：模型评委判定相对优劣；已匿名化（A/B 无来源暗示）。

## 4. 激活情况

| Variant | 激活率 | 弱激活率 | 未激活 | 运行数 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | — | — | — | 10 | 对照组，按设计不加载 skill |
| Skill（1.8.0-broken） | 100.0% | 0.0% | 0.0% | 10 | 以工具调用读取 skill 文件为强证据 |

> 激活判定以「模型实际读取了 skill 文件」为强证据。弱激活指输出中出现 skill 关键词但模型从未读取该文件，不计入激活率分子。

## 5. 判定结果

### 5.1 Variant 汇总

| Variant | win | tie | loss | 未判定 | 胜率 | 断言通过率 | EFC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | 0 | 0 | 0 | 0 | — | 50.0% | 3.444 |
| Skill（1.8.0-broken） | 2 | 7 | 0 | 1 | 22.2% | 60.0% | 5.760 |

### 5.2 用例明细

| 用例 | 类型 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attribution-six-section | 计分 | 100.0% | 100.0% | 50.0% | 1 | 1 | 0 | 0 |
| direct-answer-no-six-section | 计分 | 100.0% | 100.0% | 50.0% | 1 | 1 | 0 | 0 |
| adversarial-forecast-and-causality | 计分 | 100.0% | 100.0% | 0.0% | 0 | 1 | 0 | 1 |
| trap-average-of-average | 计分 | 100.0% | 100.0% | 75.0% | 0 | 2 | 0 | 0 |
| trap-incomplete-period | 计分 | 100.0% | 100.0% | 100.0% | 0 | 2 | 0 | 0 |

### 5.3 规则断言明细

| Variant | 用例 | 次数 | 断言 | 结果 |
| --- | --- | --- | --- | --- |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第一段：数据口径与质量说明（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第二段：趋势与结构（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第三段：异常识别（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第四段：指标拆解（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第五段：洞察结论（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第六段：行动建议与跟踪指标（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客流因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客流 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客单价因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客单价 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (红线 5：行动建议必须落到责任人（SKILL.md 第五节）) | ❌ 未匹配到 责任人 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节）) | ❌ 未匹配到 跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第一段：数据口径与质量说明（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第二段：趋势与结构（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第三段：异常识别（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第四段：指标拆解（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第五段：洞察结论（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第六段：行动建议与跟踪指标（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客流因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客流 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客单价因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客单价 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (红线 5：行动建议必须落到责任人（SKILL.md 第五节）) | ✅ 匹配到 责任人 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节）) | ✅ 匹配到 跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ✅ 匹配到 样本量 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元) | ❌ 未提取到数值：客单价[^\n]{0,40}?([\d,]+\.?\d*)\s*元 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元) | ❌ 提取到的不是有效数值: 1,000,000 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节）) | ❌ 未匹配到 未做因果检验|需进一步验证|未做因果|待验证|需人工核实|未验证因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 1：预测要么拒绝，要么写明假设与测算过程（SKILL.md 第五节硬禁止 1）) | ✅ 匹配到 假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测|不做预测|不予预测|拒绝 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ❌ 未匹配到 样本量|样本数|共\s*\d+\s*(条|行|家) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：口径缺失下结论禁止，须声明来源与期间（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 统计期间|导出时间|数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustNotMatch (红线 1：全文无任何假设/测算/拒绝表述时，不得直接承诺「下个月销售额提升 10%」（SKILL.md 第五节硬禁止 1）) | ✅ 成功避开 ^(?![\s\S]*(假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测))(?=[\s\S]{0,400}?下个月销售额)[\s\S]*?下个月销售额[^\n]{0,24}?(提升|增长|增加)\s*10\s*% |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节）) | ❌ 未匹配到 未做因果检验|需进一步验证|未做因果|待验证|需人工核实|未验证因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 1：预测要么拒绝，要么写明假设与测算过程（SKILL.md 第五节硬禁止 1）) | ✅ 匹配到 假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测|不做预测|不予预测|拒绝 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ❌ 未匹配到 样本量|样本数|共\s*\d+\s*(条|行|家) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：口径缺失下结论禁止，须声明来源与期间（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 统计期间|导出时间|数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustNotMatch (红线 1：全文无任何假设/测算/拒绝表述时，不得直接承诺「下个月销售额提升 10%」（SKILL.md 第五节硬禁止 1）) | ✅ 成功避开 ^(?![\s\S]*(假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测))(?=[\s\S]{0,400}?下个月销售额)[\s\S]*?下个月销售额[^\n]{0,24}?(提升|增长|增加)\s*10\s*% |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (须点明错误算法得到 125 元，暴露算术平均的偏差（SKILL.md methods.md 8.3）) | ✅ 匹配到 125 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (须点明错误算法得到 125 元，暴露算术平均的偏差（SKILL.md methods.md 8.3）) | ✅ 匹配到 125 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 7：期间不等就比禁止，须等长或按同天数对齐（SKILL.md 第五节硬禁止 7）) | ✅ 匹配到 日均|同天数|等长|对齐|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (须指明期间不完整这一陷阱或引用两期天数（SKILL.md methods.md 8.2）) | ✅ 匹配到 期间不完整|天数不同|天数不等|不等长|未完成|进行中|半个月|15\s*天|28\s*天 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (须给出对齐后的日均或对齐后变动率（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md methods.md 8.2）) | ✅ 匹配到 20[,.]?666|22[,.]?142|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 7：期间不等就比禁止，须等长或按同天数对齐（SKILL.md 第五节硬禁止 7）) | ✅ 匹配到 日均|同天数|等长|对齐|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (须指明期间不完整这一陷阱或引用两期天数（SKILL.md methods.md 8.2）) | ✅ 匹配到 期间不完整|天数不同|天数不等|不等长|未完成|进行中|半个月|15\s*天|28\s*天 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (须给出对齐后的日均或对齐后变动率（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md methods.md 8.2）) | ✅ 匹配到 20[,.]?666|22[,.]?142|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (六段契约第一段：数据口径与质量说明（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (六段契约第二段：趋势与结构（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (六段契约第三段：异常识别（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (六段契约第四段：指标拆解（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (六段契约第五段：洞察结论（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (六段契约第六段：行动建议与跟踪指标（SKILL.md 第二节）) | ❌ 未匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客流因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客流 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客单价因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客单价 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (红线 5：行动建议必须落到责任人（SKILL.md 第五节）) | ❌ 未匹配到 责任人 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节）) | ❌ 未匹配到 跟踪指标 |
| Skill（1.8.0-broken） | attribution-six-section | 1 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ✅ 匹配到 样本量 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (六段契约第一段：数据口径与质量说明（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (六段契约第二段：趋势与结构（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (六段契约第三段：异常识别（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (六段契约第四段：指标拆解（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (六段契约第五段：洞察结论（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (六段契约第六段：行动建议与跟踪指标（SKILL.md 第二节）) | ✅ 匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客流因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客流 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (拆解范式：销售额 = 客流 × 客单价，必须出现客单价因子（SKILL.md 第二节第四段）) | ✅ 匹配到 客单价 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (红线 5：行动建议必须落到责任人（SKILL.md 第五节）) | ✅ 匹配到 责任人 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节）) | ✅ 匹配到 跟踪指标 |
| Skill（1.8.0-broken） | attribution-six-section | 2 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ✅ 匹配到 样本量 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 1 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 2 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0-broken） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节）) | ❌ 未匹配到 未做因果检验|需进一步验证|未做因果|待验证|需人工核实|未验证因果 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 1 | mustMatch (红线 1：预测要么拒绝，要么写明假设与测算过程（SKILL.md 第五节硬禁止 1）) | ✅ 匹配到 假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测|不做预测|不予预测|拒绝 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ❌ 未匹配到 样本量|样本数|共\s*\d+\s*(条|行|家) |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：口径缺失下结论禁止，须声明来源与期间（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 统计期间|导出时间|数据来源 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 1 | mustNotMatch (红线 1：全文无任何假设/测算/拒绝表述时，不得直接承诺「下个月销售额提升 10%」（SKILL.md 第五节硬禁止 1）) | ✅ 成功避开 ^(?![\s\S]*(假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测))(?=[\s\S]{0,400}?下个月销售额)[\s\S]*?下个月销售额[^\n]{0,24}?(提升|增长|增加)\s*10\s*% |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节）) | ✅ 匹配到 未做因果检验|需进一步验证|未做因果|待验证|需人工核实|未验证因果 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 2 | mustMatch (红线 1：预测要么拒绝，要么写明假设与测算过程（SKILL.md 第五节硬禁止 1）) | ✅ 匹配到 假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测|不做预测|不予预测|拒绝 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：给出量化结论须声明样本量（SKILL.md 第五节）) | ✅ 匹配到 样本量|样本数|共\s*\d+\s*(条|行|家) |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：口径缺失下结论禁止，须声明来源与期间（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 统计期间|导出时间|数据来源 |
| Skill（1.8.0-broken） | adversarial-forecast-and-causality | 2 | mustNotMatch (红线 1：全文无任何假设/测算/拒绝表述时，不得直接承诺「下个月销售额提升 10%」（SKILL.md 第五节硬禁止 1）) | ✅ 成功避开 ^(?![\s\S]*(假设|测算|前提|情景|敏感性|静态测算|试算|不(做|输出|提供)预测|无法预测))(?=[\s\S]{0,400}?下个月销售额)[\s\S]*?下个月销售额[^\n]{0,24}?(提升|增长|增加)\s*10\s*% |
| Skill（1.8.0-broken） | trap-average-of-average | 1 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0-broken） | trap-average-of-average | 1 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0-broken） | trap-average-of-average | 1 | mustMatch (须点明错误算法得到 125 元，暴露算术平均的偏差（SKILL.md methods.md 8.3）) | ✅ 匹配到 125 |
| Skill（1.8.0-broken） | trap-average-of-average | 1 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0-broken） | trap-average-of-average | 2 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0-broken） | trap-average-of-average | 2 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0-broken） | trap-average-of-average | 2 | mustMatch (须点明错误算法得到 125 元，暴露算术平均的偏差（SKILL.md methods.md 8.3）) | ✅ 匹配到 125 |
| Skill（1.8.0-broken） | trap-average-of-average | 2 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、methods.md 8.3）) | ❌ 未匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0-broken） | trap-incomplete-period | 1 | mustMatch (红线 7：期间不等就比禁止，须等长或按同天数对齐（SKILL.md 第五节硬禁止 7）) | ✅ 匹配到 日均|同天数|等长|对齐|同期天数|按天 |
| Skill（1.8.0-broken） | trap-incomplete-period | 1 | mustMatch (须指明期间不完整这一陷阱或引用两期天数（SKILL.md methods.md 8.2）) | ✅ 匹配到 期间不完整|天数不同|天数不等|不等长|未完成|进行中|半个月|15\s*天|28\s*天 |
| Skill（1.8.0-broken） | trap-incomplete-period | 1 | mustMatch (须给出对齐后的日均或对齐后变动率（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md methods.md 8.2）) | ✅ 匹配到 20[,.]?666|22[,.]?142|6\.7\s*% |
| Skill（1.8.0-broken） | trap-incomplete-period | 1 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Skill（1.8.0-broken） | trap-incomplete-period | 2 | mustMatch (红线 7：期间不等就比禁止，须等长或按同天数对齐（SKILL.md 第五节硬禁止 7）) | ✅ 匹配到 日均|同天数|等长|对齐|同期天数|按天 |
| Skill（1.8.0-broken） | trap-incomplete-period | 2 | mustMatch (须指明期间不完整这一陷阱或引用两期天数（SKILL.md methods.md 8.2）) | ✅ 匹配到 期间不完整|天数不同|天数不等|不等长|未完成|进行中|半个月|15\s*天|28\s*天 |
| Skill（1.8.0-broken） | trap-incomplete-period | 2 | mustMatch (须给出对齐后的日均或对齐后变动率（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md methods.md 8.2）) | ✅ 匹配到 20[,.]?666|22[,.]?142|6\.7\s*% |
| Skill（1.8.0-broken） | trap-incomplete-period | 2 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |

## 6. 规则与评委的分歧

| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |
| --- | --- | --- | --- | --- | --- |
| attribution-six-section | 1 | skill | 违反 | win | 规则断言判定 skill 与 baseline 表现相当，但评委认为改善；以规则断言为准 |
| direct-answer-no-six-section | 2 | skill | 通过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |
| trap-average-of-average | 2 | skill | 违反 | tie | 规则断言判定 skill 相对 baseline 违反更多约束（倒退），但评委未看出相对差异；以规则断言为准 |

> 规则断言优先级高于模型评委，上表以规则为准。分歧本身提示任务设计或 skill 声明存在偏差。

## 7. 未验证项与限制

- 1 对比较未能判定（运行失败或评委失败），未计入胜率分子分母之外的断言结论需谨慎解读

## 8. 结论

**结论不足** — 激活率 100.0%、胜率 22.2%，两项未同时达标。建议用更多重复次数与多轮评委复核。

### 结论边界

- 本结论仅覆盖上述运行配置下的用例集，不外推到未测任务。
- 判定基于模型输出质量，不是业务真实效果。

---

报告由 skill-eval 生成 · 运行 `run-20261101-133545-0888c7a8` · 证据目录 `~/.skill-eval/negative-control/run-broken2`