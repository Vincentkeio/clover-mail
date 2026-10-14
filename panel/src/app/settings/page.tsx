import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { getPanelSettings } from '@/lib/settings'
import SettingsForm from './settings-form'
import TotpSection from './totp-section'
import PasskeySection from './passkey-section'
import ApiTokenSection from './api-token-section'
import GlobalMailSettings from './mail-settings'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const settings = await getPanelSettings()

  // DEMO_MODE 的虚拟管理员（id=0）没有数据库行
  const [row] = admin.id > 0 ? await db.select().from(admins).where(eq(admins.id, admin.id)).limit(1) : []
  const totpEnabled = !!row?.totpSecret
  let passkeyCount = 0
  if (row?.webauthnCredentials) {
    try {
      const list = JSON.parse(row.webauthnCredentials)
      passkeyCount = Array.isArray(list) ? list.length : 0
    } catch {
      passkeyCount = 0
    }
  }

  return (
    <main className="wrap">
      <div className="topbar"><div><p className="eyebrow">ADVANCED</p><h1>高级参数</h1><p className="hint">全局邮箱策略、手动 DNS、Webmail 管理账号与系统安全选项。</p></div></div>
      <GlobalMailSettings initial={settings.mail} />
      <SettingsForm initial={settings} advancedContent={<div className="advanced-sections"><TotpSection enabled={totpEnabled} /><PasskeySection count={passkeyCount} demoMode={admin.id === 0} /><ApiTokenSection demoMode={admin.id === 0} /><section className="panel"><h2>DNS 同步说明</h2><p className="hint">更改生成策略后，到域名详情的 DNS 高级选项重新生成，再推送到 Cloudflare。重复同步会自动比对差异。</p></section></div>} />
    </main>
  )
}
