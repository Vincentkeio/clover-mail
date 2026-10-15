import { NextRequest, NextResponse } from 'next/server'
import { sessionCookie, verifySessionToken } from '@/lib/session'

/** 公开页面（无需登录） */
const PUBLIC_PAGES = ['/login']
/** 公开品牌资源：登录页和浏览器标签页必须能在未登录时加载。 */
const PUBLIC_ASSETS = new Set(['/clover-mark.svg', '/icon.svg'])
/** 公开 API（compose healthcheck / 认证 / 对账双认证入口 / 演示种子） */
const PUBLIC_API = [
  '/api/health',
  '/api/v1/system/maintenance/status', // Read-only status, signed task ticket checked in route.
  '/api/auth/login',
  '/api/auth/logout',
  '/api/v1/system/reconcile', // 路由内自行做 session-or-bearer 双认证
  '/api/dev/seed', // 路由内要求 ALLOW_SEED=true
  '/api/auth/webauthn/login/options', // Passkey 登录入口（公开，凭据校验在路由内）
  '/api/auth/webauthn/login/verify',
  // Private Docker calls use the shared SSO key in the route; Caddy blocks public access.
  '/api/internal/roundcube/ticket',
  '/api/internal/roundcube/bootstrap',
]

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // DEMO_MODE：本地预览/演示模式，跳过一切登录检查（生产禁止设置）
  if (process.env.DEMO_MODE === 'true') return NextResponse.next()

  if (PUBLIC_ASSETS.has(pathname)) return NextResponse.next()

  if (PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next()
  }
  if (PUBLIC_API.includes(pathname)) return NextResponse.next()

  // 带 Authorization 的 API 请求放行到路由内校验（开放 API token / 对账 Bearer）
  // —— middleware 跑在 edge/node 无 DB，token 真伪在路由里判，无效仍会 401
  if (pathname.startsWith('/api/') && req.headers.get('authorization')) {
    return NextResponse.next()
  }

  const token = req.cookies.get(sessionCookie.name)?.value
  if (verifySessionToken(token)) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = req.nextUrl.clone()
  url.pathname = '/login'
  return NextResponse.redirect(url)
}

export const config = {
  // middleware 里用 node:crypto 做 HMAC 验签，必须固定 Node 运行时（edge 不支持 node: 前缀模块）
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
