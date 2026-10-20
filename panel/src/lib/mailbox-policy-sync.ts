import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { db } from '@/db'
import { domains, mailboxes } from '@/db/schema'
import { eq } from 'drizzle-orm'
import { config } from './config'
import { createTranslator, type Translator } from './i18n/translate'
import { getGlobalMailSettings } from './settings'
import { syncRoundcubePolicy } from './roundcube-policy'
import { syncSrsDomains } from './srs-sync'

const execFileAsync = promisify(execFile)

/** 调用方未传 Translator 时的兜底（默认语言）。 */
const fallbackTranslator = createTranslator('en')
const CONFIG_DIR = '/tmp/docker-mailserver'
const DOVECOT_FILE = `${CONFIG_DIR}/dovecot.cf`
const DOVECOT_LIVE_FILE = '/etc/dovecot/local.conf'
const SMTP_MAP = `${CONFIG_DIR}/clover-smtp-deny.cf`
const RECIPIENT_MAP = `${CONFIG_DIR}/clover-domain-deny.cf`
const POLICY_START = '# BEGIN CLOVER MAILBOX POLICY'
const POLICY_END = '# END CLOVER MAILBOX POLICY'
const SMTP_START = '# BEGIN CLOVER SMTP MAILBOX POLICY'
const SMTP_END = '# END CLOVER SMTP MAILBOX POLICY'

async function docker(args: string[], timeout = 30_000) {
  return execFileAsync('docker', ['exec', config.dmsContainer, ...args], { timeout, maxBuffer: 8 * 1024 * 1024 })
}

async function containerFile(path: string) {
  try { return (await docker(['cat', path])).stdout }
  catch { return '' }
}

function removeBlock(text: string, start: string, end: string) {
  return text.replace(new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, 'g'), '\n').trimEnd()
}

function buildDovecotConfig(version: string, enabledProtocols: string[]) {
  const modern = /^2\.(?:[4-9]|[1-9]\d)\./.test(version)
  const sections = (['imap', 'pop3', 'sieve'] as const).map((protocol) => {
    const path = `${CONFIG_DIR}/clover-deny-${protocol}.passwd`
    const passdb = modern
      ? `  passdb clover-deny-${protocol} {\n    driver = passwd-file\n    passwd_file_path = ${path}\n    deny = yes\n  }`
      : `  passdb {\n    driver = passwd-file\n    args = scheme=CRYPT username_format=%u ${path}\n    deny = yes\n  }`
    return `protocol ${protocol} {\n${passdb}\n}`
  })
  const base = '# 由 Clover 全局邮箱设置生成；请通过全局邮箱设置修改。\nprotocols = lmtp ' + enabledProtocols.join(' ')
  return [base, POLICY_START, ...sections, POLICY_END, ''].join('\n')
}

function buildSmtpRestriction(base: string) {
  const map = `texthash:${SMTP_MAP}`
  const withoutPrevious = base.split(`check_sasl_access ${map}`).join('').trim().replace(/^,+|,+$/g, '')
  return [`check_sasl_access ${map}`, withoutPrevious].filter(Boolean).join(', ')
}

function buildRecipientRestriction(base: string) {
  const check = `check_recipient_access texthash:${RECIPIENT_MAP}`
  return [check, base.split(check).join('').trim().replace(/^,+|,+$/g, '')].filter(Boolean).join(', ')
}

/** Apply global protocol and message-size settings while retaining per-mailbox active-state denials. */
export async function syncMailboxPolicies(t: Translator = fallbackTranslator) {
  const [rows, domainRows, mailSettings] = await Promise.all([
    db.select({ login: mailboxes.login, active: mailboxes.active, domainActive: domains.active }).from(mailboxes).innerJoin(domains, eq(mailboxes.domainId, domains.id)),
    db.select({ name: domains.name, active: domains.active }).from(domains),
    getGlobalMailSettings(),
  ])
  // Postfix limits the complete MIME message globally. Allow room for base64
  // expansion, line wrapping, headers and the body over the largest mailbox cap.
  // A zero cap means unlimited; Postfix interprets message_size_limit=0 likewise.
  const messageSizeLimitBytes = mailSettings.maxAttachmentMb === 0
    ? 0
    : Math.ceil((mailSettings.maxAttachmentMb * 1.4 + 10) * 1024 * 1024)
  const enabledProtocols = [
    mailSettings.allowImap ? 'imap' : '',
    mailSettings.allowPop3 ? 'pop3' : '',
    mailSettings.allowSieve ? 'sieve' : '',
  ].filter(Boolean)
  const denied = {
    imap: rows.filter((row) => !row.active || !row.domainActive || !mailSettings.allowImap).map((row) => row.login),
    pop3: rows.filter((row) => !row.active || !row.domainActive || !mailSettings.allowPop3).map((row) => row.login),
    sieve: rows.filter((row) => !row.active || !row.domainActive || !mailSettings.allowSieve).map((row) => row.login),
  }
  const smtpDenied = rows.filter((row) => !row.active || !row.domainActive || !mailSettings.allowSmtp).map((row) => `${row.login} REJECT mailbox SMTP access is disabled`)
  const temporary = await mkdtemp(join(tmpdir(), 'clover-mailbox-policy-'))
  try {
    const version = (await docker(['dovecot', '--version'])).stdout.trim()
    const oldDovecot = await containerFile(DOVECOT_FILE)
    const cleanDovecot = removeBlock(oldDovecot.replace(/^\s*protocols\s*=.*$/m, '').trim(), POLICY_START, POLICY_END)
    const dovecot = [cleanDovecot, buildDovecotConfig(version, enabledProtocols)].filter(Boolean).join('\n\n')
    const dovecotLocal = join(temporary, 'dovecot.cf')
    await writeFile(dovecotLocal, dovecot, 'utf8')
    const deniedPaths = (['imap', 'pop3', 'sieve'] as const).map((protocol) => ({
      protocol,
      local: join(temporary, `clover-deny-${protocol}.passwd`),
      content: denied[protocol].map((login) => `${login}::`).join('\n') + '\n',
    }))
    for (const file of deniedPaths) await writeFile(file.local, file.content, 'utf8')
    const smtpMapLocal = join(temporary, 'clover-smtp-deny.cf')
    await writeFile(smtpMapLocal, ['# Generated by Clover mailbox policies', ...smtpDenied].join('\n') + '\n', 'utf8')
    const recipientMapLocal = join(temporary, 'clover-domain-deny.cf')
    await writeFile(recipientMapLocal, ['# Temporarily defer mail for disabled domains', ...domainRows.filter((row) => !row.active).map((row) => `${row.name} 450 Domain temporarily disabled`)].join('\n') + '\n', 'utf8')

    await execFileAsync('docker', ['cp', dovecotLocal, `${config.dmsContainer}:${DOVECOT_FILE}`], { timeout: 15_000 })
    await execFileAsync('docker', ['cp', dovecotLocal, `${config.dmsContainer}:${DOVECOT_LIVE_FILE}`], { timeout: 15_000 })
    for (const file of deniedPaths) await execFileAsync('docker', ['cp', file.local, `${config.dmsContainer}:${CONFIG_DIR}/clover-deny-${file.protocol}.passwd`], { timeout: 15_000 })
    await execFileAsync('docker', ['cp', smtpMapLocal, `${config.dmsContainer}:${SMTP_MAP}`], { timeout: 15_000 })
    await execFileAsync('docker', ['cp', recipientMapLocal, `${config.dmsContainer}:${RECIPIENT_MAP}`], { timeout: 15_000 })
    try {
      await docker(['doveconf', '-n'])
    } catch (error) {
      const restore = join(temporary, 'dovecot-restore.cf')
      await writeFile(restore, oldDovecot, 'utf8')
      await execFileAsync('docker', ['cp', restore, `${config.dmsContainer}:${DOVECOT_FILE}`], { timeout: 15_000 }).catch(() => undefined)
      await execFileAsync('docker', ['cp', restore, `${config.dmsContainer}:${DOVECOT_LIVE_FILE}`], { timeout: 15_000 }).catch(() => undefined)
      throw error
    }
    await docker(['doveadm', 'reload'])

    const existingMain = await containerFile(`${CONFIG_DIR}/postfix-main.cf`)
    const baseMain = removeBlock(existingMain, SMTP_START, SMTP_END)
    const currentRestrictions = (await docker(['postconf', '-h', 'smtpd_sender_restrictions'])).stdout.trim()
    const restriction = buildSmtpRestriction(currentRestrictions)
    // DMS submission/submissions override smtpd_sender_restrictions with
    // $mua_sender_restrictions. Update both or disabled users can still submit.
    const currentMuaRestrictions = (await docker(['postconf', '-h', 'mua_sender_restrictions'])).stdout.trim()
    const muaRestriction = buildSmtpRestriction(currentMuaRestrictions)
    const currentRecipientRestrictions = (await docker(['postconf', '-h', 'smtpd_recipient_restrictions'])).stdout.trim()
    const recipientRestriction = buildRecipientRestriction(currentRecipientRestrictions)
    const smtpMain = [baseMain, SMTP_START, `smtpd_sender_restrictions = ${restriction}`, `mua_sender_restrictions = ${muaRestriction}`, `smtpd_recipient_restrictions = ${recipientRestriction}`, `message_size_limit = ${messageSizeLimitBytes}`, SMTP_END, ''].filter(Boolean).join('\n')
    const smtpMainLocal = join(temporary, 'postfix-main.cf')
    await writeFile(smtpMainLocal, smtpMain, 'utf8')
    await execFileAsync('docker', ['cp', smtpMainLocal, `${config.dmsContainer}:${CONFIG_DIR}/postfix-main.cf`], { timeout: 15_000 })
    await docker(['postconf', '-e', `smtpd_sender_restrictions=${restriction}`])
    await docker(['postconf', '-e', `mua_sender_restrictions=${muaRestriction}`])
    await docker(['postconf', '-e', `smtpd_recipient_restrictions=${recipientRestriction}`])
    await docker(['postconf', '-e', `message_size_limit=${messageSizeLimitBytes}`])
    const appliedLimit = Number((await docker(['postconf', '-h', 'message_size_limit'])).stdout.trim())
    if (appliedLimit !== messageSizeLimitBytes) throw new Error(t('apiErrors.policySync.messageSizeFailed', { expected: messageSizeLimitBytes, applied: appliedLimit }))
    await docker(['postfix', 'reload'])
    await syncRoundcubePolicy()
    const srs = await syncSrsDomains()
    if (!srs.ok) throw new Error(t('apiErrors.policySync.srsFailed', { error: srs.error }))
    return { ok: true as const, messageSizeLimitBytes }
  } catch (error) {
    return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
