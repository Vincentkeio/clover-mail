import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type ManagedCertificate = {
  host: string
  installed: boolean
  daysRemaining: number | null
  validFrom?: string | null
  validTo?: string | null
  issuer?: string
  subject?: string
  fingerprint?: string
}

export type CertificateHelperStatus = {
  mode: string
  autoRenew: boolean
  running?: boolean
  error?: string | null
  message?: string
  updatedAt?: string
  certificates?: { panel?: ManagedCertificate; mail?: ManagedCertificate }
}

export async function readCertificateHelperStatus(): Promise<CertificateHelperStatus> {
  const { stdout } = await execFileAsync('docker', [
    'exec', 'clover-certificate-helper', 'python3', '/app/certificates.py', 'status',
  ], { timeout: 20_000, maxBuffer: 1024 * 1024 })
  return JSON.parse(stdout.trim()) as CertificateHelperStatus
}
