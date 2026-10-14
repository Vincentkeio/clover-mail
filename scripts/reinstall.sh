#!/usr/bin/env bash
# Clover 覆盖部署入口：保留配置与 Docker 数据卷，重新构建并启动服务。
set -euo pipefail

cd "$(dirname "$0")/.."
[ "$(id -u)" -eq 0 ] || { echo "请以 root 运行。" >&2; exit 1; }
[ -f .env ] || { echo "找不到 .env；请使用全新安装流程。" >&2; exit 1; }
[ -f compose.yaml ] || { echo "找不到 compose.yaml；无法覆盖部署。" >&2; exit 1; }

log() { printf '\033[1;32m[clover-reinstall]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[clover-reinstall]\033[0m %s\n' "$*"; }

# 保留并备份原配置。覆盖部署不会 down -v，也不会移除 named volumes。
ENV_BACKUP=".env.before-overwrite.$(date +%Y%m%d-%H%M%S)"
cp -p .env "$ENV_BACKUP"
chmod 600 "$ENV_BACKUP"
log "原配置已备份为 ${ENV_BACKUP}；.env 与 Docker 数据卷将保留。"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

COMPOSE_FILES=(-f compose.yaml)

log "拉取已发布镜像…"
docker compose "${COMPOSE_FILES[@]}" pull panel mail caddy \
  || { echo "镜像拉取失败；没有覆盖部署。请检查 GHCR 网络后重试。" >&2; exit 1; }

log "构建证书助手并覆盖部署服务…"
docker compose -f compose.yaml build certificate-helper
docker compose "${COMPOSE_FILES[@]}" up -d --no-build --force-recreate

cert_ok=1
if [ "${CLOVER_SHARED_NGINX:-0}" = "1" ] || [ "${CLOVER_CADDY_SCHEME:-https}" = "http" ]; then
  log "检查面板证书并配置 TLS…"
  docker exec clover-certificate-helper python3 /app/certificates.py issue \
    || { cert_ok=0; warn "服务已覆盖部署，但证书操作失败；查看 docker logs clover-certificate-helper。原数据卷仍保留。"; }
fi

log "等待面板健康检查…"
ok=0
for _ in $(seq 1 30); do
  if docker exec clover-panel node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 2
done

docker compose "${COMPOSE_FILES[@]}" ps
if [ "$ok" -eq 1 ]; then
  bash scripts/admin-bootstrap.sh
  log "覆盖部署完成；原配置和数据卷已保留。"
else
  warn "服务已覆盖部署，但面板健康检查未通过；查看 docker logs --tail 100 clover-panel。数据卷仍保留。"
  exit 1
fi
if [ "$cert_ok" -ne 1 ]; then
  exit 1
fi
