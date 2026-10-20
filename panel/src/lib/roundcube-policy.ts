import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getGlobalMailSettings } from './settings'
import { DEFAULT_LOCALE } from './i18n/config'
import { createTranslator, type Translator } from './i18n/translate'

/** 调用方未传 Translator 时的兜底（默认语言），避免漏改调用点时丢文案。 */
const fallbackTranslator = createTranslator(DEFAULT_LOCALE)

async function waitForRoundcube(t: Translator) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch('http://roundcube:80/', { signal: AbortSignal.timeout(2000), cache: 'no-store' })
      const ready = response.ok
      await response.body?.cancel()
      if (ready) return
    } catch { /* The native entrypoint may still be initializing its database. */ }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(t('apiAuth.roundcube.notReady'))
}

/** Native Roundcube configuration reads this non-secret snapshot on every request. */
export async function syncRoundcubePolicy(t: Translator = fallbackTranslator) {
  const directory = process.env.ROUNDCUBE_POLICY_PATH
  if (!directory) return
  const mail = await getGlobalMailSettings()
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, '.policy-' + randomUUID() + '.json')
  await writeFile(temporary, JSON.stringify({
    allowExternalImages: mail.allowExternalImages,
    maxAttachmentMb: mail.maxAttachmentMb,
    maxMessageBytes: mail.maxAttachmentMb === 0 ? 0 : Math.ceil((mail.maxAttachmentMb * 1.4 + 10) * 1024 * 1024),
  }), { mode: 0o644 })
  await rename(temporary, join(directory, 'policy.json'))
  const iniPath = join(directory, 'roundcube.ini')
  const postMb = mail.maxAttachmentMb === 0 ? 0 : Math.ceil(mail.maxAttachmentMb * 1.4 + 10)
  const ini = 'upload_max_filesize=' + (mail.maxAttachmentMb === 0 ? '0' : mail.maxAttachmentMb + 'M')
    + '\npost_max_size=' + (postMb === 0 ? '0' : postMb + 'M')
    + '\nmemory_limit=' + Math.max(512, postMb * 2) + 'M\nmax_execution_time=300\n'
  const previous = await readFile(iniPath, 'utf8').catch(() => '')
  if (previous !== ini) {
    const iniTemporary = join(directory, '.roundcube-' + randomUUID() + '.ini')
    await writeFile(iniTemporary, ini, { mode: 0o644 })
    await rename(iniTemporary, iniPath)
    try { await promisify(execFile)('docker', ['restart', 'clover-roundcube'], { timeout: 45_000 }) }
    catch { throw new Error(t('apiAuth.roundcube.attachmentLimitRestartFailed')) }
  }
  await waitForRoundcube(t)
}
