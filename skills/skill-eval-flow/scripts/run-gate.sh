#!/usr/bin/env bash
# skill-eval-flow：跑被测 skill 自带的门禁脚本（S4 前置检查）。
#
# 为什么这一步不能省：
#   断言套件和评委都是在**猜**契约；门禁脚本是 **skill 作者自己写的契约实现**。
#   实测（data-analysis）：断言与评委都没抓到「直答形态未声明输出形态」这个缺陷，
#   只有跑 skill 自带的 scripts/quality_check.py 才暴露出来
#   （baseline 0/10 通过、skill 6/10 通过，失败的 4 份全是同一根因）。
#
# 用法：
#   bash run-gate.sh <被测SKILL.md路径> <运行目录>
#
# 行为：
#   - 自动探测被测 skill 里的门禁脚本（quality_check.py / validate*.py / lint*.sh 等）
#   - 对运行目录下的 baseline/ 与 skill/ 两侧输出各跑一遍
#   - 把结果写进 <运行目录>/gate-report.md
#   - 找不到门禁脚本时打印 [skip] 并以退出码 0 结束（不是失败）

set -uo pipefail

SKILL_MD="${1:-}"
RUN_DIR="${2:-}"

if [ -z "$SKILL_MD" ] || [ -z "$RUN_DIR" ]; then
  echo "用法: bash run-gate.sh <被测SKILL.md路径> <运行目录>" >&2
  exit 2
fi

SKILL_DIR="$(dirname "$SKILL_MD")"
OUT="$RUN_DIR/gate-report.md"

if [ ! -d "$RUN_DIR" ]; then
  echo "[fail] 运行目录不存在: $RUN_DIR" >&2
  exit 1
fi

# --- 探测门禁脚本 ------------------------------------------------------------
# 按优先级找：显式的门禁脚本优先，其次按命名模式探测。
GATE=""
for cand in \
  "$SKILL_DIR/scripts/quality_check.py" \
  "$SKILL_DIR/scripts/validate.py" \
  "$SKILL_DIR/scripts/validator.py" \
  "$SKILL_DIR/scripts/check.py" \
  "$SKILL_DIR/scripts/lint.sh"; do
  if [ -f "$cand" ]; then GATE="$cand"; break; fi
done

if [ -z "$GATE" ]; then
  # 再按模式扫一遍 scripts/ 目录
  for pat in quality_check.py validate.py validator.py check.py lint.sh; do
    hit="$(find "$SKILL_DIR/scripts" -maxdepth 1 -name "$pat" -type f 2>/dev/null | head -1)"
    if [ -n "$hit" ]; then GATE="$hit"; break; fi
  done
fi

if [ -z "$GATE" ]; then
  echo "[skip] 被测 skill 未发现自带门禁脚本（扫过 $SKILL_DIR/scripts/）"
  exit 0
fi

echo "[ok] 门禁脚本: $GATE"

# --- 探测门禁脚本的自测开关 -------------------------------------------------
# 很多门禁脚本有 --self-test / --selftest 参数。先跑一次确认脚本本身可用，
# 避免把「脚本用错参数」误判成「skill 输出不合格」。
SELF_TEST_FLAG=""
for f in --self-test --selftest; do
  if python3 "$GATE" "$f" >/dev/null 2>&1; then SELF_TEST_FLAG="$f"; break; fi
done
[ -n "$SELF_TEST_FLAG" ] && echo "[ok] 门禁自测可用: $SELF_TEST_FLAG"

# --- 探测门禁脚本的调用方式 -------------------------------------------------
# 不同 skill 的门禁参数约定不同：有的接裸文件路径，有的要 `--report <路径>`，
# 有的还要 `--data`（数据体检）。传错参数会拿到 argparse 的 usage 错误（退出码 2），
# **那不是「输出不合格」，是用法不对**——两者必须分开。
#
# 探测顺序：
#   1. `--report <file>`  （实测 data-analysis 的 quality_check.py 走这条）
#   2. 裸文件路径
# 用一个**必然存在但内容无害**的临时报告探测，选第一个不报 usage 的调用方式。
GATE_INVOKE_MODE=""
probe_file="$(mktemp -t gate-probe).md"
printf '# probe\n\n占位内容。\n' > "$probe_file"

# 判据是「有没有报 usage 错误」，不是退出码——
# 门禁对不合规内容也返回非 0，用退出码探测会选错模式。
if ! python3 "$GATE" --report "$probe_file" 2>&1 | grep -qi "usage:"; then
  GATE_INVOKE_MODE="--report"
elif ! python3 "$GATE" "$probe_file" 2>&1 | grep -qi "usage:"; then
  GATE_INVOKE_MODE="bare"
fi
rm -f "$probe_file"

if [ -z "$GATE_INVOKE_MODE" ]; then
  echo "[fail] 门禁脚本调用方式探测失败：--report 与裸路径都不接受" >&2
  echo "       已按「调用失败」记录全部样本（不是「输出不合格」）" >&2
  GATE_INVOKE_MODE="unknown"
else
  echo "[ok] 门禁调用方式: $GATE_INVOKE_MODE"
fi

# --- 对两侧输出各跑一遍 -----------------------------------------------------
run_one() {
  local variant="$1" task="$2" n="$3" file="$4"
  local out code
  case "$GATE_INVOKE_MODE" in
    --report) out="$(python3 "$GATE" --report "$file" 2>&1)" ;;
    bare)    out="$(python3 "$GATE" "$file" 2>&1)" ;;
    *)       out="调用方式未知（探测失败）"; code=99 ;;
  esac
  code=$?
  # usage 错误 = 参数不对，不是输出不合格
  if printf '%s' "$out" | grep -qi "usage:"; then
    echo "error|$variant|$task|$n|门禁用法不对（usage 错误） ${out//$'\n'/ }"
    return
  fi
  if [ "$code" -eq 0 ]; then
    echo "pass|$variant|$task|$n|退出码=0 ${out//$'\n'/ }"
  elif [ "$code" -eq 1 ] || [ "$code" -eq 2 ]; then
    # 门禁约定的「判定不通过」退出码
    echo "fail|$variant|$task|$n|退出码=$code ${out//$'\n'/ }"
  else
    # 其他退出码 = 调用方式不对（参数不支持等），不是「输出不合格」
    echo "error|$variant|$task|$n|退出码=$code ${out//$'\n'/ }"
  fi
}

{
  echo "# 门禁脚本复跑报告"
  echo
  echo "> 门禁脚本：\`$GATE\`"
  echo "> 被测 skill：\`$SKILL_MD\`"
  echo "> 说明：门禁是 skill 作者自己写的契约实现——断言套件和评委都是在猜契约。"
  echo "> 本报告反映「skill 自带门禁怎么看这批输出」，与断言判定口径不同，两者都要看。"
  echo
} > "$OUT"

echo "| 侧 | 用例 | 次 | 门禁判定 | 输出摘要 |" >> "$OUT"
echo "| --- | --- | --- | --- | --- |" >> "$OUT"

TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_CALL_ERR=0
ROWS=""

for variant in baseline skill; do
  base="$RUN_DIR/cases/$variant"
  [ -d "$base" ] || continue
  for task_dir in "$base"/*/; do
    [ -d "$task_dir" ] || continue
    task="$(basename "$task_dir")"
    for n_dir in "$task_dir"*/; do
      [ -d "$n_dir" ] || continue
      file="$n_dir/output.md"
      [ -f "$file" ] || continue
      n="$(basename "$n_dir")"
      line="$(run_one "$variant" "$task" "$n" "$file")"
      ROWS="$ROWS$line"$'\n'
      case "$line" in
        pass\|*)  TOTAL_PASS=$((TOTAL_PASS+1)) ;;
        fail\|*)  TOTAL_FAIL=$((TOTAL_FAIL+1)) ;;
        error\|*) TOTAL_CALL_ERR=$((TOTAL_CALL_ERR+1)) ;;
      esac
    done
  done
done

# 渲染表格：三种状态分开——「调用失败」不等于「输出不合格」，混在一起会误导归因。
echo "$ROWS" | while IFS='|' read -r status v t n rest; do
  [ -z "${status:-}" ] && continue
  case "$status" in
    pass)  JUDGE='✅ 通过' ;;
    fail)  JUDGE='❌ 不通过' ;;
    error) JUDGE='⚠️ 调用失败（非输出不合格）' ;;
    *)     JUDGE='?' ;;
  esac
  echo "| $v | $t | $n | $JUDGE | $(echo "$rest" | cut -c1-100) |" >> "$OUT"
done

{
  echo
  echo "**汇总**：通过 ${TOTAL_PASS}，不通过 ${TOTAL_FAIL}，调用失败 ${TOTAL_CALL_ERR}。"
  echo
  echo "> 「调用失败」= 门禁脚本用法不对（退出码非 0/1/2），**不能**读作「输出不合格」。"
} >> "$OUT"

echo
echo "门禁复跑完成 → $OUT"
echo "通过 ${TOTAL_PASS} / 不通过 ${TOTAL_FAIL} / 调用失败 ${TOTAL_CALL_ERR}"
exit 0
