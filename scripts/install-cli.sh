#!/usr/bin/env bash
set -euo pipefail

CLOVER_HOME="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TARGET="/usr/local/bin/clover"
SOURCE="${CLOVER_HOME}/scripts/clover.sh"

[ "$(id -u)" -eq 0 ] || { echo "安装 clover 命令需要 root 权限。" >&2; exit 1; }
[ -f "$SOURCE" ] || { echo "找不到 Clover 管理脚本：$SOURCE" >&2; exit 1; }
chmod 755 "$SOURCE"
if [ -e "$TARGET" ] || [ -L "$TARGET" ]; then
  if [ -L "$TARGET" ] && [ "$(readlink -f "$TARGET" 2>/dev/null || true)" = "$(readlink -f "$SOURCE")" ]; then
    exit 0
  fi
  echo "$TARGET 已存在且不属于当前 Clover 安装；为避免覆盖现有命令，未修改。" >&2
  exit 1
fi
ln -s "$SOURCE" "$TARGET"
echo "已安装快捷命令：$TARGET"
