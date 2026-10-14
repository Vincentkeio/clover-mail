import { getCurrentAdmin, unauthorized } from './auth'

export async function requireWebmailAdmin(request: Request, mutation = false) {
  // Webmail is an interactive feature tied to the signed-in Clover panel session;
  // API tokens are intentionally not accepted as a substitute for that session.
  if (request.headers.has('authorization')) return { response: unauthorized() as Response }
  const admin = await getCurrentAdmin()
  if (!admin) return { response: unauthorized() as Response }

  if (mutation) {
    const fetchSite = request.headers.get('sec-fetch-site')
    if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site') {
      return { response: Response.json({ error: '请求来源无效，请从 Clover 面板重新进入 Webmail。' }, { status: 403 }) }
    }
    const origin = request.headers.get('origin')
    const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
    if (origin && host) {
      try {
        if (new URL(origin).host !== host) {
          return { response: Response.json({ error: '请求来源无效，请从 Clover 面板重新进入 Webmail。' }, { status: 403 }) }
        }
      } catch {
        return { response: Response.json({ error: '请求来源无效。' }, { status: 403 }) }
      }
    }
  }
  return { admin }
}
