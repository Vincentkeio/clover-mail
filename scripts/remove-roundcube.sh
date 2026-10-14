#!/usr/bin/env bash
# Remove the retired Clover Roundcube container and only its own named data volumes.
set -euo pipefail

container=clover-roundcube
if ! docker inspect "$container" >/dev/null 2>&1; then
  exit 0
fi

volumes="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}}{{"\n"}}{{end}}{{end}}' "$container")"
docker rm -f "$container" >/dev/null
while IFS= read -r volume; do
  [ -n "$volume" ] || continue
  case "$volume" in
    *_roundcube-db|*_roundcube-data)
      docker volume rm "$volume" >/dev/null 2>&1 || echo "[clover] Roundcube 旧数据卷未能删除：$volume" >&2
      ;;
    *)
      echo "[clover] 保留 Roundcube 容器挂载的非预期数据卷：$volume" >&2
      ;;
  esac
done <<< "$volumes"
echo "[clover] 已移除旧 Roundcube 容器及其专属配置数据；邮件数据卷未触碰。"
