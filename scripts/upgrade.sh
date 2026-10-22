#!/usr/bin/env bash
# =============================================================================
# clover 升级脚本（VPS 宿主机）
#
#   ./scripts/upgrade.sh              # 拉代码 + 拉镜像 + 重建面板 + 重启 + 健康检查
#   ./scripts/upgrade.sh --no-pull    # 跳过 git pull（只更新镜像）
#
# 数据安全：SQLite 迁移在面板启动时自动执行（幂等）；升级前可选自动备份。
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

NO_PULL=0
[ "${1:-}" = "--no-pull" ] && NO_PULL=1

log() { printf '\033[1;32m[upgrade]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[upgrade]\033[0m %s\n' "$*"; }
UPGRADE_TMP=""
cleanup_upgrade_tmp() {
  [ -z "$UPGRADE_TMP" ] || rm -rf -- "$UPGRADE_TMP"
}
trap cleanup_upgrade_tmp EXIT

update_from_archive() {
  local repo="${CLOVER_REPO:-Vincentkeio/clover-mail}"
  local ref="${CLOVER_REF:-main}"
  local tmp src item deploy_item name url revision

  UPGRADE_TMP="$(mktemp -d)"
  tmp="$UPGRADE_TMP"
  # Resolve once, then download that exact commit so version checks describe
  # the files installed even if the branch advances during the download.
  local auth_args=()
  [ -z "${CLOVER_TOKEN:-}" ] || auth_args=(-H "Authorization: Bearer ${CLOVER_TOKEN}")
  curl -fsSL --max-time 30 "${auth_args[@]}" \
    "https://api.github.com/repos/${repo}/commits/${ref}" -o "${tmp}/revision.json"
  revision="$(sed -nE '/"sha"[[:space:]]*:/ { s/.*"sha"[[:space:]]*:[[:space:]]*"([0-9a-f]{40})".*/\1/p; q; }' "${tmp}/revision.json")"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo '无法确认源码版本；当前服务未重建。' >&2; return 1; }
  url="https://codeload.github.com/${repo}/tar.gz/${revision}"
  if [ -n "${CLOVER_TOKEN:-}" ]; then
    curl -fsSL --max-time 180 -H "Authorization: Bearer ${CLOVER_TOKEN}" \
      "https://api.github.com/repos/${repo}/tarball/${revision}" -o "${tmp}/clover.tar.gz" \
      || { echo "代码下载失败（请检查仓库、分支和 CLOVER_TOKEN）；当前服务未重建。" >&2; return 1; }
  else
    curl -fsSL --max-time 120 "$url" -o "${tmp}/clover.tar.gz" \
      || { echo "代码下载失败（请检查网络、仓库和分支）；当前服务未重建。" >&2; return 1; }
  fi

  mkdir -p "${tmp}/source"
  tar -xzf "${tmp}/clover.tar.gz" -C "${tmp}/source"
  src="$(find "${tmp}/source" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  [ -n "$src" ] && [ -f "$src/compose.yaml" ] && [ -f "$src/scripts/upgrade.sh" ] \
    && [ -f "$src/scripts/maintenance.sh" ] \
    || { echo "下载的源码包不完整；当前服务未重建。" >&2; return 1; }

  log "非 Git 安装 → 使用 GitHub ${repo}@${ref} 更新源码"
  shopt -s dotglob nullglob
  for item in "$src"/*; do
    name="$(basename "$item")"
    case "$name" in
      .env|.env.bak.*|.env.before-*|backups) continue ;;
      .env.*)
        if [ "$name" != .env.example ]; then continue; fi
        rm -f "$name"
        cp -a "$item" .
        ;;
      deploy)
        mkdir -p deploy
        for deploy_item in "$src/deploy"/*; do
          name="$(basename "$deploy_item")"
          [ "$name" = acme ] && continue
          rm -rf "deploy/$name"
          cp -a "$deploy_item" deploy/
        done
        ;;
      *)
        rm -rf "$name"
        cp -a "$item" .
        ;;
    esac
  done
  shopt -u dotglob nullglob
  [ -z "$revision" ] || printf '%s\n' "$revision" > .clover-source-revision
  rm -rf -- "$UPGRADE_TMP"
  UPGRADE_TMP=""
  log "源码更新完成（.env、备份、deploy/acme 证书目录和 Docker 数据卷均保留）"
}

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

# Manual upgrade entry point; bootstrap.sh handles install/overwrite choices separately.
port_in_use() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${1}$"
}
set_env() {
  if grep -q "^$1=" .env; then
    sed -i "s|^$1=.*|$1=$2|" .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

if [ -f .env ] && [ "${CLOVER_SHARED_CADDY:-0}" != "1" ] \
  && { port_in_use 80 || port_in_use 443; } \
  && command -v python3 >/dev/null 2>&1; then
  host_caddy="$(python3 scripts/host-caddy.py detect 2>/dev/null || true)"
  if [ -n "$host_caddy" ]; then
    CLOVER_HOST_CADDY_CONFIG="${host_caddy%%|*}"
    CLOVER_HOST_CADDY_BIN="${host_caddy#*|}"
    : "${CLOVER_HTTP_PORT:=18080}"
    : "${CLOVER_HTTPS_PORT:=18443}"
    [ "$CLOVER_HTTP_PORT" != 80 ] || CLOVER_HTTP_PORT=18080
    [ "$CLOVER_HTTPS_PORT" != 443 ] || CLOVER_HTTPS_PORT=18443
    CLOVER_SHARED_CADDY=1
    CLOVER_SHARED_NGINX=0
    CLOVER_CADDY_SCHEME=http
    CLOVER_CADDY_HTTP_PUBLISH="127.0.0.1:${CLOVER_HTTP_PORT}"
    CLOVER_CADDY_HTTPS_PUBLISH="127.0.0.1:${CLOVER_HTTPS_PORT}"
    CLOVER_HOME="$(pwd)"
    CLOVER_TLS_DIRECTIVE=
    log "检测到宿主机 Caddy，修复共享入口配置（保留现有站点）"
    set_env CLOVER_HTTP_PORT "$CLOVER_HTTP_PORT"
    set_env CLOVER_HTTPS_PORT "$CLOVER_HTTPS_PORT"
    set_env CLOVER_SHARED_CADDY "$CLOVER_SHARED_CADDY"
    set_env CLOVER_SHARED_NGINX "$CLOVER_SHARED_NGINX"
    set_env CLOVER_HOST_CADDY_CONFIG "$CLOVER_HOST_CADDY_CONFIG"
    set_env CLOVER_HOST_CADDY_BIN "$CLOVER_HOST_CADDY_BIN"
    set_env CLOVER_CADDY_SCHEME "$CLOVER_CADDY_SCHEME"
    set_env CLOVER_CADDY_HTTP_PUBLISH "$CLOVER_CADDY_HTTP_PUBLISH"
    set_env CLOVER_CADDY_HTTPS_PUBLISH "$CLOVER_CADDY_HTTPS_PUBLISH"
    set_env CLOVER_HOME "$CLOVER_HOME"
    set_env CLOVER_TLS_DIRECTIVE "$CLOVER_TLS_DIRECTIVE"
    chmod 600 .env
  fi
fi

if { port_in_use 80 || port_in_use 443; } && command -v systemctl >/dev/null 2>&1 \
  && systemctl is-active --quiet nginx; then
  nginx_80=0; nginx_443=0
  ss -H -ltnp 'sport = :80' 2>/dev/null | grep -q nginx && nginx_80=1 || true
  ss -H -ltnp 'sport = :443' 2>/dev/null | grep -q nginx && nginx_443=1 || true
  if { ! port_in_use 80 || [ "$nginx_80" -eq 1 ]; } \
    && { ! port_in_use 443 || [ "$nginx_443" -eq 1 ]; }; then
    log "检测到宿主机 nginx，修复共享入口配置（Caddy 内部监听；证书签发会短暂停 nginx）"
    : "${CLOVER_HTTP_PORT:=18080}"
    : "${CLOVER_HTTPS_PORT:=18443}"
    [ "$CLOVER_HTTP_PORT" != 80 ] || CLOVER_HTTP_PORT=18080
    [ "$CLOVER_HTTPS_PORT" != 443 ] || CLOVER_HTTPS_PORT=18443
    CLOVER_SHARED_NGINX=1
    CLOVER_CADDY_SCHEME=http
    CLOVER_CADDY_HTTP_PUBLISH="127.0.0.1:${CLOVER_HTTP_PORT}"
    CLOVER_CADDY_HTTPS_PUBLISH="127.0.0.1:${CLOVER_HTTPS_PORT}"
    CLOVER_HOME="$(pwd)"
    CLOVER_TLS_DIRECTIVE=
    set_env CLOVER_HTTP_PORT "$CLOVER_HTTP_PORT"
    set_env CLOVER_HTTPS_PORT "$CLOVER_HTTPS_PORT"
    set_env CLOVER_SHARED_NGINX "$CLOVER_SHARED_NGINX"
    set_env CLOVER_CADDY_SCHEME "$CLOVER_CADDY_SCHEME"
    set_env CLOVER_CADDY_HTTP_PUBLISH "$CLOVER_CADDY_HTTP_PUBLISH"
    set_env CLOVER_CADDY_HTTPS_PUBLISH "$CLOVER_CADDY_HTTPS_PUBLISH"
    set_env CLOVER_HOME "$CLOVER_HOME"
    set_env CLOVER_TLS_DIRECTIVE "$CLOVER_TLS_DIRECTIVE"
    chmod 600 .env
  fi
fi

# 1) 升级前备份（有脚本就备份，失败不阻断但明确告警）
if [ -f scripts/backup.sh ] && [ -n "${RECONCILE_TOKEN:-}" ]; then
  log "升级前备份…"
  if bash scripts/backup.sh; then
    if [[ "${CLOVER_UPDATE_SNAPSHOT_STAMP:-}" =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
      docker exec clover-panel rm -f "/app/data/clover-before-update-${CLOVER_UPDATE_SNAPSHOT_STAMP}.db" \
        || warn "完整备份已成功，但未能删除重复的面板数据库回滚快照。"
    fi
  else
    warn "备份失败！继续升级前请确认可接受（Ctrl+C 中止）"
    sleep 5
  fi
else
  warn "跳过备份（缺少 RECONCILE_TOKEN 或 backup.sh 不可执行）"
fi

# 2) 代码
if [ "${NO_PULL}" -eq 0 ]; then
  if [ -d .git ]; then
    if ! git diff --quiet || ! git diff --cached --quiet; then
      STASH_LABEL="clover-upgrade-before-update-$(date +%Y%m%d-%H%M%S)"
      log "将服务器本地代码改动保存到 Git stash：${STASH_LABEL}"
      git stash push -m "${STASH_LABEL}"
    fi
    log "拉取仓库代码…"
    git pull --rebase || {
      echo "代码更新失败；本地代码改动仍保留在 Git stash 中。请检查 git status 与 git stash list 后重试。" >&2
      exit 1
    }
    git rev-parse HEAD > .clover-source-revision
  else
    update_from_archive
  fi
fi

# The maintenance entry point is mounted into the dashboard's docker:cli job.
# Keep it in the same source refresh as this upgrade script so the next job uses
# the matching implementation instead of a stale host copy.
[ -f scripts/maintenance.sh ] || {
  echo "源码更新不完整：缺少 scripts/maintenance.sh；当前服务未重建。" >&2
  exit 1
}
log "维护脚本已同步：scripts/maintenance.sh"

# A previous version may not have installed the `clover` command yet.
if [ -x scripts/install-cli.sh ]; then
  bash scripts/install-cli.sh "$(pwd)" || warn "快捷命令安装未完成；服务升级继续，可稍后手动运行 bash scripts/install-cli.sh"
fi

bash scripts/ensure-roundcube-env.sh
export ROUNDCUBE_SSO_SECRET="$(sed -n 's/^ROUNDCUBE_SSO_SECRET=//p' .env)"

# 3) 拉取正式发布镜像并重启面板。
# 安装目录可能带有 panel/ 源码（例如 bootstrap 解压的 GitHub 源码包），
# 普通升级仍必须使用 GHCR 发布镜像，避免在 VPS 上本地 npm ci 耗尽磁盘。
COMPOSE_FILES=(-f compose.yaml)

PANEL_PUBLISH_REVISION=""
wait_for_panel_publish() {
  local revision repo payload count status conclusion attempt commit_payload
  revision="$(cat .clover-source-revision 2>/dev/null || true)"
  [[ "$revision" =~ ^[0-9a-f]{40}$ ]] || return 0
  repo="${CLOVER_REPO:-Vincentkeio/clover-mail}"
  local auth_args=()
  [ -z "${CLOVER_TOKEN:-}" ] || auth_args=(-H "Authorization: Bearer ${CLOVER_TOKEN}")
  for attempt in $(seq 1 36); do
    payload="$(curl -fsSL --max-time 15 "${auth_args[@]}" \
      "https://api.github.com/repos/${repo}/actions/workflows/publish-panel.yml/runs?head_sha=${revision}&per_page=1")" \
      || { echo '无法查询面板镜像发布状态；为避免使用旧镜像，更新已停止。' >&2; return 1; }
    count="$(printf '%s' "$payload" | grep -oE '"total_count"[[:space:]]*:[[:space:]]*[0-9]+' | head -n 1 | grep -oE '[0-9]+$' || true)"
    [ -n "$count" ] || { echo '无法解析面板镜像发布状态；更新已停止。' >&2; return 1; }
    if [ "$count" = 0 ]; then
      if [ "$attempt" -lt 4 ]; then
        [ "$attempt" -eq 1 ] && log '正在确认对应的面板镜像构建任务…'
        sleep 10
        continue
      fi
      commit_payload="$(curl -fsSL --max-time 15 "${auth_args[@]}" \
        "https://api.github.com/repos/${repo}/commits/${revision}")" \
        || { echo '无法确认本次源码变更范围；为避免使用旧镜像，更新已停止。' >&2; return 1; }
      if printf '%s' "$commit_payload" | grep -qE '"filename"[[:space:]]*:[[:space:]]*"(panel/|\.github/workflows/publish-panel\.yml)'; then
        echo '本次源码包含面板变更，但镜像构建任务尚未出现；更新已停止，请稍后重试。' >&2
        return 1
      fi
      log "本次源码提交没有触发面板镜像发布，继续使用最新已发布镜像。"
      return 0
    fi
    status="$(printf '%s' "$payload" | grep -oE '"status"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n 1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
    conclusion="$(printf '%s' "$payload" | grep -oE '"conclusion"[[:space:]]*:[[:space:]]*"[^"]+"' | head -n 1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
    if [ "$status" = completed ]; then
      [ "$conclusion" = success ] || { echo "面板镜像发布失败（${conclusion:-未知状态}）；更新已停止。" >&2; return 1; }
      PANEL_PUBLISH_REVISION="$revision"
      return 0
    fi
    [ "$attempt" -eq 1 ] && log '面板镜像仍在发布，等待对应版本完成…'
    sleep 10
  done
  echo '等待面板镜像发布超时；更新已停止，稍后重试。' >&2
  return 1
}

if [ "${CLOVER_UPDATE_TO_LATEST:-0}" = 1 ]; then
  set_env CLOVER_TAG latest
  export CLOVER_TAG=latest
fi

wait_for_panel_publish
log "拉取 GHCR 面板镜像及邮件/Caddy 镜像…"
for attempt in $(seq 1 6); do
  docker compose "${COMPOSE_FILES[@]}" pull panel || {
    echo "面板镜像拉取失败；未重建或重启面板。" >&2
    exit 1
  }
  [ -z "$PANEL_PUBLISH_REVISION" ] && break
  panel_image="${CLOVER_PANEL_IMAGE:-ghcr.io/vincentkeio/clover-panel}:${CLOVER_TAG:-latest}"
  image_revision="$(docker image inspect "$panel_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' 2>/dev/null || true)"
  [ "$image_revision" = "$PANEL_PUBLISH_REVISION" ] && break
  [ "$attempt" -eq 6 ] && { echo '镜像仓库仍返回旧版面板镜像；当前服务未重建，请稍后重试。' >&2; exit 1; }
  log '镜像仓库尚未同步到本次源码版本，稍后重试拉取…'
  sleep 10
done
docker compose "${COMPOSE_FILES[@]}" pull mail caddy roundcube || {
  echo "发布镜像拉取失败；未重建或重启面板。请检查 GHCR 网络后重试。" >&2
  exit 1
}

log "重启面板（使用已发布镜像，不在 VPS 本地构建）…"
docker compose "${COMPOSE_FILES[@]}" up -d --no-build panel

log "重启其余服务（应用新镜像）…"
docker compose build certificate-helper
docker compose up -d certificate-helper
docker compose "${COMPOSE_FILES[@]}" up -d --no-build

if [ "${CLOVER_SHARED_NGINX:-0}" = "1" ] || [ "${CLOVER_SHARED_CADDY:-0}" = "1" ] || [ "${CLOVER_CADDY_SCHEME:-https}" = "http" ]; then
  if [ "${CLOVER_SHARED_CADDY:-0}" = "1" ]; then
    log "配置宿主机 Caddy 反代并检查面板证书…"
  else
    log "申请/续签面板证书并启用 nginx 反代…"
  fi
  docker exec clover-certificate-helper python3 /app/certificates.py issue --force
fi

# 4) 健康检查（在面板容器内 fetch，不依赖 DNS/证书）
log "等待面板健康检查（最多 60s）…"
ok=0
for i in $(seq 1 30); do
  if docker exec clover-panel node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok=1; break
  fi
  sleep 2
done

if [ "${ok}" -eq 1 ]; then
  # Refresh configuration/plugin directory mounts after archive replacement.
  docker compose "${COMPOSE_FILES[@]}" up -d --no-deps --no-build --force-recreate roundcube
  bash scripts/configure-roundcube.sh
  # Archive updates can replace the mounted directory itself. Recreate the
  # gateway so both Git and archive upgrades use the current host files.
  docker compose "${COMPOSE_FILES[@]}" up -d --no-deps --no-build --force-recreate caddy
  rm -f .clover-local-build
  log "清理未使用的 Docker 构建缓存…"
  docker builder prune --all --force || warn "构建缓存清理失败；服务已健康运行，可稍后手动执行 docker builder prune -a。"
  log "清理未使用的 Docker 镜像层…"
  docker image prune --force || warn "悬空镜像清理失败；服务已健康运行，可稍后手动执行 docker image prune。"
  # Tagged images are not dangling. Inspect every repository used by this
  # Compose project and remove old image IDs only when no container references
  # them (including stopped containers and other projects).
  while IFS= read -r image_ref; do
    [ -n "$image_ref" ] || continue
    image_ref="${image_ref%%@*}"
    image_component="${image_ref##*/}"
    if [[ "$image_component" == *:* ]]; then
      image_repo="${image_ref%:*}"
    else
      image_repo="$image_ref"
    fi
    while IFS= read -r image_id; do
      [ -n "$image_id" ] || continue
      if [ -n "$(docker ps -aq --filter "ancestor=${image_id}" 2>/dev/null || true)" ]; then
        continue
      fi
      docker image rm "$image_id" >/dev/null \
        || warn "未使用旧镜像清理失败：${image_id} (${image_repo})"
    done < <(docker image ls --no-trunc --format '{{.ID}}' "$image_repo" 2>/dev/null | sort -u)
  done < <(docker compose "${COMPOSE_FILES[@]}" config --images 2>/dev/null | sort -u)
  log "升级完成，面板与 Roundcube 免密连接已就绪。查看状态：docker compose ps"
  log "迁移日志：docker logs clover-panel | grep migrations"
else
  warn "面板健康检查未通过！查看日志：docker logs --tail 100 clover-panel"
  exit 1
fi
