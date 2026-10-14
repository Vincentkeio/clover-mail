#!/usr/bin/env bash
# =============================================================================
# 启用 DMS 侧补丁（master user + prefix 正则别名表接线）
#
#   ./scripts/enable-dms-patches.sh              # 用 deploy/dms-user-patches.sh（已填好的版本）
#   ./scripts/enable-dms-patches.sh --template   # 从模板复制一份再填（首次用）
#
# 为什么不用 compose 挂载：源文件不存在时 Docker 会创建**空目录**占位，
# DMS 读到目录会静默跳过补丁（实机踩过）。改成显式 docker cp + 重启。
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

CONTAINER="${DMS_CONTAINER:-docker-mailserver}"
TARGET="/tmp/docker-mailserver/user-patches.sh"
SRC="deploy/dms-user-patches.sh"
TEMPLATE="deploy/dms-user-patches.master-user.sh"

if [ "${1:-}" = "--template" ]; then
  if [ -f "$SRC" ]; then
    echo "已存在 $SRC（如需重来请先备份/删除）" >&2
    exit 1
  fi
  cp "$TEMPLATE" "$SRC"
  echo "✔ 已从模板复制 → $SRC"
  echo "  请编辑其中的 MASTER_USER / MASTER_PASS_HASH / MASTER_UID 后再运行本脚本（不带参数）"
  exit 0
fi

[ -f "$SRC" ] || { echo "缺少 $SRC —— 先跑：$0 --template" >&2; exit 1; }

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true \
  || { echo "容器 $CONTAINER 未运行（先 docker compose up -d）" >&2; exit 1; }

echo "[patches] 拷贝补丁到容器 $TARGET …"
# 老版本 compose 的 bind mount 会在配置卷里留下同名**空目录**，docker cp 会把文件塞进目录里
# 导致补丁静默失效（实机踩过），这里先清掉异常目录
if docker exec "$CONTAINER" test -d "$TARGET" 2>/dev/null; then
  echo "[patches] 发现同名目录（旧挂载残留）→ 清理"
  docker exec "$CONTAINER" rm -rf "$TARGET"
fi
docker cp "$SRC" "${CONTAINER}:${TARGET}"
docker exec "$CONTAINER" chmod 700 "$TARGET"

# ⚠️ 关键顺序（实机验证）：DMS 启动序列里「合并 postfix-main.cf」早于「执行 user-patches.sh」，
# 若只靠重启让 DMS 自己跑补丁，本次新写的 postfix-main.cf 要等**再下一次**启动才生效。
# 因此这里先在容器内立即执行一次补丁，再重启让 DMS 合并配置。
echo "[patches] 容器内立即执行补丁 …"
docker exec "$CONTAINER" bash "$TARGET" 2>&1 | sed 's/^/  /'

echo "[patches] 重启邮件容器让 DMS 合并配置（postfix-main.cf → main.cf）…"
docker restart "$CONTAINER" >/dev/null
echo "[patches] 等待容器就绪…"
for i in $(seq 1 60); do
  if docker exec "$CONTAINER" sh -c 'test -f /var/run/dovecot/master.pid || pgrep -x dovecot >/dev/null' 2>/dev/null; then
    break
  fi
  sleep 3
done

echo "[patches] 核对结果："
echo "-- master user 配置 --"
docker exec "$CONTAINER" sh -c 'grep -l "master = yes" /etc/dovecot/*.conf* /etc/dovecot/conf.d/*.conf* 2>/dev/null | head -3 || echo "(未找到 master passdb，检查补丁内容)"'
echo "-- virtual_alias_maps（应含 pcre:/tmp/docker-mailserver/postfix-virtual-regex.cf）--"
docker exec "$CONTAINER" postconf -h virtual_alias_maps
echo
echo "完成。WebMail 免密登录还需在面板「设置 → WebMail」填相同的 master 用户名/密码。"
