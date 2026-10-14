import { NextResponse } from 'next/server'
import { timingSafeEqual } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { audit } from '@/lib/audit'
import { sqlite } from '@/db'
import { config } from '@/lib/config'

const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

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
