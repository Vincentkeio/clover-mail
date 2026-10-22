#!/usr/bin/env bash
# Optional Compose initialization container; .env is edited on the host first.
set -euo pipefail
cd "${CLOVER_HOME:?请通过 README 中的 Compose 命令传入安装目录}"
project="$(pwd -P)"
[[ "$project" != / && "$project" =~ ^/[a-zA-Z0-9_./-]+$ ]] || { echo '请使用不含空格或特殊字符的独立安装目录。' >&2; exit 1; }
test -f .env || { echo '请先复制 .env.example 为 .env 并编辑域名等参数。' >&2; exit 1; }
exec 9>.clover-compose-install.lock
flock -n 9 || { echo '已有 Compose 初始化任务正在执行。' >&2; exit 1; }
chmod 600 .env
set -a; . ./.env; set +a
compose() { docker compose -f compose.yaml "$@"; }
set_env() {
  if grep -q "^${1}=" .env; then sed -i "s|^${1}=.*|${1}=${2}|" .env
  else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
for key in PANEL_HOSTNAME MAIL_HOSTNAME MAIL_DOMAIN; do
  value="${!key:-}"
  if ! [[ "$value" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,}$ ]] || [[ "$value" = example.com || "$value" = *.example.com ]]; then
    echo "请先在 .env 填写有效的 ${key}。" >&2; exit 1
  fi
done
[[ "${ACME_EMAIL:-}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ && "$ACME_EMAIL" != *@example.com ]] || { echo '请先在 .env 填写自己的 ACME_EMAIL。' >&2; exit 1; }
[[ "$PANEL_HOSTNAME" != "$MAIL_HOSTNAME" ]] || { echo '面板与邮件主机名必须不同。' >&2; exit 1; }
if { [[ "${CLOVER_SHARED_CADDY:-0}" = 1 || "${CLOVER_SHARED_NGINX:-0}" = 1 ]]; } && ! docker inspect clover-panel >/dev/null 2>&1; then
  echo '此 Compose 安装入口适用于独占 Web 端口的服务器；共享宿主机入口请使用安装器。' >&2; exit 1
fi
for name in clover-panel docker-mailserver; do
  if docker inspect "$name" >/dev/null 2>&1; then
    previous="$(docker inspect "$name" --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}')"
    [[ "$previous" = "$project" ]] || { echo "${name} 属于另一安装目录，已停止初始化。" >&2; exit 1; }
  fi
done
if [[ -z "${SESSION_SECRET:-}" || "$SESSION_SECRET" = change-me-to-random-32+ ]]; then
  set_env SESSION_SECRET "$(openssl rand -hex 32)"
elif [[ ${#SESSION_SECRET} -lt 16 ]]; then
  echo 'SESSION_SECRET 至少需要 16 字符；已有实例请保留原密钥。' >&2; exit 1
fi
[[ -n "${RECONCILE_TOKEN:-}" ]] || set_env RECONCILE_TOKEN "$(openssl rand -hex 32)"
if [[ -z "${ROUNDCUBE_SSO_SECRET:-}" ]]; then
  set_env ROUNDCUBE_SSO_SECRET "$(openssl rand -hex 32)"
elif [[ ${#ROUNDCUBE_SSO_SECRET} -lt 32 ]]; then
  echo 'ROUNDCUBE_SSO_SECRET 至少需要 32 字符。' >&2; exit 1
fi
set_env CLOVER_HOME "$project"
memory_mb="$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo)"
if [[ "$memory_mb" -lt 2000 && "${ENABLE_CLAMAV:-1}" = 1 ]]; then
  set_env ENABLE_CLAMAV 0
  echo '已根据服务器内存调整邮件防病毒服务配置。'
fi
if [[ -z "${SSL_TYPE:-}" ]]; then
  set_env SSL_TYPE manual
  set_env SSL_CERT_PATH /tmp/docker-mailserver/ssl/mail.crt
  set_env SSL_KEY_PATH /tmp/docker-mailserver/ssl/mail.key
fi
# Compose interpolation must use the generated values, rather than the old
# exported template values inherited by this initialization container.
set -a; . ./.env; set +a
compose config --quiet
echo '正在拉取服务镜像…'
compose pull panel mail roundcube caddy
if [[ "$SSL_TYPE" = manual && "${SSL_CERT_PATH:-}" = /tmp/docker-mailserver/ssl/mail.crt && "${SSL_KEY_PATH:-}" = /tmp/docker-mailserver/ssl/mail.key ]]; then
  echo '正在准备初始邮件 TLS 证书…'
  compose run --rm --no-deps --entrypoint sh mail -c '
    set -eu
    mkdir -p /tmp/docker-mailserver/ssl
    cert=/tmp/docker-mailserver/ssl/mail.crt
    key=/tmp/docker-mailserver/ssl/mail.key
    if [ ! -f "$cert" ] && [ ! -f "$key" ]; then
      openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=$MAIL_HOSTNAME" -keyout "$key" -out "$cert" 2>/dev/null
      chmod 600 "$key"
    fi
    test -s "$cert" && test -s "$key"
  '
fi
echo '正在构建证书助手并启动服务…'
bash scripts/install-build.sh
compose up -d --no-build mail panel roundcube caddy certificate-helper
bash scripts/admin-bootstrap.sh
bash scripts/configure-roundcube.sh
CLOVER_FRESH_INSTALL=1 CLOVER_CLI_TARGET=/host-bin/clover bash scripts/install-cli.sh "$project"
printf '\n安装完成： https://%s/\n' "$PANEL_HOSTNAME"
echo '管理员凭据已在上方显示（已有管理员会保留）。初始邮件证书为自签时，请登录面板签发可信证书。'
