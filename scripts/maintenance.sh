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
    image="$(docker inspect clover-panel --format '{{.Config.Image}}')"
    digests="$(docker image inspect "$image" --format '{{json .RepoDigests}}')"
    if [ -f .clover-local-build ] || [ "$digests" = '[]' ] || [ "$digests" = 'null' ]; then
      echo '当前为本机源码构建，正在构建新面板镜像…'
      test -f panel/Dockerfile || { echo '本机源码不可用'; exit 1; }
      docker build -t "$image" ./panel
    else
      echo '正在拉取发布镜像…'
      docker compose pull panel
    fi
    echo '正在切换面板容器…'
    docker compose up -d --force-recreate panel
    echo '更新完成。'
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
    cat > caddy/Caddyfile <<'CADDY'
{
  email {$ACME_EMAIL}
}

{$PANEL_HOSTNAME} {
  encode zstd gzip
  handle /rspamd* {
    reverse_proxy mail:11334
  }
  handle {
    reverse_proxy panel:3000
  }
}

{$MAIL_HOSTNAME} {
  respond 404
}
CADDY
    echo '正在验证 Caddy 配置…'
    if ! docker run --rm -e PANEL_HOSTNAME="$panel_host" -e MAIL_HOSTNAME="$mail_host" -e ACME_EMAIL="$(sed -n 's/^ACME_EMAIL=//p' .env | head -n 1)" -v "$project/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2 caddy validate --config /etc/caddy/Caddyfile; then
      cp ".env.before-domain-$stamp" .env
      cp "caddy/Caddyfile.before-domain-$stamp" caddy/Caddyfile
      echo '配置验证失败，已恢复原配置。'
      exit 1
    fi
    echo '正在应用域名配置…'
    if [ "$previous_mail" = "$mail_host" ]; then
      services='panel caddy cert-sync'
    else
      services='mail panel caddy cert-sync'
    fi
    if ! docker compose up -d --force-recreate $services; then
      cp ".env.before-domain-$stamp" .env
      cp "caddy/Caddyfile.before-domain-$stamp" caddy/Caddyfile
      docker compose up -d --force-recreate $services || true
      echo '应用失败，已尝试恢复原配置。'
      exit 1
    fi
    if [ "$(sed -n 's/^CLOVER_SHARED_CADDY=//p' .env | head -n 1)" = "1" ]; then
      if ! python3 scripts/host-caddy.py configure-env --env-file .env; then
        cp ".env.before-domain-$stamp" .env
        cp "caddy/Caddyfile.before-domain-$stamp" caddy/Caddyfile
        docker compose up -d --force-recreate $services || true
        echo '宿主机 Caddy 配置失败；已恢复 Clover 配置，原 Caddy 站点未被覆盖。' >&2
        exit 1
      fi
    fi
    echo "域名配置已应用。面板：https://$panel_host/；邮件主机：$mail_host"
    ;;
  *) echo '用法：maintenance.sh restart|update|configure <面板域名> <邮件主机名>'; exit 2 ;;
esac
