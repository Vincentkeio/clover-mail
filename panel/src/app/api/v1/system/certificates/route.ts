import { NextResponse } from 'next/server'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { readCertificateHelperStatus } from '@/lib/certificate-status'
import { getTranslator } from '@/lib/i18n/server'
import type { Translator } from '@/lib/i18n/translate'

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

async function readStatus(t: Translator) {
  return readCertificateHelperStatus(t)
}

export async function GET() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  try {
    return NextResponse.json(await readStatus(t))
  } catch (error) {
    return NextResponse.json(
      { error: t('apiSystem.certificates.statusReadFailed', { error: errorText(error) }) },
      { status: 503 },
    )
  }
}

export async function POST() {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  try {
    const status = await readStatus(t)
    if (status.mode !== 'nginx') {
      return NextResponse.json({ error: t('apiSystem.certificates.caddyManaged') }, { status: 409 })
    }
    await execFileAsync(
      'docker',
      ['exec', '-d', 'clover-certificate-helper', 'python3', '/app/certificates.py', 'issue', '--force'],
      { timeout: 15_000, maxBuffer: 256 * 1024 },
    )
    return NextResponse.json({ ok: true, running: true, message: t('apiSystem.certificates.taskStarted') })
  } catch (error) {
    return NextResponse.json(
      { error: t('apiSystem.certificates.operationFailed', { error: errorText(error) }) },
      { status: 502 },
    )
  }
}
