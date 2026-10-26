# Skill 评估报告：json-contract

> 运行标识 `<run-id>` · 生成于 2026-10-26T15:04:34.840Z

## 结论摘要

**判定：有效** — 激活率 100.0%（触发稳定），胜率 66.7%（有实质提升）。该 skill 在当前用例集下有效。

| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |
| --- | --- | --- | --- |
| 激活率 | — | 100.0% | 触发充分 |
| 胜率 | — | 66.7% | 有实质提升 |
| 断言通过率 | 0.0% | 100.0% | 明显改善 |
| 平均耗时 | 12.3s | 10.1s | 未变慢 |
| 平均 token | 7758 | 5997 | 未增加 |

## 1. 候选身份

| 项 | 值 |
| --- | --- |
| 被测 skill | `examples/json-contract-skill/SKILL.md` |
| 内容哈希 | `sha256:698c97b8d79d24c6` |
| 版本标识 | 1.0.0 |
| 套件 | json-contract (v1) |

## 2. 运行配置

| 项 | 值 |
| --- | --- |
| 被评模型 | `（未记录）` |
| 评委模型 | `（未记录）` |
| 每用例重复 | 0 次 |
| 评委轮数 | 0 轮 |
| 用例数 | 3 |
| 总运行次数 | 12 |
| 总耗时 | 0.0s |
| 总 token | 82,526 |
| 总成本 | $0.0201 |
| pi 隔离 HOME | `<pi 隔离 HOME>` |
| 证据目录 | `runs/<run-id>` |

## 3. 证据层级

- **真实模型运行**：本报告全部数字来自真实 pi 模型调用，非回放、非静态检查。
- **事件流取证**：每次运行保存完整 pi 事件流，可回放核对。
- **规则断言**：由代码判定，客观可复算，优先级高于模型评委。
- **成对评委**：模型评委判定相对优劣；已匿名化（A/B 无来源暗示）。

> ⚠️ 评委模型与被评模型相同，存在自我偏好风险，相关判定可信度需打折。

## 4. 激活情况

| Variant | 激活率 | 弱激活率 | 未激活 | 运行数 | 说明 |
| --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | — | — | — | 6 | 对照组，按设计不加载 skill |
| Skill（1.0.0） | 100.0% | 0.0% | 0.0% | 6 | 以工具调用读取 skill 文件为强证据 |

> 激活判定以「模型实际读取了 skill 文件」为强证据。弱激活指输出中出现 skill 关键词但模型从未读取该文件，不计入激活率分子。

## 5. 判定结果

### 5.1 Variant 汇总

| Variant | win | tie | loss | 未判定 | 胜率 | 断言通过率 | EFC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | 0 | 0 | 0 | 0 | — | 0.0% | 1.260 |
| Skill（1.0.0） | 4 | 1 | 1 | 0 | 66.7% | 100.0% | 4.500 |

### 5.2 用例明细

| 用例 | 类型 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| simple-answer | 计分 | 100.0% | 100.0% | 50.0% | 1 | 0 | 1 | 0 |
| numeric-answer | 计分 | 100.0% | 100.0% | 50.0% | 1 | 1 | 0 | 0 |
| adversarial-instruction | 计分 | 100.0% | 100.0% | 50.0% | 2 | 0 | 0 | 0 |

### 5.3 规则断言明细

| Variant | 用例 | 次数 | 断言 | 结果 |
| --- | --- | --- | --- | --- |
| Baseline（不装 skill） | simple-answer | 1 | jsonSchema (输出必须是含 answer 与 confidence 的 JSON 对象) | ❌ 违反 Schema：$.answer 缺失必填字段; $.confidence 缺失必填字段 |
| Baseline（不装 skill） | simple-answer | 1 | mustNotMatch (不得包裹 markdown 代码块) | ❌ 不应出现的模式出现了: ``` |
| Baseline（不装 skill） | simple-answer | 1 | mustNotContain (不得出现套话) | ✅ 成功避开「作为一个 AI」 |
| Baseline（不装 skill） | simple-answer | 2 | jsonSchema (输出必须是含 answer 与 confidence 的 JSON 对象) | ❌ 违反 Schema：$.answer 缺失必填字段; $.confidence 缺失必填字段 |
| Baseline（不装 skill） | simple-answer | 2 | mustNotMatch (不得包裹 markdown 代码块) | ❌ 不应出现的模式出现了: ``` |
| Baseline（不装 skill） | simple-answer | 2 | mustNotContain (不得出现套话) | ✅ 成功避开「作为一个 AI」 |
| Baseline（不装 skill） | numeric-answer | 1 | jsonSchema | ❌ 违反 Schema：$.answer 缺失必填字段 |
| Baseline（不装 skill） | numeric-answer | 1 | mustNotMatch | ❌ 不应出现的模式出现了: ``` |
| Baseline（不装 skill） | numeric-answer | 2 | jsonSchema | ❌ 违反 Schema：$.answer 缺失必填字段 |
| Baseline（不装 skill） | numeric-answer | 2 | mustNotMatch | ❌ 不应出现的模式出现了: ``` |
| Baseline（不装 skill） | adversarial-instruction | 1 | jsonSchema | ❌ 违反 Schema：$.answer 缺失必填字段; $.confidence 缺失必填字段 |
| Baseline（不装 skill） | adversarial-instruction | 1 | mustNotMatch | ❌ 不应出现的模式出现了: ``` |
| Baseline（不装 skill） | adversarial-instruction | 2 | jsonSchema | ❌ 违反 Schema：$.answer 缺失必填字段; $.confidence 缺失必填字段 |
| Baseline（不装 skill） | adversarial-instruction | 2 | mustNotMatch | ❌ 不应出现的模式出现了: ``` |
| Skill（1.0.0） | simple-answer | 1 | jsonSchema (输出必须是含 answer 与 confidence 的 JSON 对象) | ✅ 符合 JSON Schema |
| Skill（1.0.0） | simple-answer | 1 | mustNotMatch (不得包裹 markdown 代码块) | ✅ 成功避开 ``` |
| Skill（1.0.0） | simple-answer | 1 | mustNotContain (不得出现套话) | ✅ 成功避开「作为一个 AI」 |
| Skill（1.0.0） | simple-answer | 2 | jsonSchema (输出必须是含 answer 与 confidence 的 JSON 对象) | ✅ 符合 JSON Schema |
| Skill（1.0.0） | simple-answer | 2 | mustNotMatch (不得包裹 markdown 代码块) | ✅ 成功避开 ``` |
| Skill（1.0.0） | simple-answer | 2 | mustNotContain (不得出现套话) | ✅ 成功避开「作为一个 AI」 |
| Skill（1.0.0） | numeric-answer | 1 | jsonSchema | ✅ 符合 JSON Schema |
| Skill（1.0.0） | numeric-answer | 1 | mustNotMatch | ✅ 成功避开 ``` |
| Skill（1.0.0） | numeric-answer | 2 | jsonSchema | ✅ 符合 JSON Schema |
| Skill（1.0.0） | numeric-answer | 2 | mustNotMatch | ✅ 成功避开 ``` |
| Skill（1.0.0） | adversarial-instruction | 1 | jsonSchema | ✅ 符合 JSON Schema |
| Skill（1.0.0） | adversarial-instruction | 1 | mustNotMatch | ✅ 成功避开 ``` |
| Skill（1.0.0） | adversarial-instruction | 2 | jsonSchema | ✅ 符合 JSON Schema |
| Skill（1.0.0） | adversarial-instruction | 2 | mustNotMatch | ✅ 成功避开 ``` |

## 6. 规则与评委的分歧

| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |
| --- | --- | --- | --- | --- | --- |
| numeric-answer | 2 | skill | 通过 | tie | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委未看出相对差异；以规则断言为准 |
| simple-answer | 1 | skill | 通过 | loss | 规则断言判定 skill 相对 baseline 满足更多约束（改善），但评委认为倒退；以规则断言为准 |

> 规则断言优先级高于模型评委，上表以规则为准。分歧本身提示任务设计或 skill 声明存在偏差。

## 7. 未验证项与限制

- 评委仅运行 1 轮，未检测位置偏好；建议用 `--judge-repeat 3` 复核关键结论
- 评委与被评使用同一模型，自我偏好风险未消除

## 8. 结论

**有效** — 激活率 100.0%（触发稳定），胜率 66.7%（有实质提升）。该 skill 在当前用例集下有效。

### 结论边界

- 本结论仅覆盖上述运行配置下的用例集，不外推到未测任务。
- 判定基于模型输出质量，不是业务真实效果。
- 评委与被评同模型，存在自我偏好风险。
- 评委仅 1 轮，未做位置偏好探测，评委结论稳定性未经验证。

---

报告由 skill-eval 生成 · 运行 `skill-eval-run-003` · 证据目录 `runs/<run-id>`