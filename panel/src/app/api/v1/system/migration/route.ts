import { createDecipheriv, randomUUID, scrypt as scryptCallback } from 'node:crypto'
import { execFile } from 'node:child_process'
import { createReadStream, createWriteStream, mkdtempSync, openSync, readSync, rmSync, closeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { config } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 900

const execFileAsync = promisify(execFile)
const scrypt = promisify(scryptCallback)
const MAGIC = Buffer.from('CLOVER-MIGRATION-V1\n', 'ascii')
const HEADER_BYTES = MAGIC.length + 16 + 12
const MAX_PACKAGE_BYTES = 100 * 1024 * 1024 * 1024
const VOLUMES = ['mail-data', 'mail-state', 'mail-config', 'roundcube-db', 'roundcube-policy', 'caddy-data', 'caddy-config']

function validJob(value: string) { return /^[a-f0-9]{32}$/.test(value) }

export async function GET(req: Request) {
  if (!await getCurrentAdmin()) return unauthorized()
  const job = new URL(req.url).searchParams.get('job') ?? ''
  if (!validJob(job)) return NextResponse.json({ error: '迁移任务编号无效。' }, { status: 400 })
  try {
    const { stdout } = await execFileAsync('docker', ['exec', config.migrationHelperContainer, 'cat', `/clover/backups/migration-${job}.status`], { timeout: 10_000, maxBuffer: 8_000, encoding: 'utf8' })
    const [state, message] = stdout.trim().split('|')
    return NextResponse.json({ state, message }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ state: 'queued', message: '正在启动恢复任务…' }, { headers: { 'Cache-Control': 'no-store' } }) }
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const origin = req.headers.get('origin')
  const requestHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  if (origin && new URL(origin).host !== requestHost) return NextResponse.json({ error: '请求来源无效。' }, { status: 403 })
  if (req.headers.get('x-clover-confirm') !== 'RESTORE') return NextResponse.json({ error: '请输入确认词后重试。' }, { status: 400 })
  const encodedPassphrase = req.headers.get('x-clover-migration-passphrase') ?? ''
  let passphrase = ''
  try { passphrase = Buffer.from(encodedPassphrase, 'base64').toString('utf8') } catch { /* Validate below. */ }
  if (passphrase.length < 12 || passphrase.length > 256) return NextResponse.json({ error: '迁移口令需为 12 至 256 个字符。' }, { status: 400 })
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_PACKAGE_BYTES) return NextResponse.json({ error: '迁移包超过 100 GiB 上限。' }, { status: 413 })
  if (!req.body) return NextResponse.json({ error: '迁移包内容为空。' }, { status: 400 })

  const id = randomUUID().replaceAll('-', '')
  const localDir = mkdtempSync(join(tmpdir(), 'clover-migration-import-'))
  const encryptedPath = join(localDir, 'upload.clover')
  const archivePath = join(localDir, 'migration.tar.gz')
  let total = 0
  const header = Buffer.alloc(HEADER_BYTES)
  try {
    const upload = async function* () {
      const reader = req.body!.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          yield Buffer.from(value)
        }
      } finally { reader.releaseLock() }
    }
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      if (total > MAX_PACKAGE_BYTES) { callback(new Error('迁移包超过 100 GiB 上限。')); return }
      callback(null, chunk)
    } })
    await pipeline(Readable.from(upload()), limiter, createWriteStream(encryptedPath, { mode: 0o600, flags: 'wx' }))
    if (total < HEADER_BYTES + 16) throw new Error('迁移包格式不完整。')
    const fd = openSync(encryptedPath, 'r')
    let tag: Buffer
    try {
      const headerLength = readSync(fd, header, 0, header.length, 0)
      if (headerLength !== header.length) throw new Error('迁移包格式不完整。')
      tag = Buffer.alloc(16)
      readSync(fd, tag, 0, tag.length, total - 16)
    } finally { closeSync(fd) }
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('文件不是 Clover 加密迁移包。')
    const salt = header.subarray(MAGIC.length, MAGIC.length + 16)
    const iv = header.subarray(MAGIC.length + 16, HEADER_BYTES)
    const key = await scrypt(passphrase, salt, 32) as Buffer
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    await pipeline(createReadStream(encryptedPath, { start: HEADER_BYTES, end: total - 17 }), decipher, createWriteStream(archivePath, { mode: 0o600, flags: 'wx' }))

    const listing = await execFileAsync('tar', ['--quoting-style=escape', '-tzf', archivePath], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' })
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean)
    if (!entries.length || entries.some((entry) => entry.startsWith('/') || entry.includes('\\') || entry.split('/').some((part) => part === '..') || /[\r\n\0]/.test(entry))) throw new Error('迁移包包含无效路径。')
    const types = await execFileAsync('tar', ['--quoting-style=escape', '-tvzf', archivePath], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' })
    if (types.stdout.split(/\r?\n/).filter(Boolean).some((line) => !['-', 'd'].includes(line[0]))) throw new Error('迁移包包含链接或特殊文件，已拒绝恢复。')
    const required = ['manifest.json', 'config/project/.env', 'config/project/compose.yaml', 'volumes/panel-data/clover.db', ...VOLUMES.map((volume) => `volumes/${volume}/`)]
    for (const item of required) if (!entries.some((entry) => entry.replace(/^\.\//, '') === item || entry.replace(/^\.\//, '').startsWith(item))) throw new Error(`迁移包缺少必要内容：${item}`)
    const manifestResult = await execFileAsync('tar', ['-xOzf', archivePath, './manifest.json'], { timeout: 15_000, maxBuffer: 64 * 1024, encoding: 'utf8' })
    const manifest = JSON.parse(manifestResult.stdout) as { format?: string; volumes?: unknown }
    const manifestVolumes = Array.isArray(manifest.volumes) ? manifest.volumes as unknown[] : []
    if (manifest.format !== 'clover-migration-v1' || !['panel-data', ...VOLUMES].every((name) => manifestVolumes.includes(name))) throw new Error('迁移包清单版本或数据卷清单无效。')

    await execFileAsync('docker', ['cp', archivePath, `${config.migrationHelperContainer}:/clover/backups/migration-${id}.tar.gz`], { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
    await execFileAsync('docker', ['exec', config.migrationHelperContainer, 'sh', '-c', `printf '%s\\n' 'queued|等待恢复任务…' > /clover/backups/migration-${id}.status`], { timeout: 10_000 })
    await execFileAsync('docker', ['exec', '-d', config.migrationHelperContainer, 'sh', '/clover/scripts/migration-restore.sh', id], { timeout: 10_000 })
    await audit(admin.username, 'system.migration.import', undefined, { bytes: total })
    return NextResponse.json({ ok: true, job: id, message: '恢复任务已启动。' }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: `迁移包导入失败：${error instanceof Error ? error.message : String(error)}` }, { status: 400 })
  } finally { rmSync(localDir, { recursive: true, force: true }) }
}
