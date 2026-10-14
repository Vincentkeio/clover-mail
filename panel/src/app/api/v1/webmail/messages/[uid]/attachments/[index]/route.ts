import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireWebmailAdmin } from '@/lib/webmail-auth'
import { getMessageAttachment } from '@/lib/webmail-service'

export const dynamic = 'force-dynamic'
const query = z.object({ login: z.string().email(), folder: z.string().min(1).max(200) })

export async function GET(request: Request, context: { params: Promise<{ uid: string; index: string }> }) {
  const auth = await requireWebmailAdmin(request)
  if (auth.response) return auth.response
  const { uid: rawUid, index: rawIndex } = await context.params
  const uid = Number(rawUid)
  const index = Number(rawIndex)
  const params = query.safeParse(Object.fromEntries(new URL(request.url).searchParams))
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(index) || index < 0 || !params.success) {
    return NextResponse.json({ error: '附件地址无效。' }, { status: 400 })
  }
  try {
    const attachment = await getMessageAttachment(params.data.login, params.data.folder, uid, index)
    const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(attachment.contentType) ? attachment.contentType : 'application/octet-stream'
    const encodedFilename = encodeURIComponent(attachment.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
    return new Response(new Uint8Array(attachment.content), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(attachment.content.length),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '下载附件失败。' }, { status: 502 })
  }
}
