# 归档：data-analysis 1.8.0__20261101-1435

> 本目录是某次评估中被判定为通过（`effective`）的 skill 快照。
> 快照内容与被测内容逐字节一致，内容哈希见下表。

## 身份

| 项 | 值 |
|---|---|
| 版本标识 | `1.8.0__20261101-1435` |
| skill 版本 | 1.8.0 |
| 源路径 | `~/.workbuddy/skills/data-analysis/SKILL.md` |
| 内容哈希 | `sha256:25e72e3e5b5ec3ca` |
| 归档时间 | 2026-11-03T15:13:16.894Z |
| 运行标识 | `run-20261101-143506-d421a79c` |

## 评估结论

| 项 | 值 |
|---|---|
| 结论 | **effective** |
| 结论说明 | 激活率 100.0%（触发稳定），胜率 60.0%（有实质提升）。该 skill 在当前用例集下有效。 |
| 激活率 | 100.0% |
| 胜率 | 60.0% |
| 断言通过率（条目累计） | baseline 50.0% → skill 100.0%（增益 50.0 pp） |
| 断言通过率（整轮全过） | baseline 30.0% → skill 100.0% |
| 断言判定总数 | 116 |

> 两种断言口径都列出：条目累计口径用于增益比较，整轮全过口径是 `variantSummaries` 里的字段。

## 运行配置

| 项 | 值 |
|---|---|
| 套件 | `suite-data-analysis`（版本 1.0） |
| 被评模型 | `minimax-cn/MiniMax-M3.1-Flash` |
| 评委模型 | `xiaomi-token-plan-cn/mimo-v2.6-flash` |

## 复现方式

```bash
skill-eval eval --suite <套件.json> --skill ~/.workbuddy/skills/data-analysis/SKILL.md --model minimax-cn/MiniMax-M3.1-Flash --judge-model xiaomi-token-plan-cn/mimo-v2.6-flash --out <运行目录>
```

评估报告见同目录 `REPORT.md`。
