#!/usr/bin/env bash
# 把仓库内的 skill-eval-flow 安装到各 agent 的 skill 目录。
#
# 默认装两个位置（幂等，重复执行同步最新内容）：
#   ~/.agents/skills/skill-eval-flow     —— Agent Skills 规范全局位置，pi / Claude Code / Codex 都会扫描
#   ~/.workbuddy/skills/skill-eval-flow  —— WorkBuddy 用户级 skill
#
# 只装其中一个：--agents 或 --workbuddy。也可给自定义路径作为位置参数。

set -euo pipefail

SRC="$(cd "$(dirname "$0")/../skills/skill-eval-flow" && pwd)"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "错误：找不到 $SRC/SKILL.md" >&2
  exit 1
fi

TARGETS=()
if [ $# -eq 0 ]; then
  TARGETS+=("$HOME/.agents/skills/skill-eval-flow" "$HOME/.workbuddy/skills/skill-eval-flow")
else
  for arg in "$@"; do
    case "$arg" in
      --agents)    TARGETS+=("$HOME/.agents/skills/skill-eval-flow") ;;
      --workbuddy) TARGETS+=("$HOME/.workbuddy/skills/skill-eval-flow") ;;
      *)           TARGETS+=("$arg") ;;
    esac
  done
fi

for DST in "${TARGETS[@]}"; do
  mkdir -p "$DST/scripts" "$DST/references"
  # 整目录同步，使目标端的脚本和参考文件随源目录增删。
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$SRC/" "$DST/"
  else
    rm -rf "$DST/scripts" "$DST/references"
    mkdir -p "$DST/scripts" "$DST/references"
    cp -R "$SRC/." "$DST/"
  fi
  chmod +x "$DST/scripts/"*.sh 2>/dev/null || true
  echo "已安装到 $DST"
done

echo ""
echo "调用方式："
echo "  WorkBuddy / pi：「评估这个 skill：<SKILL.md 路径>」"
echo "  pi 强制触发：/skill:skill-eval-flow <SKILL.md 路径>"
