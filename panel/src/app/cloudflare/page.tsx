import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { getPanelSettings } from '@/lib/settings'
import { getI18n } from '@/lib/i18n/server'
import CloudflarePanel from './cloudflare-panel'

export const dynamic = 'force-dynamic'

export default async function CloudflarePage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const settings = await getPanelSettings()
  const { t } = await getI18n()

  return (
    <main className="wrap">
      <div className="topbar">
        <div><h1>{t('cloudflare.title')}</h1><p className="hint">{t('cloudflare.subtitle')}</p></div>
        <span className={'tag ' + (settings.cfTokenSet ? 'ok' : '')}>{settings.cfTokenSet ? t('cloudflare.connectedMasked', { masked: settings.cfTokenMasked ?? '' }) : t('cloudflare.notConnected')}</span>
      </div>
      <CloudflarePanel tokenSet={settings.cfTokenSet} tokenMasked={settings.cfTokenMasked} />
      <p className="hint"><a href="/api-docs">{t('cloudflare.apiDocs')}</a> · <span className="mono">POST /api/v1/cloudflare/import</span> {t('cloudflare.apiImportHint')}</p>
    </main>
  )
}
