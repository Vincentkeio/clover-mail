#!/usr/bin/env bash
# =============================================================================
# 打包「发布包」——只含运行所需文件（不含 panel 源码，面板从 GHCR 拉）
#
#   ./scripts/package-release.sh              # 输出 dist/clover-<日期>.tar.gz
#   VERSION=1.0.0 ./scripts/package-release.sh
#
# 用户拿到发布包后的用法：解压 → bash install.sh
# （或一条命令：curl -fsSL .../bootstrap.sh | bash，见 README）
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

VERSION="${VERSION:-$(date +%Y%m%d)}"
OUT_DIR="${OUT_DIR:-dist}"
NAME="clover-${VERSION}"

# 工作目录放仓库内（相对路径，跨平台稳定：Windows 下 mktemp 会给出 C:\ 混合路径，rm 处理不了）
WORK="${OUT_DIR}/.pkg-work"
rm -rf "${WORK}" 2>/dev/null || true
mkdir -p "${WORK}/${NAME}" "${OUT_DIR}"

FILES=(
  .dockerignore
  compose.yaml
  compose.build.yaml
  caddy/Caddyfile
  install.sh
  bootstrap.sh
  .env.example
  LICENSE
  README.md
  docs/plan.md
  docs/m0-checklist.md
  docs/manual-acceptance.md
  docs/mail-client-setup.md
  scripts/backup.sh
  scripts/clover.sh
  scripts/admin-bootstrap.sh
  scripts/reinstall.sh
  scripts/maintenance.sh
  scripts/ensure-roundcube-env.sh
  scripts/configure-roundcube.sh
  scripts/install-cli.sh
  scripts/upgrade.sh
  deploy/roundcube/config/clover.php
  deploy/roundcube/plugins/clover_sso/clover_sso.php
  deploy/certificate-helper/Dockerfile
  scripts/certificates.py
  scripts/host-caddy.py
)

missing=0
for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "缺少文件：$f" >&2
    missing=1
    continue
  fi
  mkdir -p "${WORK}/${NAME}/$(dirname "$f")"
  cp "$f" "${WORK}/${NAME}/$f"
done
[ "$missing" -eq 0 ] || { echo "打包中止：有文件缺失" >&2; exit 1; }

mkdir -p "${WORK}/${NAME}/backups"

# 用相对路径打包（避免绝对路径在不同 shell 下的转换问题）
tar czf "${OUT_DIR}/${NAME}.tar.gz" -C "${WORK}" "${NAME}"
rm -rf "${WORK}"

SIZE="$(du -h "${OUT_DIR}/${NAME}.tar.gz" | awk '{print $1}')"
echo "✔ 发布包：${OUT_DIR}/${NAME}.tar.gz（${SIZE}）"
echo "  内容：compose / compose.build / Caddyfile / install.sh / bootstrap.sh / scripts / deploy 模板"
echo "  用户用法：tar xzf ${NAME}.tar.gz && cd ${NAME} && bash install.sh"
