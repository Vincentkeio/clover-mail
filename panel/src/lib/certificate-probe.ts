import tls from 'node:tls'
import net from 'node:net'

export type CertificateProbe = {
  host: string; port: number; ok: boolean; authorized?: boolean; subject?: string; issuer?: string
  validFrom?: string; validTo?: string; daysLeft?: number; fingerprint?: string; error?: string
}

export function readCertificate(host: string, port: number, servername: string): Promise<CertificateProbe> {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername, rejectUnauthorized: false, timeout: 7000 }, () => {
      const cert = socket.getPeerCertificate()
      const validTo = cert.valid_to ? new Date(cert.valid_to) : null
      const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86_400_000) : undefined
      const subjectValue = cert.subject?.CN || cert.subject?.O || ''
      const issuerValue = cert.issuer?.CN || cert.issuer?.O || ''
      resolve({
        host: servername, port,
        ok: Boolean(cert.raw && daysLeft !== undefined && daysLeft >= 0 && socket.authorized),
        authorized: socket.authorized,
        subject: Array.isArray(subjectValue) ? subjectValue.join(', ') : subjectValue,
        issuer: Array.isArray(issuerValue) ? issuerValue.join(', ') : issuerValue,
        validFrom: cert.valid_from, validTo: cert.valid_to, daysLeft, fingerprint: cert.fingerprint256,
        ...(!socket.authorized && socket.authorizationError ? { error: String(socket.authorizationError) } : {}),
      })
      socket.end()
    })
    socket.once('timeout', () => socket.destroy(new Error('连接超时')))
    socket.once('error', (error) => resolve({ host: servername, port, ok: false, error: error.message }))
  })
}

export function checkTcpPort(host: string, port: number, timeoutMs = 3000): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const finish = (result: { ok: boolean; error?: string }) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs, () => finish({ ok: false, error: '连接超时' }))
    socket.once('connect', () => finish({ ok: true }))
    socket.once('error', (error) => finish({ ok: false, error: error.message }))
  })
}
