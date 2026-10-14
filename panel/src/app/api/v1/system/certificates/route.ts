import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { readCertificateHelperStatus } from '@/lib/certificate-status'

const execFileAsync = promisify(execFile)
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function errorText(error: unknown) {
  if (error && typeof error === 'object') {
    const detail = error as { stderr?: string; stdout?: string; message?: string }
    return detail.stderr?.trim() || detail.stdout?.trim() || detail.message || String(error)
  }
  return String(error)
}

async function readStatus() {
  return readCertificateHelperStatus()
}

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  try {
    return NextResponse.json(await readStatus())
  } catch (error) {
    return NextResponse.json(
      { error: `无法读取证书状态：${errorText(error)}` },
      { status: 503 },
    )
  }
}

export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  try {
    const status = await readStatus()
    if (status.mode !== 'nginx') {
      return NextResponse.json({ error: '当前使用 Caddy 管理面板证书；Caddy 会自动签发和续期。' }, { status: 409 })
    }
    await execFileAsync(
      'docker',
      ['exec', '-d', 'clover-certificate-helper', 'python3', '/app/certificates.py', 'issue', '--force'],
      { timeout: 15_000, maxBuffer: 256 * 1024 },
    )
    return NextResponse.json({ ok: true, running: true, message: '证书任务已启动。' })
  } catch (error) {
    return NextResponse.json(
      { error: `证书操作失败：${errorText(error)}` },
      { status: 502 },
    )
  }
}
