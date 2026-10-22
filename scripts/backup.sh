#!/usr/bin/env bash
# =============================================================================
# clover 备份脚本（跑在 VPS 宿主机上，建议 cron 每日执行）
#
#   ./scripts/backup.sh                 # 备份到 ./backups/
#   BACKUP_DIR=/mnt/backup ./scripts/backup.sh
#
# 依赖：curl；使用 .env 里的 RECONCILE_TOKEN 认证（面板设置页也可生成 API token）
# cron 示例（每日 3:30，只保留最近一次完整备份）：
#   30 3 * * * cd /root/clover && ./scripts/backup.sh >> /var/log/clover-backup.log 2>&1
# =============================================================================
set -euo pipefail
umask 077

cd "$(dirname "$0")/.."
[ -f .env ] || { echo "找不到 .env（请在项目根目录运行）" >&2; exit 1; }

# shellcheck disable=SC1091
set -a; . ./.env; set +a

: "${PANEL_HOSTNAME:?PANEL_HOSTNAME 未配置}"
: "${RECONCILE_TOKEN:?RECONCILE_TOKEN 未配置（见 .env）}"

BASE_URL="${BACKUP_BASE_URL:-https://${PANEL_HOSTNAME}}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_TMP=""
cleanup_backup_tmp() {
  [ -z "$BACKUP_TMP" ] || rm -rf -- "$BACKUP_TMP"
}
trap cleanup_backup_tmp EXIT

mkdir -p "${BACKUP_DIR}"
BACKUP_TMP="$(mktemp -d "${BACKUP_DIR}/.clover-backup-${STAMP}.XXXXXX")"

echo "[backup] $(date -Is) 开始 → ${BACKUP_DIR}"

fetch() {
  local what="$1" out="$2"
  local downloaded=0
  # 默认通过容器内回环访问面板，不依赖公网 DNS/TLS；自定义 URL 时保留 HTTPs 路径。
  if [ -z "${BACKUP_BASE_URL:-}" ] && command -v docker >/dev/null 2>&1 \
    && [ "$(docker inspect -f '{{.State.Running}}' clover-panel 2>/dev/null || true)" = true ]; then
    if docker exec -e "CLOVER_BACKUP_WHAT=${what}" clover-panel node -e '
      (async () => {
        const response = await fetch(`http://127.0.0.1:3000/api/v1/system/backup?what=${encodeURIComponent(process.env.CLOVER_BACKUP_WHAT)}`, {
          headers: { Authorization: `Bearer ${process.env.RECONCILE_TOKEN || ""}` },
          signal: AbortSignal.timeout(300000),
        });
        if (!response.ok) {
          console.error(`[backup] HTTP ${response.status}`);
          process.exitCode = 1;
          return;
        }
        process.stdout.write(Buffer.from(await response.arrayBuffer()));
      })().catch((error) => { console.error(`[backup] ${error.message}`); process.exitCode = 1; });
    ' > "${out}"; then
      downloaded=1
    fi
  fi
  if [ "${downloaded}" -eq 0 ] && printf 'Authorization: Bearer %s\n' "$RECONCILE_TOKEN" | curl -fsS --max-time 300 \
    -H @- \
    "${BASE_URL}/api/v1/system/backup?what=${what}" \
    -o "${out}"; then
    downloaded=1
  fi

  if [ "${downloaded}" -eq 1 ]; then
    local size
    size="$(wc -c < "${out}")"
    echo "[backup] OK ${what} → ${out} (${size} bytes)"
    # 极小文件通常是错误 JSON，判一下
    if [ "${size}" -lt 200 ]; then
      echo "[backup] 警告：${out} 体积异常（${size} bytes），请在服务器本地检查；日志不输出备份内容。" >&2
      return 1
    fi
  else
    echo "[backup] 失败：${what}" >&2
    return 1
  fi
}

fetch db "${BACKUP_TMP}/clover-db-${STAMP}.db"
fetch dms-config "${BACKUP_TMP}/dms-config-${STAMP}.tar.gz"

# 校验 SQLite 快照可读（有 sqlite3 才校验）
if command -v sqlite3 >/dev/null 2>&1; then
  integrity="$(sqlite3 "${BACKUP_TMP}/clover-db-${STAMP}.db" 'PRAGMA integrity_check;' | head -1)"
  [ "$integrity" = 'ok' ] || { echo "[backup] SQLite 快照校验失败：${integrity:-无结果}" >&2; exit 1; }
fi

# 先完整生成并校验新备份，再发布文件并清理旧版本；失败时旧备份仍保留。
db_name="clover-db-${STAMP}.db"
config_name="dms-config-${STAMP}.tar.gz"
mv -- "${BACKUP_TMP}/${db_name}" "${BACKUP_DIR}/${db_name}"
mv -- "${BACKUP_TMP}/${config_name}" "${BACKUP_DIR}/${config_name}"
find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'clover-db-*.db' -o -name 'dms-config-*.tar.gz' \) \
  ! -name "$db_name" ! -name "$config_name" -print -delete

echo "[backup] $(date -Is) 完成（仅保留最近一次完整备份）"
