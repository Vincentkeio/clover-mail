import 'server-only'
import { randomUUID } from 'node:crypto'
import { ImapFlow, type ListResponse } from 'imapflow'
import { simpleParser } from 'mailparser'
import nodemailer from 'nodemailer'
import { and, desc, eq } from 'drizzle-orm'
import { db } from '@/db'
import { auditLogs, mailboxes } from '@/db/schema'
import { ensureWebmailMaster } from './webmail-master'
import { sanitizeMailHtml } from './webmail-html'
import { getGlobalMailSettings } from './settings'

export type WebmailFolder = { path: string; name: string; specialUse?: string; messages: number; unseen: number }
export type WebmailSendAttempt = {
  id: number
  status: 'accepted' | 'failed'
  messageId: string
  to: string
  subject: string
  error: string
  createdAt: string
}

function getMailHost() {
  return (process.env.MAIL_HOSTNAME || process.env.MAIL_FQDN || process.env.DMS_CONTAINER || 'docker-mailserver')
    .trim().replace(/\.$/, '').toLowerCase()
}

type MailboxPolicy = { login: string; active: boolean } & Awaited<ReturnType<typeof getGlobalMailSettings>>

async function getMailboxPolicy(login: string): Promise<MailboxPolicy> {
  const normalized = login.trim().toLowerCase()
  const [[box], globalSettings] = await Promise.all([
    db.select({ login: mailboxes.login, active: mailboxes.active })
      .from(mailboxes).where(eq(mailboxes.login, normalized)).limit(1),
    getGlobalMailSettings(),
  ])
  if (!box || !box.active) throw new Error('邮箱不存在或已停用。')
  return { ...box, ...globalSettings }
}

export async function getWebmailPolicy(login: string) {
  return getMailboxPolicy(login)
}

async function assertActiveMailbox(login: string) {
  return (await getMailboxPolicy(login)).login
}

async function createImap(login: string) {
  const policy = await getMailboxPolicy(login)
  if (!policy.allowImap) throw new Error('全局邮箱设置已关闭 IMAP，Webmail 也无法连接。')
  const mailLogin = policy.login
  const { masterUser, masterPassword } = await ensureWebmailMaster()
  const host = getMailHost()
  const client = new ImapFlow({
    host: process.env.CLOVER_DMS_HOST || 'docker-mailserver',
    port: 993,
    secure: true,
    auth: { user: `${mailLogin}*${masterUser}`, pass: masterPassword },
    tls: { servername: host, minVersion: 'TLSv1.2' },
    logger: false,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
  })
  await client.connect()
  return { client, login: mailLogin, masterUser, masterPassword, host, policy }
}

async function withImapReadRetry<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/(?:unexpected close|(?:socket|connection).*(?:closed|reset|timed? ?out)|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT)/i.test(message)) {
      throw error
    }
    // Dovecot may close an IMAP session during a restart or brief load spike.
    // Retry read-only listing once with a fresh connection; never retry mutations.
    await new Promise((resolve) => setTimeout(resolve, 250))
    try {
      return await operation()
    } catch (retryError) {
      const reason = retryError && typeof retryError === 'object' && 'reason' in retryError
        ? String(retryError.reason || '') : ''
      if (/unexpected close/i.test(retryError instanceof Error ? retryError.message : String(retryError))) {
        throw new Error(reason
          ? `邮件服务关闭了 IMAP 连接：${reason}`
          : '邮件服务提前关闭了 IMAP 连接，已自动重试仍未恢复。请刷新；若持续发生，请检查 Dovecot 日志。')
      }
      throw retryError
    }
  }
}

function labelKeyword(label: string) {
  const normalized = label.trim().normalize('NFKC').slice(0, 40)
  if (!normalized) throw new Error('标签名称不能为空。')
  return `clover-label-${Buffer.from(normalized, 'utf8').toString('hex')}`
}

function labelsFromFlags(flags: Set<string> | undefined) {
  return [...(flags || [])].flatMap((flag) => {
    const match = /^clover-label-([\da-f]+)$/i.exec(flag)
    if (!match || match[1].length % 2) return []
    try { return [Buffer.from(match[1], 'hex').toString('utf8')] } catch { return [] }
  })
}

function isExecutableAttachment(filename: string, contentType = '') {
  return /\.(?:ade|adp|apk|app|appx|bat|bin|cab|cmd|com|cpl|dll|dmg|exe|hta|img|ins|iso|isp|jar|js|jse|lnk|msi|msp|mst|pif|ps1|psm1|reg|scr|sct|sh|shb|sys|vb|vbe|vbs|wsf|wsh|xll)$/i.test(filename)
    || /^application\/(?:x-msdownload|x-executable|x-dosexec|x-sh|x-shellscript)$/i.test(contentType)
}

function assertWebmailMessageWithinLimit(size: number, maxAttachmentMb: number) {
  if (maxAttachmentMb === 0) return
  // Match the global Postfix cap: allow base64 expansion, MIME wrapping, headers and body.
  const messageLimitBytes = Math.ceil((maxAttachmentMb * 1.4 + 10) * 1024 * 1024)
  if (size > messageLimitBytes) {
    throw new Error(`邮件超过 Webmail 当前可处理上限（完整邮件约 ${Math.ceil(messageLimitBytes / (1024 * 1024))} MiB）。`)
  }
}

function folderName(path: string) {
  const last = path.split(/[/.]/).filter(Boolean).at(-1) || path
  return last === 'INBOX' ? '收件箱' : last
}

function normalizeFolder(item: ListResponse): Omit<WebmailFolder, 'messages' | 'unseen'> {
  const labels: Record<string, string> = {
    '\\inbox': '收件箱', '\\sent': '已发送', '\\drafts': '草稿',
    '\\trash': '已删除', '\\junk': '垃圾邮件', '\\archive': '归档',
  }
  return { path: item.path, name: labels[item.specialUse?.toLowerCase() || ''] || folderName(item.path), specialUse: item.specialUse || undefined }
}

async function appendSentCopy(login: string, rawMessage: Buffer, date: Date) {
  const { client } = await createImap(login)
  try {
    const folders = await client.list()
    const sent = folders.find((item) => item.specialUse?.toLowerCase() === '\\sent')
      || folders.find((item) => /^(sent|sent mail|sent items)$/i.test(item.name))
    const path = sent?.path || 'Sent'
    if (!sent) await client.mailboxCreate(path).catch(() => undefined)
    const result = await client.append(path, rawMessage, ['\\Seen'], date)
    if (!result) return false
    return true
  } finally {
    await client.logout().catch(() => undefined)
  }
}

export async function listFolders(login: string) {
  return withImapReadRetry(async () => {
    const { client } = await createImap(login)
    try {
      const folders = (await client.list({ statusQuery: { messages: true, unseen: true } })).map((item) => ({
        ...normalizeFolder(item),
        messages: item.status?.messages ?? 0,
        unseen: item.status?.unseen ?? 0,
      }))
      if (!folders.some((folder) => folder.path.toUpperCase() === 'INBOX')) {
        folders.unshift({ path: 'INBOX', name: '收件箱', messages: 0, unseen: 0 })
      }
      return folders
    } finally {
      await client.logout().catch(() => undefined)
    }
  })
}

function addresses(value: Array<{ name?: string | null; address?: string | null }> | undefined): string[] {
  if (!Array.isArray(value)) return []
  return value.map((entry: { name?: string | null; address?: string | null }) =>
    entry.name ? `${entry.name} <${entry.address || ''}>` : entry.address || '',
  ).filter(Boolean)
}

type MailSearch = { query?: string; limit?: number }

function buildSearchCriteria(query: string) {
  const criteria: Record<string, unknown> = {}
  const terms: string[] = []
  const tokens = query.match(/(?:[a-z]+:"[^"]+"|"[^"]+"|\S+)/gi) || []
  for (const rawToken of tokens) {
    const token = rawToken.replace(/^"|"$/g, '')
    const match = /^(from|to|subject|after|before|is|label):(.+)$/i.exec(token)
    if (!match) { terms.push(token); continue }
    const [, rawField, rawValue] = match
    const value = rawValue.replace(/^"|"$/g, '')
    const field = rawField.toLowerCase()
    if (field === 'from' || field === 'to' || field === 'subject') {
      const current = criteria[field]
      criteria[field] = current ? `${current} ${value}` : value
    } else if (field === 'label') {
      try { criteria.keyword = labelKeyword(value) } catch { terms.push(token) }
    } else if (field === 'is') {
      if (value === 'unread') criteria.unseen = true
      else if (value === 'read') criteria.seen = true
      else if (value === 'starred') criteria.flagged = true
      else if (value === 'unstarred') criteria.unflagged = true
      else terms.push(token)
    } else {
      const date = new Date(`${value}T00:00:00Z`)
      if (!Number.isNaN(date.valueOf())) criteria[field === 'after' ? 'since' : 'before'] = date
      else terms.push(token)
    }
  }
  if (terms.length) criteria.text = terms.join(' ')
  return criteria
}

export async function listMessages(login: string, folder: string, search: MailSearch = {}) {
  return withImapReadRetry(async () => {
    const { client } = await createImap(login)
    let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
    try {
      lock = await client.getMailboxLock(folder)
      const exists = client.mailbox && client.mailbox.exists || 0
      if (!exists) return []
      const query = search.query?.trim().slice(0, 300) || ''
      const cap = Math.max(1, Math.min(search.limit || 100, 500))
      let messages: Awaited<ReturnType<typeof client.fetchAll>>
      if (query) {
        const matched = await client.search(buildSearchCriteria(query) as never, { uid: true })
        if (!matched || matched.length === 0) return []
        const uids = matched.slice(-cap).sort((a, b) => b - a)
        messages = await client.fetchAll(uids.join(','), {
          uid: true, envelope: true, flags: true,
        }, { uid: true })
      } else {
        // Avoid SEARCH ALL returning every UID for large mailboxes. Sequence numbers
        // let IMAP fetch only the newest page without materializing the whole folder.
        const firstSequence = Math.max(1, exists - cap + 1)
        messages = await client.fetchAll(`${firstSequence}:*`, {
          uid: true, envelope: true, flags: true,
        })
      }
      return messages
        .sort((a, b) => (b.uid || 0) - (a.uid || 0))
        .map((message) => ({
          uid: message.uid,
          messageId: message.envelope?.messageId || '',
          date: message.envelope?.date ? new Date(message.envelope.date).toISOString() : null,
          from: addresses(message.envelope?.from).join(', ') || '未知发件人',
          to: addresses(message.envelope?.to).join(', '),
          subject: message.envelope?.subject || '(无主题)',
          unread: !message.flags?.has('\\Seen'),
          starred: Boolean(message.flags?.has('\\Flagged')),
          labels: labelsFromFlags(message.flags),
        }))
    } finally {
      lock?.release()
      await client.logout().catch(() => undefined)
    }
  })
}

export async function listSendAttempts(login: string): Promise<WebmailSendAttempt[]> {
  const normalized = await assertActiveMailbox(login)
  const rows = await db.select({
    id: auditLogs.id,
    detail: auditLogs.detail,
    createdAt: auditLogs.createdAt,
  }).from(auditLogs)
    .where(and(eq(auditLogs.action, 'webmail.message.send'), eq(auditLogs.target, normalized)))
    .orderBy(desc(auditLogs.id))
    .limit(100)

  return rows.flatMap((row) => {
    try {
      const detail = JSON.parse(row.detail || '{}') as Record<string, unknown>
      if (detail.status !== 'accepted' && detail.status !== 'failed') return []
      return [{
        id: row.id,
        status: detail.status,
        messageId: typeof detail.messageId === 'string' ? detail.messageId : '',
        to: typeof detail.to === 'string' ? detail.to : '',
        subject: typeof detail.subject === 'string' ? detail.subject : '(无主题)',
        error: typeof detail.error === 'string' ? detail.error : '',
        createdAt: row.createdAt,
      }]
    } catch {
      return []
    }
  })
}

export async function getMessage(login: string, folder: string, uid: number, loadRemote = false) {
  const { client, policy } = await createImap(login)
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
  try {
    lock = await client.getMailboxLock(folder)
    const summary = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true })
    if (!summary) throw new Error('邮件不存在或已被移动。')
    assertWebmailMessageWithinLimit(summary.size || 0, policy.maxAttachmentMb)
    const message = await client.fetchOne(String(uid), { uid: true, source: true, envelope: true, flags: true }, { uid: true })
    if (!message || !message.source) throw new Error('邮件不存在或已被移动。')
    await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
    const parsed = await simpleParser(message.source)
    const from = parsed.from?.value.map((entry) => entry.name ? `${entry.name} <${entry.address}>` : entry.address).join(', ') || '未知发件人'
    const to = parsed.to && !Array.isArray(parsed.to)
      ? parsed.to.value.map((entry) => entry.name ? `${entry.name} <${entry.address}>` : entry.address).join(', ')
      : ''
    const sourceHtml = typeof parsed.html === 'string' ? parsed.html : ''
    const remoteImages = [...sourceHtml.matchAll(/<img\b[^>]*?src\s*=\s*(["'])(https?:\/\/[^"']+)\1[^>]*>/gi)]
    const trackerCount = remoteImages.filter((match) => /(?:width|height)\s*=\s*["']?1\b/i.test(match[0]) || /display\s*:\s*none/i.test(match[0])).length
    const canLoadRemote = loadRemote && policy.allowExternalImages
    const html = sourceHtml ? sanitizeMailHtml(sourceHtml, { allowRemoteImages: canLoadRemote }) : ''
    const plainText = parsed.text?.trim() || html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    return {
      uid: message.uid,
      from,
      to,
      subject: parsed.subject || message.envelope?.subject || '(无主题)',
      date: parsed.date?.toISOString() || (message.envelope?.date ? new Date(message.envelope.date).toISOString() : null),
      text: plainText,
      html,
      messageId: parsed.messageId || '',
      inReplyTo: parsed.inReplyTo || '',
      references: Array.isArray(parsed.references) ? parsed.references.join(' ') : parsed.references || '',
      starred: Boolean(message.flags?.has('\\Flagged')),
      labels: labelsFromFlags(message.flags),
      allowRemoteImages: policy.allowExternalImages,
      remoteImageCount: remoteImages.length,
      trackerCount,
      authenticationResults: String(parsed.headers.get('authentication-results') || '').slice(0, 1000),
      remoteContentLoaded: canLoadRemote,
      attachments: parsed.attachments.map((attachment, index) => ({
        index,
        filename: attachment.filename || `附件 ${index + 1}`,
        contentType: attachment.contentType || 'application/octet-stream',
        size: attachment.size,
      })),
    }
  } finally {
    lock?.release()
    await client.logout().catch(() => undefined)
  }
}

export async function setMessageUnread(login: string, folder: string, uid: number, unread: boolean) {
  const { client } = await createImap(login)
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
  try {
    lock = await client.getMailboxLock(folder)
    if (unread) await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true })
    else await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true })
  } finally {
    lock?.release()
    await client.logout().catch(() => undefined)
  }
}

export async function setMessageStarred(login: string, folder: string, uid: number, starred: boolean) {
  const { client } = await createImap(login)
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
  try {
    lock = await client.getMailboxLock(folder)
    if (starred) await client.messageFlagsAdd(String(uid), ['\\Flagged'], { uid: true })
    else await client.messageFlagsRemove(String(uid), ['\\Flagged'], { uid: true })
  } finally {
    lock?.release()
    await client.logout().catch(() => undefined)
  }
}

export async function setMessageLabel(login: string, folder: string, uid: number, label: string, enabled: boolean) {
  const { client } = await createImap(login)
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
  try {
    lock = await client.getMailboxLock(folder)
    const keyword = labelKeyword(label)
    if (enabled) await client.messageFlagsAdd(String(uid), [keyword], { uid: true })
    else await client.messageFlagsRemove(String(uid), [keyword], { uid: true })
  } finally {
    lock?.release()
    await client.logout().catch(() => undefined)
  }
}

export async function moveMessage(login: string, folder: string, uid: number, destination: 'trash' | 'junk' | 'inbox') {
  const { client } = await createImap(login)
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
  try {
    lock = await client.getMailboxLock(folder)
    const folders = await client.list()
    const special = destination === 'trash' ? '\\trash' : destination === 'junk' ? '\\junk' : ''
    const names = destination === 'trash' ? /^(trash|deleted items|deleted messages)$/i
      : destination === 'junk' ? /^(junk|spam)$/i : /^inbox$/i
    const target = folders.find((item) => item.specialUse?.toLowerCase() === special)
      || folders.find((item) => names.test(item.name))
    let targetPath = target?.path
    if (!targetPath && (destination === 'trash' || destination === 'junk')) {
      targetPath = destination === 'trash' ? 'Trash' : 'Junk'
      await client.mailboxCreate(targetPath).catch(() => undefined)
    }
    if (!targetPath) throw new Error('找不到目标邮件文件夹。')
    const moved = await client.messageMove(String(uid), targetPath, { uid: true })
    if (!moved) throw new Error('邮件移动失败。')
  } finally {
    lock?.release()
    await client.logout().catch(() => undefined)
  }
}

export async function sendMessage(input: {
  login: string
  to: string
  cc?: string
  subject: string
  text: string
  html?: string
  attachments?: Array<{ filename: string; contentType: string; content: Buffer }>
  inReplyTo?: string
  references?: string
}) {
  const policy = await getMailboxPolicy(input.login)
  if (!policy.allowSmtp) throw new Error('全局邮箱设置已关闭 SMTP 发信。')
  const login = policy.login
  const maxBytes = policy.maxAttachmentMb === 0 ? Number.POSITIVE_INFINITY : policy.maxAttachmentMb * 1024 * 1024
  const totalBytes = input.attachments?.reduce((sum, attachment) => sum + attachment.content.length, 0) || 0
  if (totalBytes > maxBytes) throw new Error(`附件合计超过全局 ${policy.maxAttachmentMb} MB 限制。`)
  if (!policy.allowExecutableAttachments && input.attachments?.some((attachment) => isExecutableAttachment(attachment.filename, attachment.contentType))) {
    throw new Error('全局邮箱设置禁止发送可执行附件。')
  }
  const { masterUser, masterPassword } = await ensureWebmailMaster()
  const host = getMailHost()
  const transporter = nodemailer.createTransport({
    host: process.env.CLOVER_DMS_HOST || 'docker-mailserver',
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: `${login}*${masterUser}`, pass: masterPassword },
    tls: { servername: host, minVersion: 'TLSv1.2' },
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
  })
  try {
    const result = await transporter.sendMail({
      from: login,
      to: input.to,
      cc: input.cc || undefined,
      subject: input.subject,
      text: input.text,
      html: input.html || undefined,
      attachments: input.attachments?.map((attachment) => ({
        filename: attachment.filename,
        contentType: attachment.contentType,
        content: attachment.content,
      })),
      inReplyTo: input.inReplyTo || undefined,
      references: input.references || undefined,
    })
    const date = new Date()
    const attachmentBytes = input.attachments?.reduce((sum, attachment) => sum + attachment.content.length, 0) || 0
    // Building a second, base64-expanded copy of large messages for IMAP Sent would
    // multiply peak memory. SMTP already accepted the message, so skip that copy.
    if (attachmentBytes > 10 * 1024 * 1024) return { messageId: result.messageId, saved: false }
    const encoded = (content: Buffer | string) => Buffer.from(content).toString('base64').replace(/.{1,76}/g, '$&\r\n')
    const encodedBody = encoded(input.text)
    const encodedHtml = input.html ? encoded(input.html) : ''
    const alternativeBoundary = `clover-alternative-${randomUUID()}`
    const mixedBoundary = `clover-mixed-${randomUUID()}`
    const hasAttachments = Boolean(input.attachments?.length)
    const headers = [
      `From: ${login}`,
      `To: ${input.to}`,
      input.cc ? `Cc: ${input.cc}` : '',
      `Subject: =?UTF-8?B?${Buffer.from(input.subject || '').toString('base64')}?=`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: ${result.messageId}`,
      input.inReplyTo ? `In-Reply-To: ${input.inReplyTo}` : '',
      input.references ? `References: ${input.references}` : '',
      'MIME-Version: 1.0',
      hasAttachments ? `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`
        : input.html ? `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"` : 'Content-Type: text/plain; charset=utf-8',
      ...(!hasAttachments && !input.html ? ['Content-Transfer-Encoding: base64'] : []),
    ].filter(Boolean)
    let saved = false
    const alternativeBody = input.html
      ? `--${alternativeBoundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n--${alternativeBoundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedHtml}\r\n--${alternativeBoundary}--\r\n`
      : `Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}\r\n`
    const mimeBody = hasAttachments
      ? `--${mixedBoundary}\r\n${input.html ? `Content-Type: multipart/alternative; boundary="${alternativeBoundary}"\r\n\r\n${alternativeBody}` : alternativeBody}${input.attachments!.map((attachment) => {
        const encodedFilename = encodeURIComponent(attachment.filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
        const fallbackFilename = attachment.filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
        const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(attachment.contentType) ? attachment.contentType : 'application/octet-stream'
        return `--${mixedBoundary}\r\nContent-Type: ${contentType}; name="${fallbackFilename}"; name*=UTF-8''${encodedFilename}\r\nContent-Disposition: attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded(attachment.content)}\r\n`
      }).join('')}--${mixedBoundary}--\r\n`
      : input.html ? alternativeBody : `${encodedBody}\r\n`
    try { saved = await appendSentCopy(login, Buffer.from(`${headers.join('\r\n')}\r\n\r\n${mimeBody}`), date) } catch { /* Sending already succeeded; report the Sent copy separately. */ }
    return { messageId: result.messageId, saved }
  } finally {
    transporter.close()
  }
}

export async function getMessageAttachment(login: string, folder: string, uid: number, index: number) {
  const { client, policy } = await createImap(login)
  let lock: Awaited<ReturnType<typeof client.getMailboxLock>> | undefined
  try {
    lock = await client.getMailboxLock(folder)
    const summary = await client.fetchOne(String(uid), { uid: true, size: true }, { uid: true })
    if (!summary) throw new Error('邮件不存在或已被移动。')
    assertWebmailMessageWithinLimit(summary.size || 0, policy.maxAttachmentMb)
    const message = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true })
    if (!message || !message.source) throw new Error('邮件不存在或已被移动。')
    const parsed = await simpleParser(message.source)
    const totalAttachmentBytes = parsed.attachments.reduce((total, item) => total + item.size, 0)
    if (policy.maxAttachmentMb > 0 && totalAttachmentBytes > policy.maxAttachmentMb * 1024 * 1024) {
      throw new Error(`邮件附件合计超过全局 ${policy.maxAttachmentMb} MB 限制。`)
    }
    const attachment = parsed.attachments[index]
    if (!attachment) throw new Error('附件不存在。')
    if (!policy.allowExecutableAttachments && isExecutableAttachment(attachment.filename || '', attachment.contentType)) {
      throw new Error('全局邮箱设置禁止下载可执行附件。')
    }
    return {
      content: attachment.content,
      filename: attachment.filename || `attachment-${index + 1}`,
      contentType: attachment.contentType || 'application/octet-stream',
    }
  } finally {
    lock?.release()
    await client.logout().catch(() => undefined)
  }
}
