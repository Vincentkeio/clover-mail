#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
test -f .env || { echo '.env 不存在，无法配置 Roundcube。' >&2; exit 1; }
if ! grep -Eq '^ROUNDCUBE_SSO_SECRET=[A-Za-z0-9_-]{32,}$' .env; then
  secret="$(openssl rand -hex 32)"
  sed -i '/^ROUNDCUBE_SSO_SECRET=/d' .env
  printf '\nROUNDCUBE_SSO_SECRET=%s\n' "$secret" >> .env
  unset secret
fi
chmod 600 .env
