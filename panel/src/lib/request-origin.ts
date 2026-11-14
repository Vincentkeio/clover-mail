/**
 * 浏览器请求的 Origin 校验。
 *
 * 面板的会话 cookie 是 SameSite，同站（sibling subdomain）请求仍会带上，
 * 单靠 cookie 无法区分「面板自己的页面」与「同站被植入的页面」。
 * 这里用浏览器的 Fetch Metadata 与 Origin 作为判断依据。
 *
 * 必须容纳三类真实调用方：
 * 1. 浏览器页面内 fetch/XHR —— 有 Origin 时严格比对；同源 GET 可能不带 Origin；
 * 2. 浏览器地址栏/书签导航（GET）—— 不带 Origin，Sec-Fetch-Mode 为 navigate；
 * 3. cron / CLI / 容器内回环（Bearer token）—— 完全没有 Fetch Metadata 头。
 *
 * 收紧要点：缺少 Origin 的子资源请求必须由 Fetch Metadata 确认同源。
 * 非浏览器客户端不受影响，GET 导航也不会被误杀。
 */
export function hasTrustedOrigin(headers: Pick<Headers, 'get'>, requestUrl?: string): boolean {
  const site = (headers.get('sec-fetch-site') || '').toLowerCase()
  const mode = (headers.get('sec-fetch-mode') || '').toLowerCase()
  const navigating = mode === 'navigate'

  // 跨站请求一律拒绝。同站但不同源（sibling subdomain）的子资源请求同样拒绝——
  // 这正是 SameSite cookie 无法覆盖的缺口。但顶级导航（点击同站链接）放行，
  // 否则从 Webmail 等子域跳回面板会被误杀。
  if (site === 'cross-site') return false
  if (site === 'same-site' && !navigating) return false

  const origin = headers.get('origin')
  if (!origin) {
    // 同源 GET（包括 Next.js 客户端导航）可能没有 Origin，浏览器的
    // Sec-Fetch-Site 可以证明它是同源请求。未知来源的子资源仍拒绝。
    if (mode && !navigating && site !== 'same-origin') return false
    return true
  }

  try {
    const fallback = requestUrl ? new URL(requestUrl) : null
    const host = (headers.get('x-forwarded-host') || headers.get('host') || fallback?.host || '').split(',')[0].trim()
    const proto = (headers.get('x-forwarded-proto') || fallback?.protocol.replace(':', '') || (process.env.NODE_ENV === 'production' ? 'https' : 'http')).split(',')[0].trim()
    const expected = new URL(process.env.PANEL_URL || `${proto}://${host}`)
    const actual = new URL(origin)
    return ['http:', 'https:'].includes(actual.protocol) && actual.origin === origin && actual.origin === expected.origin
  } catch { return false }
}
