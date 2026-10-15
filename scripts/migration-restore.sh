#!/bin/sh
set -eu

job=${1:?missing migration job id}
case "$job" in *[!a-f0-9]*|'') echo 'invalid migration id' >&2; exit 2 ;; esac
project=/clover
umask 077
mkdir -p "$project/backups"
exec >> "$project/backups/migration-${job}.log" 2>&1
archive="$project/backups/migration-${job}.tar.gz"
status="$project/backups/migration-${job}.status"
work="/tmp/clover-migration-restore-${job}"
compose_project=${CLOVER_COMPOSE_PROJECT:-clover}
mail_container=${CLOVER_MAIL_CONTAINER:-docker-mailserver}
panel_container=${CLOVER_PANEL_CONTAINER:-clover-panel}
roundcube_container=${CLOVER_ROUNDCUBE_CONTAINER:-clover-roundcube}
caddy_container=${CLOVER_CADDY_CONTAINER:-clover-caddy}
stopped=""
write_status() { printf '%s|%s\n' "$1" "$2" > "$status"; }
compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose --project-directory "${CLOVER_HOME:-/opt/clover}" --env-file "$project/.env" -p "$compose_project" "$@"
  elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --project-directory "${CLOVER_HOME:-/opt/clover}" --env-file "$project/.env" -p "$compose_project" "$@"
  else
    echo 'Docker Compose is not installed in the migration helper.' >&2
    return 127
  fi
}
cleanup() {
  result=$?
  for name in $stopped; do docker start "$name" >/dev/null 2>&1 || result=1; done
  rm -rf "$work" "$archive"
  if [ "$result" -eq 0 ]; then write_status complete '迁移包已恢复，服务正在检查。'; else write_status failed '恢复失败；请查看服务器 backups 目录下对应任务日志。'; fi
  exit "$result"
}
trap cleanup EXIT HUP INT TERM
exec 9>/tmp/clover-migration.lock
flock -n 9 || { write_status failed '已有迁移任务正在运行。'; exit 1; }
write_status running '正在检查迁移包…'
mkdir -p "$work/stage" "$project/backups"

listing=$(tar --quoting-style=escape -tzf "$archive")
printf '%s\n' "$listing" | while IFS= read -r entry; do
  case "$entry" in /*|*\\*|*'../'*|../*|*'/'..|*'/'../*) echo 'unsafe path in migration archive' >&2; exit 1 ;; esac
done
types=$(tar --quoting-style=escape -tvzf "$archive")
printf '%s\n' "$types" | while IFS= read -r entry; do
  case "${entry%% *}" in d*|-*) ;; *) echo 'links and special files are not supported' >&2; exit 1 ;; esac
done
tar --numeric-owner --same-owner --same-permissions --xattrs --acls -xzf "$archive" -C "$work/stage"
test -s "$work/stage/manifest.json"
test -s "$work/stage/config/project/.env"
test -s "$work/stage/config/project/compose.yaml"
test -s "$work/stage/volumes/panel-data/clover.db"

for name in "$caddy_container" "$roundcube_container" "$panel_container" "$mail_container"; do
  state=$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)
  if [ "$state" = true ]; then
    docker stop --time 30 "$name" >/dev/null
    stopped="$stopped $name"
  fi
done
write_status running '正在恢复数据卷和配置…'

docker_root=$(docker info --format '{{.DockerRootDir}}')
for logical in mail-data mail-state mail-config roundcube-db roundcube-policy caddy-data caddy-config; do
  source="$work/stage/volumes/$logical"
  [ -d "$source" ] || { echo "missing volume in migration package: $logical" >&2; exit 1; }
  volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$compose_project" --filter "label=com.docker.compose.volume=$logical" | head -n 1)
  [ -n "$volume" ] || { echo "target Docker volume is missing: $logical" >&2; exit 1; }
  mountpoint=$(docker volume inspect -f '{{.Mountpoint}}' "$volume")
  case "$mountpoint" in "$docker_root"/*) ;; *) echo "unexpected target volume mountpoint: $logical" >&2; exit 1 ;; esac
  target="/host${mountpoint}"
  [ -d "$target" ] || { echo "target volume is inaccessible: $logical" >&2; exit 1; }
  find "$target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  cp -a "$source/." "$target/"
done

panel_volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$compose_project" --filter label=com.docker.compose.volume=panel-data | head -n 1)
[ -n "$panel_volume" ] || { echo 'target panel-data volume is missing' >&2; exit 1; }
panel_mount=$(docker volume inspect -f '{{.Mountpoint}}' "$panel_volume")
case "$panel_mount" in "$docker_root"/*) ;; *) echo 'unexpected panel-data mountpoint' >&2; exit 1 ;; esac
panel_target="/host${panel_mount}"
[ -d "$panel_target" ] || { echo 'target panel-data volume is inaccessible' >&2; exit 1; }
find "$panel_target" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
cp -a "$work/stage/volumes/panel-data/." "$panel_target/"

cp -a "$work/stage/config/project/.env" "$project/.env"
cp -a "$work/stage/config/project/compose.yaml" "$project/compose.yaml"
for name in caddy deploy scripts panel; do
  if [ -d "$work/stage/config/project/$name" ]; then
    replacement="$project/.migration-${job}-$name"
    cp -a "$work/stage/config/project/$name" "$replacement"
    rm -rf "$project/$name"
    mv "$replacement" "$project/$name"
  fi
done
if [ -f "$work/stage/config/project/README.md" ]; then cp -a "$work/stage/config/project/README.md" "$project/README.md"; fi
if [ -f "$work/stage/config/project/.env.example" ]; then cp -a "$work/stage/config/project/.env.example" "$project/.env.example"; fi
if [ -f "$work/stage/config/project/compose.build.yaml" ]; then cp -a "$work/stage/config/project/compose.build.yaml" "$project/compose.build.yaml"; fi
if grep -q '^CLOVER_HOME=' "$project/.env"; then sed -i "s|^CLOVER_HOME=.*|CLOVER_HOME=${CLOVER_HOME:-/opt/clover}|" "$project/.env"; else printf '\nCLOVER_HOME=%s\n' "${CLOVER_HOME:-/opt/clover}" >> "$project/.env"; fi
chmod 600 "$project/.env"
write_status running '数据已恢复，正在重新启动服务…'
cd "$project"
compose -f compose.yaml config --quiet
compose -f compose.yaml up -d --no-build mail panel roundcube caddy
stopped=""
write_status complete '迁移包已恢复；请检查新 VPS 的 IP、DNS 和证书。'
