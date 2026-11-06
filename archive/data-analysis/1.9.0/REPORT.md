# Skill 评估报告：data-analysis

> 运行标识 `run-20261105-142602-e4d3863f` · 生成于 2026-11-05T15:24:56.048Z

## 结论摘要

**判定：有效（但昂贵）** — 激活率 100.0%，胜率 78.6%、断言增益 +60.7pp，各项统计与覆盖率门禁均达标。该 skill 在当前用例集下有效（注意：成本偏高（token 40.1x，4,545 tokens/pp，耗时 4.3x），属于「有效但昂贵」）。

| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |
| --- | --- | --- | --- |
| 激活率（正向召回） | — | 100.0% | 触发充分 |
| 成对评委胜率（已判对） | — | 78.6%（95% CI [52.4%, 92.4%]） | 有实质提升 |
| 评判覆盖率 / 全样本胜率下界 | — | 覆盖 93.3% · 下界 73.3% · 规则纠偏 78.6% | 覆盖充分 |
| 断言通过率（条目累计） | 26.8% | 87.4%（+60.7pp）（95% CI [+50.8pp, +68.5pp]） | 显著改善 |
| 平均耗时 | 25.2s | 109.7s | 变慢，需关注延迟 |
| 平均 token | 7048 | 282738 | expensive（成本偏高（token 40.1x，4,545 tokens/pp，耗时 4.3x）） |

## 1. 候选身份

| 项 | 值 |
| --- | --- |
| 被测 skill | `~/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md` |
| 内容哈希 | `sha256:63adebbaf67fdfde` |
| 版本标识 | 1.8.0 |
| 套件 | data-analysis (v2) |
| 套件哈希 | `sha256:7e7ff00adca64355` |

## 2. 运行配置

| 项 | 值 |
| --- | --- |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |
| 每用例重复 | 3 次 |
| 评委轮数 | 2 轮（含位置偏好探测） |
| 用例数 | 5 |
| 总运行次数 | 30 |
| 总耗时 | 3533.5s |
| 总 token | 4,415,421 |
| 总成本 | $0.2500 |
| pi 隔离 HOME | `/tmp/sk-eval-pihome-v2` |
| 证据目录 | 本目录（归档快照，证据见同目录 ARCHIVE.md） |

## 3. 证据层级

- **真实模型运行**：本报告全部数字来自真实 pi 模型调用，非回放、非静态检查。
- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对（含附属文件读取取证）。
- **规则断言**：由代码判定，客观可复算，优先级高于模型评委；失败或超时的空输出运行不计入断言分母。
- **成对评委**：模型评委判定相对优劣；已匿名化（A/B 无来源暗示），长输出采用头尾保留采样。

## 4. 激活情况

| Variant | 正向激活率 | 负向误触发率 | 弱激活率 | 未激活 | 运行数 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | — | — | — | — | 15 | 对照组，按设计不加载 skill |
| Skill（1.8.0） | 100.0% | — | 0.0% | 0.0% | 15 | 以工具调用读取 SKILL.md 或包内附属文件为强证据 |

> 激活判定以「模型实际读取了 skill 文件或包内附属文件」为强证据。弱激活指输出中出现关键词但从未读取文件，不计入激活率分子。

## 5. 判定结果

### 5.1 Variant 汇总

| Variant | win | tie | loss | 未判定 | 评判覆盖率 | 已判胜率 | 全样本下界 | 规则纠偏胜率 | 断言全过率 | 成本评级 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | 0 | 0 | 0 | 0 | — | — | — | — | 0.0% | — |
| Skill（1.8.0） | 11 | 3 | 0 | 1 | 93.3% | 78.6% | 73.3% | 78.6% | 26.7% | expensive |

### 5.2 用例明细

| 用例 | 类型 | 期望触发 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attribution-six-section | 计分 | 是 | 83.3% | 100.0% | 60.0% | 2 | 0 | 0 | 1 |
| direct-answer-no-six-section | 计分 | 是 | 100.0% | 100.0% | 0.0% | 3 | 0 | 0 | 0 |
| adversarial-forecast-and-causality | 计分 | 是 | 100.0% | 100.0% | 16.7% | 3 | 0 | 0 | 0 |
| trap-average-of-average | 计分 | 是 | 100.0% | 100.0% | 0.0% | 1 | 2 | 0 | 0 |
| trap-incomplete-period | 计分 | 是 | 100.0% | 100.0% | 0.0% | 2 | 1 | 0 | 0 |

### 5.3 规则断言明细

| Variant | 用例 | 次数 | 断言 | 结果 |
| --- | --- | --- | --- | --- |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第一段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第二段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第三段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第四段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第五段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (六段契约第六段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (红线 3：禁止口径缺失下结论，须声明数据来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ✅ 匹配到 导出时间 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ❌ 未匹配到 统计期间 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ✅ 匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ❌ 未匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第一段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第二段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第三段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第四段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第五段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第六段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (红线 3：禁止口径缺失下结论，须声明数据来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ✅ 匹配到 导出时间 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ❌ 未匹配到 统计期间 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ✅ 匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ❌ 未匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ❌ 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ❌ 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ❌ 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 3 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ❌ 未匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ❌ 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 统计期间|导出时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ❌ 未匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ❌ 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 统计期间|导出时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ❌ 未匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ❌ 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 统计期间|导出时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 3 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ❌ 未匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-average-of-average | 3 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天) |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-incomplete-period | 3 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (六段契约第一段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (六段契约第二段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (六段契约第三段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (六段契约第四段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (六段契约第五段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (六段契约第六段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (红线 3：禁止口径缺失下结论，须声明数据来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ✅ 匹配到 导出时间 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ✅ 匹配到 统计期间 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ✅ 匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ✅ 匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Skill（1.8.0） | attribution-six-section | 1 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (六段契约第一段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (六段契约第二段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (六段契约第三段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (六段契约第四段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (六段契约第五段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (六段契约第六段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (红线 3：禁止口径缺失下结论，须声明数据来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ✅ 匹配到 导出时间 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ✅ 匹配到 统计期间 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ✅ 匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ✅ 匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Skill（1.8.0） | attribution-six-section | 2 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (六段契约第一段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (六段契约第二段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (六段契约第三段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (六段契约第四段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (六段契约第五段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (六段契约第六段标题（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (红线 3：禁止口径缺失下结论，须声明数据来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ✅ 匹配到 导出时间 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ✅ 匹配到 统计期间 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ✅ 匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ✅ 匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Skill（1.8.0） | attribution-six-section | 3 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ❌ 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，但命中了等价写法（单月）——内容做到了，措辞未覆盖 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ❌ 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ✅ 匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ✅ 匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ✅ 匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0） | direct-answer-no-six-section | 3 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ✅ 匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ✅ 匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 统计期间|导出时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 1 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ✅ 匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ✅ 匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 统计期间|导出时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ✅ 匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ❌ 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 统计期间|导出时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 3 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ✅ 匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\| |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ✅ 匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-average-of-average | 3 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天) |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-incomplete-period | 3 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |

### 5.4 断言灵敏度体检（白送断言筛查）

共评估 53 条断言：有区分度 **42** 条（79.2%），无区分度（baseline 通过率 ≥ 80%）**11** 条。

| 用例 | 断言 | baseline 通过率 | skill 通过率 | 诊断 |
| --- | --- | --- | --- | --- |
| attribution-six-section | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | 100.0% (2/2) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| attribution-six-section | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | 100.0% (2/2) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| direct-answer-no-six-section | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| direct-answer-no-six-section | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| direct-answer-no-six-section | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| direct-answer-no-six-section | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| trap-average-of-average | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| trap-average-of-average | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| trap-incomplete-period | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| trap-incomplete-period | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |
| trap-incomplete-period | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | 100.0% (3/3) | 100.0% (3/3) | 白送断言（模型自带能力即可满足） |

### 5.5 评委标签纠正记录

评委返回的标签与它自己给出的分差方向矛盾时，工具以分差方向为准并在此记录。本轮共纠正 1 条。

| 用例 | 次数 | 原始标签 | 纠正后 | 分差 | 说明 |
| --- | --- | --- | --- | --- | --- |
| direct-answer-no-six-section | 1 | loss | win | +30 | 评委标签 loss 与分差 +30 方向矛盾，按分差方向纠正为 win |

## 6. 规则与评委的分歧

| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |
| --- | --- | --- | --- | --- | --- |
| trap-average-of-average | 1 | skill | 未全过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |
| trap-average-of-average | 2 | skill | 未全过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |
| trap-incomplete-period | 1 | skill | 未全过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |

> 规则断言优先级高于模型评委，当评委判 win 但规则断言出现倒退或零改善时，有效判定以规则纠偏胜率为准。

## 7. 未验证项与限制

- **1/30 次运行失败**，已计入分母且已从负向断言分母剔除（防空输出假通过）：baseline/attribution-six-section#3
- 1 对比较未能完成评判，已在全样本胜率下界与有效评判覆盖率中显式计入分母

## 8. 优化建议（已通过，以下为可加固项）

skill 已通过测评，但仍有可加固的契约：11 条断言失败，其中 9 条属于「约束不稳」。优先处理这一类，其余见下方明细。另有 1 条失败属「断言过严（不是 skill 的问题）」，要改的是套件而非 skill。

### 8.1 核心待改根因（跨用例去重 · 按优先级与预计增益排序）

| 优先级 | 失败模式 | 待修契约 | 影响用例 | 预计增益 | 修改建议与定位 |
| --- | --- | --- | --- | --- | --- |
| P1 | 约束不稳 | 直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句） | direct-answer-no-six-section | +1.3pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P2 | 约束不稳 | 红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败） | trap-average-of-average | +1.3pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P3 | 约束不稳 | 第六段四要素含跟踪指标（SKILL.md 第二节第六段写法） | trap-average-of-average | +1.3pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P4 | 约束不稳 | 补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败） | trap-incomplete-period | +1.3pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P5 | 约束不稳 | 输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败） | direct-answer-no-six-section | +0.6pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P6 | 约束不稳 | 直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增 | direct-answer-no-six-section | +0.6pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P7 | 约束不稳 | 红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1） | adversarial-forecast-and-causality | +0.6pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P8 | 约束不稳 | 第六段四要素含时限（SKILL.md 第二节第六段写法） | adversarial-forecast-and-causality | +0.6pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P9 | 约束不稳 | 直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增 | trap-average-of-average | +0.6pp | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P10 | 契约无效 | 第六段四要素含时限（SKILL.md 第二节第六段写法） | trap-average-of-average | +1.9pp | 这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束（而不是靠模型自己推测），必要时补成明确的红线条目。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |
| P11 | 契约无效 | 红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7） | trap-incomplete-period | +1.9pp | 这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束（而不是靠模型自己推测），必要时补成明确的红线条目。（定位：SKILL.md 正文已提及相关概念，但软性散文约束力不足——建议改为硬性 Checklist 或附标准输出片段） |

### 8.2 按失败模式归类

| 失败模式 | 条数 | 说明 |
| --- | --- | --- |
| 约束不稳 | 9 | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。 |
| 契约无效 | 2 | 这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束（而不是靠模型自己推测），必要时补成明确的红线条目。 |
| 断言过严（不是 skill 的问题） | 1 | **这是断言写得过严，不是 skill 的问题**——输出里其实做到了，只是用了断言没覆盖的措辞。要改的是**套件**：把这条断言放宽到能接受 skill 契约里允许的其他写法，或给该断言补上 `equivalentPatterns` 声明等价写法。放宽后必须复验 baseline 仍不命中——放宽到 baseline 也能过，测出来的增益就是假的。 |

### 8.3 逐条失败明细

| 用例 | 断言 | 失败模式 | 失败原因 |
| --- | --- | --- | --- |
| direct-answer-no-six-section | mustMatch（直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）） | 约束不稳 | 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| direct-answer-no-six-section | mustMatch（输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）） | 约束不稳 | 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| direct-answer-no-six-section | mustMatch（输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）） | 断言过严（不是 skill 的问题） | 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，但命中了等价写法（单月）——内容做到了，措辞未覆盖 |
| direct-answer-no-six-section | mustMatch（直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增） | 约束不稳 | 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| adversarial-forecast-and-causality | mustMatch（红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）） | 约束不稳 | 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| adversarial-forecast-and-causality | mustMatch（第六段四要素含时限（SKILL.md 第二节第六段写法）） | 约束不稳 | 未匹配到 时限|个工作日|天内|完成时间 |
| trap-average-of-average | mustMatch（红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）） | 约束不稳 | 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| trap-average-of-average | mustMatch（第六段四要素含时限（SKILL.md 第二节第六段写法）） | 契约无效 | 未匹配到 时限|个工作日|天内|完成时间 |
| trap-average-of-average | mustMatch（第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）） | 约束不稳 | 未匹配到 跟踪指标|监控指标|验证指标 |
| trap-average-of-average | mustMatch（直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增） | 约束不稳 | 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| trap-incomplete-period | mustMatch（红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）） | 契约无效 | 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| trap-incomplete-period | mustMatch（补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）） | 约束不稳 | 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |

> 「漏触发」= 模型未读取 skill 导致的下游断言失败，应改 frontmatter description 而非正文；
> 「契约未落地」= baseline 能做到、装 skill 后反而做不到，是 skill 的真问题；
> 「契约无效」= baseline 也做不到，说明 skill 没把这条约束写清楚（或写在未读附属文件里）；
> 「断言过严」= 输出内容其实做到了，只是用了断言没覆盖的措辞——**要改的是套件，不是 skill**。

### 8.4 断言过严（要改套件，不是 skill）

以下 1 条失败**不是 skill 的问题**——输出内容做到了，只是断言的正则没覆盖 skill 契约里允许的其他措辞。

| 用例 | 断言 | 建议 |
| --- | --- | --- |
| direct-answer-no-six-section | mustMatch（输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）） | 放宽该断言的 pattern，或补 equivalentPatterns 声明等价写法 |

> 放宽后**必须复验 baseline 仍不命中**——放宽到 baseline 也能过，测出来的增益就是假的。

### 下一步

本 skill 已通过测评。上述失败项是**可选的加固项**，不影响本次结论：

1. skill 侧可加固 11 项根因（共涉及 11 条用例断言）：按「核心待改根因」表修改 SKILL.md。
2. 套件侧要改的 1 条：放宽对应断言的 pattern（或补 equivalentPatterns），放宽后**复验 baseline 仍不命中**。
3. 若要改 skill，请**保持同一套件（核对套件哈希）与同一模型**重新评估，只改 skill 内容——否则无法归因。
4. 修改后的 skill 版本号递增，归档区会保留上一版快照便于对比。

## 9. 结论

**有效（但昂贵）** — 激活率 100.0%，胜率 78.6%、断言增益 +60.7pp，各项统计与覆盖率门禁均达标。该 skill 在当前用例集下有效（注意：成本偏高（token 40.1x，4,545 tokens/pp，耗时 4.3x），属于「有效但昂贵」）。

### 结论边界

- 本结论仅覆盖上述运行配置与被评模型下的用例集，不同能力层级的模型建议用 `--models` 跑跨模型矩阵验证。
- 判定基于模型输出质量，不是业务真实效果。

---

报告由 skill-eval 生成 · 运行 `run-20261105-142602-e4d3863f` · 证据目录 `本目录`