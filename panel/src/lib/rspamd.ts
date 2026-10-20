import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config'
import { createTranslator, type Translator } from '@/lib/i18n/translate'

const execFileAsync = promisify(execFile)

const exec = async (args: string[], timeoutMs = 15_000) => {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      timeout: timeoutMs,
      maxBuffer: 10 * 1024 * 1024,
    })
    return { ok: true as const, stdout: stdout.trim() }
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string }
    return { ok: false as const, error: e.message, stderr: typeof e.stderr === 'string' ? e.stderr : '' }
  }
}

const dmsContainer = () => config.dmsContainer

/**
 * rspamd HTTP 查询（经 docker exec curl，DMS 单镜像内 rspamd 与 postfix 同容器）。
 * ⚠️ 实机核对（DMS 16）：worker 的 11333 HTTP 端口默认未监听（curl 拒绝连接），
 * 应查 **controller 11334**（返回 JSON，实测 /stat 可得）。端口可用 RSPAMD_URL 覆盖。
 */
const RSPAMD_URL = process.env.RSPAMD_URL ?? 'http://127.0.0.1:11334'

async function rspamdGet(path: string, t: Translator): Promise<{ ok: true; body: string } | { ok: false; error: string }> {
  const r = await exec(['exec', dmsContainer(), 'curl', '-s', '--max-time', '8', `${RSPAMD_URL}/${path}`])
  if (!r.ok) return { ok: false, error: r.error }
  if (!r.stdout.startsWith('{') && !r.stdout.startsWith('[')) {
    const detail = r.stdout.slice(0, 120) || t('apiSystem.spamStats.emptyResponse')
    return { ok: false, error: t('apiSystem.spamStats.abnormalResponse', { detail }) }
  }
  return { ok: true, body: r.stdout }
}

export type RspamdStat = {
  /** /stat 的字段随版本略有差异，统一用索引签名读取 */
  [key: string]: unknown
}

/** 总览统计（/stat）：扫描/拒绝/软拒绝等 */
export async function rspamdStat(t: Translator = createTranslator('en')): Promise<{ ok: boolean; stat: RspamdStat | null; error?: string }> {
  const r = await rspamdGet('stat', t)
  if (!r.ok) return { ok: false, stat: null, error: r.error }
  try {
    return { ok: true, stat: JSON.parse(r.body) as RspamdStat }
  } catch (err) {
    return { ok: false, stat: null, error: String(err) }
  }
}

/** 符号命中 TopN（/symbols → {SYMBOL: {weight, frequency}}） */
export async function rspamdSymbols(topN = 15, t: Translator = createTranslator('en')): Promise<{
  ok: boolean
  symbols: Array<{ name: string; weight: number; frequency: number }>
  error?: string
}> {
  const r = await rspamdGet('symbols', t)
  if (!r.ok) return { ok: false, symbols: [], error: r.error }
  try {
    const raw = JSON.parse(r.body) as Record<string, { weight?: number; frequency?: number }>
    const symbols = Object.entries(raw)
      .map(([name, v]) => ({ name, weight: Number(v.weight ?? 0), frequency: Number(v.frequency ?? 0) }))
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, topN)
    return { ok: true, symbols }
  } catch (err) {
    return { ok: false, symbols: [], error: String(err) }
  }
}

/** 动作分布（/actions） */
export async function rspamdActions(t: Translator = createTranslator('en')): Promise<{ ok: boolean; actions: Record<string, number>; error?: string }> {
  const r = await rspamdGet('actions', t)
  if (!r.ok) return { ok: false, actions: {}, error: r.error }
  try {
    return { ok: true, actions: JSON.parse(r.body) as Record<string, number> }
  } catch (err) {
    return { ok: false, actions: {}, error: String(err) }
  }
}

/** 聚合：一次拿全（页面并行请求时用） */
export async function rspamdOverview(t: Translator = createTranslator('en')) {
  const [stat, symbols, actions] = await Promise.all([rspamdStat(t), rspamdSymbols(15, t), rspamdActions(t)])
  return {
    reachable: stat.ok,
    stat: stat.stat,
    symbols: symbols.symbols,
    actions: actions.actions,
    error: stat.ok ? undefined : stat.error,
  }
}
