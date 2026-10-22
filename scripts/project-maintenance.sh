#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
project="$(pwd -P)"
action="${1:?capture 或 finish}"
run_cleanup() {
  if command -v python3 >/dev/null 2>&1; then
    python3 scripts/cleanup-project.py "$1" --project "$project" --host-project "$project"
  else
    docker exec clover-certificate-helper python3 /clover/scripts/cleanup-project.py "$1" \
      --project /clover --host-project "$project"
  fi
}
case "$action" in
  capture) run_cleanup capture ;;
  finish)
    if run_cleanup pending; then
      # Old updaters call this refreshed helper after pulling sources. A fresh
      # complete backup applies current retention and gates destructive cleanup.
      if bash scripts/backup.sh; then
        run_cleanup finish
      else
        echo '[cleanup] 完整备份失败；旧镜像和更新回滚快照均保留。' >&2
        exit 1
      fi
    fi
    ;;
  *) echo '用法：project-maintenance.sh capture|finish' >&2; exit 2 ;;
esac
