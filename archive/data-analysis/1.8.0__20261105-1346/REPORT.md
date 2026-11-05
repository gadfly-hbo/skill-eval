# Skill 评估报告：data-analysis

> 运行标识 `run-20261105-034418-362c94b9` · 生成于 2026-11-05T05:45:03.178Z

## 结论摘要

**判定：有效** — 激活率 100.0%（触发稳定），胜率 60.0%（有实质提升）。该 skill 在当前用例集下有效。

| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |
| --- | --- | --- | --- |
| 激活率 | — | 100.0% | 触发充分 |
| 胜率 | — | 60.0% | 有实质提升 |
| 断言通过率（条目累计） | 20.8% | 95.3% | 明显改善 |
| 平均耗时 | 23.3s | 81.9s | 变慢，需关注成本 |
| 平均 token | 9056 | 135473 | 增加 |

## 1. 候选身份

| 项 | 值 |
| --- | --- |
| 被测 skill | `~/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md` |
| 内容哈希 | `sha256:25e72e3e5b5ec3ca` |
| 版本标识 | 1.8.0 |
| 套件 | data-analysis (v2) |

## 2. 运行配置

| 项 | 值 |
| --- | --- |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |
| 每用例重复 | 2 次 |
| 评委轮数 | 2 轮（含位置偏好探测） |
| 用例数 | 5 |
| 总运行次数 | 20 |
| 总耗时 | 1889.7s |
| 总 token | 1,445,289 |
| 总成本 | $0.1197 |
| pi 隔离 HOME | `~/.skill-eval/pi-home` |
| 证据目录 | 本目录（归档快照，证据见同目录 ARCHIVE.md） |

## 3. 证据层级

- **真实模型运行**：本报告全部数字来自真实 pi 模型调用，非回放、非静态检查。
- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对。
- **规则断言**：由代码判定，客观可复算，优先级高于模型评委。
- **成对评委**：模型评委判定相对优劣；已匿名化（A/B 无来源暗示）。

## 4. 激活情况

| Variant | 激活率 | 弱激活率 | 未激活 | 运行数 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | — | — | — | 10 | 对照组，按设计不加载 skill |
| Skill（1.8.0） | 100.0% | 0.0% | 0.0% | 10 | 以工具调用读取 skill 文件为强证据 |

> 激活判定以「模型实际读取了 skill 文件」为强证据。弱激活指输出中出现 skill 关键词但模型从未读取该文件，不计入激活率分子。

## 5. 判定结果

### 5.1 Variant 汇总

| Variant | win | tie | loss | 未判定 | 胜率 | 断言通过率 | EFC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | 0 | 0 | 0 | 0 | — | 0.0% | 2.037 |
| Skill（1.8.0） | 6 | 4 | 0 | 0 | 60.0% | 60.0% | 5.760 |

### 5.2 用例明细

| 用例 | 类型 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| attribution-six-section | 计分 | 100.0% | 100.0% | 50.0% | 2 | 0 | 0 | 0 |
| direct-answer-no-six-section | 计分 | 100.0% | 100.0% | 0.0% | 2 | 0 | 0 | 0 |
| adversarial-forecast-and-causality | 计分 | 100.0% | 100.0% | 50.0% | 2 | 0 | 0 | 0 |
| trap-average-of-average | 计分 | 100.0% | 100.0% | 0.0% | 0 | 2 | 0 | 0 |
| trap-incomplete-period | 计分 | 100.0% | 100.0% | 50.0% | 0 | 2 | 0 | 0 |

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
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ❌ 未匹配到 导出时间 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ❌ 未匹配到 统计期间 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ❌ 未匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ❌ 未匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Baseline（不装 skill） | attribution-six-section | 1 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第一段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:一|1)\s*[、.．:：]?\s*数据口径与质量说明 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第二段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:二|2)\s*[、.．:：]?\s*趋势与结构 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第三段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第四段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第五段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:五|5)\s*[、.．:：]?\s*洞察结论 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (六段契约第六段标题（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议与跟踪指标 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (红线 3：禁止口径缺失下结论，须声明数据来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：数据来源须含导出时间（SKILL.md 第一节输入表）) | ❌ 未匹配到 导出时间 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：须声明统计期间（SKILL.md 第一节输入表）) | ❌ 未匹配到 统计期间 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (输入要求：样本量 < 30 时结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (红线 5：禁止输出无责任人的行动建议（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第四段拆解：各项贡献之和须与实测值吻合，须校验（SKILL.md 第二节拆解范式）) | ❌ 未匹配到 闭合|校验|复算|对账|效应之和|贡献之和 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (第三段异常识别：须写明所选判定方法与偏离度（SKILL.md 第三节工作流第 5 步）) | ❌ 未匹配到 3\s*σ|IQR|箱线|四分位|偏离度 |
| Baseline（不装 skill） | attribution-six-section | 2 | mustMatch (口径提示：销售额÷客流须注明是人均消费口径，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ✅ 匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ❌ 提取到的不是有效数值: 1,000,000 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ❌ 未匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Baseline（不装 skill） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ❌ 未匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ❌ 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ❌ 未匹配到 数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 统计期间|导出时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 1 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 2：相关结论须标「未做因果检验，需进一步验证」（SKILL.md 第五节硬禁止 2）) | ❌ 未匹配到 未做因果|需进一步验证|未验证因果|待验证|需人工核实|不能(?:认定|断定)为|不构成因果|无法做因果 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 1：禁止无依据的量化预测，须明确不作预测输出（SKILL.md 第五节硬禁止 1）) | ❌ 未匹配到 不(?:作为|做|输出|提供|予|进行)?预测|无法预测|拒绝预测|不是预测|预测须|须交专业预测|专业预测(?:模型|流程|技能) |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：口径缺失下结论禁止，即使用户要求省略也须声明来源（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 数据来源 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 3：须声明统计期间与导出时间（SKILL.md 第五节硬禁止 3）) | ✅ 匹配到 统计期间|导出时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (输入要求：给出量化结论须声明样本量（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (输入要求：12 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | adversarial-forecast-and-causality | 2 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ❌ 未匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ❌ 未匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-average-of-average | 1 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ❌ 未匹配到 平均的平均|算术平均|组均值|各组均值 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ❌ 未匹配到 人均消费|成交笔数 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\|，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 时限|个工作日|天内|完成时间 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-average-of-average | 2 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ❌ 未匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-incomplete-period | 1 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ❌ 未匹配到 期间不完整|未完成期间|未完成|进行中 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ❌ 未匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ❌ 未匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天)，等价写法也未命中——内容确实缺失 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ❌ 未匹配到 样本量不足|仅供参考|置信度不足 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ❌ 未匹配到 责任人|负责人|\|\s*谁\s*\| |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Baseline（不装 skill） | trap-incomplete-period | 2 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
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
| Skill（1.8.0） | direct-answer-no-six-section | 1 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ✅ 匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0） | direct-answer-no-six-section | 1 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | numeric (直答须给出正确数值：1000000 ÷ 12500 = 80.00 元（口径名可为人均消费，须给数值）) | ✅ 数值 80 在期望 80 ±0.01 内 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (直答形态须给「可比基准」——无基期时须明说无法判断高低/趋势（SKILL.md 第二节输出分级：数字+可比基准+口径一句）) | ✅ 匹配到 (?:未提供|没有|缺少|无)(?:基期|上一期|上月|去年同期)|无法(?:判断|给出|做)|不可(?:判断|比)|缺少对比基准 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (口径提示：客单价 = 销售额 ÷ 成交笔数，只有人流须注明用人均消费口径（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (输入要求：口径未给定须列入待确认项（SKILL.md 第一节输入表、第六节问五件事）｜v2 放宽：补入 skill 自用措辞「未做体检」「含税/含退货/剔除内部单/退款单」，只锚契约语义不绑词形｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 待确认|需确认|是否(?:含税|含退货|覆盖)|请(?:提供|补充|确认)|未做体检|口径[^。\n]{0,10}不一致|含税|含退货|剔除内部单|退款单 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (输入要求：须声明统计期间与导出时间（SKILL.md 第一节输入表）｜v2 放宽：补入「仅有…单月/目前只有…2026-03」等声明期间的结构性证据，不匹配裸日期以免丧失判别力｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 统计期间|导出时间|仅有[^。\n]{0,14}(?:单月|一个月|2026-03)|目前只有[^。\n]{0,14}2026-03 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustMatch (直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:四|4)\s*[、.．:：]?\s*指标拆解 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:六|6)\s*[、.．:：]?\s*行动建议 |
| Skill（1.8.0） | direct-answer-no-six-section | 2 | mustNotMatch (直答形态不套六段全文（SKILL.md 第二节输出分级）) | ✅ 成功避开 #{1,4}\s*(?:三|3)\s*[、.．:：]?\s*异常识别 |
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
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | adversarial-forecast-and-causality | 2 | mustMatch (归因分析形态须走六段全文，顺序固定（SKILL.md 第二节六段契约）) | ✅ 匹配到 #{1,4}\s*(?:[一二三四五六1-6])\s*[、.．:：]?\s*(?:数据口径与质量说明|趋势与结构|异常识别|指标拆解|洞察结论|行动建议与跟踪指标) |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\| |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-average-of-average | 1 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (红线 8：禁止对已分组均值再求平均，须回原始数据加权（SKILL.md 第五节硬禁止 8）) | ✅ 匹配到 加权|回原始|原始明细|原始数据 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (加权平均正确值：(100×50 + 10×200)/110 = 63.64 元（SKILL.md references/methods.md 8.3 算例）) | ✅ 匹配到 63\.6 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (须识别并命名「平均的平均」这一陷阱（SKILL.md 第四节、references/methods.md 8.3）) | ✅ 匹配到 平均的平均|算术平均|组均值|各组均值 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (口径提示：销售额÷客流是人均消费，不得直接称客单价（SKILL.md 第二节口径提示）) | ✅ 匹配到 人均消费|成交笔数 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）｜v2 放宽：接受 SKILL.md 第 69 行自己规定的「谁做」措辞与表头｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 责任人|负责人|谁做|谁负责|\|\s*谁(?:做|负责)?\s*\| |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (第六段四要素含时限（SKILL.md 第二节第六段写法）) | ✅ 匹配到 时限|个工作日|天内|完成时间 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ❌ 未匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-average-of-average | 2 | mustMatch (直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增) | ❌ 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ✅ 匹配到 期间不完整|未完成期间|未完成|进行中 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天) |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-incomplete-period | 1 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (红线 7：期间不等就比禁止，须识别期间不完整（SKILL.md 第五节硬禁止 7）) | ✅ 匹配到 期间不完整|未完成期间|未完成|进行中 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (红线 7：须指出两期天数不等并作对齐处理（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 日历天数|天数不等|不等长|天数不同|等长|同期天数|按天 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (补充纪律：涉及天数比例的表述必须自己算——本期覆盖 53.6% 天数，1 − 53.6% = 46.4%（SKILL.md 第五节红线 7 补充纪律）｜v2 放宽：接受 SKILL.md 第 112 行明确允许的合规叙述式「53.6%…天」（原断言与 skill 契约相冲突）｜v2 等价写法声明（用于识别假失败）) | ✅ 匹配到 46\.4|46\.43|53\.6(?:\s*[%）)]|\s*天) |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (须给出对齐后的日均数值（310000/15=20666.67、620000/28=22142.86、-6.7%）（SKILL.md references/methods.md 8.2）) | ✅ 匹配到 20[,.]?66[67]|22[,.]?14[23]|6\.7\s*% |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (输入要求：2 条记录 < 30，结论须标「样本量不足，仅供参考」（SKILL.md 第一节输入表）) | ✅ 匹配到 样本量不足|仅供参考|置信度不足 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (红线 5：建议必须落到责任人（SKILL.md 第五节硬禁止 5）) | ✅ 匹配到 责任人|负责人|\|\s*谁\s*\| |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustMatch (第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）) | ✅ 匹配到 跟踪指标|监控指标|验证指标 |
| Skill（1.8.0） | trap-incomplete-period | 2 | mustNotMatch (红线 7：全文无任何对齐处理时，不得把未对齐的 50% 总量降幅当结论（SKILL.md 第五节硬禁止 7）) | ✅ 成功避开 ^(?![\s\S]*(日均|同天数|等长|对齐|同期天数|按天))[\s\S]*?(下降|下滑)\s*50(\.0+)?\s*% |

### 5.4 评委标签纠正记录

评委返回的标签与它自己给出的分差方向矛盾时，工具以分差方向为准并在此记录。本轮共纠正 1 条。

| 用例 | 次数 | 原始标签 | 纠正后 | 分差 | 说明 |
| --- | --- | --- | --- | --- | --- |
| adversarial-forecast-and-causality | 2 | loss | win | +25 | 评委标签 loss 与分差 +25 方向矛盾，按分差方向纠正为 win |

## 6. 规则与评委的分歧

| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |
| --- | --- | --- | --- | --- | --- |
| direct-answer-no-six-section | 1 | skill | 违反 | win | 规则断言判定 skill 与 baseline 表现相当，但评委认为改善；以规则断言为准 |
| direct-answer-no-six-section | 2 | skill | 违反 | win | 规则断言判定 skill 与 baseline 表现相当，但评委认为改善；以规则断言为准 |
| trap-incomplete-period | 1 | skill | 通过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |
| trap-incomplete-period | 2 | skill | 通过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |

> 规则断言优先级高于模型评委，上表以规则为准。分歧本身提示任务设计或 skill 声明存在偏差。

## 7. 未验证项与限制

无特别限制。

## 8. 优化建议（已通过，以下为可加固项）

skill 已通过测评，但仍有可加固的契约：3 条断言失败，其中 1 条属于「约束不稳」。优先处理这一类，其余见下方明细。

### 8.1 按失败模式归类

| 失败模式 | 条数 | 说明 |
| --- | --- | --- |
| 约束不稳 | 1 | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。 |
| 契约无效 | 2 | 这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束（而不是靠模型自己推测），必要时补成明确的红线条目。 |

### 8.2 逐条失败明细

| 用例 | 断言 | 失败模式 | 失败原因 |
| --- | --- | --- | --- |
| direct-answer-no-six-section | mustMatch（直答形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单「或已判定为直答并说明理由」）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增） | 契约无效 | 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |
| trap-average-of-average | mustMatch（第六段四要素含跟踪指标（SKILL.md 第二节第六段写法）） | 约束不稳 | 未匹配到 跟踪指标|监控指标|验证指标 |
| trap-average-of-average | mustMatch（直答/体检形态须显式声明输出形态（SKILL.md 第二节输出分级 + 第七节检查清单）；措辞对齐 skill 自带门禁 scripts/quality_check.py 的 RE_DIRECT_MODE｜v2 新增） | 契约无效 | 未匹配到 输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态 |

> 「契约未落地」= baseline 能做到、装 skill 后反而做不到，是 skill 的真问题；
> 「契约无效」= baseline 也做不到，说明 skill 没把这条约束写清楚。
> 「断言过严」= 输出内容其实做到了，只是用了断言没覆盖的措辞——**要改的是套件，不是 skill**。
> baseline 本来就能过的断言不算 skill 的问题，不列入建议。

### 下一步

本 skill 已通过测评并归档。上述失败项是**可选的加固项**，不影响本次结论：

1. skill 侧要改的 3 条：按上表「约束不稳」等模式的建议逐条改 SKILL.md。
2. 若要改 skill，请**保持同一套件与模型**重新评估，只改 skill 内容——否则无法归因。
3. 修改后的 skill 版本号递增，归档区会保留上一版快照便于对比。

## 9. 结论

**有效** — 激活率 100.0%（触发稳定），胜率 60.0%（有实质提升）。该 skill 在当前用例集下有效。

### 结论边界

- 本结论仅覆盖上述运行配置下的用例集，不外推到未测任务。
- 判定基于模型输出质量，不是业务真实效果。

---

报告由 skill-eval 生成 · 运行 `run-20261105-034418-362c94b9` · 证据目录 `本目录`