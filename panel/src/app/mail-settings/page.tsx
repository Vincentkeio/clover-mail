import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { getI18n } from '@/lib/i18n/server'
import { getGlobalMailSettings, getMailHostname } from '@/lib/settings'
import GlobalMailSettings from '@/app/settings/mail-settings'

export const dynamic = 'force-dynamic'

export default async function GlobalMailSettingsPage() {
  const { t } = await getI18n()
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const settings = await getGlobalMailSettings()

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">MAIL / POLICY</p><h1>{t('mailSettings.title')}</h1><p className="hint">{t('mailSettings.intro')}</p></div></div>
    <GlobalMailSettings initial={settings} mailHost={getMailHostname()} />
  </main>
}
