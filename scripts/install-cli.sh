#!/usr/bin/env bash
set -euo pipefail

CLOVER_HOME="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TARGET="${CLOVER_CLI_TARGET:-/usr/local/bin/clover}"
SOURCE="${CLOVER_HOME}/scripts/clover.sh"

[ "$(id -u)" -eq 0 ] || { echo "安装 clover 命令需要 root 权限。" >&2; exit 1; }
[ -f "$SOURCE" ] || { echo "找不到 Clover 管理脚本：$SOURCE" >&2; exit 1; }
# This helper is freshly opened even by pre-2.0.10 updaters. Capture container
# image IDs before their pull replaces upstream tags. Do this before Caddy reload.
if [ "${CLOVER_FRESH_INSTALL:-0}" != 1 ] && [ -f "$CLOVER_HOME/scripts/project-maintenance.sh" ]; then
  bash "$CLOVER_HOME/scripts/project-maintenance.sh" capture \
    || echo '警告：无法记录 Clover 镜像归属；归属不明的镜像将保留。' >&2
fi
# Older upgrade scripts invoke this refreshed helper after pulling new sources.
# Prepare the new service's key and routing before their deployment step runs.
if [ -f "$CLOVER_HOME/.env" ] && [ -f "$CLOVER_HOME/scripts/ensure-roundcube-env.sh" ]; then
  bash "$CLOVER_HOME/scripts/ensure-roundcube-env.sh"
  if command -v docker >/dev/null 2>&1 && [ "$(docker inspect -f '{{.State.Running}}' clover-caddy 2>/dev/null || true)" = true ]; then
    if docker exec clover-caddy test -f /etc/caddy/Caddyfile; then
      docker exec clover-caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null \
        || { echo "Caddy 路由重载失败；请检查配置后重试。" >&2; exit 1; }
    else
      echo 'Caddy 配置目录已更新，将在服务重建时载入新配置。'
    fi
  fi
fi
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
