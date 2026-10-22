/** Non-browser clients may omit Origin; browsers must use the panel's origin. */
export function hasTrustedOrigin(headers: Pick<Headers, 'get'>, requestUrl?: string): boolean {
  if (headers.get('sec-fetch-site') === 'cross-site') return false
  const origin = headers.get('origin')
  if (!origin) return true
  try {
    const fallback = requestUrl ? new URL(requestUrl) : null
    const host = (headers.get('x-forwarded-host') || headers.get('host') || fallback?.host || '').split(',')[0].trim()
    const proto = (headers.get('x-forwarded-proto') || fallback?.protocol.replace(':', '') || (process.env.NODE_ENV === 'production' ? 'https' : 'http')).split(',')[0].trim()
    const expected = new URL(process.env.PANEL_URL || `${proto}://${host}`)
    const actual = new URL(origin)
    return ['http:', 'https:'].includes(actual.protocol) && actual.origin === origin && actual.origin === expected.origin
  } catch { return false }
}
