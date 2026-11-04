# 归档：deep-research 20261104-1515

> 本目录是某次评估中被判定为通过（`effective`）的 skill 快照。
> 快照内容与被测内容逐字节一致，内容哈希见下表。

## 身份

| 项 | 值 |
|---|---|
| 版本标识 | `20261104-1515` |
| skill 版本 | 1.0.0 |
| 源路径 | `~/Dev/Projects/skill-eval/pending/deep-research/SKILL.md` |
| 内容哈希 | `sha256:4d4847581b82fbb6` |
| 归档时间 | 2026-11-04T07:15:42.750Z |
| 运行标识 | `run-20261104-042151-5aa9abab` |

## 评估结论

| 项 | 值 |
|---|---|
| 结论 | **effective** |
| 结论说明 | 激活率 80.0%（触发稳定），胜率 75.0%（有实质提升）。该 skill 在当前用例集下有效。 |
| 激活率 | 80.0% |
| 胜率 | 75.0% |
| 断言通过率（条目累计） | baseline 16.2% → skill 29.4%（增益 13.2 pp） |
| 断言通过率（整轮全过） | baseline 0.0% → skill 0.0% |
| 断言判定总数 | 136 |

> 两种断言口径都列出：条目累计口径用于增益比较，整轮全过口径是 `variantSummaries` 里的字段。

## 增益门槛

| 项 | 值 |
|---|---|
| 门槛 | 10 pp |
| 实测增益 | 13.2 pp |
| 判定 | ✅ 达标 |

> 门槛来自阴性对照实验：原版 skill +50.0pp，契约剥离后仅 +8.6pp。
> 断言整体灵敏度只有 51.9%，只看绝对通过率会把「模型本来就能做对」误当成 skill 的功劳。

## 运行配置

| 项 | 值 |
|---|---|
| 套件 | `deep-research`（版本 1） |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |

## 复现方式

```bash
skill-eval eval --suite <套件.json> --skill ~/Dev/Projects/skill-eval/pending/deep-research/SKILL.md --model minimax-cn/MiniMax-M3.1-Flash --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash --out <运行目录>
```

评估报告见同目录 `REPORT.md`。
