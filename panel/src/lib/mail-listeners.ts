import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { checkTcpPort } from './certificate-probe'
import { config } from './config'
import { supervisorStatus } from './dms'
import { createTranslator, type Translator } from './i18n/translate'

const execFileAsync = promisify(execFile)
const ports = [465, 993] as const
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** 调用方未传 Translator 时的兜底（默认语言）。 */
const fallbackTranslator = createTranslator('en')

export type MailListenerCheck = { port: number; ok: boolean; error?: string }
export type MailListenerRepair = {
  ok: boolean
  ports: MailListenerCheck[]
  message: string
}

export async function checkMailListeners(): Promise<MailListenerCheck[]> {
  return Promise.all(ports.map(async (port) => ({ port, ...await checkTcpPort(config.dmsContainer, port) })))
}

async function waitForListeners(timeoutMs: number): Promise<MailListenerCheck[]> {
  const deadline = Date.now() + timeoutMs
  let result = await checkMailListeners()
  while (!result.every((item) => item.ok) && Date.now() < deadline) {
    await delay(2000)
    result = await checkMailListeners()
  }
  return result
}

function summarizeFailures(result: MailListenerCheck[], t: Translator) {
  return result.filter((item) => !item.ok)
    .map((item) => t('apiErrors.listeners.portFailure', { port: item.port, error: item.error || t('apiErrors.listeners.noResponse') }))
    .join(t('apiErrors.dns.listSeparator'))
}

/** Start/restart only the DMS processes behind missing listeners; restart the container as fallback. */
export async function ensureMailListeners(t: Translator = fallbackTranslator): Promise<MailListenerRepair> {
  let result = await waitForListeners(8000)
  if (result.every((item) => item.ok)) {
    return { ok: true, ports: result, message: t('apiErrors.listeners.ok') }
  }

  try {
    const status = await supervisorStatus()
    if (status.ok) {
      for (const service of ['postfix', 'dovecot']) {
        const line = status.stdout.split('\n').find((item) => item.startsWith(`${service} `))
        if (!line) continue
        const action = line.includes(' RUNNING ') ? 'restart' : 'start'
        await execFileAsync('docker', [
          'exec', config.dmsContainer, 'supervisorctl', action, service,
        ], { timeout: 20_000, maxBuffer: 1024 * 1024 })
      }
    }
  } catch {
    // The whole-container restart below is the recovery path if supervisor is unavailable.
  }

  result = await waitForListeners(30_000)
  if (result.every((item) => item.ok)) {
    return { ok: true, ports: result, message: t('apiErrors.listeners.recovered') }
  }

  try {
    await execFileAsync('docker', [
      'restart', '--time', '20', config.dmsContainer,
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 })
    result = await waitForListeners(60_000)
  } catch (error) {
    return {
      ok: false,
      ports: result,
      message: t('apiErrors.listeners.restartFailed', { error: error instanceof Error ? error.message : String(error) }),
    }
  }

  return result.every((item) => item.ok)
    ? { ok: true, ports: result, message: t('apiErrors.listeners.restarted') }
    : { ok: false, ports: result, message: t('apiErrors.listeners.stillDown', { failures: summarizeFailures(result, t) }) }
}
