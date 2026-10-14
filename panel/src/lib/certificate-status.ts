import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

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

async function ensureHelperRunning(): Promise<void> {
  let running: boolean
  try {
    running = await helperIsRunning()
  } catch (error) {
    const detail = commandError(error)
    if (/no such (?:object|container)/i.test(detail)) {
      throw new Error('证书助手容器不存在。请通过服务更新或修复重新创建 certificate-helper。')
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
    throw new Error('证书助手已停止，自动启动失败。请查看 clover-certificate-helper 容器日志。')
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      if (await helperIsRunning()) return
    } catch { /* Compose may be recreating the container */ }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('证书助手启动后仍未运行。请查看 clover-certificate-helper 容器日志。')
}

export async function readCertificateHelperStatus(): Promise<CertificateHelperStatus> {
  await ensureHelperRunning()
  try {
    const { stdout } = await execFileAsync('docker', [
      'exec', HELPER_CONTAINER, 'python3', '/app/certificates.py', 'status',
    ], { timeout: 20_000, maxBuffer: 1024 * 1024 })
    return JSON.parse(stdout.trim()) as CertificateHelperStatus
  } catch (error) {
    if (/container .* is not running/i.test(commandError(error))) {
      throw new Error('证书助手在读取状态时停止了，请刷新后重试；若仍失败，请查看容器日志。')
    }
    throw error
  }
}
