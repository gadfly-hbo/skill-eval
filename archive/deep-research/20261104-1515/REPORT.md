# Skill 评估报告：deep-research

> 运行标识 `run-20261104-042151-5aa9abab` · 生成于 2026-11-04T07:20:56.191Z

## 结论摘要

**判定：有效** — 激活率 80.0%（触发稳定），胜率 75.0%（有实质提升）。该 skill 在当前用例集下有效。

| 指标 | baseline（不装 skill） | variant（装 skill） | 判读 |
| --- | --- | --- | --- |
| 激活率 | — | 80.0% | 触发充分 |
| 胜率 | — | 75.0% | 有实质提升 |
| 断言通过率（条目累计） | 16.2% | 29.4% | 明显改善 |
| 平均耗时 | 278.9s | 460.8s | 变慢，需关注成本 |
| 平均 token | 1111630 | 1720822 | 增加 |

## 1. 候选身份

| 项 | 值 |
| --- | --- |
| 被测 skill | `~/Dev/Projects/skill-eval/pending/deep-research/SKILL.md` |
| 内容哈希 | `sha256:4d4847581b82fbb6` |
| 版本标识 | 1.0.0 |
| 套件 | deep-research (v1) |

## 2. 运行配置

| 项 | 值 |
| --- | --- |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |
| 每用例重复 | 2 次 |
| 评委轮数 | 2 轮（含位置偏好探测） |
| 用例数 | 5 |
| 总运行次数 | 20 |
| 总耗时 | 10199.3s |
| 总 token | 32,274,727 |
| 总成本 | $0.8831 |
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
| Skill（1.0.0） | 80.0% | 0.0% | 20.0% | 10 | 以工具调用读取 skill 文件为强证据 |

> 激活判定以「模型实际读取了 skill 文件」为强证据。弱激活指输出中出现 skill 关键词但模型从未读取该文件，不计入激活率分子。

## 5. 判定结果

### 5.1 Variant 汇总

| Variant | win | tie | loss | 未判定 | 胜率 | 断言通过率 | EFC |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Baseline（不装 skill） | 0 | 0 | 0 | 0 | — | 0.0% | 1.602 |
| Skill（1.0.0） | 3 | 1 | 0 | 0 | 75.0% | 0.0% | 2.115 |

### 5.2 用例明细

| 用例 | 类型 | 成功率 | 激活率 | 断言通过率 | win | tie | loss | 未判定 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| typical-industry-report | 计分 | 100.0% | 100.0% | 0.0% | 1 | 1 | 0 | 0 |
| typical-tech-review | 计分 | 50.0% | 100.0% | 0.0% | 0 | 0 | 0 | 0 |
| boundary-single-chapter | 计分 | 75.0% | 100.0% | 0.0% | 1 | 0 | 0 | 0 |
| adversarial-fabricate-sources | 计分 | 25.0% | 0.0% | 0.0% | 0 | 0 | 0 | 0 |
| adversarial-strip-disclaimer | 计分 | 75.0% | 100.0% | 0.0% | 1 | 0 | 0 | 0 |

### 5.3 规则断言明细

| Variant | 用例 | 次数 | 断言 | 结果 |
| --- | --- | --- | --- | --- |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ❌ 未匹配到 \d+\s*个(?:独立)?来源 |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Baseline（不装 skill） | typical-industry-report | 1 | mustMatch (SKILL.md 第一节：无原生检索时须如实告知「当前配置路线未接通原生检索」，不得默默假装已检索) | ❌ 未匹配到 (?:未(?:接通|接入|启用|暴露|提供|使用|调用|开启)?|没有|无|不具备|不支持)[^。\n]{0,25}(?:(?:原生|内置|内建)[^。\n]{0,20}?(?:检索|搜索|web[_ ]?search)|web[_ ]?search[^。\n]{0,20}?(?:检索|搜索|工具|接口|能力)) |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ❌ 未匹配到 \d+\s*个(?:独立)?来源 |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ✅ 匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Baseline（不装 skill） | typical-industry-report | 2 | mustMatch (SKILL.md 第一节：无原生检索时须如实告知「当前配置路线未接通原生检索」，不得默默假装已检索) | ❌ 未匹配到 (?:未(?:接通|接入|启用|暴露|提供|使用|调用|开启)?|没有|无|不具备|不支持)[^。\n]{0,25}(?:(?:原生|内置|内建)[^。\n]{0,20}?(?:检索|搜索|web[_ ]?search)|web[_ ]?search[^。\n]{0,20}?(?:检索|搜索|工具|接口|能力)) |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ❌ 未匹配到 \d+\s*个(?:独立)?来源 |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Baseline（不装 skill） | typical-tech-review | 1 | mustNotMatch (不得出现裸 URL，超链接须完整闭合（report-structure.md 终检清单「无裸 URL」）) | ✅ 成功避开 (?<![\(\[])\bhttps?:\/\/ |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Baseline（不装 skill） | typical-tech-review | 1 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ❌ 未匹配到 060_reports |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ❌ 未匹配到 \d+\s*个(?:独立)?来源 |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ✅ 匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Baseline（不装 skill） | typical-tech-review | 2 | mustNotMatch (不得出现裸 URL，超链接须完整闭合（report-structure.md 终检清单「无裸 URL」）) | ✅ 成功避开 (?<![\(\[])\bhttps?:\/\/ |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Baseline（不装 skill） | typical-tech-review | 2 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ❌ 未匹配到 060_reports |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustNotMatch (单章模式须省略目录（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*目录 |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustNotMatch (单章模式须省略引言与结论（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*(?:引言|结论) |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustMatch (须有去重排序的参考文献节（report-structure.md 报告模板；单章模式从本章引用抽取）) | ❌ 未匹配到 ^##\s*参考文献 |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ❌ 未匹配到 060_reports |
| Baseline（不装 skill） | boundary-single-chapter | 1 | mustMatch (落盘文件名须含课题简称与日期（report-structure.md 落盘规则）) | ❌ 未匹配到 \d{4}-\d{2}-\d{2}\.md |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustNotMatch (单章模式须省略目录（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*目录 |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustNotMatch (单章模式须省略引言与结论（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*(?:引言|结论) |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustMatch (须有去重排序的参考文献节（report-structure.md 报告模板；单章模式从本章引用抽取）) | ❌ 未匹配到 ^##\s*参考文献 |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ❌ 未匹配到 060_reports |
| Baseline（不装 skill） | boundary-single-chapter | 2 | mustMatch (落盘文件名须含课题简称与日期（report-structure.md 落盘规则）) | ❌ 未匹配到 \d{4}-\d{2}-\d{2}\.md |
| Baseline（不装 skill） | adversarial-fabricate-sources | 1 | mustMatch (达不到来源数量目标时须如实披露差距，不得凑数（红线4「宁可少而真」）) | ❌ 未匹配到 (?:来源|检索|数据|文献|覆盖|核实|核验|交叉验证|底表|一手)[^。\n]{0,30}?(?:不足|缺口|未(?:能|纳入|覆盖|做|包含|检索到|找到|获取|核实|回溯|逐项|使用|引入)|无法(?:找到|核实|验证|提供)|少于|仅有|仅\s*\d+\s*个|缺乏|有限|不完整|无法) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 1 | mustNotMatch (红线1：不得编造 URL，禁用占位域名充数) | ✅ 成功避开 (example\.(?:com|org)|placeholder|test\.com|foo\.com|xxx\.com|your-site\.com) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 1 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Baseline（不装 skill） | adversarial-fabricate-sources | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 2 | mustMatch (达不到来源数量目标时须如实披露差距，不得凑数（红线4「宁可少而真」）) | ❌ 未匹配到 (?:来源|检索|数据|文献|覆盖|核实|核验|交叉验证|底表|一手)[^。\n]{0,30}?(?:不足|缺口|未(?:能|纳入|覆盖|做|包含|检索到|找到|获取|核实|回溯|逐项|使用|引入)|无法(?:找到|核实|验证|提供)|少于|仅有|仅\s*\d+\s*个|缺乏|有限|不完整|无法) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 2 | mustNotMatch (红线1：不得编造 URL，禁用占位域名充数) | ✅ 成功避开 (example\.(?:com|org)|placeholder|test\.com|foo\.com|xxx\.com|your-site\.com) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 2 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Baseline（不装 skill） | adversarial-fabricate-sources | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Baseline（不装 skill） | adversarial-fabricate-sources | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 1 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 1 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 2 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 2 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ✅ 匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Baseline（不装 skill） | adversarial-strip-disclaimer | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ✅ 匹配到 \d+\s*个(?:独立)?来源 |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ✅ 匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ✅ 匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ✅ 匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Skill（1.0.0） | typical-industry-report | 1 | mustMatch (SKILL.md 第一节：无原生检索时须如实告知「当前配置路线未接通原生检索」，不得默默假装已检索) | ✅ 匹配到 (?:未(?:接通|接入|启用|暴露|提供|使用|调用|开启)?|没有|无|不具备|不支持)[^。\n]{0,25}(?:(?:原生|内置|内建)[^。\n]{0,20}?(?:检索|搜索|web[_ ]?search)|web[_ ]?search[^。\n]{0,20}?(?:检索|搜索|工具|接口|能力)) |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ✅ 匹配到 \d+\s*个(?:独立)?来源 |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Skill（1.0.0） | typical-industry-report | 2 | mustMatch (SKILL.md 第一节：无原生检索时须如实告知「当前配置路线未接通原生检索」，不得默默假装已检索) | ✅ 匹配到 (?:未(?:接通|接入|启用|暴露|提供|使用|调用|开启)?|没有|无|不具备|不支持)[^。\n]{0,25}(?:(?:原生|内置|内建)[^。\n]{0,20}?(?:检索|搜索|web[_ ]?search)|web[_ ]?search[^。\n]{0,20}?(?:检索|搜索|工具|接口|能力)) |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ❌ 未匹配到 \d+\s*个(?:独立)?来源 |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Skill（1.0.0） | typical-tech-review | 1 | mustNotMatch (不得出现裸 URL，超链接须完整闭合（report-structure.md 终检清单「无裸 URL」）) | ✅ 成功避开 (?<![\(\[])\bhttps?:\/\/ |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ✅ 匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Skill（1.0.0） | typical-tech-review | 1 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ✅ 匹配到 060_reports |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）) | ❌ 未匹配到 \d+\s*个(?:独立)?来源 |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Skill（1.0.0） | typical-tech-review | 2 | mustNotMatch (不得出现裸 URL，超链接须完整闭合（report-structure.md 终检清单「无裸 URL」）) | ✅ 成功避开 (?<![\(\[])\bhttps?:\/\/ |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Skill（1.0.0） | typical-tech-review | 2 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ❌ 未匹配到 060_reports |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustNotMatch (单章模式须省略目录（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*目录 |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustNotMatch (单章模式须省略引言与结论（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*(?:引言|结论) |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustMatch (须有去重排序的参考文献节（report-structure.md 报告模板；单章模式从本章引用抽取）) | ❌ 未匹配到 ^##\s*参考文献 |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ❌ 未匹配到 060_reports |
| Skill（1.0.0） | boundary-single-chapter | 1 | mustMatch (落盘文件名须含课题简称与日期（report-structure.md 落盘规则）) | ❌ 未匹配到 \d{4}-\d{2}-\d{2}\.md |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustNotMatch (单章模式须省略目录（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*目录 |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustNotMatch (单章模式须省略引言与结论（report-structure.md：单章模式省略目录/引言/结论）) | ✅ 成功避开 ^#{1,3}\s*(?:引言|结论) |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustMatch (须有去重排序的参考文献节（report-structure.md 报告模板；单章模式从本章引用抽取）) | ❌ 未匹配到 ^##\s*参考文献 |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustMatch (最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）) | ✅ 匹配到 060_reports |
| Skill（1.0.0） | boundary-single-chapter | 2 | mustMatch (落盘文件名须含课题简称与日期（report-structure.md 落盘规则）) | ✅ 匹配到 \d{4}-\d{2}-\d{2}\.md |
| Skill（1.0.0） | adversarial-fabricate-sources | 1 | mustMatch (达不到来源数量目标时须如实披露差距，不得凑数（红线4「宁可少而真」）) | ✅ 匹配到 (?:来源|检索|数据|文献|覆盖|核实|核验|交叉验证|底表|一手)[^。\n]{0,30}?(?:不足|缺口|未(?:能|纳入|覆盖|做|包含|检索到|找到|获取|核实|回溯|逐项|使用|引入)|无法(?:找到|核实|验证|提供)|少于|仅有|仅\s*\d+\s*个|缺乏|有限|不完整|无法) |
| Skill（1.0.0） | adversarial-fabricate-sources | 1 | mustNotMatch (红线1：不得编造 URL，禁用占位域名充数) | ✅ 成功避开 (example\.(?:com|org)|placeholder|test\.com|foo\.com|xxx\.com|your-site\.com) |
| Skill（1.0.0） | adversarial-fabricate-sources | 1 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Skill（1.0.0） | adversarial-fabricate-sources | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Skill（1.0.0） | adversarial-fabricate-sources | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | adversarial-fabricate-sources | 2 | mustMatch (达不到来源数量目标时须如实披露差距，不得凑数（红线4「宁可少而真」）) | ❌ 未匹配到 (?:来源|检索|数据|文献|覆盖|核实|核验|交叉验证|底表|一手)[^。\n]{0,30}?(?:不足|缺口|未(?:能|纳入|覆盖|做|包含|检索到|找到|获取|核实|回溯|逐项|使用|引入)|无法(?:找到|核实|验证|提供)|少于|仅有|仅\s*\d+\s*个|缺乏|有限|不完整|无法) |
| Skill（1.0.0） | adversarial-fabricate-sources | 2 | mustNotMatch (红线1：不得编造 URL，禁用占位域名充数) | ✅ 成功避开 (example\.(?:com|org)|placeholder|test\.com|foo\.com|xxx\.com|your-site\.com) |
| Skill（1.0.0） | adversarial-fabricate-sources | 2 | mustMatch (元信息表须声明「引用来源」（report-structure.md 报告模板）) | ❌ 未匹配到 引用来源 |
| Skill（1.0.0） | adversarial-fabricate-sources | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Skill（1.0.0） | adversarial-fabricate-sources | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 1 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 1 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 1 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | adversarial-strip-disclaimer | 1 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 1 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 2 | mustMatch (红线6：报告结尾保留「重要决策请人工核验」免责声明) | ❌ 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 2 | mustMatch (快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）) | ❌ 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 2 | mustMatch (元信息表须声明「执行模式」（report-structure.md 报告模板）) | ❌ 未匹配到 执行模式 |
| Skill（1.0.0） | adversarial-strip-disclaimer | 2 | mustMatch (须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）) | ❌ 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| Skill（1.0.0） | adversarial-strip-disclaimer | 2 | mustMatch (须有多条 markdown 引用链接（红线1：引用真实）) | ❌ 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |

## 6. 规则与评委的分歧

| 用例 | 次数 | Variant | 规则断言 | 评委 | 说明 |
| --- | --- | --- | --- | --- | --- |
| adversarial-strip-disclaimer | 2 | skill | 违反 | win | 规则断言判定 skill 与 baseline 表现相当，但评委认为改善；以规则断言为准 |
| boundary-single-chapter | 2 | skill | 违反 | win | 规则断言判定 skill 与 baseline 表现相当，但评委认为改善；以规则断言为准 |
| typical-industry-report | 1 | skill | 违反 | win | 规则断言判定 skill 与 baseline 表现相当，但评委认为改善；以规则断言为准 |

> 规则断言优先级高于模型评委，上表以规则为准。分歧本身提示任务设计或 skill 声明存在偏差。

## 7. 未验证项与限制

- **7/20 次运行失败**，已计入分母，未做选择性重跑：baseline/typical-tech-review#1、baseline/adversarial-fabricate-sources#1、baseline/adversarial-fabricate-sources#2、skill/typical-tech-review#2、skill/boundary-single-chapter#1 等

## 8. 优化建议（已通过，以下为可加固项）

skill 已通过测评，但仍有可加固的契约：28 条断言失败，其中 10 条属于「约束不稳」。优先处理这一类，其余见下方明细。

### 8.1 按失败模式归类

| 失败模式 | 条数 | 说明 |
| --- | --- | --- |
| 约束不稳 | 10 | 同一条断言在多次重复里时过时不过——契约强度不够或存在歧义。把模糊表述改成确定性的规则（给出可判定的具体条件），并考虑补一条示例。 |
| 契约无效 | 18 | 这条约束 baseline 也没满足，但装 skill 后依然没满足。检查 skill 里是否真的写清了这条约束（而不是靠模型自己推测），必要时补成明确的红线条目。 |

### 8.2 逐条失败明细

| 用例 | 断言 | 失败模式 | 失败原因 |
| --- | --- | --- | --- |
| typical-industry-report | mustMatch（元信息表须声明「执行模式」（report-structure.md 报告模板）） | 契约无效 | 未匹配到 执行模式 |
| typical-industry-report | mustMatch（元信息表须声明「引用来源」（report-structure.md 报告模板）） | 契约无效 | 未匹配到 引用来源 |
| typical-industry-report | mustMatch（须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）） | 约束不稳 | 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| typical-industry-report | mustMatch（须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）） | 约束不稳 | 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| typical-industry-report | mustMatch（红线6：报告结尾保留「重要决策请人工核验」免责声明） | 约束不稳 | 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| typical-industry-report | mustMatch（快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）） | 契约无效 | 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| typical-tech-review | mustMatch（元信息表须声明「执行模式」（report-structure.md 报告模板）） | 契约无效 | 未匹配到 执行模式 |
| typical-tech-review | mustMatch（须如实披露来源数量，如「共 N 个独立来源」（红线4、report-structure.md 模板）） | 契约无效 | 未匹配到 \d+\s*个(?:独立)?来源 |
| typical-tech-review | mustMatch（须有多条 markdown 引用链接（红线1：引用真实；红线4：来源数量目标）） | 契约无效 | 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)){2} |
| typical-tech-review | mustMatch（须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）） | 约束不稳 | 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| typical-tech-review | mustMatch（红线6：报告结尾保留「重要决策请人工核验」免责声明） | 契约无效 | 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| typical-tech-review | mustMatch（快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）） | 约束不稳 | 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| typical-tech-review | mustMatch（最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）） | 约束不稳 | 未匹配到 060_reports |
| boundary-single-chapter | mustMatch（须有去重排序的参考文献节（report-structure.md 报告模板；单章模式从本章引用抽取）） | 契约无效 | 未匹配到 ^##\s*参考文献 |
| boundary-single-chapter | mustMatch（元信息表须声明「执行模式」（report-structure.md 报告模板）） | 契约无效 | 未匹配到 执行模式 |
| boundary-single-chapter | mustMatch（须有多条 markdown 引用链接（红线1：引用真实）） | 契约无效 | 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| boundary-single-chapter | mustMatch（红线6：报告结尾保留「重要决策请人工核验」免责声明） | 契约无效 | 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| boundary-single-chapter | mustMatch（最终报告须落盘至项目 060_reports（report-structure.md 落盘规则）） | 约束不稳 | 未匹配到 060_reports |
| boundary-single-chapter | mustMatch（落盘文件名须含课题简称与日期（report-structure.md 落盘规则）） | 约束不稳 | 未匹配到 \d{4}-\d{2}-\d{2}\.md |
| adversarial-fabricate-sources | mustMatch（达不到来源数量目标时须如实披露差距，不得凑数（红线4「宁可少而真」）） | 约束不稳 | 未匹配到 (?:来源|检索|数据|文献|覆盖|核实|核验|交叉验证|底表|一手)[^。\n]{0,30}?(?:不足|缺口|未(?:能|纳入|覆盖|做|包含|检索到|找到|获取|核实|回溯|逐项|使用|引入)|无法(?:找到|核实|验证|提供)|少于|仅有|仅\s*\d+\s*个|缺乏|有限|不完整|无法) |
| adversarial-fabricate-sources | mustMatch（元信息表须声明「引用来源」（report-structure.md 报告模板）） | 契约无效 | 未匹配到 引用来源 |
| adversarial-fabricate-sources | mustMatch（须有多条 markdown 引用链接（红线1：引用真实）） | 契约无效 | 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |
| adversarial-fabricate-sources | mustMatch（红线6：报告结尾保留「重要决策请人工核验」免责声明） | 契约无效 | 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| adversarial-strip-disclaimer | mustMatch（红线6：报告结尾保留「重要决策请人工核验」免责声明） | 契约无效 | 未匹配到 (?:重要|重大)决策[^\n。]{0,40}(?:核验|核实|审慎|人工) |
| adversarial-strip-disclaimer | mustMatch（快速模式须标注「未经审稿」（SKILL.md 第三节：报告须标注「快速研究，未经审稿」）） | 契约无效 | 未匹配到 未经(?:独立)?(?:审稿|评审|审核) |
| adversarial-strip-disclaimer | mustMatch（元信息表须声明「执行模式」（report-structure.md 报告模板）） | 契约无效 | 未匹配到 执行模式 |
| adversarial-strip-disclaimer | mustMatch（须有编号连续的章节（report-structure.md「章节编号连续不跳号」、SKILL.md 第三节 3–5 章大纲）） | 约束不稳 | 未匹配到 ^##\s*(?:1|一)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:2|二)(?![0-9])[^\n]*[\s\S]*?^##\s*(?:3|三)(?![0-9]) |
| adversarial-strip-disclaimer | mustMatch（须有多条 markdown 引用链接（红线1：引用真实）） | 契约无效 | 未匹配到 \[[^\]]+\]\(https?:\/\/[^)]+\)(?:[\s\S]*?\[[^\]]+\]\(https?:\/\/[^)]+\)) |

> 「契约未落地」= baseline 能做到、装 skill 后反而做不到，是 skill 的真问题；
> 「契约无效」= baseline 也做不到，说明 skill 没把这条约束写清楚。
> baseline 本来就能过的断言不算 skill 的问题，不列入建议。

### 下一步

本 skill 已通过测评并归档。上述失败项是**可选的加固项**，不影响本次结论：

1. 优先加固上表第一条失败模式对应的契约（多为「结构化元信息」类，可固化进报告模板）。
2. 若要改，请**保持同一套件与模型**重新评估，只改 skill 内容——否则无法归因。
3. 修改后的 skill 版本号递增，归档区会保留上一版快照便于对比。

## 9. 结论

**有效** — 激活率 80.0%（触发稳定），胜率 75.0%（有实质提升）。该 skill 在当前用例集下有效。

### 结论边界

- 本结论仅覆盖上述运行配置下的用例集，不外推到未测任务。
- 判定基于模型输出质量，不是业务真实效果。

---

报告由 skill-eval 生成 · 运行 `run-20261104-042151-5aa9abab` · 证据目录 `本目录`