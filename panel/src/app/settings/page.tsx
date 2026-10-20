import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { admins } from '@/db/schema'
import { getCurrentAdmin } from '@/lib/auth'
import { getI18n } from '@/lib/i18n/server'
import { getPanelSettings } from '@/lib/settings'
import SettingsForm from './settings-form'
import TotpSection from './totp-section'
import PasskeySection from './passkey-section'
import ApiTokenSection from './api-token-section'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const { t } = await getI18n()
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
      <div className="topbar"><div><p className="eyebrow">ADVANCED</p><h1>{t('nav.advanced')}</h1><p className="hint">{t('settings.subtitle')}</p></div></div>
      <SettingsForm initial={settings} advancedContent={<div className="advanced-sections"><TotpSection enabled={totpEnabled} /><PasskeySection count={passkeyCount} demoMode={admin.id === 0} /><ApiTokenSection demoMode={admin.id === 0} /><section className="panel"><h2>{t('settings.dnsSyncTitle')}</h2><p className="hint">{t('settings.dnsSyncHint')}</p></section></div>} />
    </main>
  )
}
