import { NextResponse } from 'next/server'
import { z } from 'zod'
import { audit } from '@/lib/audit'
import { requireWebmailAdmin } from '@/lib/webmail-auth'
import { getWebmailPolicy, sendMessage } from '@/lib/webmail-service'
import { sanitizeMailHtml } from '@/lib/webmail-html'

export const dynamic = 'force-dynamic'
const noNewlines = (max: number, min = 0) => z.string().min(min).max(max).refine((value) => !/[\r\n]/.test(value), '邮件头不能包含换行符')
const schema = z.object({
  login: z.string().email(),
  to: noNewlines(4000, 3),
  cc: noNewlines(4000).optional(),
  subject: noNewlines(998),
  text: z.string().min(1).max(500_000),
  html: z.string().max(500_000).optional(),
  inReplyTo: noNewlines(1000).optional(),
  references: noNewlines(8000).optional(),
})

export async function POST(request: Request) {
  const auth = await requireWebmailAdmin(request, true)
  if (auth.response) return auth.response
  const form = await request.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: '邮件数据格式无效。' }, { status: 400 })
  const body = schema.safeParse(Object.fromEntries(['login', 'to', 'cc', 'subject', 'text', 'html', 'inReplyTo', 'references']
    .map((key) => [key, form.get(key) ?? undefined])))
  if (!body.success) return NextResponse.json({ error: '请检查收件人、主题和邮件正文。' }, { status: 400 })
  const uploaded = form.getAll('attachments')
  if (uploaded.some((item) => typeof item === 'string') || uploaded.length > 10) {
    return NextResponse.json({ error: '最多可附加 10 个文件。' }, { status: 400 })
  }
  const files = uploaded.filter((item): item is File => item instanceof File)
  if (files.length !== uploaded.length) return NextResponse.json({ error: '附件格式无效。' }, { status: 400 })
  let policy
  try { policy = await getWebmailPolicy(body.data.login) } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '邮箱策略读取失败。' }, { status: 400 })
  }
  const attachmentBytes = files.reduce((total, file) => total + file.size, 0)
  const maxAttachmentBytes = policy.maxAttachmentMb === 0 ? Number.POSITIVE_INFINITY : policy.maxAttachmentMb * 1024 * 1024
  if (attachmentBytes > maxAttachmentBytes) {
    return NextResponse.json({ error: policy.maxAttachmentMb === 0 ? '附件超出服务器可处理范围。' : `附件合计超过全局 ${policy.maxAttachmentMb} MB 限制。` }, { status: 413 })
  }
  const attachments = await Promise.all(files.map(async (file) => ({
    filename: file.name.replace(/[\\/\u0000-\u001f\u007f]/g, '_').slice(0, 180) || 'attachment',
    contentType: /^[\w.+-]+\/[\w.+-]+$/.test(file.type) ? file.type : 'application/octet-stream',
    content: Buffer.from(await file.arrayBuffer()),
  })))
  try {
    const result = await sendMessage({ ...body.data, html: body.data.html ? sanitizeMailHtml(body.data.html) : undefined, attachments })
    await audit(auth.admin.username, 'webmail.message.send', body.data.login.trim().toLowerCase(), {
      status: 'accepted', messageId: result.messageId, to: body.data.to, subject: body.data.subject,
      attachments: attachments.length, saved: result.saved,
    }).catch((auditError) => console.error('[webmail] failed to record accepted send:', auditError))
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : '发送失败。'
    await audit(auth.admin.username, 'webmail.message.send', body.data.login.trim().toLowerCase(), {
      status: 'failed', to: body.data.to, subject: body.data.subject, error: message.slice(0, 500),
    }).catch((auditError) => console.error('[webmail] failed to record send failure:', auditError))
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
