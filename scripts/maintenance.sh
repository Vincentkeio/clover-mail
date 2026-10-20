#!/bin/sh
set -eu

action="${1:-}"
project="$(pwd)"
test -f "$project/compose.yaml" || { echo '找不到 compose.yaml'; exit 1; }

update_env() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

wait_for_container() {
  name="$1"
  expected="$2"
  timeout="$3"
  started_at="$(date +%s)"
  last_state='missing'
  last_health='none'
  stable_since=''
  stable_restarts=''
  while :; do
    now="$(date +%s)"
    [ $((now - started_at)) -lt "$timeout" ] || break
    last_state="$(docker inspect --format '{{.State.Status}}' "$name" 2>/dev/null || true)"
    last_health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$name" 2>/dev/null || true)"
    if [ "$last_state" = 'running' ]; then
      if [ "$expected" = 'healthy' ] && [ "$last_health" = 'healthy' ]; then
        return 0
      fi
      if [ "$expected" = 'stable' ]; then
        restarts="$(docker inspect --format '{{.RestartCount}}' "$name" 2>/dev/null || true)"
        if [ "$restarts" != "$stable_restarts" ] || [ -z "$stable_since" ]; then
          stable_restarts="$restarts"
          stable_since="$now"
        elif [ $((now - stable_since)) -ge 15 ]; then
          return 0
        fi
      fi
    else
      stable_since=''
      stable_restarts=''
    fi
    sleep 1
  done
  echo "服务 $name 未就绪（状态：${last_state:-missing}，健康：${last_health:-none}），最近日志：" >&2
  docker logs --tail 30 "$name" >&2 || true
  return 1
}

restore_domain_files() {
  cp ".env.before-domain-$stamp" .env
  cp "caddy/Caddyfile.before-domain-$stamp" caddy/Caddyfile
}

restore_domain_config() {
  restore_domain_files
  docker compose up -d --force-recreate --no-deps $services || true
  if [ "$(sed -n 's/^CLOVER_SHARED_CADDY=//p' .env | head -n 1)" = "1" ]; then
    wait_for_container clover-certificate-helper stable 30 || true
    docker exec clover-certificate-helper python3 /app/host-caddy.py configure-env --host-root /host --env-file /clover/.env || true
  fi
  wait_for_container clover-panel healthy 90 || true
  wait_for_container clover-caddy stable 60 || true
  wait_for_container clover-certificate-helper stable 30 || true
}

wait_for_http_panel_route() {
  panel_host="$1"
  http_port="$2"
  elapsed=0
  while [ "$elapsed" -lt 30 ]; do
    if docker exec clover-certificate-helper python3 -c \
      'import sys,urllib.request; req=urllib.request.Request(sys.argv[1],headers={"Host":sys.argv[2]}); resp=urllib.request.urlopen(req,timeout=4); sys.exit(0 if resp.status == 200 else 1)' \
      "http://127.0.0.1:${http_port}/api/health" "$panel_host" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  echo '内部 Caddy 尚未能连接面板健康接口。' >&2
  return 1
}

container_env_matches() {
  name="$1"
  key="$2"
  value="$3"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$name" 2>/dev/null \
    | grep -Fxq -- "$key=$value"
}

case "$action" in
  restart)
    echo '正在重启面板…'
    docker compose restart panel
    echo '面板已重启。'
    ;;
  update)
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    echo '正在备份面板数据库…'
    docker exec clover-panel node -e 'const Database=require("better-sqlite3"); const db=new Database("/app/data/clover.db"); db.backup("/app/data/clover-before-update-"+process.argv[1]+".db").then(()=>db.close()).catch((err)=>{console.error(err);process.exit(1)})' "$stamp"
    echo '正在准备完整更新工具…'
    apk add --no-cache bash curl git openssl python3
    export CLOVER_UPDATE_TO_LATEST=1
    # Use the same source/scripts/Compose/image update path as the clover CLI.
    exec bash scripts/upgrade.sh
    ;;
  configure)
    panel_host="${2:-}"
    mail_host="${3:-}"
    case "$panel_host" in *[!a-z0-9.-]*|'') echo '面板域名无效'; exit 1;; esac
    case "$mail_host" in *[!a-z0-9.-]*|'') echo '邮件主机名无效'; exit 1;; esac
    [ "$panel_host" != "$mail_host" ] || { echo '面板与邮件主机名必须不同'; exit 1; }
    stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    cp .env ".env.before-domain-$stamp"
    cp caddy/Caddyfile "caddy/Caddyfile.before-domain-$stamp"
    previous_mail="$(sed -n 's/^MAIL_HOSTNAME=//p' .env | head -n 1)"
    update_env PANEL_HOSTNAME "$panel_host"
    update_env PANEL_FQDN "$panel_host"
    update_env MAIL_HOSTNAME "$mail_host"
    update_env MAIL_FQDN "$mail_host"
    update_env OVERRIDE_HOSTNAME "$mail_host"
    caddy_scheme="$(sed -n 's/^CLOVER_CADDY_SCHEME=//p' .env | head -n 1)"
    [ -n "$caddy_scheme" ] || caddy_scheme='https'
    caddy_tls="$(sed -n 's/^CLOVER_TLS_DIRECTIVE=//p' .env | head -n 1)"
    acme_email="$(sed -n 's/^ACME_EMAIL=//p' .env | head -n 1)"
    if [ "$previous_mail" = "$mail_host" ]; then
      services='panel caddy certificate-helper'
    else
      services='mail panel caddy certificate-helper'
    fi
    cat > caddy/Caddyfile <<'CADDY'
{
  email {$ACME_EMAIL}
}

{$CLOVER_CADDY_SCHEME}://{$PANEL_HOSTNAME} {
  {$CLOVER_TLS_DIRECTIVE}
  encode zstd gzip
  handle /api/internal/roundcube/* {
    respond 404
  }
  handle /webmail/* {
    uri strip_prefix /webmail
    reverse_proxy roundcube:80
  }
  handle /rspamd* {
    respond 404
  }
  handle {
    reverse_proxy panel:3000
  }
}
CADDY
    echo '正在验证 Caddy 配置…'
    if ! docker run --rm -e PANEL_HOSTNAME="$panel_host" -e ACME_EMAIL="$acme_email" -e CLOVER_CADDY_SCHEME="$caddy_scheme" -e CLOVER_TLS_DIRECTIVE="$caddy_tls" -v "$project/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile; then
      restore_domain_files
      echo '配置验证失败，已恢复原配置。'
      exit 1
    fi
    echo '正在应用域名配置…'
    if ! docker compose up -d --force-recreate --no-deps $services; then
      restore_domain_config
      echo '应用失败，已尝试恢复原配置。'
      exit 1
    fi
    if ! wait_for_container clover-panel healthy 90 || ! wait_for_container clover-caddy stable 60 || ! wait_for_container clover-certificate-helper stable 30; then
      restore_domain_config
      echo '新配置下的面板或 Caddy 未就绪，已恢复原配置。' >&2
      exit 1
    fi
    if ! container_env_matches clover-panel PANEL_HOSTNAME "$panel_host" \
      || ! container_env_matches clover-panel MAIL_HOSTNAME "$mail_host" \
      || ! container_env_matches clover-caddy PANEL_HOSTNAME "$panel_host" \
      || ! container_env_matches clover-caddy CLOVER_CADDY_SCHEME "$caddy_scheme" \
      || ! container_env_matches docker-mailserver MAIL_HOSTNAME "$mail_host"; then
      restore_domain_config
      echo '容器环境仍未载入新域名配置，已恢复原配置。' >&2
      exit 1
    fi
    if ! docker exec clover-caddy caddy validate --config /etc/caddy/Caddyfile; then
      restore_domain_config
      echo '运行中的 Caddy 配置校验失败，已恢复原配置。' >&2
      exit 1
    fi
    if [ "$caddy_scheme" = 'http' ]; then
      http_port="$(sed -n 's/^CLOVER_HTTP_PORT=//p' .env | head -n 1)"
      [ -n "$http_port" ] || http_port='18080'
      if ! wait_for_http_panel_route "$panel_host" "$http_port"; then
        restore_domain_config
        echo '新配置下内部 Caddy 无法访问面板，已恢复原配置。' >&2
        exit 1
      fi
    fi
    if [ "$(sed -n 's/^CLOVER_SHARED_CADDY=//p' .env | head -n 1)" = "1" ]; then
      # This maintenance script runs inside the docker:cli container, which has
      # neither Python nor the host filesystem. The certificate helper has
      # both the host root mounted at /host and the project mounted at /clover.
      if ! docker exec clover-certificate-helper python3 /app/host-caddy.py configure-env --host-root /host --env-file /clover/.env; then
        restore_domain_config
        echo '宿主机 Caddy 配置失败；已恢复 Clover 配置，原 Caddy 站点未被覆盖。' >&2
        exit 1
      fi
    fi
    echo "域名配置已应用。面板：https://$panel_host/；邮件主机：$mail_host"
    ;;
  *) echo '用法：maintenance.sh restart|update|configure <面板域名> <邮件主机名>'; exit 2 ;;
esac
