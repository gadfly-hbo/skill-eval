#!/usr/bin/env bash
# 把仓库内的 skill-eval-flow 安装到 WorkBuddy 用户级 skill 目录。
# 幂等：重复执行会同步最新内容。

set -euo pipefail

SRC="$(cd "$(dirname "$0")/../skills/skill-eval-flow" && pwd)"
DST="${1:-$HOME/.workbuddy/skills/skill-eval-flow}"

if [ ! -f "$SRC/SKILL.md" ]; then
  echo "错误：找不到 $SRC/SKILL.md" >&2
  exit 1
fi

mkdir -p "$DST"

# 同步三个组成部分，保持仓库为唯一源。
cp "$SRC/SKILL.md" "$DST/SKILL.md"
mkdir -p "$DST/scripts" "$DST/references"
cp "$SRC/scripts/preflight.sh" "$DST/scripts/preflight.sh"
cp "$SRC/references/suite-design.md" "$DST/references/suite-design.md"
chmod +x "$DST/scripts/preflight.sh"

echo "已安装 skill-eval-flow 到 $DST"
echo "在 WorkBuddy 对话中说「评估这个 skill：<SKILL.md 路径>」即可触发。"
