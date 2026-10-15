import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { sqlite } from '@/db'
import { closeDatabase, databasePath } from '@/db'
import { config } from '@/lib/config'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { spawn } from 'node:child_process'

const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300
const MAX_CONFIG_IMPORT_BYTES = 128 * 1024 * 1024
const MAX_DATABASE_IMPORT_BYTES = 64 * 1024 * 1024
const REQUIRED_TABLES = ['admins', 'domains', 'mailboxes', 'routing_rules', 'dns_records', 'settings', 'audit_logs', 'api_tokens']

/**
 * 一致性备份下载（M5）：
 * - what=db         → SQLite VACUUM INTO 快照（WAL 下也安全）
 * - what=dms-config → DMS 配置目录 tar（账号库、DKIM 私钥、SSL、master user 等）
 * 真机上配合 scripts/backup.sh 定时拉取；恢复见 README「备份与恢复」。
 */
export async function GET(req: Request) {
  const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''
  const reconcileToken = process.env.RECONCILE_TOKEN ?? ''
  const reconcileAuthorized = Boolean(
    bearer && reconcileToken && Buffer.byteLength(bearer) === Buffer.byteLength(reconcileToken)
      && timingSafeEqual(Buffer.from(bearer), Buffer.from(reconcileToken)),
  )
  const admin = reconcileAuthorized ? { id: 0, username: 'backup' } : await getCurrentAdmin()
  if (!admin) return unauthorized()

  const what = new URL(req.url).searchParams.get('what') ?? 'db'
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')

  if (what === 'db') {
    const dir = mkdtempSync(join(tmpdir(), 'clover-backup-'))
    const file = join(dir, `clover-${stamp}.db`)
    try {
      sqlite.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
      const buf = readFileSync(file)
      await audit(admin.username, 'system.backup', 'db', { bytes: buf.length })
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/vnd.sqlite3',
          'Content-Disposition': `attachment; filename="clover-${stamp}.db"`,
          'Content-Length': String(buf.length),
        },
      })
    } catch (err) {
      return NextResponse.json({ error: `备份失败: ${err instanceof Error ? err.message : err}` }, { status: 500 })
    } finally {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* 临时文件清理失败不影响响应 */
      }
    }
  }

  if (what === 'dms-config') {
    try {
      const { stdout } = await execFileAsync(
        'docker',
        ['exec', config.dmsContainer, 'tar', 'czf', '-', '-C', '/tmp/docker-mailserver', '.'],
        { timeout: 60_000, maxBuffer: 128 * 1024 * 1024, encoding: 'buffer' as never },
      )
      const buf = stdout as unknown as Buffer
      await audit(admin.username, 'system.backup', 'dms-config', { bytes: buf.length })
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/gzip',
          'Content-Disposition': `attachment; filename="dms-config-${stamp}.tar.gz"`,
          'Content-Length': String(buf.length),
        },
      })
    } catch (err) {
      return NextResponse.json(
        { error: `DMS 配置备份失败（docker 不可用？）: ${err instanceof Error ? err.message : err}` },
        { status: 502 },
      )
    }
  }

  return NextResponse.json({ error: 'what 仅支持 db | dms-config' }, { status: 400 })
}

async function validateConfigArchive(path: string) {
  const listing = await execFileAsync('tar', ['--quoting-style=escape', '-tzf', path], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean)
  if (!entries.length || entries.some((entry) => entry.startsWith('/') || entry.includes('\\') || entry.split('/').some((part) => part === '..') || /[\r\n\0]/.test(entry))) {
    throw new Error('邮件配置归档目录结构无效。')
  }
  const types = await execFileAsync('tar', ['--quoting-style=escape', '-tvzf', path], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })
  if (types.stdout.split(/\r?\n/).filter(Boolean).some((line) => !['-', 'd'].includes(line[0]))) {
    throw new Error('邮件配置归档包含链接或特殊文件，已拒绝导入。')
  }
}

async function importDatabase(file: File, admin: { id: number; username: string }) {
  if (!file.name.toLowerCase().endsWith('.db') || file.size < 1 || file.size > MAX_DATABASE_IMPORT_BYTES) {
    return NextResponse.json({ error: '请选择有效的 .db 文件（最大 64 MiB）。' }, { status: 413 })
  }
  const dir = mkdtempSync(join(dirname(databasePath), '.clover-db-import-'))
  const staged = join(dir, 'import.db')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rollback = `${databasePath}.before-import-${stamp}`
  let closed = false
  let movedCurrent = false
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(staged, { mode: 0o600, flags: 'wx' }))
    let check: InstanceType<typeof Database> | undefined
    try {
      check = new Database(staged, { readonly: true, fileMustExist: true })
      const result = check.pragma('quick_check') as Array<{ quick_check?: string }>
      const tables = new Set((check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name))
      if (result.length !== 1 || result[0]?.quick_check !== 'ok' || REQUIRED_TABLES.some((table) => !tables.has(table))) {
        return NextResponse.json({ error: '数据库校验失败，文件不是可用的 Clover 面板数据库。' }, { status: 400 })
      }
    } catch (error) {
      return NextResponse.json({ error: `数据库校验失败，无法读取 SQLite 文件：${error instanceof Error ? error.message : String(error)}` }, { status: 400 })
    } finally { check?.close() }

    await audit(admin.username, 'system.backup.import', 'db', { bytes: file.size })
    await sqlite.backup(rollback)
    chmodSync(rollback, 0o600)
    closeDatabase()
    closed = true
    renameSync(databasePath, `${databasePath}.replaced-${stamp}`)
    movedCurrent = true
    renameSync(staged, databasePath)
    chmodSync(databasePath, 0o600)
    const child = spawn('docker', ['restart', '--time', '20', config.panelContainer], { detached: true, stdio: 'ignore' })
    child.unref()
    return NextResponse.json({ ok: true, restarting: true, message: '数据库已导入，面板正在重启。' }, { status: 202 })
  } catch (error) {
    if (closed && movedCurrent) {
      try {
        rmSync(databasePath, { force: true })
        renameSync(`${databasePath}.replaced-${stamp}`, databasePath)
        const child = spawn('docker', ['restart', '--time', '20', config.panelContainer], { detached: true, stdio: 'ignore' })
        child.unref()
      } catch { /* Keep the rollback copy for manual recovery. */ }
    }
    return NextResponse.json({ error: `数据库导入失败：${error instanceof Error ? error.message : String(error)}` }, { status: 500 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

async function importDmsConfig(file: File, admin: { id: number; username: string }) {
  if (!file.name.toLowerCase().endsWith('.tar.gz') || file.size < 1 || file.size > MAX_CONFIG_IMPORT_BYTES) {
    return NextResponse.json({ error: '请选择邮件配置 .tar.gz 归档（最大 128 MiB）。' }, { status: 413 })
  }
  const dir = mkdtempSync(join(tmpdir(), 'clover-config-import-'))
  const archive = join(dir, 'dms-config.tar.gz')
  const previous = join(dir, 'dms-config-before.tar.gz')
  const token = randomUUID().replaceAll('-', '')
  const remoteDir = `/tmp/clover-config-import-${token}`
  const dms = config.dmsContainer
  const execDms = (args: string[], timeout = 60_000) => execFileAsync('docker', ['exec', dms, ...args], { timeout, maxBuffer: 16 * 1024 * 1024 })
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(archive, { mode: 0o600, flags: 'wx' }))
    try { await validateConfigArchive(archive) } catch (error) {
      return NextResponse.json({ error: `邮件配置归档校验失败：${error instanceof Error ? error.message : String(error)}` }, { status: 400 })
    }
    await execFileAsync('docker', ['exec', dms, 'mkdir', '-p', remoteDir], { timeout: 15_000 })
    await execFileAsync('docker', ['exec', dms, 'tar', 'czf', `${remoteDir}/previous.tar.gz`, '-C', '/tmp/docker-mailserver', '.'], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    await execFileAsync('docker', ['cp', `${dms}:${remoteDir}/previous.tar.gz`, previous], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    await execFileAsync('docker', ['cp', archive, `${dms}:${remoteDir}/import.tar.gz`], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    const remoteArchive = `${remoteDir}/import.tar.gz`
    await execDms(['mkdir', '-p', `${remoteDir}/stage`])
    await execDms(['tar', '-xzf', remoteArchive, '-C', `${remoteDir}/stage`], 120_000)
    const script = `set -eu; dest=/tmp/docker-mailserver; stage=${remoteDir}/stage; backup=${remoteDir}/rollback; mkdir -p "$backup"; cp -a "$dest/." "$backup/"; find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; if ! cp -a "$stage/." "$dest/"; then find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; cp -a "$backup/." "$dest/"; exit 1; fi`
    await execDms(['sh', '-ec', script], 120_000)
    await audit(admin.username, 'system.backup.import', 'dms-config', { bytes: file.size })
    await execFileAsync('docker', ['restart', dms], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
    await execDms(['rm', '-rf', remoteDir]).catch(() => undefined)
    return NextResponse.json({ ok: true, message: '邮件服务配置已导入，邮件服务已重启。' })
  } catch (error) {
    try {
      if (existsSync(previous) && statSync(previous).size > 0) {
        await execFileAsync('docker', ['start', dms], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 }).catch(() => undefined)
        await execFileAsync('docker', ['cp', previous, `${dms}:${remoteDir}/rollback.tar.gz`], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
        const rollbackScript = `set -eu; dest=/tmp/docker-mailserver; find "$dest" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +; tar -xzf ${remoteDir}/rollback.tar.gz -C "$dest"`
        await execDms(['sh', '-ec', rollbackScript], 120_000)
        await execFileAsync('docker', ['restart', dms], { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 })
      }
    } catch { /* Keep service and archive state available for manual recovery. */ }
    await execDms(['rm', '-rf', remoteDir]).catch(() => undefined)
    return NextResponse.json({ error: `邮件配置导入失败：${error instanceof Error ? error.message : String(error)}` }, { status: 502 })
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

export async function POST(req: Request) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const origin = req.headers.get('origin')
  const requestHost = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host
  if (origin && new URL(origin).host !== requestHost) return NextResponse.json({ error: '请求来源无效。' }, { status: 403 })
  const what = new URL(req.url).searchParams.get('what')
  if (what !== 'db' && what !== 'dms-config') return NextResponse.json({ error: 'what 仅支持 db | dms-config' }, { status: 400 })
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择要导入的备份文件。' }, { status: 400 })
  return what === 'db' ? importDatabase(file, admin) : importDmsConfig(file, admin)
}
