#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
for attempt in $(seq 1 30); do
  if docker exec clover-panel node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then break; fi
  sleep 2
done
# Shared key travels only on the private container loopback request.
docker exec clover-panel node -e '
fetch("http://127.0.0.1:3000/api/internal/roundcube/bootstrap", {
  method: "POST",
  headers: { "X-Clover-SSO-Key": process.env.ROUNDCUBE_SSO_SECRET || "" },
  signal: AbortSignal.timeout(120000)
}).then(async response => {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || "Roundcube 免密初始化失败");
  console.log(data.state === "awaiting-mailbox" ? "Roundcube 已就绪；创建邮箱后首次打开会自动配置免密认证。" : "Roundcube 免密认证与全局设置已同步。");
}).catch(error => { console.error(error.message); process.exit(1); });
'
# Legacy updaters reopen this file after source refresh and panel health. Keep
# the migration here so the very first update runs the refreshed cleanup code.
if [ -f scripts/project-maintenance.sh ]; then
  bash scripts/project-maintenance.sh finish \
    || echo '警告：Clover 更新后空间清理未完成；服务已更新，旧数据保留。' >&2
fi
