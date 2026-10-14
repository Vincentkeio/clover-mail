import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { readMailQueue, serviceStatus, tailMailLog } from '@/lib/queue'

export const dynamic = 'force-dynamic'

/** 队列 + 服务进程 + 日志尾部（一次返回，页面轮询用） */
export async function GET(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()

  const url = new URL(req.url)
  const logLines = Math.min(Number(url.searchParams.get('lines') ?? '150') || 150, 500)

  const [queue, services, logs] = await Promise.all([
    readMailQueue(),
    serviceStatus(),
    tailMailLog(logLines),
  ])

  return NextResponse.json({
    reachable: queue.reachable,
    queue,
    services,
    logs,
    error: queue.error ?? logs.error,
  })
}
