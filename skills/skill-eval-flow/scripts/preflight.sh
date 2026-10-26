#!/usr/bin/env bash
# skill-eval-flow 环境自检（S1）。
#
# 检查项：
#   1. node >= 22（skill-eval 依赖 node --experimental-strip-types）
#   2. skill-eval 在 PATH
#   3. pi CLI 在 PATH
#   4. pi 隔离 HOME 就绪（缺失时自动创建：复制认证文件、清理残留 *.lock）
#
# 输出：每项一行 "[ok] ..." / "[fail] ..."，最后一行 "PREFLIGHT_OK" 或 "PREFLIGHT_FAIL"。
# 退出码：全部通过为 0，任一失败为 1。

set -uo pipefail

PI_HOME="${SKILL_EVAL_PI_HOME:-$HOME/.skill-eval/pi-home}"
FAILED=0

ok()   { echo "[ok] $1"; }
fail() { echo "[fail] $1"; FAILED=1; }

# --- 1. node >= 22 -----------------------------------------------------------
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))' 2>/dev/null || echo 0)"
  if [ "${NODE_MAJOR:-0}" -ge 22 ]; then
    ok "node $(node --version)"
  else
    fail "node 版本过低（$(node --version)），需要 >= 22。请升级 node 后重试。"
  fi
else
  fail "找不到 node。skill-eval 需要 node >= 22。"
fi

# --- 2. skill-eval CLI -------------------------------------------------------
if command -v skill-eval >/dev/null 2>&1; then
  ok "skill-eval CLI（$(command -v skill-eval)）"
else
  fail "skill-eval 不在 PATH。请先执行：cd <skill-eval仓库> && npm install && npm link"
fi

# --- 3. pi CLI ---------------------------------------------------------------
if command -v pi >/dev/null 2>&1; then
  ok "pi CLI（$(command -v pi)）"
else
  fail "找不到 pi CLI。请先安装并完成认证（运行一次 pi）。"
fi

# --- 4. pi 隔离 HOME ----------------------------------------------------------
SRC="$HOME/.pi/agent"

if [ ! -f "$SRC/auth.json" ]; then
  fail "pi 未认证：$SRC/auth.json 不存在。请先运行一次 pi 完成认证，再重试。"
else
  mkdir -p "$PI_HOME/.pi/agent"
  for f in auth.json models-store.json models.json; do
    if [ -f "$SRC/$f" ]; then
      cp "$SRC/$f" "$PI_HOME/.pi/agent/$f"
    fi
  done
  chmod 600 "$PI_HOME/.pi/agent/auth.json" 2>/dev/null || true

  # 清理上次异常退出残留的空锁目录（pi 用 mkdir 建锁，残留会导致下次启动 EEXIST）
  CLEANED=0
  for lock in "$PI_HOME"/.pi/agent/*.lock; do
    [ -d "$lock" ] || continue
    if rmdir "$lock" 2>/dev/null; then CLEANED=$((CLEANED+1)); fi
  done
  if [ "$CLEANED" -gt 0 ]; then
    ok "pi 隔离 HOME 就绪：$PI_HOME（清理了 $CLEANED 个残留锁目录）"
  else
    ok "pi 隔离 HOME 就绪：$PI_HOME"
  fi
fi

# --- 汇总 ---------------------------------------------------------------------
echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "PREFLIGHT_OK"
  exit 0
else
  echo "PREFLIGHT_FAIL"
  exit 1
fi
