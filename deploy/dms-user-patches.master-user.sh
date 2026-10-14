#!/usr/bin/env bash
# =============================================================================
# DMS user-patches.sh — clover master user（Webmail 免密登录）
#
# 背景：面板内置 WebMail 使用 Dovecot master user 在服务端免密代理 IMAP/SMTP，
#       不存储任何邮箱明文密码（见 docs/plan.md 6.6）。Dovecot master user 是
#       Dovecot 原生能力，DMS 镜像内为 stock Dovecot；官方对容器内文件类变更
#       统一推荐本补丁脚本通道（容器每次启动自动执行）。
#
# 用法：
#   1) cp deploy/dms-user-patches.master-user.sh deploy/dms-user-patches.sh
#      （compose 只挂载固定文件名 user-patches.sh；模板与生效文件分离，避免误激活）
#   2) 在文件下方 MASTER_USER/MASTER_PASS_HASH 处设置内部主账号及其哈希
#   3) docker compose up -d mail（重启生效；已有容器 restart 亦可）
#
# ⚠️ 真机验收时需按部署的 DMS 版本核对两处路径：
#   - dovecot 配置目录与 include 机制（下面默认写在 /etc/dovecot）
#   - passwd-file 的实际文件名（dovecot-master.passwd）
#   核对命令：docker exec docker-mailserver doveconf -n | grep -i master
# =============================================================================
set -euo pipefail

# ---- 按实际环境修改这三行 ----
MASTER_USER='clover-master@example.com'          # 与面板设置 → WebMail → master 用户名一致
MASTER_PASS_HASH='{SHA512-CRYPT}$6$REPLACE_ME'   # 生成：docker exec -it docker-mailserver doveadm pw -s SHA512-CRYPT
MASTER_UID=9999                                  # master 用户以哪个 uid 读目标邮箱（DMS 的 vmail uid 通常是 9999，按 doveconf userdb 实际值核对）
# ------------------------------

DOVECOT_CONF_DIR='/etc/dovecot'
DOVECOT_CONFD_DIR="${DOVECOT_CONF_DIR}/conf.d"
MASTER_PASSWD_FILE="${DOVECOT_CONF_DIR}/dovecot-master.passwd"

echo "[clover-patch] enabling dovecot master user: ${MASTER_USER}"

# 1) master 用户的口令文件（master=yes 的 passdb）
printf '%s:%s:%s:%s::/::userdb_mail=maildir:~/Maildir\n' \
  "${MASTER_USER}" "${MASTER_PASS_HASH}" "${MASTER_UID}" "${MASTER_UID}" \
  > "${MASTER_PASSWD_FILE}"
AUTH_USER="$(doveconf -h default_internal_user)"
AUTH_GROUP="$(id -gn "${AUTH_USER}")"
chown root:"${AUTH_GROUP}" "${MASTER_PASSWD_FILE}"
chmod 640 "${MASTER_PASSWD_FILE}"

# 2) 独立的 master passdb 配置（login 格式：real-user@domain*master-user）
DOVECOT_VERSION="$(dovecot --version)"
if [[ "${DOVECOT_VERSION}" =~ ^2\.([4-9]|[1-9][0-9])\. ]]; then
  cat > "${DOVECOT_CONFD_DIR}/auth-master.conf.ext" <<'EOF'
passdb clover-webmail-master {
  driver = passwd-file
  passwd_file_path = /etc/dovecot/dovecot-master.passwd
  master = yes
  result_success = continue
  mechanisms_filter = plain login
}
EOF
else
  cat > "${DOVECOT_CONFD_DIR}/auth-master.conf.ext" <<'EOF'
passdb {
  driver = passwd-file
  args = scheme=CRYPT username_format=%u /etc/dovecot/dovecot-master.passwd
  master = yes
  result_success = continue
  mechanisms = plain login
}
EOF
fi

# 3) DMS 使用 conf.d/10-auth.conf 加载认证设置。
AUTH_CONF="${DOVECOT_CONFD_DIR}/10-auth.conf"
if grep -q '^[[:space:]]*auth_master_user_separator[[:space:]]*=' "${AUTH_CONF}"; then
  sed -i 's|^[[:space:]]*auth_master_user_separator[[:space:]]*=.*|auth_master_user_separator = *|' "${AUTH_CONF}"
else
  sed -i '1i auth_master_user_separator = *' "${AUTH_CONF}"
fi
if ! grep -Fq '!include /etc/dovecot/conf.d/auth-master.conf.ext' "${AUTH_CONF}"; then
  sed -i '1i !include /etc/dovecot/conf.d/auth-master.conf.ext' "${AUTH_CONF}"
fi

echo "[clover-patch] done. Dovecot master authentication settings applied; validate with doveconf -n"

# =============================================================================
# 追加：prefix 路由规则（pcre 正则别名表）接线
# 面板会把 prefix 规则写成 /tmp/docker-mailserver/postfix-virtual-regex.cf（clover 独占文件）。
#
# ⚠️ 实机教训：不要用 `postconf -e` 改 virtual_alias_maps —— DMS 启动时会用自己的模板
#    重写 main.cf，改动会被覆盖（实测重启后 map 列表恢复原样）。
#     DMS 原生机制是「/tmp/docker-mailserver/postfix-main.cf 会被追加进 main.cf」，
#     因此这里写 postfix-main.cf（追加式，幂等）。
# 核对：docker exec docker-mailserver postconf -h virtual_alias_maps
# =============================================================================
REGEX_MAP='/tmp/docker-mailserver/postfix-virtual-regex.cf'
POSTFIX_MAIN_CF='/tmp/docker-mailserver/postfix-main.cf'

# 空表兜底：postfix 引用不存在的 map 会启动失败
[ -f "${REGEX_MAP}" ] || printf '# clover prefix 规则（面板自动生成）\n' > "${REGEX_MAP}"

if grep -q 'postfix-virtual-regex.cf' "${POSTFIX_MAIN_CF}" 2>/dev/null; then
  echo "[clover-patch] postfix-main.cf 已含 regex 表，跳过写入"
else
  cat >> "${POSTFIX_MAIN_CF}" <<EOF

# --- clover: prefix 路由规则（pcre 正则别名表） ---
virtual_alias_maps = texthash:/etc/postfix/virtual pcre:${REGEX_MAP}
EOF
  echo "[clover-patch] 已写入 postfix-main.cf（virtual_alias_maps 追加 pcre:${REGEX_MAP}）"
fi

# ⚠️ 双重保障（实机验证）：
# DMS 只在**容器初始化流程**里合并 postfix-main.cf，本次补丁写入的文件要等下一轮初始化才生效
# （实测 main.cf mtime 未随重启更新）。所以这里再用 postconf 直接落一次即时生效，
# 同时保留 postfix-main.cf 以便 DMS 未来重建 main.cf 时仍然带上 pcre 表。
postconf -e "virtual_alias_maps = texthash:/etc/postfix/virtual pcre:${REGEX_MAP}" 2>/dev/null \
  && echo "[clover-patch] postconf 已即时生效"
postfix reload >/dev/null 2>&1 || true
echo "[clover-patch] postfix 已 reload"
