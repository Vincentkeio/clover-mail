import { spawn } from 'node:child_process'
import { createWriteStream, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { db } from '@/db'
import { mailboxes } from '@/db/schema'
import { audit } from '@/lib/audit'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'
import { config } from '@/lib/config'
import { getTranslator } from '@/lib/i18n/server'

const execFileAsync = promisify(execFile)
const MAX_IMPORT_BYTES = 256 * 1024 * 1024
export const dynamic = 'force-dynamic'
export const maxDuration = 300
export const runtime = 'nodejs'

async function findMailbox(id: number) {
  if (!Number.isSafeInteger(id) || id < 1) return null
  const [box] = await db.select({ id: mailboxes.id, login: mailboxes.login }).from(mailboxes).where(eq(mailboxes.id, id)).limit(1)
  return box ?? null
}

async function docker(args: string[], options: { timeout?: number; maxBuffer?: number } = {}) {
  return execFileAsync('docker', ['exec', config.dmsContainer, ...args], {
    timeout: options.timeout ?? 60_000,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    encoding: 'utf8',
  })
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  const box = await findMailbox(Number((await ctx.params).id))
  if (!box) return NextResponse.json({ error: t('apiAuth.mailboxes.notFound') }, { status: 404 })

  const token = crypto.randomUUID().replaceAll('-', '')
  const workDir = `/tmp/clover-mail-export-${token}`
  try {
    await docker(['mkdir', '-p', `${workDir}/Maildir`])
    // Dovecot runs as the unprivileged docker account inside docker-mailserver.
    await docker(['chown', '-R', 'docker:docker', workDir])
    // Dovecot creates a consistent Maildir snapshot and includes all folders and message flags.
    await docker(['doveadm', 'backup', '-u', box.login, `maildir:${workDir}/Maildir`], { timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    await docker(['rm', '-rf', workDir]).catch(() => undefined)
    return NextResponse.json({ error: t('apiAuth.mailArchive.exportFailed', { error: error instanceof Error ? error.message : String(error) }) }, { status: 502 })
  }

  const child = spawn('docker', ['exec', config.dmsContainer, 'tar', '-czf', '-', '-C', `${workDir}/Maildir`, '.'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4000) })
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      child.stdout.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)))
      child.stdout.on('error', (error) => controller.error(error))
      child.on('error', (error) => controller.error(error))
      child.on('close', (code) => {
        if (code === 0) {
          void audit(admin.username, 'mail.archive.export', box.login, {}).catch(() => undefined)
          controller.close()
        } else controller.error(new Error(stderr || t('apiAuth.mailArchive.exportProcessExited', { code: String(code) })))
        void docker(['rm', '-rf', workDir]).catch(() => undefined)
      })
    },
    cancel() { child.kill('SIGTERM'); void docker(['rm', '-rf', workDir]).catch(() => undefined) },
  })
  const filename = `mail-${box.login.replace(/[^a-zA-Z0-9._-]/g, '_')}-${new Date().toISOString().slice(0, 10)}.tar.gz`
  return new Response(body, { headers: {
    'Content-Type': 'application/gzip',
    'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await getCurrentAdmin()
  if (!admin) return unauthorized()
  const t = await getTranslator()
  const box = await findMailbox(Number((await ctx.params).id))
  if (!box) return NextResponse.json({ error: t('apiAuth.mailboxes.notFound') }, { status: 404 })

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  const modeValue = form?.get('mode')
  if (modeValue !== null && modeValue !== 'folder' && modeValue !== 'merge' && modeValue !== 'replace') {
    return NextResponse.json({ error: t('apiAuth.mailArchive.invalidMode') }, { status: 400 })
  }
  const mode = modeValue === 'merge' || modeValue === 'replace' ? modeValue : 'folder'
  if (mode === 'replace' && form?.get('confirmReplace') !== box.login) {
    return NextResponse.json({ error: t('apiAuth.mailArchive.replaceNotConfirmed', { login: box.login }) }, { status: 400 })
  }
  if (!(file instanceof File) || !file.name.toLowerCase().endsWith('.tar.gz')) {
    return NextResponse.json({ error: t('apiAuth.mailArchive.selectArchive') }, { status: 400 })
  }
  if (file.size < 1 || file.size > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: t('apiAuth.mailArchive.fileSize') }, { status: 413 })
  }

  const localDir = mkdtempSync(join(tmpdir(), 'clover-mail-import-'))
  const archivePath = join(localDir, 'mail.tar.gz')
  const token = crypto.randomUUID().replaceAll('-', '')
  const remoteDir = `/tmp/clover-mail-import-${token}`
  const remoteArchive = `${remoteDir}/mail.tar.gz`
  const remoteMaildir = `${remoteDir}/Maildir`
  try {
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(archivePath, { mode: 0o600 }))
    const listed = await execFileAsync('tar', ['--quoting-style=escape', '-tzf', archivePath], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })
    const entries = listed.stdout.split(/\r?\n/).filter(Boolean)
    if (!entries.length || entries.some((entry) => entry.startsWith('/') || entry.includes('\\') || entry.split('/').some((part) => part === '..') || /[\r\n\0]/.test(entry))) {
      return NextResponse.json({ error: t('apiAuth.mailArchive.invalidStructure') }, { status: 400 })
    }
    const types = await execFileAsync('tar', ['--quoting-style=escape', '-tvzf', archivePath], { timeout: 60_000, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' })
    if (types.stdout.split(/\r?\n/).filter(Boolean).some((line) => !['-', 'd'].includes(line[0]))) {
      return NextResponse.json({ error: t('apiAuth.mailArchive.unsupportedEntries') }, { status: 400 })
    }
    if (!entries.some((entry) => /(^|\/)cur\/$/.test(entry)) || !entries.some((entry) => /(^|\/)new\/$/.test(entry))) {
      return NextResponse.json({ error: t('apiAuth.mailArchive.maildirMissing') }, { status: 400 })
    }

    await docker(['mkdir', '-p', `${remoteMaildir}`])
    await execFileAsync('docker', ['cp', archivePath, `${config.dmsContainer}:${remoteArchive}`], { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 })
    await docker(['tar', '--no-same-owner', '--no-same-permissions', '-xzf', remoteArchive, '-C', remoteMaildir], { timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 })
    await docker(['chmod', '-R', 'a+rX', remoteMaildir])
    if (mode === 'replace') {
      // Clear every existing mailbox explicitly. This is destructive, so the UI requires a
      // second confirmation naming the selected address before sending this mode.
      const listedMailboxes = await docker(['doveadm', 'mailbox', 'list', '-u', box.login], { timeout: 60_000 })
      const names = [...new Set(listedMailboxes.stdout.split(/\r?\n/).map((name) => name.trim()).filter(Boolean))]
      for (const name of names) {
        await docker(['doveadm', 'expunge', '-u', box.login, 'mailbox', name, 'all'], { timeout: 5 * 60_000, maxBuffer: 8 * 1024 * 1024 })
      }
    }

    const folder = mode === 'folder' ? `Imported-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12)}` : null
    await docker(['doveadm', 'import', '-u', box.login, `maildir:${remoteMaildir}`, folder ?? '', 'ALL'], { timeout: 15 * 60_000, maxBuffer: 16 * 1024 * 1024 })
    await audit(admin.username, 'mail.archive.import', box.login, { bytes: file.size, mode, folder })
    const message = mode === 'folder'
      ? t('apiAuth.mailArchive.importedToFolder', { folder: String(folder) })
      : mode === 'merge'
        ? t('apiAuth.mailArchive.importedMerged')
        : t('apiAuth.mailArchive.importedReplaced')
    return NextResponse.json({ ok: true, folder, mode, message })
  } catch (error) {
    return NextResponse.json({ error: t('apiAuth.mailArchive.importFailed', { error: error instanceof Error ? error.message : String(error) }) }, { status: 502 })
  } finally {
    await docker(['rm', '-rf', remoteDir]).catch(() => undefined)
    rmSync(localDir, { recursive: true, force: true })
  }
}
