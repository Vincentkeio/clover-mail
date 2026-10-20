#!/bin/sh
set -eu
umask 077

job=${1:?missing migration job id}
case "$job" in *[!a-f0-9]*|'') echo 'invalid migration id' >&2; exit 2 ;; esac
project=/clover
snapshot="/tmp/clover-migration-${job}.db"
work="/tmp/clover-migration-export-${job}"
compose_project=${CLOVER_COMPOSE_PROJECT:-clover}
mail_container=${CLOVER_MAIL_CONTAINER:-docker-mailserver}
roundcube_container=${CLOVER_ROUNDCUBE_CONTAINER:-clover-roundcube}
stopped=""

cleanup() {
  result=$?
  for name in $stopped; do docker start "$name" >/dev/null 2>&1 || result=1; done
  rm -rf "$work" "$snapshot"
  exit "$result"
}
trap cleanup EXIT HUP INT TERM
exec 9>/tmp/clover-migration.lock
flock -n 9 || { echo 'migration export is already running' >&2; exit 1; }

for name in "$roundcube_container" "$mail_container"; do
  state=$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)
  if [ "$state" = true ]; then
    docker stop --time 30 "$name" >/dev/null
    stopped="$stopped $name"
  fi
done

test -s "$snapshot" || { echo 'panel database snapshot is missing' >&2; exit 1; }
mkdir -p "$work/stage/config/project" "$work/stage/volumes/panel-data"
cp -a "$project/.env" "$project/.env.example" "$project/compose.yaml" "$project/caddy" "$project/deploy" "$project/scripts" "$project/README.md" "$project/README.zh-CN.md" "$work/stage/config/project/"
mkdir -p "$work/stage/config/project/panel"
if [ -d "$project/panel" ]; then
  find "$project/panel" -mindepth 1 -maxdepth 1 -type f ! -name '*.db*' ! -name '*.tsbuildinfo' -exec cp -a {} "$work/stage/config/project/panel/" \;
fi
for dir in src public drizzle; do
  if [ -d "$project/panel/$dir" ]; then cp -a "$project/panel/$dir" "$work/stage/config/project/panel/"; fi
done
if [ -f "$project/compose.build.yaml" ]; then cp -a "$project/compose.build.yaml" "$work/stage/config/project/"; fi
cp -a "$snapshot" "$work/stage/volumes/panel-data/clover.db"

docker_root=$(docker info --format '{{.DockerRootDir}}')
for logical in mail-data mail-state mail-config roundcube-db roundcube-policy caddy-data caddy-config; do
  volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$compose_project" --filter "label=com.docker.compose.volume=$logical" | head -n 1)
  [ -n "$volume" ] || { echo "missing Docker volume: $logical" >&2; exit 1; }
  mountpoint=$(docker volume inspect -f '{{.Mountpoint}}' "$volume")
  case "$mountpoint" in "$docker_root"/*) ;; *) echo "unexpected volume mountpoint: $logical" >&2; exit 1 ;; esac
  host_path="/host${mountpoint}"
  [ -d "$host_path" ] || { echo "volume data is inaccessible: $logical" >&2; exit 1; }
  if [ "$logical" = roundcube-policy ]; then
    mkdir -p "$work/stage/volumes/$logical"
    cp -a "$host_path/." "$work/stage/volumes/$logical/"
  else
    ln -s "$host_path" "$work/stage/volumes/$logical"
  fi
done

panel_volume=$(docker volume ls -q --filter "label=com.docker.compose.project=$compose_project" --filter label=com.docker.compose.volume=panel-data | head -n 1)
[ -n "$panel_volume" ] || { echo 'missing Docker volume: panel-data' >&2; exit 1; }
panel_mount=$(docker volume inspect -f '{{.Mountpoint}}' "$panel_volume")
case "$panel_mount" in "$docker_root"/*) ;; *) echo 'unexpected panel-data mountpoint' >&2; exit 1 ;; esac
panel_host="/host${panel_mount}"
find "$panel_host" -mindepth 1 -maxdepth 1 ! -name 'clover.db' ! -name 'clover.db-wal' ! -name 'clover.db-shm' -exec cp -a {} "$work/stage/volumes/panel-data/" \;

cat > "$work/stage/manifest.json" <<EOF
{"format":"clover-migration-v1","createdAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","project":"clover","volumes":["panel-data","mail-data","mail-state","mail-config","roundcube-db","roundcube-policy","caddy-data","caddy-config"]}
EOF

# Postfix runtime FIFOs and sockets are recreated on startup. Enumerate only
# regular files and directories; do not recurse into omitted special files.
(cd "$work/stage" && find -L . \( -type d -o -type f \) -print0) > "$work/files.list"
tar --create --gzip --dereference --hard-dereference --numeric-owner --xattrs --acls --no-recursion --null --directory="$work/stage" --files-from="$work/files.list" --file=-
