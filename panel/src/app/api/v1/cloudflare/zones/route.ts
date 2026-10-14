import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { listAllZones } from '@/lib/cloudflare'
import { allDomains } from '@/lib/cf-sync'
import { getCfToken } from '@/lib/settings'

export const dynamic = 'force-dynamic'

/**
 * 列出 CF Token 可见的全部域名（zone），并标注是否已在面板中。
 * 这是「填一次 Token → 全部域名一键配 DNS」的第一步。
 */
export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const token = await getCfToken()
  if (!token) {
    return NextResponse.json(
      { tokenSet: false, zones: [], error: '未配置 Cloudflare API Token（设置页录入后可自动拉取账号下所有域名）' },
      { status: 400 },
    )
  }

  try {
    const [zones, local] = await Promise.all([listAllZones(token), allDomains()])
    const imported = new Set(local.map((d) => d.name))
    return NextResponse.json({
      tokenSet: true,
      zones: zones.map((z) => ({
        id: z.id,
        name: z.name,
        status: z.status,
        account: z.account?.name ?? null,
        imported: imported.has(z.name.toLowerCase()),
      })),
    })
  } catch (err) {
    return NextResponse.json(
      { tokenSet: true, zones: [], error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
