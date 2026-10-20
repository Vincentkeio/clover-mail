import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config'
import { redactSensitiveText } from './redact'

const execFileAsync = promisify(execFile)

const exec = async (args: string[], timeoutMs = 20_000) => {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true as const, stdout, stderr: '' }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }
    // 注意：supervisorctl 在有 STOPPED 进程时**退出码非 0 但仍打印完整状态**（实测 exit=3），
    // 因此这里把 stdout 也带回去，交给调用方按内容判断。
    return {
      ok: false as const,
      error: redactSensitiveText(e.message),
      stdout: typeof e.stdout === 'string' ? redactSensitiveText(e.stdout) : '',
      stderr: typeof e.stderr === 'string' ? redactSensitiveText(e.stderr) : '',
    }
  }
}

export type QueueEntry = {
  queueId: string
  size: string
  arrivalTime: string
  sender: string
  recipients: string[]
  reason?: string
}

export type QueueInfo = {
  reachable: boolean
  empty: boolean
  entries: QueueEntry[]
  error?: string
}

/**
 * Postfix 队列（mailq / postqueue -j 更结构化但 DMS 默认 mailq 可用）。
 * 解析 "queue ID  size  arrival  sender  recipient" 自由文本格式。
 */
export async function readMailQueue(): Promise<QueueInfo> {
  const r = await exec(['exec', config.dmsContainer, 'mailq'])
  if (!r.ok) return { reachable: false, empty: true, entries: [], error: r.error }

  const lines = r.stdout.split('\n').map((l) => l.trimEnd())
  if (lines.length === 0 || /^Mail queue is empty/.test(lines[0])) {
    return { reachable: true, empty: true, entries: [] }
  }

  const entries: QueueEntry[] = []
  let current: QueueEntry | null = null

  for (const line of lines) {
    if (/^[0-9A-F]{6,}\s/.test(line)) {
      // 新条目头：ID SIZE ARRIVAL SENDER
      const m = line.match(/^([0-9A-F]+)\s+(\S+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+)\s+(\S+)/)
      if (current) entries.push(current)
      current = {
        queueId: m?.[1] ?? line.split(/\s+/)[0],
        size: m?.[2] ?? '?',
        arrivalTime: m?.[3] ?? '?',
        sender: m?.[4] ?? '?',
        recipients: [],
      }
    } else if (current && /^\S+@\S+/.test(line.trim())) {
      // 收件人行（可能有多个，缩进续行）
      const rcpt = line.trim().split(/\s+/).pop()
      if (rcpt && rcpt.includes('@')) current.recipients.push(rcpt)
    } else if (current && /\(/.test(line)) {
      current.reason = line.trim().replace(/^\*?\s*/, '')
    }
  }
  if (current) entries.push(current)

  return { reachable: true, empty: entries.length === 0, entries }
}

export type LogLine = { time: string; host: string; service: string; message: string }

/** 邮件日志尾部（/var/log/mail/mail.log，rsyslog 在 DMS 容器内） */
export async function tailMailLog(lines = 150): Promise<{
  reachable: boolean
  lines: LogLine[]
  error?: string
}> {
  const r = await exec(['exec', config.dmsContainer, 'tail', '-n', String(lines), '/var/log/mail/mail.log'])
  if (!r.ok) return { reachable: false, lines: [], error: r.error }

  const parsed: LogLine[] = []
  for (const raw of r.stdout.split('\n')) {
    const line = redactSensitiveText(raw.trim())
    if (!line) continue
    // 形如: Oct 12 09:00:00 host postfix/smtp[123]: message
    const m = line.match(/^(\w{3}\s+\d{1,2}\s+[\d:]{8})\s+(\S+)\s+([\w-]+(?:\[\d+\])?):\s*(.*)$/)
    if (m) parsed.push({ time: m[1], host: m[2], service: m[3], message: m[4] })
    else parsed.push({ time: '', host: '', service: '', message: line })
  }
  return { reachable: true, lines: parsed }
}

/** DMS 服务进程状态（supervisorctl；退出码 3 = 有 STOPPED 进程，属正常返回） */
export async function serviceStatus(): Promise<{ reachable: boolean; services: Array<{ name: string; status: string; detail?: string }> }> {
  const r = await exec(['exec', config.dmsContainer, 'supervisorctl', 'status'], 15_000)
  const output = (r.ok ? r.stdout : `${r.stdout || ''}${r.stderr || ''}`).trim()
  if (!output) return { reachable: false, services: [] }

  const services = output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(\S+)\s+(\S+)\s+(.*)$/)
      return m ? { name: m[1], status: m[2], detail: m[3] } : { name: l, status: '?', detail: '' }
    })
  return { reachable: services.length > 0, services }
}
