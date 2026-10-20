import { db } from '@/db'
import { auditLogs } from '@/db/schema'
import { redactAuditDetail, redactSensitiveText } from './redact'

/** 一切变更动作留痕（含开放 API，见 plan 6.7） */
export async function audit(
  actor: string,
  action: string,
  target?: string,
  detail?: unknown,
): Promise<void> {
  await db.insert(auditLogs).values({
    actor: redactSensitiveText(actor),
    action,
    target: target === undefined ? undefined : redactSensitiveText(target),
    detail: detail === undefined ? null : JSON.stringify(redactAuditDetail(detail)),
  })
}
