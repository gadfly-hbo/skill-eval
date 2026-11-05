/**
 * 全局评估阈值配置与依据说明（单一真相来源）。
 *
 * 将原本散落在 CLI、报告渲染、归档门控与回归检查中的魔法数字集中管理，
 * 避免判定阈值与展示判读阈值不一致或各自漂移。
 */

/** 默认每用例重复运行次数：3 次起才能避免 1/2 单次翻转定胜负（见阴性对照报告第 6 节）。 */
export const DEFAULT_REPEAT = 3;

/** 默认评委重复轮数：至少 2 轮才能启用正反顺序的位置偏好探测。 */
export const DEFAULT_JUDGE_REPEAT = 2;

/**
 * 激活率（召回率）判定门槛：60%。
 * 低于 60% 说明超过四成应当触发的场景模型根本没读 skill，改内容收效甚微。
 */
export const ACTIVATION_THRESHOLD = 0.6;

/**
 * 激活率「充分」展示线：80%。
 * 60%–80% 虽越过门槛但属于「压线达标（偶有漏触发）」，报告单独区分。
 */
export const ACTIVATION_STRONG_THRESHOLD = 0.8;

/**
 * 负向用例（shouldActivate=false）最大允许误触发率：20%。
 * 超过 20% 说明 frontmatter description 写得过泛，污染无关任务。
 */
export const MAX_FALSE_ACTIVATION_RATE = 0.2;

/**
 * 成对评委胜率判定门槛：60%。
 * 按已判定计分对（及规则纠偏/不对称超时惩罚后）计，至少六成胜出才算明显优于 baseline。
 */
export const WIN_RATE_THRESHOLD = 0.6;

/**
 * 胜率「实质提升」展示线：70%。
 * 60%–70% 在小样本下紧贴判定边界，报告判读标为「压线达标」以提示边界不确定性。
 */
export const WIN_RATE_STRONG_THRESHOLD = 0.7;

/** 胜率弱提升观察线：45%（45%–60% 为「提升不显著」，低于 45% 为「无提升甚至倒退」）。 */
export const WIN_RATE_MARGINAL_THRESHOLD = 0.45;

/**
 * 全样本胜率下界门槛：50%。
 * 把所有未判定（not_judged / 超时 / 崩溃）计分对全部算进分母后，win 占比仍须 ≥ 50%，
 * 防止大量超时把不利样本剔除出分母后靠幸存样本拿到高胜率（实测 deep-research 4/10 评判 3 win = 75%，全样本仅 30%）。
 */
export const MIN_WIN_RATE_LOWER_BOUND = 0.5;

/**
 * 有效评判覆盖率门槛：70%。
 * 计分 pair 中成功完成评判的比例低于 70% 时，缺失数据过多，强制判为 inconclusive。
 */
export const MIN_PAIR_COVERAGE = 0.7;

/**
 * 最低有效判定对数：4 对。
 * 计分判定不足 4 对时，单次波动至少占 25pp–33pp，样本不足以给出 effective 结论。
 */
export const MIN_JUDGED_PAIRS = 4;

/**
 * skill 侧最大允许超时率：20%。
 * 超过 20% 的运行因超时中断说明 skill 过重或陷入死循环，不能判为稳定有效。
 */
export const MAX_VARIANT_TIMEOUT_RATE = 0.2;

/**
 * 规则断言条目累计增益门槛（百分点）：10pp。
 * 来自阴性对照实验：原版 skill +50.0pp，剥离行为契约的破坏版 +8.6pp，10pp 位于两者之间。
 */
export const GAIN_THRESHOLD_PP = 10;

/** 断言增益「显著改善」展示线：20pp（10pp–20pp 显示为「压线改善」）。 */
export const GAIN_STRONG_THRESHOLD_PP = 20;

/**
 * 无区分度断言（白送断言）判定线：baseline 通过率 ≥ 80%。
 * 对齐 suite-design.md「没读 skill 的模型有超过八成把握满足，删掉或改严」。
 */
export const INSENSITIVE_BASELINE_PASS_RATE = 0.8;

/**
 * 成本「昂贵」红线：
 * - token 倍率 > 5x 且单次净增 > 20,000 tokens；或
 * - 每 1pp 断言增益消耗的额外 token > 5,000；或
 * - 耗时倍率 > 4x 且单次净增 > 60s。
 * 越过红线时保留有效判定但标记 costGrade="expensive"（报告呈现「有效但昂贵」）。
 */
export const COST_WARN_TOKEN_RATIO = 5.0;
export const COST_WARN_DELTA_TOKENS = 20_000;
export const COST_WARN_TOKENS_PER_PP = 5_000;
export const COST_WARN_DURATION_RATIO = 4.0;
export const COST_WARN_DELTA_DURATION_SEC = 60;

/**
 * 成本「失控」红线：token 膨胀 > 30x 且每 1pp 增益消耗 > 20,000 tokens。
 * 触发失控红线时降级为 inconclusive，要求先瘦身 skill 再上线。
 */
export const COST_RUNAWAY_TOKEN_RATIO = 30.0;
export const COST_RUNAWAY_TOKENS_PER_PP = 20_000;

/** 回归门禁默认最大允许下降幅度。 */
export const REGRESSION_MAX_SCORE_DROP = 0.1;
export const REGRESSION_MAX_ACTIVATION_DROP = 0.2;

/** 置信水平 z 值（95% 双侧正态分位数）。 */
export const Z_95 = 1.959963984540054;
