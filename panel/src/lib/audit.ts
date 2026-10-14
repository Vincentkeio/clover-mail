import { db } from '@/db'
import { auditLogs } from '@/db/schema'

/** 一切变更动作留痕（含开放 API，见 plan 6.7） */
export async function audit(
  actor: string,
  action: string,
  target?: string,
  detail?: unknown,
): Promise<void> {
  await db.insert(auditLogs).values({
    actor,
    action,
    target,
    detail: detail === undefined ? null : JSON.stringify(detail),
  })
}
