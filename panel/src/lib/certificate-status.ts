import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

const execFileAsync = promisify(execFile)
const HELPER_CONTAINER = 'clover-certificate-helper'

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

function commandError(error: unknown): string {
  if (error && typeof error === 'object') {
    const detail = error as { stderr?: string; stdout?: string; message?: string }
    return detail.stderr?.trim() || detail.stdout?.trim() || detail.message || String(error)
  }
  return String(error)
}

async function helperIsRunning(): Promise<boolean> {
  const { stdout } = await execFileAsync('docker', [
    'inspect', '--format={{.State.Running}}', HELPER_CONTAINER,
  ], { timeout: 10_000, maxBuffer: 64 * 1024 })
  return stdout.trim() === 'true'
}

async function ensureHelperRunning(t: Translator): Promise<void> {
  let running: boolean
  try {
    running = await helperIsRunning()
  } catch (error) {
    const detail = commandError(error)
    if (/no such (?:object|container)/i.test(detail)) {
      throw new Error(t('apiSystem.certificateStatus.helperMissing'))
    }
    throw error
  }
  if (running) return

  try {
    await execFileAsync('docker', ['start', HELPER_CONTAINER], {
      timeout: 15_000, maxBuffer: 64 * 1024,
    })
  } catch (error) {
    // A concurrent Compose update may have started or replaced the container.
    try {
      if (await helperIsRunning()) return
    } catch { /* report the actionable start error below */ }
    throw new Error(t('apiSystem.certificateStatus.startFailed'))
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      if (await helperIsRunning()) return
    } catch { /* Compose may be recreating the container */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(t('apiSystem.certificateStatus.notRunning'))
}

export async function readCertificateHelperStatus(t: Translator = createTranslator('en')): Promise<CertificateHelperStatus> {
  await ensureHelperRunning(t)
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec', HELPER_CONTAINER, 'python3', '/app/certificates.py', 'status',
    ], { timeout: 20_000, maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout.trim()) as CertificateHelperStatus
  } catch (error) {
    if (/container .* is not running/i.test(commandError(error))) {
      throw new Error(t('apiSystem.certificateStatus.stoppedWhileReading'))
    }
    throw error
  }
}
