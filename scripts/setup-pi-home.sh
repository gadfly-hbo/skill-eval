#!/usr/bin/env bash
# 准备 pi 隔离 HOME。
#
# pi CLI 会在 ~/.pi/agent/ 下建锁文件，多进程并发时争用会导致启动失败
# （EEXIST: file already exists, mkdir '.../auth.json.lock'）。
# 评估时用独立 HOME，既避锁也不污染全局 pi 配置。
#
# 升级 pi 或更换模型认证后需要重新执行。

set -euo pipefail

PI_HOME="${1:-$HOME/.skill-eval/pi-home}"
SRC="$HOME/.pi/agent"

if [ ! -d "$SRC" ]; then
  echo "错误：找不到 $SRC，请先运行过 pi CLI 完成认证配置。" >&2
  exit 1
fi

mkdir -p "$PI_HOME/.pi/agent"

for f in auth.json models-store.json models.json; do
  if [ -f "$SRC/$f" ]; then
    cp "$SRC/$f" "$PI_HOME/.pi/agent/$f"
    echo "已复制 $f"
  fi
done

chmod 600 "$PI_HOME/.pi/agent/auth.json" 2>/dev/null || true

# 清理上次运行残留的空锁目录。
# pi 用 mkdir 创建 <file>.lock 目录作为互斥锁，进程异常退出时会留下空目录，
# 下次启动会抛 EEXIST: file already exists, mkdir '.../trust.json.lock'。
for lock in "$PI_HOME"/.pi/agent/*.lock; do
  [ -d "$lock" ] || continue
  rmdir "$lock" 2>/dev/null && echo "已清理残留锁目录 $(basename "$lock")" || true
done

echo ""
echo "pi 隔离 HOME 就绪：$PI_HOME"
echo "用法：skill-eval eval ... --home $PI_HOME"
