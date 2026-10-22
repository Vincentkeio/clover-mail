import { randomBytes, randomUUID, scrypt as scryptCallback, createCipheriv } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { sqlite } from '@/db'
import { config } from '@/lib/config'
import { getTranslator } from '@/lib/i18n/server'
import { hasTrustedOrigin } from '@/lib/request-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

const execFileAsync = promisify(execFile)
const scrypt = promisify(scryptCallback)
const MAGIC = Buffer.from('CLOVER-MIGRATION-V1\n', 'ascii')

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  if (!hasTrustedOrigin(req.headers, req.url)) return NextResponse.json({ error: t('apiSystem.migration.badOrigin') }, { status: 403 })
  const form = await req.formData().catch(() => null)
  const passphrase = String(form?.get('passphrase') ?? '')
  if (passphrase.length < 12 || passphrase.length > 256) return NextResponse.json({ error: t('apiSystem.migration.passphraseLength') }, { status: 400 })

  const id = randomUUID().replaceAll('-', '')
  const localDir = mkdtempSync(join(tmpdir(), 'clover-migration-export-'))
  const snapshot = join(localDir, 'clover.db')
  const helperSnapshot = `/tmp/clover-migration-${id}.db`
  try {
    await sqlite.backup(snapshot)
    chmodSync(snapshot, 0o600)
    await execFileAsync('docker', ['cp', snapshot, `${config.migrationHelperContainer}:${helperSnapshot}`], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    rmSync(localDir, { recursive: true, force: true })
    return NextResponse.json({ error: t('apiSystem.migration.prepareFailed', { error: error instanceof Error ? error.message : String(error) }) }, { status: 502 })
  }

  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await scrypt(passphrase, salt, 32) as Buffer
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const child = spawn('docker', ['exec', config.migrationHelperContainer, 'sh', '/clover/scripts/migration-export.sh', id], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })

  const completion = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once('error', (error) => resolve({ code: null, error }))
    child.once('close', (code) => resolve({ code }))
  })
  const download = async function* () {
    try {
      yield Buffer.concat([MAGIC, salt, iv])
      for await (const chunk of child.stdout) {
        const encrypted = cipher.update(chunk as Buffer)
        if (encrypted.length) yield encrypted
      }
      const result = await completion
      if (result.error || result.code !== 0) throw result.error || new Error(stderr || t('apiSystem.migration.exportFailed', { code: String(result.code) }))
      const last = cipher.final()
      if (last.length) yield last
      yield cipher.getAuthTag()
      await audit(admin.username, 'system.migration.export', undefined, {}).catch(() => undefined)
    } finally {
      if (child.exitCode === null) child.kill('SIGTERM')
      rmSync(localDir, { recursive: true, force: true })
      void execFileAsync('docker', ['exec', config.migrationHelperContainer, 'rm', '-f', helperSnapshot]).catch(() => undefined)
    }
  }
  const body = Readable.toWeb(Readable.from(download())) as ReadableStream<Uint8Array>

  return new Response(body, { headers: {
    'Content-Type': 'application/vnd.clover.migration',
    'Content-Disposition': `attachment; filename="clover-migration-${new Date().toISOString().slice(0, 10)}.clover"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}
