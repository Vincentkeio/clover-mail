#!/usr/bin/env bash
# =============================================================================
# clover 三叶草邮局 — 一键安装器 v1.0.3
#
#   bash install.sh                          # 交互式安装（推荐）
#   bash install.sh --non-interactive        # 从环境变量读参数（自动化/CI）
#   bash install.sh --dry-run                # 只打印将要执行的动作，不做任何改动
#   bash install.sh --help
#
# 非交互模式需要通过环境变量提供的参数：
#   PANEL_HOSTNAME（必填）；邮件域名/主机名可登录面板后设置
#   MAIL_DOMAIN  MAIL_HOSTNAME  ACME_EMAIL（可选）  TZ
#   CLOVER_CF_API_TOKEN（可选）
#
# 目标平台：Debian 11–13 / Ubuntu 22.04+，x86_64/arm64，最低 2 核 2GB RAM + 1GB Swap；推荐 4GB RAM
# =============================================================================
set -euo pipefail

CLOVER_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$CLOVER_HOME"

if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-dumb}" != dumb ]]; then
  GREEN=$'\033[1;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[1;31m'
  CYAN=$'\033[1;36m'; DIM=$'\033[2m'; NC=$'\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; CYAN=''; DIM=''; NC=''
fi
say()  { printf "${GREEN}[clover]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[clover]${NC} %s\n" "$*"; }
die()  { printf "${RED}[clover] 错误：%s${NC}\n" "$*" >&2; exit 1; }
step() { printf "\n${CYAN}== %s ==${NC}\n" "$*"; }

DRY_RUN=0
NON_INTERACTIVE=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --non-interactive|-y) NON_INTERACTIVE=1 ;;
    --help|-h)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) die "未知参数：$arg（--help 查看用法）" ;;
  esac
done

# 所有有副作用的命令都经 run/run_sh，dry-run 下只打印
run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "${DIM}  [dry-run] %s${NC}\n" "$*"
  else
    printf "${DIM}  \$ %s${NC}\n" "$*"
    "$@"
  fi
}
run_sh() {
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "${DIM}  [dry-run] %s${NC}\n" "$*"
  else
    printf "${DIM}  \$ %s${NC}\n" "$*"
    bash -c "$*"
  fi
}

printf "${CYAN}"
cat <<'EOF'
   ╭──────────────────────────────────────────╮
   │   🍀  clover 三叶草邮局 · 一键安装 v1.0.3 │
   │   自托管 Docker 邮局 + DNS 一键推送 CF    │
   ╰──────────────────────────────────────────╯
EOF
printf "${NC}"
[ "$DRY_RUN" -eq 1 ] && warn "DRY-RUN 模式：只打印动作，不做任何改动"
[ "$NON_INTERACTIVE" -eq 1 ] && say "非交互模式：参数取自环境变量"

if [ -f .env ]; then
  die "检测到已有 Clover 配置（${CLOVER_HOME}/.env）。如需覆盖安装或清空旧数据，请重新运行 bootstrap.sh 并选择操作；升级请从面板检查更新，或手动运行 clover update。"
fi

# ---------------------------------------------------------------------------
# 1. 环境检查
# ---------------------------------------------------------------------------
step "1/6 环境检查"

if [ "$(id -u)" -ne 0 ]; then
  [ "$DRY_RUN" -eq 1 ] || die "请以 root 运行（绑定 25/80/443 端口与管理 Docker 需要）"
  warn "非 root（dry-run 继续）"
fi

if [ -r /etc/os-release ]; then
  . /etc/os-release
  case "${ID:-}" in
    debian|ubuntu) say "系统：${PRETTY_NAME}" ;;
    *) [ "$DRY_RUN" -eq 1 ] && warn "非 Debian/Ubuntu（${PRETTY_NAME:-unknown}）——dry-run 继续" || die "仅支持 Debian / Ubuntu（当前：${PRETTY_NAME:-unknown}）" ;;
  esac
else
  [ "$DRY_RUN" -eq 1 ] && warn "本机无 /etc/os-release（非 Linux）——dry-run 继续" || die "无法读取 /etc/os-release，仅支持 Debian/Ubuntu"
fi

ARCH="$(dpkg --print-architecture 2>/dev/null || uname -m)"
case "$ARCH" in
  x86_64) ARCH=amd64 ;;
  aarch64) ARCH=arm64 ;;
esac
case "$ARCH" in
  amd64|arm64) say "架构：${ARCH}" ;;
  *) [ "$DRY_RUN" -eq 1 ] && warn "架构 ${ARCH} 非 amd64/arm64——dry-run 继续" || die "仅支持 amd64 / arm64（当前：${ARCH}）" ;;
esac

K_MAJOR="$(uname -r | cut -d. -f1)"; K_MINOR="$(uname -r | cut -d. -f2 | cut -d- -f1)"
if [ "${K_MAJOR:-0}" -lt 5 ] || { [ "${K_MAJOR:-0}" -eq 5 ] && [ "${K_MINOR:-0}" -lt 10 ]; }; then
  warn "内核 $(uname -r) 偏老（建议 ≥ 5.10）：容器共享宿主内核，可能 Kernel too old / 崩溃"
else
  say "内核：$(uname -r)"
fi

MEM_MB="$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)"
if [ "${MEM_MB}" -lt 3500 ]; then
  warn "内存 ${MEM_MB}MB 偏小（建议 ≥ 4GB，ClamAV/rspamd 吃内存；可在 .env 关 ENABLE_CLAMAV=0）"
else
  say "内存：${MEM_MB}MB"
fi
DISK_GB="$(df -BG --output=avail / 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)"
if [ "${DISK_GB:-0}" -lt 15 ]; then warn "根分区可用 ${DISK_GB}GB 偏小（建议 ≥ 15GB，邮件数据会增长）"; else say "磁盘可用：${DISK_GB}GB"; fi

# Docker / compose
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "Docker：$(docker --version | awk '{print $3}' | tr -d ,) · $(docker compose version --short 2>/dev/null || echo v2)"
elif [ "$DRY_RUN" -eq 1 ]; then
  warn "未检测到 Docker + Compose v2（dry-run 继续，计划执行安装）"
  run_sh "curl -fsSL https://get.docker.com | sh"
  run_sh "systemctl enable --now docker"
elif [ "$NON_INTERACTIVE" -eq 1 ]; then
  die "未安装 Docker Engine ≥24 + Compose v2（非交互模式不自动安装，请先装好）"
else
  warn "未检测到 Docker + Compose v2"
  reply="y"
  if [ -r /dev/tty ]; then
    printf "是否现在用官方脚本安装 Docker？[Y/n]: "
    IFS= read -r reply < /dev/tty || reply="y"
  fi
  case "${reply:-y}" in
    y|Y|yes|"")
      run_sh "curl -fsSL https://get.docker.com | sh"
      run_sh "systemctl enable --now docker"
      ;;
    *) die "请手动安装 Docker 后重跑：https://docs.docker.com/engine/install/debian/" ;;
  esac
fi

# 端口占用（80/443 必须空闲；25 需空闲）
port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$"
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${p}$"
  else
    return 1
  fi
}
nginx_owns_port() {
  local p="$1" owners
  owners="$(ss -H -ltnp "sport = :${p}" 2>/dev/null || true)"
  [ -n "$owners" ] || return 1
  printf '%s\n' "$owners" | grep -q nginx || return 1
  ! printf '%s\n' "$owners" | grep -qv nginx
}
aapanel_nginx_active() {
  local init=/etc/init.d/nginx bin=/www/server/nginx/sbin/nginx
  local config=/www/server/nginx/conf/nginx.conf pidfile=/www/server/nginx/logs/nginx.pid
  local pid cmdline
  [ -f "$init" ] && [ -x "$bin" ] && [ -f "$config" ] && [ -f "$pidfile" ] || return 1
  # aaPanel versions vary the quoting and variable expansion in this SysV
  # script. The canonical paths, live master process and socket owners are
  # stronger evidence than matching specific assignment text.
  grep -Fq '/www/server/nginx/' "$init" || return 1
  pid="$(cat "$pidfile" 2>/dev/null || true)"
  [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null || return 1
  cmdline="$(tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null || true)"
  [[ "$cmdline" == *"$bin"* ]] || return 1
  # An on-disk vhost may refer to a certificate that has not been issued yet.
  # In that state `nginx -T` fails even while the live aaPanel master owns both
  # public sockets. Detect the running listener instead of rejecting that host.
  nginx_owns_port 80 && nginx_owns_port 443
}
for p in 80 443 25; do
  if port_in_use "$p"; then
    warn "端口 ${p} 已被占用——如果占用者是旧的 web 服务（nginx/apache）请先停掉（证书签发/收信需要它）"
  else
    say "端口 ${p}：空闲"
  fi
done

# 已有 systemd Caddy 或 nginx 可保留为宿主入口。
SHARED_NGINX=0
SHARED_CADDY=0
HOST_CADDY_CONFIG=""
HOST_CADDY_BIN=""
if port_in_use 80 || port_in_use 443; then
  if command -v python3 >/dev/null 2>&1; then
    host_caddy="$(python3 scripts/host-caddy.py detect 2>/dev/null || true)"
    if [ -n "$host_caddy" ]; then
      HOST_CADDY_CONFIG="${host_caddy%%|*}"
      HOST_CADDY_BIN="${host_caddy#*|}"
      SHARED_CADDY=1
      say "检测到宿主机 systemd Caddy：保留现有站点，Clover Docker Caddy 改走本机内部端口"
    fi
  fi
  if [ "$SHARED_CADDY" -eq 0 ]; then
    nginx_managed=0
    nginx_controller=""
    if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet nginx; then
      nginx_managed=1
      nginx_controller="systemd nginx"
    elif aapanel_nginx_active; then
      nginx_managed=1
      nginx_controller="aaPanel nginx"
    fi
    if [ "$nginx_managed" -eq 1 ]; then
      nginx_80=0; nginx_443=0
      if port_in_use 80 && nginx_owns_port 80; then nginx_80=1; fi
      if port_in_use 443 && nginx_owns_port 443; then nginx_443=1; fi
      if { ! port_in_use 80 || [ "$nginx_80" -eq 1 ]; } \
        && { ! port_in_use 443 || [ "$nginx_443" -eq 1 ]; }; then
        SHARED_NGINX=1
        say "检测到宿主机 ${nginx_controller}：将保留 nginx，Caddy 改走本机内部端口，证书签发期间会短暂停 nginx"
      else
        die "80/443 端口还被非 nginx 程序占用，或无法确认监听进程归属。请先释放对应端口后重跑。"
      fi
    elif port_in_use 80 || port_in_use 443; then
      die "80/443 端口被占用，但未识别到可安全复用的 systemd Caddy、systemd Nginx 或 aaPanel Nginx。请确认端口用途并先释放后重跑。"
    fi
  fi
fi

# 出站 25（发信生死线）
if timeout 4 bash -c '(exec 3<>/dev/tcp/smtp.gmail.com/25)' 2>/dev/null; then
  say "出站 25 端口：通"
else
  warn "出站 25 探测不通：部分 VPS 商默认封锁，发信会被拒；需开工单放行（见 docs/m0-checklist.md）"
fi

VPS_IP="${CLOVER_VPS_IP:-}"
if [ -z "$VPS_IP" ]; then
  VPS_IP="$(curl -fsSL --max-time 8 https://api.ipify.org 2>/dev/null || true)"
fi
if [ -z "$VPS_IP" ]; then
  VPS_IP="$(curl -fsSL --max-time 8 https://ifconfig.me 2>/dev/null || true)"
fi
if [ -z "$VPS_IP" ]; then
  VPS_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
[ -n "$VPS_IP" ] && say "公网 IP：${VPS_IP}" || warn "公网 IP 自动检测失败，稍后可在面板设置页手填"

# ---------------------------------------------------------------------------
# 2. 收集参数
# ---------------------------------------------------------------------------
step "2/6 参数收集"

cat <<'EOF'
安装前请先为面板域名添加 DNS A 记录，指向本机公网 IP，并等待解析生效。
面板 Caddy 会自动申请 HTTPS 证书；邮件证书使用 HTTP-01，公网 80 端口必须可达，Cloudflare 代理在签发时需关闭（DNS only）。
若宿主机 nginx 占用 80/443，安装器会自动暂停 nginx 完成签发，再恢复并配置反向代理。
若 systemd 管理的宿主机 Caddy 已占用 80/443，安装器会保留其现有站点并添加 Clover 反代；面板证书由宿主机 Caddy 管理。
面板域名格式示例：clover.example.com（将 example.com 替换成你自己的域名）。
邮件主域名、邮件主机名及 Cloudflare 连接可在登录面板后配置。
EOF

ask() { # ask <变量名> <提示> <默认值>
  local __var="$1" prompt="$2" default="$3" reply="" read_ok=0
  local existing="${!__var:-}"
  if [ -n "$existing" ]; then printf -v "$__var" '%s' "$existing"; say "${prompt}：${existing}（来自环境变量）"; return; fi
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    printf -v "$__var" '%s' "$default"; say "${prompt}：${default}（默认，非交互）"; return
  fi
  # 子 shell 里试开 /dev/tty：能开才交互（-r 只测权限位，Windows/无 TTY 会漏判）
  if (exec 3</dev/tty) 2>/dev/null; then
    if [ -n "$default" ]; then printf "%s [%s]: " "$prompt" "$default" > /dev/tty
    else printf "%s: " "$prompt" > /dev/tty; fi
    if IFS= read -r reply < /dev/tty; then read_ok=1; fi
  fi
  if [ "$read_ok" -eq 0 ]; then warn "${prompt}：无可用 TTY，使用默认值 ${default}"; fi
  printf -v "$__var" '%s' "${reply:-$default}"
}

PANEL_HOSTNAME="${PANEL_HOSTNAME:-}"; ask PANEL_HOSTNAME   '面板域名（如 clover.example.com）' ''
PANEL_HOSTNAME="${PANEL_HOSTNAME,,}"
MAIL_DOMAIN="${MAIL_DOMAIN:-${PANEL_HOSTNAME#clover.}}"
MAIL_HOSTNAME="${MAIL_HOSTNAME:-mail.${MAIL_DOMAIN}}"
ACME_EMAIL="${ACME_EMAIL:-admin@${MAIL_DOMAIN}}"
TZ="${TZ:-}";                         ask TZ               '时区' "$(timedatectl show -p Timezone --value 2>/dev/null || echo 'Asia/Shanghai')"
SHARED_PROXY=0
if [ "$SHARED_NGINX" -eq 1 ] || [ "$SHARED_CADDY" -eq 1 ]; then SHARED_PROXY=1; fi
CLOVER_HTTP_PORT="${CLOVER_HTTP_PORT:-$([ "$SHARED_PROXY" -eq 1 ] && echo 18080 || echo 80)}"
CLOVER_HTTPS_PORT="${CLOVER_HTTPS_PORT:-$([ "$SHARED_PROXY" -eq 1 ] && echo 18443 || echo 443)}"
CLOVER_CADDY_HTTP_PUBLISH="${CLOVER_CADDY_HTTP_PUBLISH:-$([ "$SHARED_PROXY" -eq 1 ] && echo 127.0.0.1:${CLOVER_HTTP_PORT} || echo "$CLOVER_HTTP_PORT")}"
CLOVER_CADDY_HTTPS_PUBLISH="${CLOVER_CADDY_HTTPS_PUBLISH:-$([ "$SHARED_PROXY" -eq 1 ] && echo 127.0.0.1:${CLOVER_HTTPS_PORT} || echo "$CLOVER_HTTPS_PORT")}"
CLOVER_CADDY_SCHEME="${CLOVER_CADDY_SCHEME:-$([ "$SHARED_PROXY" -eq 1 ] && echo http || echo https)}"
CLOVER_SHARED_NGINX="$SHARED_NGINX"
CLOVER_SHARED_CADDY="$SHARED_CADDY"
if [ "$SHARED_PROXY" -eq 1 ]; then CLOVER_TLS_DIRECTIVE=""; fi
CLOVER_TLS_DIRECTIVE="${CLOVER_TLS_DIRECTIVE:-}"
CLOVER_CF_API_TOKEN="${CLOVER_CF_API_TOKEN:-}"
# 低配机器（< 2GB）自动关 ClamAV：吃内存，1GB 机必关
: "${ENABLE_CLAMAV:=1}"
if [ "${MEM_MB:-0}" -lt 2000 ] && [ "$ENABLE_CLAMAV" = "1" ]; then
  warn "内存 ${MEM_MB}MB < 2GB → 自动关闭 ClamAV（.env 里 ENABLE_CLAMAV=0），需要可手工改回"
  ENABLE_CLAMAV=0
fi
# 80/443 被占用时提示改端口（共享主机常见）
for p in "$CLOVER_HTTP_PORT" "$CLOVER_HTTPS_PORT"; do
  if port_in_use "$p"; then
    warn "宿主端口 ${p} 已被占用——请设 CLOVER_HTTP_PORT/CLOVER_HTTPS_PORT 换个端口，否则 Caddy 起不来"
  fi
done

# 校验
printf '%s' "$MAIL_DOMAIN" | grep -Eq '^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$' \
  || die "邮件主域名格式不正确：${MAIL_DOMAIN}"
printf '%s' "$PANEL_HOSTNAME" | grep -Eq '^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$' || die "面板域名格式不正确：${PANEL_HOSTNAME}"
printf '%s' "$ACME_EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || die "邮箱格式不正确：${ACME_EMAIL}"
[ "$MAIL_DOMAIN" != "$PANEL_HOSTNAME" ] || warn "面板域名与邮件主域名相同：可运行，但建议分开（面板子域名更安全）"

# ---------------------------------------------------------------------------
# 3. 生成 .env
# ---------------------------------------------------------------------------
step "3/6 生成配置（.env）"

gen_secret() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex 32
  else head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

if [ -f .env ]; then
  BAK=".env.bak.$(date +%Y%m%d%H%M%S)"
  warn ".env 已存在 → 备份为 ${BAK}（重新配置会覆盖）"
  [ "$DRY_RUN" -eq 1 ] || cp .env "$BAK"
  SESSION_SECRET="$(grep -E '^SESSION_SECRET=' .env | cut -d= -f2- || true)"
  RECONCILE_TOKEN="$(grep -E '^RECONCILE_TOKEN=' .env | cut -d= -f2- || true)"
fi
: "${SESSION_SECRET:=}"
: "${RECONCILE_TOKEN:=}"
[ -z "$SESSION_SECRET" ] || [ "${#SESSION_SECRET}" -lt 16 ] && SESSION_SECRET="$(gen_secret)"
[ -z "$RECONCILE_TOKEN" ] && RECONCILE_TOKEN="$(gen_secret)"

if [ "$DRY_RUN" -eq 1 ]; then
  printf "${DIM}  [dry-run] cp .env.example .env && 填入 %s 等 %s 项 + 随机密钥${NC}\n" "$MAIL_DOMAIN" "9"
else
  cp .env.example .env
  set_env() { sed -i "s|^${1}=.*|${1}=${2}|" .env; }
  set_env MAIL_DOMAIN      "$MAIL_DOMAIN"
  set_env MAIL_HOSTNAME    "$MAIL_HOSTNAME"
  set_env PANEL_HOSTNAME   "$PANEL_HOSTNAME"
  set_env ACME_EMAIL       "$ACME_EMAIL"
  set_env TZ               "$TZ"
  set_env SESSION_SECRET   "$SESSION_SECRET"
  set_env RECONCILE_TOKEN  "$RECONCILE_TOKEN"
  set_env CLOVER_VPS_IP    "${VPS_IP:-}"
  set_env CLOVER_CF_API_TOKEN "${CLOVER_CF_API_TOKEN:-}"
  set_env CLOVER_HTTP_PORT  "${CLOVER_HTTP_PORT:-80}"
  set_env CLOVER_HTTPS_PORT "${CLOVER_HTTPS_PORT:-443}"
  set_env CLOVER_CADDY_HTTP_PUBLISH "$CLOVER_CADDY_HTTP_PUBLISH"
  set_env CLOVER_CADDY_HTTPS_PUBLISH "$CLOVER_CADDY_HTTPS_PUBLISH"
  set_env CLOVER_CADDY_SCHEME "$CLOVER_CADDY_SCHEME"
  set_env CLOVER_SHARED_NGINX "$CLOVER_SHARED_NGINX"
  set_env CLOVER_SHARED_CADDY "$CLOVER_SHARED_CADDY"
  set_env CLOVER_HOST_CADDY_CONFIG "$HOST_CADDY_CONFIG"
  set_env CLOVER_HOST_CADDY_BIN "$HOST_CADDY_BIN"
  set_env CLOVER_HOME "$CLOVER_HOME"
  set_env CLOVER_TLS_DIRECTIVE "${CLOVER_TLS_DIRECTIVE:-}"
  if [ "${ENABLE_CLAMAV:-1}" = "0" ]; then set_env ENABLE_CLAMAV 0; fi
  chmod 600 .env
  say ".env 已生成（含随机 SESSION_SECRET / RECONCILE_TOKEN，权限 600）"
fi

if [ "$DRY_RUN" -eq 0 ] && [ -x scripts/install-cli.sh ]; then
  bash scripts/install-cli.sh "$CLOVER_HOME" || warn "快捷命令未能安装；可运行 bash ${CLOVER_HOME}/scripts/install-cli.sh 手动安装"
fi

# 正式安装始终使用已发布的 GHCR 镜像。bootstrap 解压的仓库源码也可能含有 panel/，
# 不能据此推断用户希望在 VPS 本地构建。
COMPOSE_FILES=(-f compose.yaml)
say "使用已发布的 GHCR 面板镜像：${CLOVER_PANEL_IMAGE:-ghcr.io/vincentkeio/clover-panel}:${CLOVER_TAG:-latest}"

# ---------------------------------------------------------------------------
# 4. 启动
# ---------------------------------------------------------------------------
step "4/6 拉取镜像并启动（首次约 3–10 分钟，ClamAV 镜像较大）"

# 拉取失败就停止，避免拿旧缓存启动，或因为源码目录存在而转成本地构建。
run bash scripts/ensure-roundcube-env.sh
run docker compose "${COMPOSE_FILES[@]}" pull panel mail caddy roundcube \
  || die "无法拉取发布镜像；请检查网络与 GHCR 访问后重试。未启动旧缓存镜像。"
run docker compose "${COMPOSE_FILES[@]}" build certificate-helper
run docker compose "${COMPOSE_FILES[@]}" up -d --no-build

if [ "$SHARED_CADDY" -eq 1 ]; then
  step "4.1/6 配置宿主机 Caddy 入口"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "${DIM}  [dry-run] python3 scripts/host-caddy.py configure-env --env-file .env${NC}\n"
  else
    python3 scripts/host-caddy.py configure-env --env-file .env \
      || die "宿主机 Caddy 配置失败；原配置已回滚。修复后可运行 python3 scripts/host-caddy.py configure-env --env-file .env 重试。"
  fi
fi

if [ "$SHARED_NGINX" -eq 1 ]; then
  step "4.1/6 配置 nginx 与面板证书"
  if [ "$DRY_RUN" -eq 1 ]; then
    printf "${DIM}  [dry-run] docker exec clover-certificate-helper python3 /app/certificates.py issue --force${NC}\n"
  else
    for i in $(seq 1 30); do docker exec clover-certificate-helper python3 -c 'print("ready")' >/dev/null 2>&1 && break; sleep 1; done
    docker exec clover-certificate-helper python3 /app/certificates.py issue --force \
      || die "面板证书签发失败。nginx 已尝试恢复；查看 docker logs clover-certificate-helper，并确认面板域名 A 记录直连本机、Cloudflare 代理关闭且公网 80 可达后重试。"
  fi
fi

# ---------------------------------------------------------------------------
# 4.5 DMS TLS 证书 —— 587/465 认证发信的前提
# 实机验证：DMS 未配证书时 submission 端口不提供 STARTTLS，客户端无法登录发信。
# 这里自动生成自签证书（够用：客户端设「接受自签」即可）；生产建议换真证书。
# ---------------------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  printf "${DIM}  [dry-run] 为 DMS 生成 TLS 自签证书（CN=${MAIL_HOSTNAME}）并写 SSL_TYPE=manual${NC}\n"
else
  step "4.5/6 DMS TLS 证书（认证发信必需）"
  if grep -qE '^SSL_TYPE=..*' .env 2>/dev/null; then
    say ".env 已有 SSL_TYPE，跳过自签证书（生产环境请用真证书）"
  else
    for i in $(seq 1 30); do docker exec docker-mailserver sh -c 'true' >/dev/null 2>&1 && break; sleep 3; done
    if command -v openssl >/dev/null 2>&1; then
      docker exec docker-mailserver sh -c 'mkdir -p /tmp/docker-mailserver/ssl'
      openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=${MAIL_HOSTNAME}" \
        -keyout /tmp/clover-mail.key -out /tmp/clover-mail.crt 2>/dev/null
      docker cp /tmp/clover-mail.crt docker-mailserver:/tmp/docker-mailserver/ssl/mail.crt
      docker cp /tmp/clover-mail.key docker-mailserver:/tmp/docker-mailserver/ssl/mail.key
      docker exec docker-mailserver chmod 600 /tmp/docker-mailserver/ssl/mail.key
      printf 'SSL_TYPE=manual\nSSL_CERT_PATH=/tmp/docker-mailserver/ssl/mail.crt\nSSL_KEY_PATH=/tmp/docker-mailserver/ssl/mail.key\n' >> .env
      run docker compose "${COMPOSE_FILES[@]}" up -d mail
      rm -f /tmp/clover-mail.key /tmp/clover-mail.crt
      warn "已启用自签 TLS。生产环境请换真证书（见 README「邮件 TLS 证书」），否则部分客户端会告警"
    else
      warn "缺少 openssl，跳过 DMS TLS 证书生成 —— 587/465 认证发信会失败！"
      warn "手工补：给 DMS 配 SSL_TYPE=manual + 证书路径（见 README）"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 5. 健康检查（容器内 fetch，不依赖 DNS/证书）
# ---------------------------------------------------------------------------
step "5/6 健康检查"

if [ "$DRY_RUN" -eq 1 ]; then
  printf "${DIM}  [dry-run] 轮询容器内 /api/health（最多 90s）${NC}\n"
else
  ok=0
  for i in $(seq 1 45); do
    if docker exec clover-panel node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then ok=1; break; fi
    sleep 2
  done
  if [ "$ok" -eq 1 ]; then
    say "面板健康 ✔"
    docker exec clover-panel node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>console.log('  '+t))" || true
    bash scripts/admin-bootstrap.sh
    bash scripts/configure-roundcube.sh || die "Roundcube 免密初始化失败，请检查邮件服务后运行 bash scripts/configure-roundcube.sh。"
  else
    warn "面板未在 90s 内就绪，查看日志：docker logs --tail 100 clover-panel"
  fi
  echo
  docker compose "${COMPOSE_FILES[@]}" ps || true
fi

# ---------------------------------------------------------------------------
# 6. 下一步指引
# ---------------------------------------------------------------------------
step "6/6 接下来"

if [ "$DRY_RUN" -eq 1 ]; then
  say "dry-run 结束：以上为将要执行的全部动作。去掉 --dry-run 即真正安装。"
  exit 0
fi

cat <<EOF

${GREEN}✅ clover 已启动${NC}

1) 面板地址：https://${PANEL_HOSTNAME}
   系统仅有一个管理员；若此前没有，随机凭据已在上方输出。新建管理员会替换旧管理员。现在可直接登录（公网不开放首次建号）
EOF
if [ "$SHARED_CADDY" -eq 1 ]; then
  cat <<'EOF'
   宿主机 Caddy 保留现有站点并提供 HTTPS；邮件证书使用 HTTP-01 webroot 验证，不会暂停入口服务。
EOF
elif [ "$SHARED_NGINX" -eq 1 ]; then
  cat <<'EOF'
   宿主机 nginx 负责 HTTPS 入口；证书签发时 nginx 会短暂停止，安装后可在「证书管理」续签。
EOF
else
  cat <<'EOF'
   面板证书由 Caddy 自动签发和续期；如有证书问题，请确认该域名 A 记录及公网 80/443 可达。
EOF
fi
cat <<EOF

2) 设置邮件（面板 → 环境配置）：
   连接 Cloudflare → 选择邮件域名并设置邮件主机名 → 一键生成并推送邮件 DNS。
   如需邮件送达优化，再到 VPS 服务商处把公网 IP 的 PTR/rDNS 指向所设邮件主机名。

3) 常用运维：
   快捷菜单   输入 clover（状态、重启、更新、修复重部署、日志、备份、卸载和管理员管理）
   查看状态   docker compose ps
   看日志     docker logs -f clover-panel
   建域向导   面板 → 域名 → 新建域名（三步）
   对账修复   curl -X POST https://${PANEL_HOSTNAME}/api/v1/system/reconcile \\
                -H "Authorization: Bearer \$(grep ^RECONCILE_TOKEN .env | cut -d= -f2)" \\
                -H 'Content-Type: application/json' -d '{"heal":true}'
   备份       ./scripts/backup.sh     （建议加 cron，保留策略见脚本头注释）
   升级       ./scripts/upgrade.sh

4) DNS 生效后到「监控 → 投递体检」跑一遍；25 端口/rDNS/送达率验收清单见 docs/m0-checklist.md

配置：${CLOVER_HOME}/.env（含随机密钥，权限 600，请备份好）
EOF
