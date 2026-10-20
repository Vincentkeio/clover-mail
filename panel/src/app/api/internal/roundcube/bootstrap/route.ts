import { NextResponse } from 'next/server'
import { db, sqlite } from '@/db'
import { mailboxes } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { ensureRoundcubeAuth } from '@/lib/roundcube-auth'
import { syncRoundcubePolicy } from '@/lib/roundcube-policy'
import { syncSrsDomains } from '@/lib/srs-sync'
import { validRoundcubeKey } from '@/lib/roundcube-sso'
import { getTranslator } from '@/lib/i18n/server'
export const dynamic = 'force-dynamic'
export async function POST(request: Request) {
  if (!validRoundcubeKey(request.headers.get('x-clover-sso-key'))) return new Response(null, { status: 403 })
  const t = await getTranslator()
  try {
    await syncRoundcubePolicy(t)
    const srs = await syncSrsDomains()
    if (!srs.ok) throw new Error(t('apiAuth.roundcube.srsSyncFailed', { error: srs.error }))
    const [mailbox] = await db.select({ login: mailboxes.login }).from(mailboxes).where(eq(mailboxes.active, true)).limit(1)
    if (mailbox) await ensureRoundcubeAuth(t)
    const remove = sqlite.prepare('DELETE FROM settings WHERE key = ?')
    for (const key of ['webmail_master_user', 'webmail_master_password', 'webmail_master_configured', 'webmail_master_config_version', 'webmail_master_setup_status', 'mailbox_policy_sync_version', 'allow_executable_attachments']) remove.run(key)
    return NextResponse.json({ ok: true, state: mailbox ? 'ready' : 'awaiting-mailbox' })
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : t('apiAuth.roundcube.bootstrapFailed') }, { status: 502 }) }
}
