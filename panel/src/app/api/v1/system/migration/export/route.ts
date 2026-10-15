import { randomBytes, randomUUID, scrypt as scryptCallback, createCipheriv } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { Readable } from 'node:stream'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { sqlite } from '@/db'
import { config } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

const execFileAsync = promisify(execFile)
const scrypt = promisify(scryptCallback)
const MAGIC = Buffer.from('CLOVER-MIGRATION-V1\n', 'ascii')

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const origin = req.headers.get('origin')
  const requestHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  if (origin && new URL(origin).host !== requestHost) return NextResponse.json({ error: '请求来源无效。' }, { status: 403 })
  const form = await req.formData().catch(() => null)
  const passphrase = String(form?.get('passphrase') ?? '')
  if (passphrase.length < 12 || passphrase.length > 256) return NextResponse.json({ error: '迁移口令需为 12 至 256 个字符。' }, { status: 400 })

  const id = randomUUID().replaceAll('-', '')
  const localDir = mkdtempSync(join(tmpdir(), 'clover-migration-export-'))
  const snapshot = join(localDir, 'clover.db')
  const helperSnapshot = `/tmp/clover-migration-${id}.db`
  try {
    await sqlite.backup(snapshot)
    await execFileAsync('docker', ['cp', snapshot, `${config.migrationHelperContainer}:${helperSnapshot}`], { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    rmSync(localDir, { recursive: true, force: true })
    return NextResponse.json({ error: `无法准备迁移包：${error instanceof Error ? error.message : String(error)}` }, { status: 502 })
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
      if (result.error || result.code !== 0) throw result.error || new Error(stderr || `迁移导出失败（${result.code}）`)
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
