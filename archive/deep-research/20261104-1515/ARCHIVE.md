# 归档：deep-research 20261104-1515

> ⚠️ **2026-11-05 门禁升级回溯审计**：本快照已从 `effective` 降级为 **`inconclusive`（`provisional: true`）**。
> 原跑批存在严重幸存者偏差：skill 侧 7/20 次运行超时（超时率 35% > 20% 上限），10 对计分样本仅 4 对完成评判（覆盖率 40% < 70% 门槛，全样本胜率下界仅 30%）；其中 `strip-disclaimer#2` 客观断言从 1/5 倒退至 0/5（规则纠偏后已判胜率降至 50%）；断言条目累计增益 +13.2pp 的 95% Newcombe-Wilson 置信区间为 `[-0.9pp, +26.8pp]`（跨越 0，未排除随机波动），且原跑批失败空输出运行曾污染负向断言分母。正式引入生产前须适当放宽 `--timeout` 并以 `repeat >= 3` 重跑复验。
>
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
| 结论 | **inconclusive**（`provisional: true`，原旧门禁标为 effective，2026-11-05 回溯降级） |
| 结论说明 | 激活率 80.0%，但超时率 35.0%、有效评判覆盖率仅 40.0%（4/10 对）、全样本胜率下界 30.0%、规则纠偏胜率 50.0%，且断言增益 +13.2pp 的 95% CI [-0.9pp, +26.8pp] 跨零，证据不足以认证有效。 |
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
