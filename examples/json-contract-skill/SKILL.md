---
name: json-contract
description: 当需要输出结构化 JSON 结果时使用，强制固定字段与格式
---

# JSON 契约输出

输出**必须**是单个 JSON 对象，且满足以下约束：

1. 不要包裹 markdown 代码块（不要 ```json）。
2. 不要在 JSON 前后添加任何解释文字、寒暄或总结。
3. 字段固定为：
   - `answer`：字符串，对任务问题的直接回答。
   - `confidence`：数字，取值 0 到 1，表示回答的确信程度。
4. `answer` 内不得包含「作为一个 AI」这类套话，直接给结论。

示例输出：
{"answer": "建议先做灰度", "confidence": 0.85}
