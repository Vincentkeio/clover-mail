import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import { getGlobalMailSettings } from '@/lib/settings'
import GlobalMailSettings from '@/app/settings/mail-settings'

export const dynamic = 'force-dynamic'

export default async function GlobalMailSettingsPage() {
  const admin = await getCurrentAdmin()
  if (!admin) redirect('/login')
  const settings = await getGlobalMailSettings()

  return <main className="wrap">
    <div className="topbar"><div><p className="eyebrow">MAIL / POLICY</p><h1>全局邮箱设置</h1><p className="hint">协议、隐私与附件策略统一应用于所有邮箱；保存后同步到邮件服务。</p></div></div>
    <GlobalMailSettings initial={settings} />
  </main>
}
