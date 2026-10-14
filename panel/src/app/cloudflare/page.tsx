import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { getPanelSettings } from '@/lib/settings'
import CloudflarePanel from './cloudflare-panel'

export const dynamic = 'force-dynamic'

export default async function CloudflarePage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const settings = await getPanelSettings()

  return (
    <main className="wrap">
      <div className="topbar">
        <div><h1>Cloudflare 连接</h1><p className="hint">连接账号、管理域名，并同步邮件所需的 DNS 记录。</p></div>
        <span className={'tag ' + (settings.cfTokenSet ? 'ok' : '')}>{settings.cfTokenSet ? `已连接 · ${settings.cfTokenMasked}` : '尚未连接'}</span>
      </div>
      <CloudflarePanel tokenSet={settings.cfTokenSet} tokenMasked={settings.cfTokenMasked} />
      <p className="hint"><a href="/api-docs">API 文档</a> · <span className="mono">POST /api/v1/cloudflare/import</span> 可脚本化批量导入</p>
    </main>
  )
}
