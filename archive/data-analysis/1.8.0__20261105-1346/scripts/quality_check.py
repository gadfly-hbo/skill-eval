#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""运营数据分析 · 输出质量校验 + 数据体检（自包含，仅依赖 Python 标准库）。

用法：
    python quality_check.py <交付物.md>               # 校验报告：结构 + 九条红线 + 形态分级
    python quality_check.py --data <数据文件>          # 体检数据：四类陷阱七项检查
    python quality_check.py --data <文件> --key 门店   # 同上，并检查该列唯一性
    python quality_check.py --package                 # 校验包自身文件与三处版本号
    python quality_check.py --self-test               # 内置正反样例自测（报告 + 数据）

设计要点（V1.7.0）：
1. 【新增】--data 数据体检：不再只查报告写得齐不齐，而是真读数据表重算。
   对应 SKILL.md 第五节红线 6–9 的四类陷阱，七项检查全部为可判定规则。
2. 【新增】输出形态分级：报告首部声明「输出形态：直答」时，不强制六段，
   只跑红线检查；未声明则按六段严格校验。对应 SKILL.md 第二节。
3. 【新增】红线 7 文本判据：声明了同比/环比、又出现「至今/截至/本月」等
   未完成期间词时，判定为期间不完整比较。
4. 保留历史版本的 _norm 修复（只压横向空白、保留换行），否则切段全线失效。
"""

import io
import os
import re
import sys

SKILL_SLUG = "data-analysis"
SKILL_NAME = "运营数据分析 · Data Analysis"
PKG_VERSION = "1.8.0"

# ---------------------------------------------------------------------------
# 一、段落契约（唯一事实源 = SKILL.md「六段契约」）
# ---------------------------------------------------------------------------
SECTION_SPECS = [
    {"key": "口径", "title": "数据口径与质量说明",
     "aliases": ["数据口径与质量说明", "数据概况", "口径与质量", "数据口径"]},
    {"key": "趋势", "title": "趋势与结构",
     "aliases": ["趋势与结构", "趋势分析", "趋势与对比"]},
    {"key": "异常", "title": "异常识别",
     "aliases": ["异常识别", "异常分析", "异常检测"]},
    {"key": "拆解", "title": "指标拆解",
     "aliases": ["指标拆解", "杜邦拆解", "指标分解"]},
    {"key": "洞察", "title": "洞察结论",
     "aliases": ["洞察结论", "关键发现", "核心结论"]},
    {"key": "行动", "title": "行动建议与跟踪指标",
     "aliases": ["行动建议与跟踪指标", "行动建议", "建议与行动", "行动与跟踪"]},
]

REQUIRED_FILES = ["SKILL.md", "manifest.yaml", "test_set.md"]

SECTION_ELEMENTS = {
    "口径": ["口径", "统计期间", "来源"],
    "趋势": [],
    "异常": [],
    "拆解": [],
    "洞察": [],
    "行动": ["跟踪"],
}

# ---------------------------------------------------------------------------
# 二、红线规则
# ---------------------------------------------------------------------------

# 红线 1：无依据的量化承诺
RE_PROMISE = re.compile(
    r"(预计|预期|可望|将会|有望|可提升|能提升|可增加|能增加|可降低|能降低|"
    r"提升\s*约?\s*\d+(?:\.\d+)?\s*%|增长\s*\d+(?:\.\d+)?\s*%)"
)
RE_PROMISE_BALANCE = re.compile(r"(下降|下滑|减少|降低|下滑\s*\d)")
RE_ASSUMPTION = re.compile(
    r"(假设|测算|前提|口径下|按.{0,8}情景|敏感性|若|如果|在.{0,6}不变|"
    r"静态测算|仅测算|以.{0,10}为基准|试算)"
)

# 红线 2：结论段给出决策结论却未声明样本量
# V1.7.0 修复：原正则用 \d+ 不认千分位，真实报告写「共 7,644 条」会被误判为未声明样本量。
# 现改为 [\d,]+ 并把「万/千」量级词一并覆盖。
RE_SAMPLE_DECL = re.compile(
    r"(样本量|样本数|数据量|"
    r"共\s*[\d,]+(?:\.\d+)?\s*(?:万|千)?\s*(条|单|行|个|人|家)|"
    r"n\s*=\s*[\d,]+|"
    r"[\d,]+\s*(条|单|行|个)\s*样本)"
)

# 红线 3：相关性被表述为因果
RE_CAUSAL = re.compile(
    r"(导致|造成|引起|决定了|必然导致|直接导致|"
    r"因\s*该?指标.{0,6}(上升|下降)|"
    r"(上升|下降|提高|提升)(是|就是|源于|由于)[^。\n]{0,12}原因)"
)
RE_CORRELATION_CAUTION = re.compile(
    r"(相关(性|关系)?(不等|未必|不能|不等于|不意味)|仅(为|是)相关|"
    r"未做因果|因果需|需进一步验证|需人工核实|待验证)"
)

# 红线 4：口径缺失
RE_CALIBER = re.compile(
    r"(口径|统计期间|统计区间|数据来源|来源系统|净(成交|收入)|GMV|"
    r"同比|环比|去重|缺失值)"
)

# 轻量输出形态声明（V1.7.0 新增，对应 SKILL.md 第二节分级）
# 直答：单指标查询；体检：只做主键/合计/时间轴/分母核查，不出六段
RE_DIRECT_MODE = re.compile(
    r"(输出形态\s*[:：]\s*(?:直答|体检)|【直答】|【体检】|直答形态|体检形态)"
)

# 红线 7 文本判据（V1.7.0 新增）：跨期比较 + 未完成期间词
RE_PERIOD_COMPARE = re.compile(r"(同比|环比|较上期|比上月|比上周|较去年)")
RE_UNFINISHED_PERIOD = re.compile(r"(至今|截至|本月|本周|截至目前|月内|年初至今|YTD)")
RE_PERIOD_ALIGN = re.compile(r"(等长|同天数|按天对齐|完整期间|截止日对齐|同期天数)")

# 证据锚点
RE_EVIDENCE = re.compile(r"[-+]?\d+(?:\.\d+)?\s*(%|万元|元|单|条|人|家|个|pp|σ|天|倍)?")


def _norm(text):
    """归一化：全角转半角、统一括号，只压缩横向空白、保留换行。

    历史修复保留：旧版用 \\s+ 会把换行压成空格，导致 _split_sections
    切不出段落（全文退化为 1 块），所有结构判据形同虚设。
    """
    out = []
    for ch in text:
        code = ord(ch)
        if code == 0x3000:
            code = 32
        elif 0xFF01 <= code <= 0xFF5E:
            code -= 0xFEE0
        out.append(chr(code))
    s = "".join(out)
    s = s.replace("（", "(").replace("）", ")")
    s = s.replace("：", ":").replace("，", ",")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    return "\n".join(ln.strip() for ln in s.split("\n"))


def _split_sections(text):
    """按 Markdown 标题切段，返回 [(标题行, 该段正文)]，保留顺序。"""
    blocks = []
    lines = text.splitlines()
    cur_title, cur_body = None, []
    for ln in lines:
        if re.match(r"^\s{0,3}#{1,4}\s+", ln):
            if cur_title is not None:
                blocks.append((cur_title, "\n".join(cur_body)))
            cur_title, cur_body = ln, []
        elif cur_title is not None:
            cur_body.append(ln)
    if cur_title is not None:
        blocks.append((cur_title, "\n".join(cur_body)))
    if not blocks:
        blocks = [("", text)]
    return blocks


def _match_section(text, aliases):
    """返回命中段落的正文；未命中返回 None。优先返回「有正文」的命中段。"""
    norm = _norm(text)
    blocks = _split_sections(norm)
    fallback = None
    for title, body in blocks:
        tn = _norm(re.sub(r"^\s{0,3}#{1,4}\s+", "", title))
        for a in aliases:
            a = _norm(a)
            if a in tn:
                if body.strip():
                    return body
                if fallback is None:
                    fallback = tn
                break
    return fallback


def check_output(text):
    """校验交付物：结构（六段或直答声明）+ 九条红线。"""
    if not isinstance(text, str):
        raise TypeError("text 必须是 str")
    norm = _norm(text)

    issues = []
    violations = []
    warnings = []

    # --- 0. 输出形态分级（V1.7.0）---
    head = "\n".join(norm.splitlines()[:25])
    m_mode = RE_DIRECT_MODE.search(head)
    direct_mode = bool(m_mode)
    mode_label = "六段"
    if direct_mode:
        mode_label = "体检" if "体检" in m_mode.group(0) else "直答"
        warnings.append("已按声明采用%s形态，未校验六段结构（须确认问题确为轻量查询或数据核查）"
                        % mode_label)

    # --- 1. 段落契约 ---
    matched = {}
    if not direct_mode:
        for spec in SECTION_SPECS:
            body = _match_section(norm, spec["aliases"])
            if body is None:
                issues.append("缺失段落：%s" % spec["title"])
                matched[spec["key"]] = None
            else:
                if len(body.strip()) < 20:
                    issues.append("段落过短（少于 20 字）：%s" % spec["title"])
                matched[spec["key"]] = body

        # --- 2. 段落内必备实质要素 ---
        for spec in SECTION_SPECS:
            body = matched.get(spec["key"])
            if body is None:
                continue
            for el in SECTION_ELEMENTS.get(spec["key"], []):
                if _norm(el) not in _norm(body):
                    issues.append("段落「%s」缺少要素：%s" % (spec["title"], el))

    # --- 3. 红线 1：无依据的量化承诺 ---
    promise_hits = [m.group(0) for m in RE_PROMISE.finditer(norm)]
    promise_hits = [h for h in promise_hits if not RE_PROMISE_BALANCE.fullmatch(h.strip())]
    if promise_hits and not RE_ASSUMPTION.search(norm):
        violations.append(
            "出现量化承诺表述 %s，但全文未给出假设/测算/前提限定，属无依据预测"
            % "、".join(sorted(set(promise_hits))[:4])
        )

    # --- 4. 红线 2：结论段下结论但未声明样本量 ---
    insight = matched.get("洞察") or (norm if direct_mode else None)
    if insight and RE_EVIDENCE.search(insight):
        if not RE_SAMPLE_DECL.search(norm):
            violations.append(
                "洞察结论已给出量化结论，但全文未声明样本量/数据量，小样本结论不可靠"
            )

    # --- 5. 红线 3：相关当因果 ---
    if RE_CAUSAL.search(norm) and not RE_CORRELATION_CAUTION.search(norm):
        violations.append(
            "出现因果式表述（导致/造成/决定了）但未标注「相关不等于因果」或待验证，存在推断越界"
        )

    # --- 6. 红线 4：口径缺失 ---
    if not RE_CALIBER.search(norm):
        violations.append("全文未声明数据口径/统计期间/来源，数据不可复算")

    # --- 7. 红线 5：行动段须有责任人 ---
    action = matched.get("行动")
    if action and _norm("责任人") not in _norm(action):
        violations.append("行动建议未落到责任人，建议不可执行")

    # --- 8. 红线 7 文本判据（V1.7.0）：期间不完整比较 ---
    # 判定范围限定在「口径段 + 趋势段」。全文扫会把行动建议里的
    # 「本月底上线」（行动时限）误判为统计期间，实测示例 1/2 均被误伤。
    if direct_mode:
        period_scope = norm
    else:
        period_scope = "\n".join(filter(None, [matched.get("口径") or "",
                                               matched.get("趋势") or ""]))
    if RE_PERIOD_COMPARE.search(norm) and RE_UNFINISHED_PERIOD.search(period_scope) \
            and not RE_PERIOD_ALIGN.search(norm):
        violations.append(
            "口径段/趋势段出现「至今/截至/本月」等未完成期间表述并做了同比或环比，"
            "且未声明等长或按同天数对齐，判定为期间不完整比较"
        )

    total = len(SECTION_SPECS)
    struct_ok = len(issues) == 0
    passed = struct_ok and len(violations) == 0
    score = round(max(0.0, (total - len(issues)) / total * 100 -
                      min(40.0, len(violations) * 10.0)), 1)

    return {
        "skill": SKILL_NAME,
        "mode": mode_label,
        "missing_sections": issues,
        "violations": violations,
        "warnings": warnings,
        "structure_ok": struct_ok,
        "passed": passed,
        "score": score,
    }


# ---------------------------------------------------------------------------
# 三、数据体检（V1.7.0 新增，对应 SKILL.md 红线 6–9）
# ---------------------------------------------------------------------------

RE_NUM = re.compile(r"^[-+]?[\d,]*\.?\d+%?$")
RE_DATE_YM = re.compile(r"^(\d{4})[-/年](\d{1,2})月?$")
RE_DATE_YMD = re.compile(r"^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?$")
TOTAL_ROW = re.compile(r"(合计|总计|小计|汇总|total)", re.I)

# 各月标准天数（非闰年），用于「期间天数不等」判定
MONTH_DAYS = {1: 31, 2: 28, 3: 31, 4: 30, 5: 31, 6: 30,
              7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31}


def _parse_number(s):
    """把 '1,234,567' / '-6.0%' / '¥1,234' 解析为 float；失败返回 None。"""
    if s is None:
        return None
    t = str(s).strip().replace(",", "").replace("¥", "").replace("￥", "")
    t = t.replace("\u2212", "-").replace("\u2014", "-").replace("\uff0b", "+")
    if not t or not RE_NUM.match(t):
        return None
    try:
        if t.endswith("%"):
            return float(t[:-1])
        return float(t)
    except ValueError:
        return None


def _is_number_cell(s):
    return _parse_number(s) is not None


def parse_table(text):
    """解析 CSV 或 Markdown 表格，返回 (headers, rows)。rows 为 list[list[str]]。"""
    lines = [ln for ln in text.replace("\r\n", "\n").split("\n") if ln.strip()]

    # Markdown 表格：含 | 分隔，第二行通常是分隔线
    if any("|" in ln for ln in lines[:5]):
        md = [ln for ln in lines if ln.strip().startswith("|")]
        if len(md) >= 2:
            def cells(line):
                return [c.strip() for c in line.strip().strip("|").split("|")]
            headers = cells(md[0])
            body = []
            for ln in md[1:]:
                cs = cells(ln)
                if all(re.match(r"^:?-{2,}:?$", c) for c in cs if c):
                    continue
                if len(cs) == len(headers):
                    body.append(cs)
            if body:
                return headers, body

    # CSV
    import csv
    rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if any(str(c).strip() for c in r)]
    if not rows:
        return [], []
    headers = [str(c).strip() for c in rows[0]]
    body = [[str(c).strip() for c in r] for r in rows[1:] if len(r) == len(headers)]
    return headers, body


def check_data(text, key_col=None, tol_total=0.005, tol_pct=1.0):
    """数据体检：七项检查，全部为可判定规则。

    DT01 完全重复行        —— 连接爆炸/重复导出的前置信号
    DT02 主键重复          —— 同上，指定 --key 时启用
    DT03 合计闭合          —— 存在合计行时，明细加总须对得上
    DT04 占比求和          —— 占比列合计须为 100
    DT05 时间轴缺口        —— 日期列存在缺失月份
    DT06 期间天数不等      —— 各期行数与日历天数不同，不可直接比总量
    DT07 分母异常          —— 率值 > 100% 或为负
    """
    headers, rows = parse_table(text)
    results = []   # (code, ok, message)

    if not headers or not rows:
        return {"skill": SKILL_NAME, "checks": [],
                "passed": False, "error": "无法解析出表格（需 CSV 或 Markdown 表格）"}

    # 分离合计行与明细行
    total_rows, detail_rows = [], []
    for r in rows:
        if r and TOTAL_ROW.search(str(r[0])):
            total_rows.append(r)
        else:
            detail_rows.append(r)

    # --- DT01 完全重复行 ---
    seen = {}
    for r in detail_rows:
        k = tuple(r)
        seen[k] = seen.get(k, 0) + 1
    dup = sum(v - 1 for v in seen.values() if v > 1)
    results.append(("DT01", dup == 0,
                    "完全重复行 %d 条%s" % (dup, "" if dup == 0 else "（查导出是否重复追加）")))

    # --- DT02 主键唯一性 ---
    # V1.7.0：支持复合主键（--key 门店,月份）。单列主键在月度面板上必然重复，
    # 真实主键多是「门店 + 月份」，只支持单列会把正常数据判成重复。
    if key_col:
        keys = [k.strip() for k in str(key_col).split(",") if k.strip()]
        idxs, missing_cols = [], []
        for k in keys:
            hit = None
            for i, h in enumerate(headers):
                if k == h or k in h:
                    hit = i
                    break
            if hit is None:
                missing_cols.append(k)
            else:
                idxs.append(hit)
        if missing_cols:
            results.append(("DT02", False, "未找到主键列：%s" % "、".join(missing_cols)))
        else:
            combos = [tuple(r[i] for i in idxs) for r in detail_rows]
            uniq = len(set(combos))
            dup_keys = [k for k in set(combos) if combos.count(k) > 1]
            results.append(("DT02", uniq == len(combos),
                            "主键「%s」%d 行 / %d 个唯一值%s"
                            % ("+".join(keys), len(combos), uniq,
                               "" if uniq == len(combos)
                               else "（重复键 %d 组，如 %s；多对多连接会放大计数）"
                                    % (len(dup_keys), dup_keys[0]))))

    # --- 数值列识别 ---
    num_cols = []
    for i, h in enumerate(headers):
        n = sum(1 for r in detail_rows if _is_number_cell(r[i]))
        if n >= max(2, len(detail_rows) * 0.6):
            num_cols.append(i)

    # --- DT03 合计闭合 ---
    if total_rows:
        tr = total_rows[0]
        for i in num_cols:
            declared = _parse_number(tr[i])
            if declared is None:
                continue
            actual, ok_col = 0.0, True
            for r in detail_rows:
                v = _parse_number(r[i])
                if v is None:
                    ok_col = False
                    break
                actual += v
            if not ok_col or actual == 0:
                continue
            rel = abs(actual - declared) / abs(actual)
            results.append(("DT03", rel <= tol_total,
                            "合计闭合「%s」：声明 %s / 明细加总 %.2f，相对偏差 %.3f%%%s"
                            % (headers[i], tr[i], actual, rel * 100,
                               "" if rel <= tol_total else "（超容差 0.5%，查重复行或遗漏行）")))
    else:
        results.append(("DT03", True, "无合计行，跳过合计闭合检查"))

    # --- DT04 占比求和 ---
    pct_cols = [i for i, h in enumerate(headers)
                if re.search(r"(占比|比例|百分比|权重)", h)]
    if pct_cols and detail_rows:
        for i in pct_cols:
            vals = [_parse_number(r[i]) for r in detail_rows]
            vals = [v for v in vals if v is not None]
            if not vals:
                continue
            s = sum(vals)
            results.append(("DT04", abs(s - 100) <= tol_pct,
                            "占比列「%s」合计 %.2f%s"
                            % (headers[i], s,
                               "" if abs(s - 100) <= tol_pct else "（偏离 100，查分母是否含自身）")))
    else:
        results.append(("DT04", True, "无占比列，跳过"))

    # --- 时间轴识别 ---
    date_col = None
    for i, h in enumerate(headers):
        if re.search(r"(月|日期|期间|date|period)", h, re.I):
            date_col = i
            break

    # --- DT05 时间轴缺口 ---
    if date_col is not None:
        yms = []
        for r in detail_rows:
            cell = str(r[date_col]).strip()
            m = RE_DATE_YM.match(cell) or RE_DATE_YMD.match(cell)
            if m:
                yms.append((int(m.group(1)), int(m.group(2))))
        if yms:
            uniq_ym = sorted(set(yms))
            gaps = []
            cur = uniq_ym[0]
            end = uniq_ym[-1]
            guard = 0
            while cur <= end and guard < 240:
                if cur not in uniq_ym:
                    gaps.append("%04d-%02d" % cur)
                y, mo = cur
                mo += 1
                if mo > 12:
                    y, mo = y + 1, 1
                cur = (y, mo)
                guard += 1
            results.append(("DT05", len(gaps) == 0,
                            "时间轴 %d 个期间，缺口：%s"
                            % (len(uniq_ym), "、".join(gaps) if gaps else "无")))
        else:
            results.append(("DT05", True, "日期列无标准期间值，跳过"))
    else:
        results.append(("DT05", True, "未识别到日期列，跳过"))

    # --- DT06 期间天数不等 ---
    if date_col is not None:
        cnt = {}
        for r in detail_rows:
            m = RE_DATE_YM.match(str(r[date_col]).strip())
            if m:
                k = (int(m.group(1)), int(m.group(2)))
                cnt[k] = cnt.get(k, 0) + 1
        if cnt:
            freq = {}
            for v in cnt.values():
                freq[v] = freq.get(v, 0) + 1
            unequal_rows = len(freq) > 1
            months = sorted(cnt.keys())
            diff_days = len(set(MONTH_DAYS.get(mo, 30) for _, mo in months)) > 1
            bad = unequal_rows and diff_days
            results.append(("DT06", not bad,
                            "各期间记录数 %d 种、日历天数%s%s"
                            % (len(freq), "不等" if diff_days else "一致",
                               "" if not bad else "（行数与天数均不等，禁止直接比总量，须换算日均）")))
        else:
            results.append(("DT06", True, "无月度粒度，跳过"))
    else:
        results.append(("DT06", True, "未识别到日期列，跳过"))

    # --- DT07 分母异常 ---
    rate_cols = [i for i, h in enumerate(headers)
                 if re.search(r"(率|ROI|转化)", h)]
    if rate_cols:
        bad = []
        for i in rate_cols:
            for r in detail_rows:
                v = _parse_number(r[i])
                if v is None:
                    continue
                if v < 0 or v > 100:
                    bad.append("%s=%s" % (headers[i], r[i]))
                    break
        results.append(("DT07", len(bad) == 0,
                        "率值越界：%s" % ("、".join(bad[:3]) if bad else "无")))
    else:
        results.append(("DT07", True, "无率值列，跳过"))

    passed_checks = sum(1 for _, ok, _ in results if ok)
    return {
        "skill": SKILL_NAME,
        "checks": results,
        "total": len(results),
        "passed_count": passed_checks,
        "passed": len(results) > 0 and passed_checks == len(results),
    }


def format_data_report(r):
    if r.get("error"):
        return "数据体检：" + r["error"]
    lines = ["数据体检：" + SKILL_SLUG,
             "检查项：%d / 通过：%d" % (r.get("total", 0), r.get("passed_count", 0)), ""]
    for code, ok, msg in r["checks"]:
        lines.append("[%s] %s  %s" % ("通过" if ok else "未通过", code, msg))
    lines.append("")
    lines.append("结果：" + ("通过 —— 七项检查未发现数据工程隐患。"
                            if r["passed"] else
                            "未通过 —— 逐条核对未通过项后再出报告，勿直接分析。"))
    return "\n".join(lines)


def check_package():
    """校验技能包文件完整性与三处版本号一致性。"""
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    missing = [f for f in REQUIRED_FILES
               if not os.path.isfile(os.path.join(root, f))]
    has_ref = os.path.isdir(os.path.join(root, "references"))
    has_script = os.path.isfile(os.path.join(root, "scripts", "quality_check.py"))

    versions = {}
    targets = (
        ("SKILL.md", "SKILL.md", True),
        ("manifest.yaml", "manifest.yaml", False),
        ("__init__.py", os.path.join("scripts", "__init__.py"), False),
    )
    for label, rel, head_only in targets:
        p = os.path.join(root, rel)
        if not os.path.isfile(p):
            continue
        with io.open(p, encoding="utf-8") as f:
            content = f.read(1200) if head_only else f.read()
        m = re.search(r"^\s*(?:version|__version__)\s*[:=]\s*[\"']?([0-9]+\.[0-9]+\.[0-9]+)",
                      content, re.M)
        if m:
            versions[label] = m.group(1)
    consistent = len(versions) == 3 and len(set(versions.values())) == 1

    # G13 等价：正文含公式 / 评分 / 对账判据 → 必须有 scripts/calc.py 且自测通过
    body = ""
    for rel in ("SKILL.md", os.path.join("references", "methods.md")):
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            with io.open(p, encoding="utf-8") as f:
                body += f.read()
    need_calc = bool(re.search(
        r"拆解为|贡献之和|效应|合计校验|对账|闭合|"
        r"[＝=][^。\n]{0,40}[×÷]|加权平均\s*=|覆盖率\s*=", body))
    calc_path = os.path.join(root, "scripts", "calc.py")
    has_calc = os.path.isfile(calc_path)
    calc_rc = None
    if has_calc:
        try:
            import subprocess as _sp
            import sys as _sys
            r = _sp.run([_sys.executable, calc_path, "--selftest"],
                        capture_output=True, text=True, encoding="utf-8",
                        errors="ignore", timeout=120)
            calc_rc = r.returncode
        except Exception:
            calc_rc = -1
    calc_ok = (not need_calc) or (has_calc and calc_rc == 0)

    passed = ((not missing) and has_ref and has_script and consistent and calc_ok)
    return {
        "skill": SKILL_SLUG,
        "missing_files": missing,
        "has_references": has_ref,
        "has_script": has_script,
        "versions": versions,
        "version_consistent": consistent,
        "need_calc": need_calc,
        "has_calc": has_calc,
        "calc_rc": calc_rc,
        "calc_ok": calc_ok,
        "passed": passed,
    }


def format_report(r):
    lines = ["技能：" + r["skill"], "形态：" + r.get("mode", "六段"),
             "得分：" + str(r.get("score", "")), ""]
    if r["passed"]:
        lines.append("结果：通过 —— 结构与红线全部合格。")
    else:
        lines.append("结果：不通过")
        if r.get("missing_sections"):
            lines += ["", "结构问题："] + ["  - " + s for s in r["missing_sections"]]
        if r.get("violations"):
            lines += ["", "红线违规（必须修复）："] + ["  - " + s for s in r["violations"]]
    if r.get("warnings"):
        lines += ["", "提示："] + ["  - " + s for s in r["warnings"]]
    return "\n".join(lines)


def format_package_report(r):
    lines = ["技能包：" + r["skill"], ""]
    lines.append("references 目录：" + ("存在" if r["has_references"] else "缺失"))
    lines.append("门禁脚本：" + ("存在" if r["has_script"] else "缺失"))
    if r.get("need_calc"):
        if r.get("has_calc"):
            lines.append("复算器：存在，自测返回码 %s%s"
                         % (r.get("calc_rc"),
                            "（通过）" if r.get("calc_rc") == 0 else "（失败，必须修复）"))
        else:
            lines.append("复算器：缺失 —— 正文含公式/拆解/对账判据，"
                         "按规范必须有 scripts/calc.py")
    else:
        lines.append("复算器：正文无公式判据，不需配置")
    vs = r.get("versions", {})
    if vs:
        lines.append("版本：" + " / ".join("%s=%s" % (k, v) for k, v in vs.items())
                     + ("（三处一致）" if r["version_consistent"] else "（不一致，必须修正）"))
    if r["missing_files"]:
        lines += ["", "缺失文件："] + ["  - " + f for f in r["missing_files"]]
    lines += ["", "结果：" + ("通过 —— 文件齐备、三处版本一致、复算器自测通过。"
                              if r["passed"] else "不通过 —— 见上列问题。")]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 四、自测
# ---------------------------------------------------------------------------
GOOD = """# 门店运营数据分析报告

## 一、数据口径与质量说明
口径：净成交口径（已扣除退货与优惠券），统计期间 2026-01 至 2026-06，数据来源为POS 系统与门店排班表，共 182 条门店日记录。
缺失值处理：3 家门店 6 月无排班数据，已剔除并在附录标注，未做插补。
数据质量：重复记录 0 条，客单价单位统一为元。

## 二、趋势与结构
销售额同比 -6%，主要由客流下降驱动；客单价同比 +5.6%，部分对冲。
结构上，直营门店占比 78%，加盟门店占比 22%，加盟店同比 +2%，直营店同比 -9%。

## 三、异常识别
3 家门店客流同比下滑超20%，偏离度分别为 -24%、-22%、-21%，超过 IQR 上界。
可能原因：周边新开竞品、门店排班减少、促销力度下降。
核实建议：调取三家门店 6 月排班表与竞品开业时间，7 个工作日内完成核实。

## 四、指标拆解
销售额 = 客流 × 客单价。客流同比 -11%，客单价同比 +5.6%，乘积项合计约 -6%，与销售额实测 -6% 基本吻合。
其中客单价提升的贡献约为 +5.6 个百分点，来自高价位机型占比上升。

## 五、洞察结论
结论一：销售额下滑的主因是客流而非价格。在 182 条门店日记录中，
客流同比 -11% 与销售额同比 -6% 之间存在相关关系，但未做因果检验，需进一步验证。
结论二：客单价上升部分来自低基数门店关店，拉低整体客单价的机型仍在售。

## 六、行动建议与跟踪指标
建议一：对三家异常门店做一周客流专项跟踪。责任人：运营部李明，时限：7 个工作日。
建议二：把"门店客流同比"纳入月度看板，跟踪指标为客流同比与签约商户数。
本报告不做未经数据支持的未来预测。
"""

BAD_STRUCTURE = """# 分析结果
销售额下降了，要加强运营。
"""

BAD_PROMISE = """# 门店运营数据分析报告

## 一、数据口径与质量说明
口径：净成交，统计期间 2026-01 至 2026-06，数据来源 POS 系统，共 182 条记录。

## 二、趋势与结构
销售额同比 -6%，客流同比 -11%。

## 三、异常识别
3 家门店客流下滑超20%，偏离度 -24%。

## 四、洞察结论
客单价下滑是因为促销力度下降，导致销售额下降。

## 五、行动建议与跟踪指标
预计客单价提升 10%，销售额增加 187 万元，需加强运营。
"""

BAD_SAMPLE = """# 门店运营数据分析报告

## 一、数据口径与质量说明
口径：净成交，统计期间 2026-01 至 2026-06，数据来源 POS 系统。

## 二、趋势与结构
销售额同比 -6%，客流同比 -11%。

## 三、异常识别
3 家门店客流下滑超20%，偏离度 -24%。

## 四、洞察结论
在 3 家门店的记录中，促销下降与客流下降同向，促销投入不足导致客流下滑。

## 五、行动建议与跟踪指标
建议：加强促销。责任人：运营部，时限：一个月，跟踪指标为销售额。
"""

BAD_NO_RESP = """# 门店运营数据分析报告

## 一、数据口径与质量说明
口径：净成交，统计期间 2026-01 至 2026-06，数据来源 POS 系统，共 182 条记录。

## 二、趋势与结构
销售额同比 -6%，客流同比 -11%。

## 三、异常识别
3 家门店客流下滑超20%，偏离度 -24%。

## 四、洞察结论
客流下降导致销售额下降，二者仅存在相关性，未做因果检验需进一步验证。

## 五、行动建议与跟踪指标
建议：加强促销与排班，跟踪指标为门店客流同比。
"""

# V1.7.0 新增：期间不完整比较（红线 7 文本判据）
BAD_PERIOD = """# 本月经营分析报告

## 一、数据口径与质量说明
口径：净成交，数据来源 POS 系统，共 182 条记录，统计期间 2026-06-01 至今。

## 二、趋势与结构
本月销售额环比下滑 12%，客流环比下滑 9%。

## 三、异常识别
3 家门店客流下滑超 20%，偏离度 -24%，采用 IQR 法判定。

## 四、指标拆解
销售额 = 客流 × 客单价，客流贡献 -9 个百分点，客单价贡献 -3 个百分点，合计 -12 个百分点。

## 五、洞察结论
在 182 条记录中，本月客流下滑与销售额下滑同向，未做因果检验，需进一步验证。

## 六、行动建议与跟踪指标
建议一：核查排班。责任人：运营部李明，时限：7 个工作日，跟踪指标：客流同比。
"""

# V1.7.0 新增：直答形态（应放行）
GOOD_DIRECT = """# 上周订单量查询

输出形态：直答

口径：净成交订单，按支付时间归属，已剔除测试单。
统计期间：2026-10-06 至 2026-10-12，共 3,842 条订单记录。
上周订单量 = 3,842 单，较前一周 3,610 单增加 6.4%，未做因果推断，仅陈述变动。
"""

# V1.7.0 新增：干净数据（应全过）
CLEAN_CSV = """门店,月份,客流,销售额,客单价
直营-01,2026-01,203958,17232440,84.49
直营-02,2026-02,157604,13315976,84.49
直营-03,2026-03,176146,14882561,84.49
直营-04,2026-04,187271,15822513,84.49
"""

# V1.7.0 新增：脏数据（应逐项检出）
DIRTY_CSV = """门店,月份,客流,销售额,客单价
直营-01,2026-01,203958,17232440,84.49
直营-01,2026-01,203958,17232440,84.49
直营-02,2026-03,157604,13315976,84.49
直营-03,2026-05,176146,14882561,84.49
直营-03,2026-05,176146,14882561,84.49
"""


def self_test():
    cases = [
        ("正向·合格六段报告", GOOD, True),
        ("正向·直答形态放行", GOOD_DIRECT, True),
        ("反向·结构残缺", BAD_STRUCTURE, False),
        ("反向·无依据量化承诺", BAD_PROMISE, False),
        ("反向·缺样本量声明", BAD_SAMPLE, False),
        ("反向·行动无责任人", BAD_NO_RESP, False),
        ("反向·期间不完整比较", BAD_PERIOD, False),
    ]
    ok = True
    print("=== 门禁自测 · 报告层 ===")
    for name, text, expect in cases:
        r = check_output(text)
        got = r["passed"]
        flag = "OK " if got == expect else "FAIL"
        if got != expect:
            ok = False
        print("[%s] %s：期望%s 实际%s（形态 %s，得分 %s）" %
              (flag, name, "通过" if expect else "拦截", "通过" if got else "拦截",
               r["mode"], r["score"]))
        for v in r["violations"]:
            print("        红线：%s" % v)
        for s in r["missing_sections"]:
            print("        结构：%s" % s)

    print("")
    print("=== 门禁自测 · 数据层 ===")
    data_cases = [
        ("正向·干净数据", CLEAN_CSV, None, True),
        ("反向·重复行+时间缺口", DIRTY_CSV, None, False),
        ("反向·主键重复", DIRTY_CSV, "门店", False),
    ]
    for name, text, key, expect in data_cases:
        r = check_data(text, key_col=key)
        got = r["passed"]
        flag = "OK " if got == expect else "FAIL"
        if got != expect:
            ok = False
        bad = [c for c, o, _ in r["checks"] if not o]
        print("[%s] %s：期望%s 实际%s（未通过项 %d）" %
              (flag, name, "通过" if expect else "检出问题",
               "通过" if got else "检出问题", len(bad)))
        for c, o, m in r["checks"]:
            if not o:
                print("        %s %s" % (c, m))

    # 对抗验证：证明数据层检查不是空跑
    print("")
    print("=== 对抗验证（防止检查函数空转）===")
    r = check_data(DIRTY_CSV, key_col="门店")
    hit = {c for c, o, _ in r["checks"] if not o}
    need = {"DT01", "DT02", "DT05"}
    covered = need <= hit
    print("[%s] 脏数据须命中 %s，实际命中 %s" %
          ("OK " if covered else "FAIL", sorted(need), sorted(hit)))
    if not covered:
        ok = False

    print("")
    print("=== 自测结果：%s ===" % ("全部符合预期" if ok else "存在不符合预期的用例"))
    return 0 if ok else 1


def main(argv):
    args = [a for a in argv[1:] if not a.startswith("-") and a != "--key"]
    flags = [a for a in argv[1:] if a.startswith("-")]

    key_col = None
    for i, a in enumerate(argv[1:]):
        if a == "--key" and i + 2 < len(argv):
            key_col = argv[i + 2]
        elif a.startswith("--key="):
            key_col = a.split("=", 1)[1]

    if "--self-test" in flags or "--selftest" in flags:
        return self_test()

    if "--package" in argv:
        report = check_package()
        print(format_package_report(report))
        return 0 if report["passed"] else 1

    if "--data" in argv:
        idx = argv.index("--data")
        if idx + 1 >= len(argv):
            print("用法：--data <数据文件> [--key 列名]")
            return 2
        path = argv[idx + 1]
        if not os.path.isfile(path):
            print("文件不存在：" + path)
            return 2
        with io.open(path, encoding="utf-8", errors="replace") as f:
            content = f.read()
        report = check_data(content, key_col=key_col)
        print(format_data_report(report))
        return 0 if report["passed"] else 1

    # --key 的值不能被当作报告路径
    if key_col is not None and key_col in args:
        args = [a for a in args if a != key_col]

    if args:
        path = args[0]
        if not os.path.isfile(path):
            print("文件不存在：" + path)
            return 2
        with io.open(path, encoding="utf-8") as f:
            report = check_output(f.read())
        print(format_report(report))
        return 0 if report["passed"] else 1

    report = check_package()
    print(format_package_report(report))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
