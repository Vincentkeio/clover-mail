import { redirect } from 'next/navigation'
import { getCurrentAdmin } from '@/lib/auth'
import Updates from './updates'

export const dynamic = 'force-dynamic'
export default async function UpdatesPage() {
  if (!await getCurrentAdmin()) redirect('/login')
  return <Updates />
}
