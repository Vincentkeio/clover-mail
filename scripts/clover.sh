#!/usr/bin/env bash
set -euo pipefail

resolve_home() {
  local source="${BASH_SOURCE[0]}"
  while [ -L "$source" ]; do
    local dir
    dir="$(cd -P "$(dirname "$source")" >/dev/null 2>&1 && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")/.." >/dev/null 2>&1 && pwd
}

CLOVER_HOME="$(resolve_home)"
cd "$CLOVER_HOME"

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 运行：sudo clover" >&2
  exit 1
fi
if [ ! -f .env ] || [ ! -f compose.yaml ]; then
  echo "未找到 Clover 安装配置：$CLOVER_HOME/.env" >&2
  exit 1
fi

compose_files=(-f compose.yaml)
compose() { docker compose "${compose_files[@]}" "$@"; }
pause() { read -r -p "按 Enter 返回菜单…" _ </dev/tty || true; }
header() {
  clear 2>/dev/null || true
  printf '\n🍀 Clover 邮局管理\n安装目录：%s\n\n' "$CLOVER_HOME"
}
show_status() {
  echo "容器状态："
  compose ps
  echo
  if docker inspect clover-panel >/dev/null 2>&1; then
    printf '面板健康：'
    if docker exec clover-panel node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
      echo "正常"
    else
      echo "未就绪（可查看面板日志）"
    fi
  fi
  echo
  df -h "$CLOVER_HOME" | awk 'NR==1 || NR==2 {print "磁盘：" $0}'
}
show_logs() {
  local service="${1:-}"
  if [ -n "$service" ]; then
    compose logs --tail 100 -f "$service"
  else
    echo "选择日志服务："
    select service in panel mail caddy certificate-helper 返回; do
      case "$service" in
        panel) compose logs --tail 100 -f panel; break ;;
        mail) compose logs --tail 100 -f mail; break ;;
        caddy) compose logs --tail 100 -f caddy; break ;;
        certificate-helper) compose logs --tail 100 -f certificate-helper; break ;;
        返回) break ;;
        *) echo "请输入菜单编号。" ;;
      esac
    done
  fi
}
restart_services() {
  compose restart
  echo "Clover 服务已重启。"
}
repair_deploy() {
  echo "将重新拉取已发布镜像并部署 Clover 服务。配置、数据库和邮件卷会保留。"
  read -r -p "输入 REDEPLOY 继续：" confirm </dev/tty
  [ "$confirm" = REDEPLOY ] || { echo "已取消。"; return; }
  if ! compose pull panel mail caddy; then
    echo "镜像拉取失败；没有重建或重启服务，请检查 GHCR 网络后重试。"
    return 1
  fi
  [ ! -f scripts/remove-roundcube.sh ] || bash scripts/remove-roundcube.sh
  compose build certificate-helper
  compose up -d --no-build --force-recreate
  bash scripts/admin-bootstrap.sh
  echo "重新部署完成；状态如下："
  compose ps
}
run_update() {
  bash scripts/upgrade.sh
  bash scripts/install-cli.sh "$CLOVER_HOME"
}
run_backup() {
  bash scripts/backup.sh
}
admin_list() {
  docker exec clover-panel node /app/admin-cli.cjs list
}
admin_password() {
  local action="$1" username="$2" password confirm
  [ -n "$username" ] || read -r -p "管理员用户名：" username </dev/tty
  [ -n "$username" ] || { echo "用户名不能为空。"; return 1; }
  read -r -s -p "新密码（至少 12 位）：" password </dev/tty; echo
  read -r -s -p "再次输入新密码：" confirm </dev/tty; echo
  [ "$password" = "$confirm" ] || { unset password confirm; echo "两次密码不一致。"; return 1; }
  if [ "${#password}" -lt 12 ]; then unset password confirm; echo "密码至少 12 位。"; return 1; fi
  printf '%s\n' "$password" | docker exec -i clover-panel node /app/admin-cli.cjs "$action" "$username"
  if [ "$action" = reset ]; then
    local session_secret
    if command -v openssl >/dev/null 2>&1; then
      session_secret="$(openssl rand -hex 32)"
    else
      session_secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    fi
    if grep -q '^SESSION_SECRET=' .env; then
      sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=${session_secret}|" .env
    else
      printf 'SESSION_SECRET=%s\n' "$session_secret" >> .env
    fi
    chmod 600 .env
    compose restart panel
    echo "管理员密码已重置，所有浏览器会话已注销；请用新密码重新登录。"
  fi
  unset password confirm
}
admin_create() {
  local existing confirm
  existing="$(docker exec clover-panel node -e 'const D=require("better-sqlite3");const d=new D(process.env.DATABASE_PATH||"/app/data/clover.db",{readonly:true});console.log(d.prepare("SELECT username FROM admins ORDER BY id").all().map(x=>x.username).join("、"));d.close();')"
  if [ -n "$existing" ]; then
    echo "当前管理员账户：$existing"
    echo "创建新管理员会覆盖旧管理员；旧密码、两步验证和 Passkey 不会转移，旧登录会话会失效。"
    read -r -p "输入 REPLACE 确认覆盖，其他内容取消：" confirm </dev/tty
    [ "$confirm" = REPLACE ] || { echo "已取消，当前管理员未更改。"; return; }
  fi
  admin_password create "${1:-}"
}
admin_reset() { admin_password reset "${1:-}"; }
admin_rename() {
  local username="${1:-}" new_username
  [ -n "$username" ] || read -r -p "要修改的管理员用户名：" username </dev/tty
  read -r -p "新的用户名：" new_username </dev/tty
  docker exec clover-panel node /app/admin-cli.cjs rename "$username" "$new_username"
}
admin_menu() {
  while true; do
    printf '\n唯一管理员账户管理（创建会覆盖原管理员；密码无法查看）\n'
    echo "  1) 查看管理员"
    echo "  2) 创建/替换唯一管理员"
    echo "  3) 修改用户名"
    echo "  4) 重置密码"
    echo "  0) 返回"
    read -r -p "请选择：" choice </dev/tty || return 0
    case "$choice" in
      1) admin_list ;;
      2) admin_create ;;
      3) admin_rename ;;
      4) admin_reset ;;
      0) return 0 ;;
      *) echo "无效选项。" ;;
    esac
  done
}
uninstall() {
  echo "卸载只会移除 Clover 容器和网络，默认保留邮件数据卷、配置与备份。"
  read -r -p "输入 UNINSTALL 继续：" confirm </dev/tty
  [ "$confirm" = UNINSTALL ] || { echo "已取消。"; return; }
  compose down
  echo "Clover 容器已卸载。数据保留在 Docker 卷中；之后可在 $CLOVER_HOME 重新部署。"
  echo "快捷命令仍保留，便于恢复或查看配置。"
}
purge_data() {
  echo "危险操作：将停止服务并永久删除 Clover 的邮件、数据库和证书数据卷。"
  echo "建议先执行备份，并将备份复制到其他机器。"
  read -r -p "输入 DELETE CLOVER DATA 继续：" confirm </dev/tty
  [ "$confirm" = "DELETE CLOVER DATA" ] || { echo "已取消。"; return; }
  compose down --volumes --remove-orphans
  echo "Clover 容器与数据卷已删除。配置和备份文件仍保留在 $CLOVER_HOME。"
  echo "如需删除安装目录和快捷命令，请手动确认后执行：rm -rf '$CLOVER_HOME' && rm -f /usr/local/bin/clover"
}

case "${1:-}" in
  status|状态) show_status; exit ;;
  restart|重启) restart_services; exit ;;
  update|更新) run_update; exit ;;
  logs|日志) show_logs "${2:-}"; exit ;;
  backup|备份) run_backup; exit ;;
  admin|管理员)
    case "${2:-}" in
      list|查看) admin_list ;;
      create|add|创建) admin_create "${3:-}" ;;
      reset|重置密码) admin_reset "${3:-}" ;;
      rename|改名) admin_rename "${3:-}" ;;
      *) admin_menu ;;
    esac
    exit ;;
  repair|重部署) repair_deploy; exit ;;
  uninstall|卸载) uninstall; exit ;;
  purge|清除数据) purge_data; exit ;;
  help|-h|--help)
    echo "用法：clover [status|restart|update|logs|backup|repair|uninstall|purge]"
    echo "管理员：clover admin [list|create <用户名>|reset <用户名>|rename <用户名>]"
    echo "提示：create 会替换原管理员；旧密码、两步验证和 Passkey 不会转移。"
    exit ;;
esac

while true; do
  header
  cat <<'EOF'
  1) 查看状态
  2) 重启服务
  3) 更新 Clover
  4) 修复 / 重新部署（保留配置与邮件数据）
  5) 查看服务日志
  6) 立即备份
  7) 卸载服务（保留数据卷和配置）
  8) 删除数据卷（保留安装文件和配置）
  9) 管理员账户（仅一个；创建新管理员会覆盖旧账户）
  0) 退出
EOF
  read -r -p "请选择：" choice </dev/tty || exit 0
  case "$choice" in
    1) show_status; pause ;;
    2) restart_services; pause ;;
    3) run_update; pause ;;
    4) repair_deploy; pause ;;
    5) show_logs; pause ;;
    6) run_backup; pause ;;
    7) uninstall; pause ;;
    8) purge_data; pause ;;
    9) admin_menu; pause ;;
    0) exit 0 ;;
    *) echo "无效选项。"; pause ;;
  esac
done
