# 归档：data-analysis 1.8.0__20261105-1346

> 本目录是某次评估中被判定为通过（`effective`）的 skill 快照。
> 快照内容与被测内容逐字节一致，内容哈希见下表。

## 身份

| 项 | 值 |
|---|---|
| 版本标识 | `1.8.0__20261105-1346` |
| skill 版本 | 1.8.0 |
| 源路径 | `~/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md` |
| 内容哈希 | `sha256:25e72e3e5b5ec3ca` |
| 归档时间 | 2026-11-05T05:46:51.189Z |
| 运行标识 | `run-20261105-034418-362c94b9` |

## 评估结论

| 项 | 值 |
|---|---|
| 结论 | **effective** |
| 结论说明 | 激活率 100.0%（触发稳定），胜率 60.0%（有实质提升）。该 skill 在当前用例集下有效。 |
| 激活率 | 100.0% |
| 胜率 | 50.0% |
| 断言通过率（条目累计） | baseline 21.6% → skill 95.1%（增益 73.5 pp） |
| 断言通过率（整轮全过） | baseline 0.0% → skill 60.0% |
| 断言判定总数 | 204 |

> 两种断言口径都列出：条目累计口径用于增益比较，整轮全过口径是 `variantSummaries` 里的字段。

## 增益门槛

| 项 | 值 |
|---|---|
| 门槛 | 10 pp |
| 实测增益 | 73.5 pp |
| 判定 | ✅ 达标 |

> 门槛来自阴性对照实验：原版 skill +50.0pp，契约剥离后仅 +8.6pp。
> 断言整体灵敏度只有 51.9%，只看绝对通过率会把「模型本来就能做对」误当成 skill 的功劳。

## 运行配置

| 项 | 值 |
|---|---|
| 套件 | `data-analysis`（版本 2） |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |

## 复现方式

```bash
skill-eval eval --suite <套件.json> --skill ~/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md --model minimax-cn/MiniMax-M3.1-Flash --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash --out <运行目录>
```

评估报告见同目录 `REPORT.md`。
