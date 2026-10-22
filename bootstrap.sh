#!/usr/bin/env bash
# =============================================================================
# clover 引导脚本 —— 真正的「一条命令」（无需 git clone）
#
#   curl -fsSL https://raw.githubusercontent.com/Vincentkeio/clover-mail/main/bootstrap.sh | bash
#   # 或带参数：... | bash -s -- --non-interactive
#   # 指定分支/标签：CLOVER_REF=v1.0.0 ... | bash
#
# 做的事：全新安装；发现已有实例时，可选择保留数据覆盖部署或清空数据后全新安装。
# =============================================================================
set -euo pipefail

REPO="${CLOVER_REPO:-Vincentkeio/clover-mail}"
REF="${CLOVER_REF:-main}"
DEST="${CLOVER_DIR:-/opt/clover}"
TARBALL="https://codeload.github.com/${REPO}/tar.gz/refs/heads/${REF}"

GREEN='\033[1;32m'; RED='\033[1;31m'; NC='\033[0m'
say() { printf "${GREEN}[clover]${NC} %s\n" "$*"; }
warn() { printf "\033[1;33m[clover]\033[0m %s\n" "$*"; }
die() { printf "${RED}[clover] 错误：%s${NC}\n" "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请以 root 运行"
command -v curl >/dev/null 2>&1 || die "缺少 curl"
command -v tar >/dev/null 2>&1 || die "缺少 tar"
case "${DEST}" in
  /*) ;;
  *) die "安装目录必须是绝对路径：${DEST}" ;;
esac
[ "${DEST}" != "/" ] || die "不允许把根目录设为 Clover 安装目录"

EXISTING_ACTION="fresh"
if [ -f "${DEST}/.env" ]; then
  say "检测到已有 Clover 实例（${DEST}/.env）"
  if [ ! -r /dev/tty ]; then
    die "检测到已有实例，但当前没有交互终端可供选择。请在 SSH 终端重新运行安装命令。"
  fi
  cat > /dev/tty <<EOF

选择安装方式：
  1) 覆盖部署并保留原数据（保留 .env、邮件/账户数据卷、证书和备份）
  2) 全新安装并清除旧数据（删除 Clover 容器、数据卷、配置、证书和本地备份）
  0) 取消
EOF
  printf '请选择 [0/1/2]：' > /dev/tty
  IFS= read -r EXISTING_ACTION < /dev/tty || die "无法读取安装选择"
  case "${EXISTING_ACTION}" in
    1) EXISTING_ACTION="preserve" ;;
    2)
      EXISTING_ACTION="fresh"
      printf '\n此操作会永久删除 Clover 邮件、管理员/域名数据库、WebMail 数据、证书和本地备份。\n请输入 DELETE CLOVER DATA 确认清除：' > /dev/tty
      IFS= read -r CONFIRM_DELETE < /dev/tty || die "无法读取清除确认"
      [ "${CONFIRM_DELETE}" = "DELETE CLOVER DATA" ] || die "确认文字不匹配，已取消；旧实例未更改。"
      EXISTING_ACTION="clean"
      ;;
    0) die "已取消；旧实例未更改。" ;;
    *) die "无效选择；旧实例未更改。请重新运行并选择 0、1 或 2。" ;;
  esac
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

say "下载 clover 源码（${REPO}@${REF}）…"
# 私有仓库：CLOVER_TOKEN=<GitHub PAT> 走 API 带鉴权下载；公开仓库直接走 codeload
if [ -n "${CLOVER_TOKEN:-}" ]; then
  curl -fsSL --max-time 180 -H "Authorization: Bearer ${CLOVER_TOKEN}" \
    "https://api.github.com/repos/${REPO}/tarball/${REF}" -o "${TMP}/clover.tar.gz" \
    || die "下载失败（token 无效或无仓库权限）"
else
  curl -fsSL --max-time 120 "${TARBALL}" -o "${TMP}/clover.tar.gz" \
    || die "下载失败（网络或仓库路径不对；私有仓库请设 CLOVER_TOKEN）"
fi

say "解压到 ${DEST} …"
mkdir -p "${TMP}/x"
tar xzf "${TMP}/clover.tar.gz" -C "${TMP}/x"
SRC="$(find "${TMP}/x" -maxdepth 1 -mindepth 1 -type d | head -1)"
[ -n "${SRC}" ] || die "解压结果异常"

if [ "${EXISTING_ACTION}" = "clean" ]; then
  say "停止 Clover 并清理旧数据卷…"
  [ -f "${DEST}/compose.yaml" ] || die "找不到旧 compose.yaml，无法安全识别并清理数据卷；旧实例未删除。"
  (cd "${DEST}" && docker compose -f compose.yaml down --volumes --remove-orphans)
  rm -f "${DEST}/.env" "${DEST}"/.env.bak.* "${DEST}"/.env.before-overwrite.*
  rm -rf "${DEST}/backups" "${DEST}/deploy/acme"
fi

mkdir -p "${DEST}"
# 保留模式下 .env、数据卷、证书和备份均保持不变。
cp -a "${SRC}/." "${DEST}/"
chmod +x "${DEST}/install.sh" "${DEST}/scripts/"*.sh 2>/dev/null || true

# exec below replaces this shell, so its EXIT trap would never run on success.
# Only remove the private directory allocated by this invocation of mktemp.
rm -rf -- "${TMP}"
trap - EXIT

cd "${DEST}"
# 私有镜像仓库登录（GHCR 上的 clover-panel 若为私有包，拉取前必须先登录）
if [ -n "${CLOVER_GHCR_TOKEN:-}" ]; then
  say "登录 GHCR（ghcr.io）…"
  echo "${CLOVER_GHCR_TOKEN}" | docker login ghcr.io -u "${CLOVER_GHCR_USER:-${GITHUB_USER:-Vincentkeio}}" --password-stdin \
    && say "GHCR 登录成功" \
    || warn "GHCR 登录失败——若镜像是私有包，拉取会失败"
fi

if [ "${EXISTING_ACTION}" = "preserve" ]; then
  say "覆盖代码并重建 Clover 服务；保留原配置和数据卷…"
  exec bash scripts/reinstall.sh
fi

say "开始安装（工作目录 ${DEST}）"
exec bash install.sh "$@"
