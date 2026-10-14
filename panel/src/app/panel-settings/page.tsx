import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import PanelSettings from './panel-settings'

export const dynamic = 'force-dynamic'

export default async function PanelSettingsPage() {
  if (!await getCurrentAdmin()) redirect('/login')
  return <PanelSettings />
}
