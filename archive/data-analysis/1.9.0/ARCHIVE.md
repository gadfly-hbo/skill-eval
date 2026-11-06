# 归档：data-analysis 1.9.0

> 本目录是某次评估中被判定为通过（`effective`）的 skill 快照。
> 快照内容与被测内容逐字节一致，内容哈希见下表。

## 身份

| 项 | 值 |
|---|---|
| 版本标识 | `1.9.0` |
| skill 版本 | 1.9.0 |
| 源路径 | `~/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md` |
| 内容哈希 | `sha256:63adebbaf67fdfde` |
| 归档时间 | 2026-11-06T02:27:20.818Z |
| 运行标识 | `run-20261105-142602-e4d3863f` |

## 评估结论

| 项 | 值 |
|---|---|
| 结论 | **effective**（有效但昂贵）（含部分运行失败 · provisional） |
| 结论说明 | 激活率 100.0%，胜率 78.6%、断言增益 +60.7pp，各项统计与覆盖率门禁均达标。该 skill 在当前用例集下有效（注意：成本偏高（token 40.1x，4,545 tokens/pp，耗时 4.3x），属于「有效但昂贵」）。 |
| 激活率 | 100.0% |
| 胜率 | 78.6% |
| 断言通过率（条目累计） | baseline 26.8% → skill 87.4%（增益 60.7 pp） |
| 断言通过率（整轮全过） | baseline 0.0% → skill 26.7% |
| 断言判定总数 | 301 |

> 两种断言口径都列出：条目累计口径用于增益比较，整轮全过口径是 `variantSummaries` 里的字段。

## 增益门槛

| 项 | 值 |
|---|---|
| 门槛 | 10 pp |
| 实测增益 | 60.7 pp |
| 判定 | ✅ 达标 |

> 门槛来自阴性对照实验：原版 skill +50.0pp，契约剥离后仅 +8.6pp。
> 断言整体灵敏度只有 51.9%，只看绝对通过率会把「模型本来就能做对」误当成 skill 的功劳。

## 运行配置

| 项 | 值 |
|---|---|
| 套件 | `data-analysis`（版本 2） |
| 套件哈希 | `sha256:7e7ff00adca64355` |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |

## 复现方式

```bash
skill-eval eval --suite <套件.json> --skill ~/Dev/Projects/skill-eval/pending/data-analysis/SKILL.md --model minimax-cn/MiniMax-M3.1-Flash --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash --out <运行目录>
```

评估报告见同目录 `REPORT.md`。
