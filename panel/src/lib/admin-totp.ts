import { sqlite } from '@/db'
import { totpStep } from './totp'

/** Consume a code once across processes, restarts and simultaneous requests. */
export function consumeAdminTotp(admin: { id: number; username: string; totpSecret: string }, code: string, disable = false): boolean {
  const step = totpStep(admin.username, admin.totpSecret, code)
  if (step === null) return false
  const result = sqlite.prepare(disable
    ? 'UPDATE admins SET totp_secret = NULL, totp_last_used_step = NULL WHERE id = ? AND totp_secret = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)'
    : 'UPDATE admins SET totp_last_used_step = ? WHERE id = ? AND totp_secret = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)')
    .run(...(disable ? [admin.id, admin.totpSecret, step] : [step, admin.id, admin.totpSecret, step]))
  return result.changes === 1
}
