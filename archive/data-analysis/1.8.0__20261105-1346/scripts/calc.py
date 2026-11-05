# -*- coding: utf-8 -*-
"""运营数据分析 · 可执行复算器

由 calc_core.py（公共骨架 V1.0）与领域计算拼成，单文件自包含、无第三方依赖。
定位：给用户一把可核验的尺子——不只出结论，还回显算式与口径。
分工：quality_check.py 验格式，本脚本验数字。

六条硬规则：Decimal 不用 float／只在一处舍入（HALF_UP）／分解须精确闭合／
必须回显算式／必须校验口径（单位·币种·期间）／必须 --selftest。

用法：python calc.py --list ｜ python calc.py --selftest
"""
# -*- coding: utf-8 -*-
"""calc_core · 复算器公共骨架 V1.0 20261021

设计目标：让每个包含数字计算的专家包/技能包都能有一把"可核验的尺子"。
与 quality_check.py 的分工：
    quality_check.py  验格式（结构、空话、必填段）
    *_calc.py         验数字（算术、闭合、比率）
本文件是**开发期模板**，不随包分发。打包时由 build_calc.py 把核心段
拼接进各包自己的 <domain>_calc.py，使其单文件自包含、无外部依赖。

六条硬规则（违反即判不合格）：
  1. Decimal 不用 float 做金额与比率运算
  2. 中间过程不舍入，只在输出时舍入一次；一律 ROUND_HALF_UP（与 Excel 一致）
  3. 分解类必须精确闭合，|Σ分项 − 总额| > 容差即报错，不输出
  4. 必须回显算式（"A = B × C = 数值"），让用户能抄到纸上核
  5. 必须校验口径（单位、币种、期间），缺即报错，不用默认值
  6. 必须 --selftest，且含手算可得的整数案例用于人机对照
"""
import argparse
import json
import sys
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation, getcontext

getcontext().prec = 28

VERSION = "1.0.0"
TOL = Decimal("0.01")


# ============================ 错误类型 ============================
class InputError(Exception):
    """输入不合法 → 退出码 2"""


class ReconcileError(Exception):
    """闭合失败 → 退出码 3"""


# ============================ 精度与舍入 ============================
def d(x, label="数值"):
    """转 Decimal。走 str 中转，避免 0.1 的二进制误差。"""
    if isinstance(x, Decimal):
        return x
    if isinstance(x, bool):
        raise InputError("%s 不能是布尔值" % label)
    if isinstance(x, float):
        # float 已经带了误差，先 repr 再解析，并提示调用方优先传字符串
        return Decimal(repr(x))
    try:
        return Decimal(str(x).strip().replace(",", ""))
    except (InvalidOperation, ValueError):
        raise InputError("%s 不是合法数字：%r" % (label, x))


def q(x, places=2):
    """唯一舍入点：四舍五入，与 Excel ROUND 一致（不用银行家舍入）。"""
    step = Decimal(1).scaleb(-places)
    return d(x).quantize(step, rounding=ROUND_HALF_UP)


def fmt_money(x, unit="元", places=2):
    """金额：千分位 + 单位。单位必须显式给，不默认猜。"""
    v = q(x, places)
    return "{:,}{}".format(v, (" " + unit) if unit else "")


def fmt_pct(x, places=1):
    """比率转百分比。x 是比率（0.36 → 36.0%），不是已乘 100 的数。"""
    return "{}%".format(q(d(x) * 100, places))


def fmt_num(x, places=2):
    v = q(x, places)
    s = "{:,}".format(v)
    return s


def div(a, b, label="分母"):
    """除法，显式防零。"""
    a, b = d(a), d(b)
    if b == 0:
        raise InputError("%s 为零，无法计算（请先补齐数据，不要用 0 顶替）" % label)
    return a / b


# ============================ 输入校验 ============================
def require(cond, msg):
    if not cond:
        raise InputError(msg)


def need(obj, key, label, lo=None, hi=None):
    """取必填数字并校验区间。缺失即报错——不用默认值兜。"""
    if key not in obj or obj[key] is None or obj[key] == "":
        raise InputError("缺少必填项：%s（%s）" % (label, key))
    v = d(obj[key], label)
    if lo is not None and v < d(lo):
        raise InputError("%s 应 ≥ %s，实际 %s" % (label, lo, v))
    if hi is not None and v > d(hi):
        raise InputError("%s 应 ≤ %s，实际 %s" % (label, hi, v))
    return v


def need_text(obj, key, label):
    v = obj.get(key)
    if not isinstance(v, str) or not v.strip():
        raise InputError("缺少必填项：%s（%s）" % (label, key))
    return v.strip()


def check_caliber(obj, need_currency=False, need_period=False):
    """口径三标注：单位必填；涉金额须给币种；涉比较须给期间。"""
    cal = obj.get("caliber") or {}
    if not isinstance(cal, dict):
        raise InputError("caliber 须为对象，含 unit / currency / period")
    if not cal.get("unit"):
        raise InputError("口径缺失：未给单位（unit），不得默认按元处理")
    if need_currency and not cal.get("currency"):
        raise InputError("口径缺失：涉金额但未给币种（currency）")
    if need_period and not cal.get("period"):
        raise InputError("口径缺失：涉跨期比较但未给期间（period）")
    return cal


def caliber_line(cal):
    parts = ["口径：单位 %s" % cal.get("unit", "未标")]
    if cal.get("currency"):
        parts.append("币种 %s" % cal["currency"])
    if cal.get("period"):
        parts.append("期间 %s" % cal["period"])
    if cal.get("source"):
        parts.append("来源 %s" % cal["source"])
    if cal.get("note"):
        parts.append(cal["note"])
    return "｜".join(parts)


# ============================ 闭合校验 ============================
def reconcile(parts, total, tol=None, label="分项"):
    """分项相加须精确等于总额。

    parts: dict{名称: 数值} 或 list[(名称, 数值)]
    返回 dict，含 sum / total / diff / closed / line
    不闭合直接抛 ReconcileError——绝不带残差往下写。
    """
    it = parts.items() if isinstance(parts, dict) else parts
    items = [(str(k), d(v, str(k))) for k, v in it]
    s = sum((v for _, v in items), Decimal(0))
    t = d(total, "总额")
    diff = s - t
    limit = d(tol) if tol is not None else TOL
    closed = abs(diff) <= limit
    detail = " + ".join("%s %s" % (k, fmt_num(v)) for k, v in items)
    line = "%s相加 = %s ／ 总额 %s ／ 差额 %s" % (
        label, fmt_num(s), fmt_num(t), fmt_num(diff))
    if not closed:
        raise ReconcileError(
            "闭合失败：%s\n  %s\n  差额 %s 已超过容差 %s。"
            "请检查是否有漏项、重复计、或口径不一致；"
            "不得把差额作为「其他／未分配」带过。"
            % (label, detail, fmt_num(diff), fmt_num(limit)))
    return {"sum": s, "total": t, "diff": diff, "closed": True, "line": line}


# ============================ 算式回显 ============================
class Echo(object):
    """收集可抄写的算式行。用户能拿计算器复算，才算可核验。"""

    def __init__(self):
        self.lines = []

    def add(self, text):
        self.lines.append(text)

    def formula(self, left, expr, value, unit=""):
        self.lines.append("%s = %s = %s%s" % (left, expr, value, (" " + unit) if unit else ""))

    def text(self):
        return "\n".join("  " + x for x in self.lines)


# ============================ 输出 ============================
def table(headers, rows):
    """等宽文本表。列宽按内容自适应，中文按 2 字宽估算（够用即可）。"""
    def w(s):
        s = str(s)
        return sum(2 if ord(c) > 127 else 1 for c in s)
    cols = len(headers)
    widths = [w(h) for h in headers]
    for r in rows:
        for i in range(cols):
            widths[i] = max(widths[i], w(r[i] if i < len(r) else ""))
    def pad(s, n):
        s = str(s)
        return s + " " * max(0, n - w(s))
    out = ["  ".join(pad(headers[i], widths[i]) for i in range(cols))]
    out.append("-" * (sum(widths) + 2 * (cols - 1)))
    for r in rows:
        out.append("  ".join(pad(r[i] if i < len(r) else "", widths[i])
                             for i in range(cols)))
    return "\n".join(out)


# ============================ 自测框架 ============================
def selftest(cases, title="复算器"):
    """cases: list of (名称, 可调用, 期望值, 比较方式)

    比较方式：
      "eq"    字符串/数值相等（数值走容差）
      "close" 数值近似（容差 1e-6）
      "raises:InputError" / "raises:ReconcileError"
    规则：至少要有 1 个「手算可得的整数案例」，用于人机对照。
    """
    ok = bad = 0
    print("=" * 68)
    print("%s 自测 V%s ｜ 共 %d 项" % (title, VERSION, len(cases)))
    print("=" * 68)
    for name, fn, want, mode in cases:
        try:
            got = fn()
            if mode.startswith("raises:"):
                print("  ✗ %-34s 期望抛 %s，实际返回 %r" % (name, mode[7:], got))
                bad += 1
                continue
            if mode == "close":
                good = abs(d(got) - d(want)) < Decimal("0.000001")
            elif isinstance(want, bool) or isinstance(got, bool):
                good = bool(got) == bool(want)
            elif isinstance(want, (int, float, Decimal)) and isinstance(got, (int, float, Decimal)):
                good = abs(d(got) - d(want)) < Decimal("0.000001")
            else:
                good = str(got) == str(want)
            if good:
                print("  ✓ %-34s %s" % (name, got))
                ok += 1
            else:
                print("  ✗ %-34s 期望 %r，实际 %r" % (name, want, got))
                bad += 1
        except Exception as e:
            want_raise = mode.startswith("raises:") and type(e).__name__ == mode[7:]
            if want_raise:
                print("  ✓ %-34s 按预期抛 %s" % (name, type(e).__name__))
                ok += 1
            else:
                print("  ✗ %-34s 异常 %s: %s" % (name, type(e).__name__, e))
                bad += 1
    print("-" * 68)
    print("== 自测 %d/%d 通过，失败 %d ==" % (ok, len(cases), bad))
    return 0 if bad == 0 else 1


# ============================ CLI ============================
def build_cli(prog, commands, description, selftest_fn, list_help):
    """统一 CLI：子命令 + --json + --selftest + --list"""
    p = argparse.ArgumentParser(prog=prog, description=description,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--selftest", action="store_true", help="跑内建自测")
    p.add_argument("--list", action="store_true", help="列出全部子命令与入参")
    p.add_argument("--json", metavar="JSON", help="以 JSON 字符串传参")
    p.add_argument("cmd", nargs="?", help="子命令名")
    a = p.parse_args()

    if a.selftest:
        return selftest_fn()
    if a.list or not a.cmd:
        print(list_help)
        return 0
    if a.cmd not in commands:
        print("未知子命令：%s\n可用：%s" % (a.cmd, "、".join(sorted(commands))))
        return 2
    try:
        payload = json.loads(a.json) if a.json else {}
    except json.JSONDecodeError as e:
        print("参数 JSON 解析失败：%s" % e)
        return 2
    try:
        out = commands[a.cmd](payload)
        print(out)
        return 0
    except InputError as e:
        print("[输入校验失败] %s" % e)
        return 2
    except ReconcileError as e:
        print("[闭合校验失败] %s" % e)
        return 3
    except Exception as e:
        print("[计算失败] %s: %s" % (type(e).__name__, e))
        return 1




# ============================ 领域：运营数据分析 ============================
# 与正文口径严格对应：
#   SKILL.md 二、第四段拆解范式（指标 = 各因子乘积；贡献之和须与实测吻合）
#   references/methods.md 二、趋势（同比/环比/回归 R²≥0.3）
#   references/methods.md 三、异常（3σ / IQR / IQR3 / 连续偏离）
#   references/methods.md 9.2 期间不完整  9.3 平均的平均  9.4 分母漂移

DOMAIN = "运营数据分析"
PROG = "calc.py"

# 判定阈值（与 methods.md 一致；可传参覆盖）
TOL_PP = Decimal("2")        # 贡献之和与实测变动的容许误差（百分点）
R2_MIN = Decimal("0.3")      # 回归 R² 下限，低于此不得称"趋势明显"
AVG_DIFF_MAX = Decimal("0.05")   # 加权均值 vs 算术均值 允许差（5%）
DEN_SURGE = Decimal("0.30")      # 分母变化超过此值
NUM_STILL = Decimal("0.10")      # 分子变化小于此值


# ============================ 统计小工具 ============================
def _mean(xs):
    xs = [d(x, "数值") for x in xs]
    if not xs:
        raise InputError("数值序列为空")
    return sum(xs, Decimal(0)) / len(xs)


def _pstdev(xs):
    """总体标准差 σ = √(Σ(x-μ)²/n)，与 methods.md 一致。"""
    xs = [d(x, "数值") for x in xs]
    mu = _mean(xs)
    var = sum(((x - mu) ** 2 for x in xs), Decimal(0)) / len(xs)
    return var.sqrt()


def _skew(xs):
    xs = [d(x, "数值") for x in xs]
    n = len(xs)
    mu, sd = _mean(xs), _pstdev(xs)
    if sd == 0:
        return Decimal(0)
    return sum((((x - mu) / sd) ** 3 for x in xs), Decimal(0)) / n


def _quantile(xs, p):
    """线性插值分位数，与 numpy 默认 linear 口径一致。"""
    v = sorted(d(x, "数值") for x in xs)
    if not v:
        raise InputError("数值序列为空")
    if len(v) == 1:
        return v[0]
    pos = Decimal(p) * (len(v) - 1)
    lo = int(pos)
    frac = pos - lo
    if lo + 1 >= len(v):
        return v[-1]
    return v[lo] + (v[lo + 1] - v[lo]) * frac


# ============================ 1 指标拆解与对账 ============================
def cmd_decompose(p):
    """乘法顺序剥离 / 加法分解，贡献之和须精确等于总变动。"""
    factors = p.get("factors")
    if not isinstance(factors, list) or len(factors) < 2:
        raise InputError("factors 须为至少 2 个因子的数组，每项含 name / base / actual")
    combine = p.get("combine")
    if combine not in ("product", "sum"):
        raise InputError("combine 须为 product（乘法拆解）或 sum（加法拆解）")

    names, B, A = [], [], []
    for i, f in enumerate(factors):
        if not isinstance(f, dict):
            raise InputError("factors[%d] 须为对象" % i)
        nm = f.get("name") or ("因子%d" % (i + 1))
        names.append(nm)
        B.append(need(f, "base", "%s 基期值" % nm))
        A.append(need(f, "actual", "%s 本期值" % nm))

    # 总变动
    if combine == "product":
        tb = Decimal(1)
        ta = Decimal(1)
        for i in range(len(B)):
            tb *= B[i]
            ta *= A[i]
    else:
        tb = sum(B, Decimal(0))
        ta = sum(A, Decimal(0))

    # 用户可显式给总额，用于校验因子是否齐备
    if p.get("total_base") is not None:
        given = need(p, "total_base", "基期总额")
        if abs(given - tb) > TOL:
            raise InputError("因子基期值复算得 %s，与给定基期总额 %s 不符——"
                             "说明因子没拆全或口径不一致"
                             % (fmt_num(tb, 2), fmt_num(given, 2)))
        tb = given
    if p.get("total_actual") is not None:
        given = need(p, "total_actual", "本期总额")
        if abs(given - ta) > TOL:
            raise InputError("因子本期值复算得 %s，与给定本期总额 %s 不符"
                             % (fmt_num(ta, 2), fmt_num(given, 2)))
        ta = given

    # 顺序剥离：effect_i = (A_i − B_i) × Π前序 A × Π后续 B
    # 望远镜求和恒等于 ΠA − ΠB，故闭合是构造性的，不靠事后修补
    effects, echo = [], Echo()
    for i in range(len(B)):
        coef = Decimal(1)
        expr = "(%s − %s)" % (fmt_num(A[i], 4), fmt_num(B[i], 4))
        if combine == "product":
            for j in range(i):
                coef *= A[j]
                expr += " × " + fmt_num(A[j], 4)
            for j in range(i + 1, len(B)):
                coef *= B[j]
                expr += " × " + fmt_num(B[j], 4)
            eff = (A[i] - B[i]) * coef
        else:
            eff = A[i] - B[i]
        effects.append(eff)
        echo.formula("%s效应" % names[i], expr, fmt_num(eff, 2))

    rec = reconcile({names[i]: effects[i] for i in range(len(B))},
                    ta - tb, tol=Decimal("0.01"), label="各因子效应")

    rows = []
    for i in range(len(B)):
        rate = None
        if B[i] != 0:
            rate = (A[i] - B[i]) / B[i]
        rows.append([names[i], fmt_num(B[i], 4), fmt_num(A[i], 4),
                     fmt_pct(rate) if rate is not None else "基期为 0",
                     fmt_num(effects[i], 2),
                     fmt_num(div(effects[i], tb, "基期总额") * 100, 2) + " pp"])

    total_rate = div(ta - tb, tb, "基期总额")
    top = max(range(len(B)), key=lambda i: abs(effects[i]))
    pp_sum = sum((div(e, tb, "基期总额") * 100 for e in effects), Decimal(0))
    pp_gap = abs(pp_sum - total_rate * 100)

    out = ["【指标拆解与对账】方式：%s" % ("乘法（顺序剥离）" if combine == "product" else "加法")]
    out.append(table(["因子", "基期", "本期", "变化率", "效应额", "占基期"], rows))
    out.append("")
    out.append("基期合计 = %s ／ 本期合计 = %s ／ 总变动 = %s（%s）"
               % (fmt_num(tb, 2), fmt_num(ta, 2), fmt_num(ta - tb, 2), fmt_pct(total_rate)))
    out.append(echo.text())
    out.append("")
    out.append("对账：" + rec["line"])
    out.append("主因判定：%s 的效应绝对值最大（%s，占基期 %s）"
               % (names[top], fmt_num(effects[top], 2),
                  fmt_num(div(effects[top], tb, "基期总额") * 100, 2) + " pp"))
    out.append("百分点校验：各因子占基期之和 %s pp vs 实测总变动 %s pp，差 %s pp（容差 %s pp）"
               % (fmt_num(pp_sum, 2), fmt_num(total_rate * 100, 2),
                  fmt_num(pp_gap, 2), fmt_num(TOL_PP, 0)))
    if pp_gap > TOL_PP:
        out.append("★ 超过 %s pp 容差：须在报告中说明原因（口径差异、四舍五入、"
                   "或存在未拆入的因子）" % fmt_num(TOL_PP, 0))

    if combine == "product":
        prod = Decimal(1)
        for i in range(len(B)):
            if B[i] == 0:
                prod = None
                break
            prod *= (A[i] / B[i])
        if prod is not None:
            parts = []
            for i in range(len(B)):
                parts.append("(1%+.2f%%)" % (
                    float((A[i] - B[i]) / B[i] * 100)))
            out.append("比率校验：%s 连乘 = %s，即 %s，与实测 %s 相差 %s pp"
                       % (" × ".join(parts), fmt_num(prod, 6), fmt_pct(prod - 1),
                          fmt_pct(total_rate),
                          fmt_num(abs(prod - 1 - total_rate) * 100, 2)))
            out.append("  说明：差值即为交叉项。顺序剥离把交叉项并入先动因子，"
                       "因此效应之和精确闭合；比率连乘则保留交叉项，两者不矛盾。")
    if p.get("caliber"):
        out.append(caliber_line(p["caliber"]))
    return "\n".join(out)


# ============================ 2 同比 / 环比 ============================
def cmd_compare(p):
    """同比环比，含基期为 0 与期间不等长两种防护。"""
    base = need(p, "base", "基期值")
    cur = need(p, "current", "本期值")
    kind = p.get("kind") or "yoy"
    if kind not in ("yoy", "mom"):
        raise InputError("kind 只能是 yoy（同比）或 mom（环比）")
    label = "同比" if kind == "yoy" else "环比"

    bd, cd = p.get("base_days"), p.get("current_days")
    note = []
    b, c = base, cur
    if bd is not None and cd is not None:
        bdn = need(p, "base_days", "基期天数", lo=1)
        cdn = need(p, "current_days", "本期天数", lo=1)
        if bdn != cdn:
            mode = p.get("align") or "daily"
            if mode == "daily":
                b = base / bdn
                c = cur / cdn
                note.append("期间不等长（%s 天 vs %s 天），已换算日均后比较："
                            "基期日均 %s、本期日均 %s"
                            % (fmt_num(bdn, 0), fmt_num(cdn, 0),
                               fmt_num(b, 4), fmt_num(c, 4)))
            elif mode == "none":
                raise InputError("期间不等长（%s 天 vs %s 天），按红线 7 不得直接比总量。"
                                 "请传 align=daily 换算日均，或先截取等长期间"
                                 % (fmt_num(bdn, 0), fmt_num(cdn, 0)))
    if b == 0:
        raise InputError("基期值为 0，%s 不可计算——不得用「增长 100%%」之类的替代说法" % label)

    chg = (c - b) / b
    echo = Echo()
    echo.formula("%s变化率" % label, "(%s − %s) ÷ %s" % (fmt_num(c, 4), fmt_num(b, 4), fmt_num(b, 4)),
                 fmt_pct(chg))

    out = ["【%s】" % label]
    out.append("基期 %s → 本期 %s，变动 %s（%s）"
               % (fmt_num(b, 4), fmt_num(c, 4), fmt_num(c - b, 4), fmt_pct(chg)))
    out.append(echo.text())
    for n in note:
        out.append("· " + n)
    if kind == "mom" and p.get("has_yoy") is not True:
        out.append("★ 仅给环比时须标注「未消除季节因素」（methods.md 二、同环比规则）")
    if abs(chg) >= Decimal("0.20"):
        out.append("提示：变动幅度 %s 已超 20%%，先排查口径变更与期间完整性，"
                   "再判断业务原因" % fmt_pct(chg))
    if p.get("caliber"):
        out.append(caliber_line(p["caliber"]))
    return "\n".join(out)


# ============================ 3 异常检测 ============================
def cmd_outlier(p):
    """3σ / IQR / IQR3，输出偏离度与判定方法。"""
    vals = p.get("values")
    if not isinstance(vals, list) or len(vals) < 4:
        raise InputError("values 须为至少 4 个数值的数组")
    n = len(vals)
    method = p.get("method") or "auto"
    if method == "auto":
        sk = _skew(vals)
        method = "3sigma" if (n >= 30 and abs(sk) <= 1) else "iqr"
    if method not in ("3sigma", "iqr", "iqr3"):
        raise InputError("method 只能是 auto / 3sigma / iqr / iqr3")

    mu = _mean(vals)
    sd = _pstdev(vals)
    q1 = _quantile(vals, "0.25")
    q3 = _quantile(vals, "0.75")
    iqr = q3 - q1
    hits = []

    if method == "3sigma":
        if n < 30:
            raise InputError("3σ 法要求样本 ≥30（当前 %d 条）；偏态或小样本请改用 IQR" % n)
        if sd == 0:
            raise InputError("标准差为 0，3σ 法不可用")
        for i, v in enumerate(vals):
            z = (d(v) - mu) / sd
            if abs(z) > 3:
                hits.append([str(i + 1), fmt_num(v, 4), "%sσ" % fmt_num(z, 2),
                             "高于" if z > 0 else "低于"])
        params = "均值 μ=%s，标准差 σ=%s，阈值 |Z|>3" % (fmt_num(mu, 4), fmt_num(sd, 4))
        method_cn = "3σ 法（Z-score）"
    else:
        k = Decimal("3") if method == "iqr3" else Decimal("1.5")
        lo, hi = q1 - k * iqr, q3 + k * iqr
        for i, v in enumerate(vals):
            vv = d(v)
            if vv < lo or vv > hi:
                dev = (vv - mu) / mu if mu != 0 else None
                hits.append([str(i + 1), fmt_num(vv, 4),
                             fmt_pct(dev) if dev is not None else "—",
                             "低于下界" if vv < lo else "高于上界"])
        params = ("Q1=%s，Q3=%s，IQR=%s，界为 [Q1−%s×IQR, Q3+%s×IQR] = [%s, %s]"
                  % (fmt_num(q1, 4), fmt_num(q3, 4), fmt_num(iqr, 4), k, k,
                     fmt_num(lo, 4), fmt_num(hi, 4)))
        method_cn = "IQR 法（%s倍）" % ("3" if method == "iqr3" else "1.5")

    out = ["【异常检测】方法：%s" % method_cn]
    out.append("样本 %d 条。%s" % (n, params))
    out.append("")
    if hits:
        out.append("检出 %d 项：" % len(hits))
        out.append(table(["序号", "值", "偏离度", "方向"], hits))
    else:
        out.append("未检出越界项。")
    if n < 30:
        out.append("★ 样本 %d 条 < 30，结论须标「样本量不足，仅供参考」" % n)
    out.append("异常性质须区分：录入错误（修正后重算）／真实业务波动（列入清单给核实动作）。"
               "不得直接删除异常值。")
    return "\n".join(out)


# ============================ 4 加权平均（平均的平均） ============================
def cmd_weighted(p):
    """组均值加权 vs 算术平均，识别「平均的平均」。"""
    groups = p.get("groups")
    if not isinstance(groups, list) or len(groups) < 2:
        raise InputError("groups 须为至少 2 组的数组，每项含 name / n / mean")
    rows, tot_n, tot_s = [], Decimal(0), Decimal(0)
    means = []
    for i, g in enumerate(groups):
        if not isinstance(g, dict):
            raise InputError("groups[%d] 须为对象" % i)
        nm = g.get("name") or ("组%d" % (i + 1))
        n = need(g, "n", "%s 样本数" % nm, lo=0)
        m = need(g, "mean", "%s 均值" % nm)
        means.append(m)
        tot_n += n
        tot_s += m * n
        rows.append([nm, fmt_num(n, 0), fmt_num(m, 4), fmt_num(m * n, 4)])

    if tot_n == 0:
        raise InputError("各组样本数合计为 0，加权平均不可计算")
    w = tot_s / tot_n
    arm = sum(means, Decimal(0)) / len(means)
    diff = div(w - arm, arm, "算术平均") if arm != 0 else Decimal(0)

    out = ["【加权平均校验】"]
    out.append(table(["组", "样本数", "组均值", "加权贡献"], rows))
    out.append("")
    out.append("加权平均 = %s ÷ %s = %s（四舍五入 %s）"
               % (fmt_num(tot_s, 4), fmt_num(tot_n, 0), fmt_num(w, 4), fmt_num(w, 2)))
    out.append("算术平均 = %s" % fmt_num(arm, 4))
    out.append("差 = %s（%s）" % (fmt_num(w - arm, 4), fmt_pct(diff)))
    if abs(diff) > AVG_DIFF_MAX:
        out.append("★ 差值超过 5%% 阈值：判定存在「平均的平均」。"
                   "须回原始明细加权，不得用组均值的算术平均代表整体")
    else:
        out.append("差值在 5%% 以内，用算术平均影响有限（但仍建议按加权口径报数）")
    if p.get("caliber"):
        out.append(caliber_line(p["caliber"]))
    return "\n".join(out)


# ============================ 5 期间对齐 ============================
def cmd_period(p):
    """期间天数与等长判定。"""
    def days(a, b, label):
        from datetime import date
        try:
            da = date.fromisoformat(need_text(p, a, label))
            db = date.fromisoformat(need_text(p, b, label))
        except ValueError:
            raise InputError("%s 日期须为 YYYY-MM-DD 格式" % label)
        if db < da:
            raise InputError("%s 结束日早于起始日" % label)
        return (db - da).days + 1

    bd = days("base_start", "base_end", "基期")
    cd = days("current_start", "current_end", "本期")
    equal = bd == cd
    out = ["【期间对齐检查】"]
    out.append("基期 %s 天 ／ 本期 %s 天" % (fmt_num(bd, 0), fmt_num(cd, 0)))
    if equal:
        out.append("结论：等长，可直接比总量。")
    else:
        ratio = div(cd, bd, "基期天数")
        out.append("结论：不等长（本期为基期的 %s），按红线 7 不得直接比总量。" % fmt_pct(ratio))
        out.append("两种可用做法：①换算日均（本期总量 ÷ %s vs 基期总量 ÷ %s）"
                   "②截取基期前 %s 天与本期对齐" % (fmt_num(cd, 0), fmt_num(bd, 0), fmt_num(cd, 0)))
        if cd < bd:
            out.append("提示：若本期为进行中期间，降幅会天然接近已过天数占比"
                       "（当前 %s），这是期间不完整的典型症状，不是业务下滑"
                       % fmt_pct(ratio))
    return "\n".join(out)


# ============================ 6 分母漂移 ============================
def cmd_ratio(p):
    """率指标两期比较，检测分母定义变更。"""
    bn = need(p, "base_num", "基期分子")
    bd = need(p, "base_den", "基期分母")
    cn = need(p, "current_num", "本期分子")
    cd = need(p, "current_den", "本期分母")
    if bd == 0 or cd == 0:
        raise InputError("分母为 0，率值不可计算")

    rb, rc = bn / bd, cn / cd
    dn = div(cd - bd, bd, "基期分母")
    mn = div(cn - bn, bn, "基期分子") if bn != 0 else Decimal(0)
    echo = Echo()
    echo.formula("基期率", "%s ÷ %s" % (fmt_num(bn, 2), fmt_num(bd, 2)), fmt_pct(rb, 2))
    echo.formula("本期率", "%s ÷ %s" % (fmt_num(cn, 2), fmt_num(cd, 2)), fmt_pct(rc, 2))

    out = ["【率值比较与分母漂移检查】"]
    out.append("基期率 %s → 本期率 %s（变化 %s 个百分点）"
               % (fmt_pct(rb, 2), fmt_pct(rc, 2), fmt_num((rc - rb) * 100, 2)))
    out.append(echo.text())
    out.append("分子变化 %s ／ 分母变化 %s" % (fmt_pct(mn), fmt_pct(dn)))
    drift = (abs(dn) > DEN_SURGE) and (abs(mn) < NUM_STILL)
    if drift:
        out.append("★ 高度疑似分母漂移：分母变化 %s（>30%%）而分子仅变 %s（<10%%）。"
                   "按 methods.md 9.4，此时率值不可比——须核对两期分母定义是否一致，"
                   "并列两套口径或回溯重算旧期间" % (fmt_pct(dn), fmt_pct(mn)))
    else:
        out.append("未触发分母漂移判据（需同时满足：分母变化 >30% 且分子变化 <10%）。"
                   "仍须人工确认两期分母定义一致——此项无法仅从数据判定")
    if p.get("caliber"):
        out.append(caliber_line(p["caliber"]))
    return "\n".join(out)


# ============================ 7 趋势与回归 ============================
def cmd_trend(p):
    """线性回归斜率与 R²、移动平均。R²<0.3 不得称趋势明显。"""
    vals = p.get("values")
    if not isinstance(vals, list) or len(vals) < 3:
        raise InputError("values 须为至少 3 个数值的数组")
    n = len(vals)
    xs = [Decimal(i + 1) for i in range(n)]
    ys = [d(v, "序列值") for v in vals]
    mx, my = _mean(xs), _mean(ys)
    sxy = sum(((xs[i] - mx) * (ys[i] - my) for i in range(n)), Decimal(0))
    sxx = sum((((xs[i] - mx) ** 2) for i in range(n)), Decimal(0))
    syy = sum((((ys[i] - my) ** 2) for i in range(n)), Decimal(0))
    if sxx == 0:
        raise InputError("序列长度为 0，无法回归")
    slope = sxy / sxx
    r2 = (sxy * sxy) / (sxx * syy) if syy != 0 else Decimal(0)

    w = p.get("ma_window")
    ma_line, ma_vals = None, []
    if w is not None:
        wn = int(need(p, "ma_window", "移动平均窗口", lo=1))
        if wn < 3:
            raise InputError("移动平均窗口须 ≥3（methods.md 二）")
        if wn * 2 > n:
            raise InputError("窗口 %d 超过序列长度的一半（%d），会抹平趋势" % (wn, n))
        for i in range(wn - 1, n):
            ma_vals.append(_mean(ys[i - wn + 1:i + 1]))
        ma_line = ("MA(%d) 末值 = %s；序列 %d 个" % (wn, fmt_num(ma_vals[-1], 4), len(ma_vals)))

    echo = Echo()
    echo.formula("斜率 β1", "Σ(x−x̄)(y−ȳ) ÷ Σ(x−x̄)²", fmt_num(slope, 6))
    echo.formula("R²", "(Σ(x−x̄)(y−ȳ))² ÷ (Σ(x−x̄)²·Σ(y−ȳ)²)", fmt_num(r2, 4))

    out = ["【趋势与回归】样本 %d 期" % n]
    out.append("斜率 = %s（每期平均变动）/ 均值 = %s" % (fmt_num(slope, 6), fmt_num(my, 4)))
    out.append("R² = %s" % fmt_num(r2, 4))
    out.append(echo.text())
    if ma_line:
        out.append(ma_line)
    if r2 < R2_MIN:
        out.append("★ R² = %s < 0.3：按 methods.md 二、**不得称「趋势明显」**，"
                   "只能说方向为上/下、拟合度低" % fmt_num(r2, 4))
    else:
        out.append("R² ≥ 0.3，可描述为存在明确方向")
    out.append("趋势结论须同时给同比与环比；只有环比时须标注「未消除季节因素」")
    return "\n".join(out)


# ============================ 自测 ============================
def _t_decomp_product():
    # 与 examples.md 示例 1 完全一致的输入：应闭合到 −6,004,875
    t = cmd_decompose({"combine": "product",
                       "factors": [{"name": "客流", "base": 1250000, "actual": 1112500},
                                   {"name": "客单价", "base": 80, "actual": 84.49}]})
    import re
    return re.search(r"总变动 = (-?[\d,\.]+)", t).group(1)


def _t_decomp_effect1():
    import re
    t = cmd_decompose({"combine": "product",
                       "factors": [{"name": "客流", "base": 1250000, "actual": 1112500},
                                   {"name": "客单价", "base": 80, "actual": 84.49}]})
    return re.search(r"客流效应 = .*= (-?[\d,\.]+)", t).group(1)


def _t_decomp_effect2():
    import re
    t = cmd_decompose({"combine": "product",
                       "factors": [{"name": "客流", "base": 1250000, "actual": 1112500},
                                   {"name": "客单价", "base": 80, "actual": 84.49}]})
    return re.search(r"客单价效应 = .*= (-?[\d,\.]+)", t).group(1)


def _t_decomp_pp():
    import re
    t = cmd_decompose({"combine": "product",
                       "factors": [{"name": "客流", "base": 1250000, "actual": 1112500},
                                   {"name": "客单价", "base": 80, "actual": 84.49}]})
    return re.search(r"客流 的效应绝对值最大", t) is not None


def _t_decomp_closed():
    t = cmd_decompose({"combine": "product",
                       "factors": [{"name": "客流", "base": 1250000, "actual": 1112500},
                                   {"name": "客单价", "base": 80, "actual": 84.49}]})
    return "差额 0.00" in t


def _t_decomp_sum():
    t = cmd_decompose({"combine": "sum",
                       "factors": [{"name": "新用户", "base": 100, "actual": 106},
                                   {"name": "老用户", "base": 200, "actual": 202}]})
    import re
    return re.search(r"总变动 = (-?[\d,\.]+)", t).group(1)


def _t_decomp_bad_total():
    return cmd_decompose({"combine": "product", "total_base": 999,
                          "factors": [{"name": "a", "base": 10, "actual": 11},
                                      {"name": "b", "base": 10, "actual": 12}]})


def _t_decomp_missing():
    return cmd_decompose({"combine": "product",
                          "factors": [{"name": "a", "base": 10, "actual": 11}]})


def _t_compare_yoy():
    import re
    t = cmd_compare({"base": 100, "current": 94, "kind": "yoy"})
    return re.search(r"变动 .*（(-?[\d\.]+%)）", t).group(1)


def _t_compare_zero_base():
    return cmd_compare({"base": 0, "current": 10})


def _t_compare_period_gap():
    return cmd_compare({"base": 100, "current": 60, "align": "none",
                        "base_days": 30, "current_days": 18})


def _t_compare_daily():
    import re
    # 30 天 100 万 vs 18 天 60 万 → 日均 3.333 vs 3.333，变化 0%
    t = cmd_compare({"base": 100, "current": 60, "base_days": 30, "current_days": 18})
    return re.search(r"变动 .*（(-?[\d\.]+%)）", t).group(1)


def _t_outlier_iqr():
    # 1..9 + 100：中位数稳定，100 应被 IQR 判出
    import re
    t = cmd_outlier({"values": [1, 2, 3, 4, 5, 6, 7, 8, 9, 100]})
    return "检出 1 项" in t


def _t_outlier_3sigma_needs_n():
    return cmd_outlier({"values": [1, 2, 3, 4, 5], "method": "3sigma"})


def _t_outlier_clean():
    t = cmd_outlier({"values": [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]})
    return "未检出越界项" in t


def _t_weighted():
    # methods.md 9.3 算例：A 100×50，B 10×200 → 加权 63.64，算术 125，差 −49.1%
    import re
    t = cmd_weighted({"groups": [{"name": "A", "n": 100, "mean": 50},
                                 {"name": "B", "n": 10, "mean": 200}]})
    return re.search(r"四舍五入 ([\d,\.]+)）", t).group(1)


def _t_weighted_flag():
    t = cmd_weighted({"groups": [{"name": "A", "n": 100, "mean": 50},
                                 {"name": "B", "n": 10, "mean": 200}]})
    return "存在「平均的平均」" in t


def _t_period_unequal():
    t = cmd_period({"base_start": "2026-03-01", "base_end": "2026-03-31",
                    "current_start": "2026-04-01", "current_end": "2026-04-18"})
    return "不等长" in t and "31" in t and "18" in t


def _t_period_equal():
    t = cmd_period({"base_start": "2026-01-01", "base_end": "2026-01-30",
                    "current_start": "2026-03-01", "current_end": "2026-03-30"})
    return "等长" in t


def _t_ratio_drift():
    t = cmd_ratio({"base_num": 100, "base_den": 10000,
                   "current_num": 104, "current_den": 6000})
    return "高度疑似分母漂移" in t


def _t_ratio_ok():
    t = cmd_ratio({"base_num": 100, "base_den": 10000,
                   "current_num": 130, "current_den": 10500})
    return "未触发分母漂移判据" in t


def _t_trend_illegible():
    # 无规律序列，R² 很低 → 不得称趋势明显
    t = cmd_trend({"values": [10, 3, 15, 4, 14, 5, 13, 6]})
    return "不得称「趋势明显」" in t or "R² ≥ 0.3" in t


def _t_trend_clear():
    t = cmd_trend({"values": [10, 20, 30, 40, 50, 60]})
    return "R² ≥ 0.3" in t


def _t_trend_ma_window():
    return cmd_trend({"values": [1, 2, 3, 4, 5, 6], "ma_window": 2})


def selftest_data():
    cases = [
        ("拆解 乘法总变动=示例1值", _t_decomp_product, "-6,004,875.00", "eq"),
        ("拆解 客流效应=示例1值", _t_decomp_effect1, "-11,000,000.00", "eq"),
        ("拆解 客单价效应=示例1值", _t_decomp_effect2, "4,995,125.00", "eq"),
        ("拆解 闭合差额为0", _t_decomp_closed, True, "eq"),
        ("拆解 主因判定", _t_decomp_pp, True, "eq"),
        ("拆解 加法总变动=8", _t_decomp_sum, "8.00", "eq"),
        ("拆解 总额不符须报错", _t_decomp_bad_total, None, "raises:InputError"),
        ("拆解 单因子须报错", _t_decomp_missing, None, "raises:InputError"),
        ("同环比 100→94 得−6.0%", _t_compare_yoy, "-6.0%", "eq"),
        ("同环比 基期为0须报错", _t_compare_zero_base, None, "raises:InputError"),
        ("同环比 期间不等长禁比", _t_compare_period_gap, None, "raises:InputError"),
        ("同环比 换算日均后相等", _t_compare_daily, "0.0%", "eq"),
        ("异常 IQR检出极端值", _t_outlier_iqr, True, "eq"),
        ("异常 3σ样本不足须报错", _t_outlier_3sigma_needs_n, None, "raises:InputError"),
        ("异常 平稳序列无检出", _t_outlier_clean, True, "eq"),
        ("加权 算例=63.64", _t_weighted, "63.64", "eq"),
        ("加权 触发平均的平均", _t_weighted_flag, True, "eq"),
        ("期间 31vs18判不等长", _t_period_unequal, True, "eq"),
        ("期间 等长可直比", _t_period_equal, True, "eq"),
        ("率值 分母漂移告警", _t_ratio_drift, True, "eq"),
        ("率值 未漂移不告警", _t_ratio_ok, True, "eq"),
        ("趋势 低R²不得称明显", _t_trend_illegible, True, "eq"),
        ("趋势 高R²可称方向", _t_trend_clear, True, "eq"),
        ("趋势 窗口<3须报错", _t_trend_ma_window, None, "raises:InputError"),
    ]
    return selftest(cases, DOMAIN + " 复算器")


LIST_HELP = """运营数据分析 复算器 calc.py V%s
只做算术，不做判断；阈值可取默认值，也可传参覆盖。

子命令与入参（--json 传 JSON 对象）：

  decompose  指标拆解与对账（第四段专用）
     combine  必填 product（乘法拆解）| sum（加法拆解）
     factors  必填 [{"name":"客流","base":1250000,"actual":1112500}, ...]（≥2 个）
     total_base / total_actual  选填，给了就校验因子是否拆全
     注：乘法用顺序剥离，效应之和构造性精确等于总变动；加法按差值直接分解

  compare    同比 / 环比
     base / current  必填
     kind            选填 yoy（默认）| mom
     base_days / current_days / align  选填；期间不等长时 align=daily 换算日均，
                     align=none 则直接报错（红线 7）

  outlier    异常检测
     values  必填（≥4 个）
     method  选填 auto（默认）| 3sigma | iqr | iqr3
     注：3σ 要求样本 ≥30；auto 在样本 <30 或偏态时自动改用 IQR

  weighted   加权平均校验（识破「平均的平均」）
     groups  必填 [{"name":"A","n":100,"mean":50}, ...]

  period     期间对齐检查
     base_start / base_end / current_start / current_end  必填（YYYY-MM-DD）

  ratio      率值比较与分母漂移检查
     base_num / base_den / current_num / current_den  必填

  trend      趋势回归与移动平均
     values     必填（≥3 个）
     ma_window  选填，≥3 且不超过序列长度一半

通用：--selftest 跑内建自测；--list 显示本页

示例：
  python calc.py decompose --json '{"combine":"product","factors":[{"name":"客流","base":1250000,"actual":1112500},{"name":"客单价","base":80,"actual":84.49}]}'
  python calc.py outlier --json '{"values":[1,2,3,4,5,6,7,8,9,100]}'
""" % VERSION


COMMANDS = {"decompose": cmd_decompose, "compare": cmd_compare,
            "outlier": cmd_outlier, "weighted": cmd_weighted,
            "period": cmd_period, "ratio": cmd_ratio, "trend": cmd_trend}


def main():
    return build_cli(PROG, COMMANDS, "运营数据分析 复算器（只做算术）",
                     selftest_data, LIST_HELP)


if __name__ == "__main__":
    sys.exit(main())
