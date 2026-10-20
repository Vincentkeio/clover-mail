#!/usr/bin/env bash
# Ensure a local administrator exists after install/overwrite without exposing
# an unauthenticated account-creation endpoint in the web panel.
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker inspect clover-panel >/dev/null 2>&1; then
  echo "[clover] 管理员检查失败：clover-panel 容器不存在。" >&2
  exit 1
fi

ready=0
for _ in $(seq 1 45); do
  if docker exec clover-panel node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done
if [ "$ready" -ne 1 ]; then
  echo "[clover] 管理员检查失败：面板未在 90 秒内就绪。" >&2
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "[clover] 管理员检查失败：缺少 openssl，无法安全生成随机密码。" >&2
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "[clover] 管理员检查失败：缺少 flock，无法安全锁定初始化流程。" >&2
  exit 1
fi

exec 9>"${TMPDIR:-/tmp}/clover-admin-bootstrap.lock"
flock 9

get_admins() {
  docker exec clover-panel node -e '
    const Database = require("better-sqlite3");
    const db = new Database(process.env.DATABASE_PATH || "/app/data/clover.db", { readonly: true });
    for (const row of db.prepare("SELECT username FROM admins ORDER BY id").all()) console.log(row.username);
    db.close();
  '
}

admins="$(get_admins)" || {
  echo "[clover] 管理员检查失败：无法读取面板数据库。" >&2
  exit 1
}

if [ -n "$admins" ]; then
  admin_count="$(printf '%s\n' "$admins" | sed '/^$/d' | wc -l | tr -d ' ')"
  if [ "$admin_count" -gt 1 ]; then
    echo "[clover] 警告：保留的数据中已有 ${admin_count} 个管理员账户（旧版本遗留），安装器不会擅自删除账户。"
    echo "[clover] 如需换成唯一管理员，运行 clover admin create；确认 REPLACE 后旧账户会被替换。"
  else
    echo "[clover] 已有唯一管理员账户，原样保留："
  fi
  while IFS= read -r username; do
    [ -n "$username" ] && printf '  - %s\n' "$username"
  done <<< "$admins"
  exit 0
fi

username="clover_$(openssl rand -hex 4)"
# 12 random bytes encode to a 16-character URL-safe password (96 bits).
password="$(openssl rand -base64 12 | tr '+/' '-_' | tr -d '=\n')"
if ! printf '%s\n' "$password" | docker exec -i clover-panel node /app/admin-cli.cjs create "$username"; then
  echo "[clover] 管理员创建失败，请查看 docker logs clover-panel。" >&2
  exit 1
fi

cat <<EOF

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
首次管理员账户已创建，请立即保存以下凭据：
用户名：$username
密码：$password
密码不会保存到服务器明文文件中。遗失后可运行：clover admin reset $username
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF
