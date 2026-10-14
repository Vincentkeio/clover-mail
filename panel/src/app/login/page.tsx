import { redirect } from 'next/navigation'
import { getCurrentAdmin, hasAnyAdmin } from '@/lib/auth'
import LoginForm from './login-form'

export const dynamic = 'force-dynamic'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; created?: string }>
}) {
  const [admin, hasAdmin] = await Promise.all([getCurrentAdmin(), hasAnyAdmin()])
  if (admin) redirect('/')
  const { error, created } = await searchParams
  return (
    <main className="login-wrap">
      <LoginForm error={error} created={created} needsAdmin={!hasAdmin} />
    </main>
  )
}
