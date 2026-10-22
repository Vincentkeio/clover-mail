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
import { getTranslator } from '@/lib/i18n/server'
import { hasTrustedOrigin } from '@/lib/request-origin'

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
  const t = await getTranslator()
  const job = new URL(req.url).searchParams.get('job') ?? ''
  if (!validJob(job)) return NextResponse.json({ error: t('apiSystem.migration.invalidJob') }, { status: 400 })
  try {
    const { stdout } = await execFileAsync('docker', ['exec', config.migrationHelperContainer, 'cat', `/clover/backups/migration-${job}.status`], { timeout: 10_000, maxBuffer: 8_000, encoding: 'utf8' })
    const [state, message] = stdout.trim().split('|')
    return NextResponse.json({ state, message }, { headers: { 'Cache-Control': 'no-store' } })
  } catch { return NextResponse.json({ state: 'queued', message: t('apiSystem.migration.starting') }, { headers: { 'Cache-Control': 'no-store' } }) }
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  if (!hasTrustedOrigin(req.headers, req.url)) return NextResponse.json({ error: t('apiSystem.migration.badOrigin') }, { status: 403 })
  if (req.headers.get('x-clover-confirm') !== 'RESTORE') return NextResponse.json({ error: t('apiSystem.migration.confirmRequired') }, { status: 400 })
  const encodedPassphrase = req.headers.get('x-clover-migration-passphrase') ?? ''
  let passphrase = ''
  try { passphrase = Buffer.from(encodedPassphrase, 'base64').toString('utf8') } catch { /* Validate below. */ }
  if (passphrase.length < 12 || passphrase.length > 256) return NextResponse.json({ error: t('apiSystem.migration.passphraseLength') }, { status: 400 })
  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_PACKAGE_BYTES) return NextResponse.json({ error: t('apiSystem.migration.packageTooLarge') }, { status: 413 })
  if (!req.body) return NextResponse.json({ error: t('apiSystem.migration.packageEmpty') }, { status: 400 })

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
      if (total > MAX_PACKAGE_BYTES) { callback(new Error(t('apiSystem.migration.packageTooLarge'))); return }
      callback(null, chunk)
    } })
    await pipeline(Readable.from(upload()), limiter, createWriteStream(encryptedPath, { mode: 0o600, flags: 'wx' }))
    if (total < HEADER_BYTES + 16) throw new Error(t('apiSystem.migration.packageIncomplete'))
    const fd = openSync(encryptedPath, 'r')
    let tag: Buffer
    try {
      const headerLength = readSync(fd, header, 0, header.length, 0)
      if (headerLength !== header.length) throw new Error(t('apiSystem.migration.packageIncomplete'))
      tag = Buffer.alloc(16)
      readSync(fd, tag, 0, tag.length, total - 16)
    } finally { closeSync(fd) }
    if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(t('apiSystem.migration.notCloverPackage'))
    const salt = header.subarray(MAGIC.length, MAGIC.length + 16)
    const iv = header.subarray(MAGIC.length + 16, HEADER_BYTES)
    const key = await scrypt(passphrase, salt, 32) as Buffer
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    await pipeline(createReadStream(encryptedPath, { start: HEADER_BYTES, end: total - 17 }), decipher, createWriteStream(archivePath, { mode: 0o600, flags: 'wx' }))

    const listing = await execFileAsync('tar', ['--quoting-style=escape', '-tzf', archivePath], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' })
    const entries = listing.stdout.split(/\r?\n/).filter(Boolean)
    if (!entries.length || entries.some((entry) => entry.startsWith('/') || entry.includes('\\') || entry.split('/').some((part) => part === '..') || /[\r\n\0]/.test(entry))) throw new Error(t('apiSystem.migration.invalidPath'))
    const types = await execFileAsync('tar', ['--quoting-style=escape', '-tvzf', archivePath], { timeout: 120_000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' })
    if (types.stdout.split(/\r?\n/).filter(Boolean).some((line) => !['-', 'd'].includes(line[0]))) throw new Error(t('apiSystem.migration.linkRejected'))
    const required = ['manifest.json', 'config/project/.env', 'config/project/compose.yaml', 'volumes/panel-data/clover.db', ...VOLUMES.map((volume) => `volumes/${volume}/`)]
    for (const item of required) if (!entries.some((entry) => entry.replace(/^\.\//, '') === item || entry.replace(/^\.\//, '').startsWith(item))) throw new Error(t('apiSystem.migration.missingItem', { item }))
    const manifestResult = await execFileAsync('tar', ['-xOzf', archivePath, './manifest.json'], { timeout: 15_000, maxBuffer: 64 * 1024, encoding: 'utf8' })
    const manifest = JSON.parse(manifestResult.stdout) as { format?: string; volumes?: unknown }
    const manifestVolumes = Array.isArray(manifest.volumes) ? manifest.volumes as unknown[] : []
    if (manifest.format !== 'clover-migration-v1' || !['panel-data', ...VOLUMES].every((name) => manifestVolumes.includes(name))) throw new Error(t('apiSystem.migration.manifestInvalid'))

    await execFileAsync('docker', ['cp', archivePath, `${config.migrationHelperContainer}:/clover/backups/migration-${id}.tar.gz`], { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 })
    await execFileAsync('docker', ['exec', config.migrationHelperContainer, 'sh', '-c', `printf '%s\\n' 'queued|${t('apiSystem.migration.queued')}' > /clover/backups/migration-${id}.status`], { timeout: 10_000 })
    await execFileAsync('docker', ['exec', '-d', config.migrationHelperContainer, 'sh', '/clover/scripts/migration-restore.sh', id], { timeout: 10_000 })
    await audit(admin.username, 'system.migration.import', undefined, { bytes: total })
    return NextResponse.json({ ok: true, job: id, message: t('apiSystem.migration.restoreStarted') }, { status: 202 })
  } catch (error) {
    return NextResponse.json({ error: t('apiSystem.migration.importFailed', { error: error instanceof Error ? error.message : String(error) }) }, { status: 400 })
  } finally { rmSync(localDir, { recursive: true, force: true }) }
}
