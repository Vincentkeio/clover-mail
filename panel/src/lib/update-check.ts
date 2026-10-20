import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getSetting, setSetting } from './settings'
import type { UpdateCheck } from './update-types'
import { compareVersions, normalizeVersion } from './versions'
import { createTranslator, type Translator } from '@/lib/i18n/translate'
import metadata from '../../package.json'

const run = promisify(execFile)
const owner = 'vincentkeio'
const repository = 'clover-panel'
const manifestTypes = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ')

async function docker(args: string[]): Promise<string> {
  const result = await run('docker', args, { timeout: 12_000, maxBuffer: 64 * 1024 })
  return result.stdout.trim()
}

async function fetchJson(url: string, init: RequestInit | undefined, t: Translator) {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(t('apiSystem.updateCheck.remoteHttpError', { status: response.status }))
  return { body: await response.json() as Record<string, unknown>, headers: response.headers }
}

const cacheKey = 'system_update_check_cache_v3'
const sourceRepository = /^[\w.-]+\/[\w.-]+$/.test(process.env.CLOVER_REPO || '') ? process.env.CLOVER_REPO! : 'Vincentkeio/clover-mail'
type Cache = { day: string; fingerprint: string; checkedAt: string; result: UpdateCheck | null; error: string }
let pending: Promise<Cache> | null = null
let pendingManual: Promise<Cache> | null = null

async function localVersion() {
  const imageId = await docker(['inspect', 'clover-panel', '--format', '{{.Image}}'])
  const labels = JSON.parse(await docker(['image', 'inspect', imageId, '--format', '{{json .Config.Labels}}'])) || {}
  const probe = `import json,re
from pathlib import Path
p=Path('/clover');g=p/'.git';revision=''
try:
 h=(g/'HEAD').read_text().strip()
 if h.startswith('ref: '):
  ref=h[5:]
  if '..' not in ref:
   f=g/ref
   if f.is_file(): revision=f.read_text().strip()
   elif (g/'packed-refs').is_file():
    revision=next((line.split()[0] for line in (g/'packed-refs').read_text().splitlines() if line.endswith(' '+ref)), '')
 else: revision=h
except OSError: pass
if not re.fullmatch('[a-f0-9]{40}',revision):
 try: revision=(p/'.clover-source-revision').read_text().strip()
 except OSError: revision=''
print(json.dumps({'sourceBuild':(p/'.clover-local-build').is_file(),'sourceRevision':revision if re.fullmatch('[a-f0-9]{40}',revision) else ''}))`
  const files = await docker(['exec', 'clover-certificate-helper', 'python3', '-c', probe]).then((value) => JSON.parse(value)).catch(() => ({ sourceBuild: false, sourceRevision: '' }))
  const revision = labels['org.opencontainers.image.revision'] || ''
  return { imageId, sourceBuild: files.sourceBuild || !revision, sourceRevision: String(files.sourceRevision || ''), revision, version: metadata.version }
}

function dayKey() {
  const timezone = process.env.TZ || 'UTC'
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
  catch { return new Date().toISOString().slice(0, 10) }
}

/**
 * 更新状态文案。检查结果会缓存一天，所以读取时按 status/version 重新生成，
 * 界面切换语言后缓存里的文案也跟着变。
 */
export function updateStatusMessage(status: UpdateCheck['status'], version: string | undefined, t: Translator): string {
  if (status === 'available') return t('apiSystem.updateCheck.available', { version: version ?? '' })
  return status === 'source' ? t('apiSystem.updateCheck.sourceBuild') : t('apiSystem.updateCheck.latest')
}

async function inspectRemote(current: UpdateCheck['current'], t: Translator): Promise<UpdateCheck> {
  const architecture = await docker(['info', '--format', '{{.Architecture}}'])
  const { body: tokenBody } = await fetchJson(`https://ghcr.io/token?service=ghcr.io&scope=repository:${owner}/${repository}:pull`, undefined, t)
  const token = typeof tokenBody.token === 'string' ? tokenBody.token : typeof tokenBody.access_token === 'string' ? tokenBody.access_token : ''
  if (!token) throw new Error(t('apiSystem.updateCheck.noRegistryToken'))

  const registryUrl = `https://ghcr.io/v2/${owner}/${repository}/manifests/latest`
  const first = await fetchJson(registryUrl, { headers: { Authorization: `Bearer ${token}`, Accept: manifestTypes } }, t)
  const firstManifest = first.body
  let selectedManifest = firstManifest
  let selectedDigest = typeof first.headers.get('docker-content-digest') === 'string' ? first.headers.get('docker-content-digest')! : ''
  const descriptors = Array.isArray(firstManifest.manifests) ? firstManifest.manifests as Array<Record<string, unknown>> : []
  if (descriptors.length) {
    const arch = architecture === 'aarch64' ? 'arm64' : architecture === 'x86_64' ? 'amd64' : architecture
    const descriptor = descriptors.find((item) => {
      const platform = item.platform as Record<string, unknown> | undefined
      return platform?.architecture === arch && platform.os === 'linux'
    })
    if (!descriptor || typeof descriptor.digest !== 'string') throw new Error(t('apiSystem.updateCheck.noArchImage', { arch }))
    selectedDigest = typeof descriptor.digest === 'string' ? descriptor.digest : selectedDigest
    const manifestResult = await fetchJson(`https://ghcr.io/v2/${owner}/${repository}/manifests/${encodeURIComponent(selectedDigest)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: manifestTypes },
    }, t)
    selectedManifest = manifestResult.body
    selectedDigest = manifestResult.headers.get('docker-content-digest') || selectedDigest
  }

  const config = selectedManifest.config as Record<string, unknown> | undefined
  const configDigest = typeof config?.digest === 'string' ? config.digest : ''
  if (!configDigest) throw new Error(t('apiSystem.updateCheck.imageConfigMissing'))
  const configResult = await fetchJson(`https://ghcr.io/v2/${owner}/${repository}/blobs/${encodeURIComponent(configDigest)}`, {
    headers: { Authorization: `Bearer ${token}` },
  }, t)
  const imageConfig = configResult.body
  const labels = (imageConfig.config as Record<string, unknown> | undefined)?.Labels as Record<string, string> | undefined
  const revision = labels?.['org.opencontainers.image.revision'] || ''
  const created = typeof imageConfig.created === 'string' ? imageConfig.created : ''

  let version = normalizeVersion(labels?.['org.opencontainers.image.version'])
  // Older branch builds used "main" as the OCI version. Read the package
  // metadata from that exact image's commit, never from a moving branch.
  if (!version && /^[a-f0-9]{40}$/.test(revision)) {
    const published = await fetchJson(`https://raw.githubusercontent.com/${sourceRepository}/${revision}/panel/package.json`, undefined, t)
    version = normalizeVersion(published.body.version)
  }
  const comparison = compareVersions(version, current.version)
  if (comparison === null) throw new Error(t('apiSystem.updateCheck.versionUnknown'))
  // Commits and rebuilt image digests are diagnostics, not release numbers.
  const status = comparison > 0 ? 'available' : current.sourceBuild ? 'source' : 'latest'
  const message = updateStatusMessage(status, version, t)
  return { checkedAt: new Date().toISOString(), status, message, current,
    latest: { tag: 'latest', digest: selectedDigest, createdAt: created, revision, version, releaseUrl: `https://github.com/${sourceRepository}/releases/tag/v${version}` } }
}

async function inspect(manual: boolean, t: Translator): Promise<Cache> {
  const raw = await getSetting(cacheKey)
  let cached: Cache | null = null
  try { cached = raw ? JSON.parse(raw) : null } catch { /* Ignore an obsolete cache. */ }
  const current = await localVersion()
  const fingerprint = current.imageId + ':' + current.sourceRevision
  if (!manual && cached?.day === dayKey() && cached.fingerprint === fingerprint) return cached
  const attempt: Cache = { day: dayKey(), fingerprint, checkedAt: new Date().toISOString(), result: cached?.result || null, error: '' }
  // Reserve today's check before contacting remote services. Other tabs and
  // subsequent logins reuse it, including on network failure; manual retry is allowed.
  await setSetting(cacheKey, JSON.stringify(attempt))
  try { attempt.result = await inspectRemote(current, t) }
  catch (error) { attempt.error = error instanceof Error ? error.message : t('apiSystem.updateCheck.cacheFailed') }
  await setSetting(cacheKey, JSON.stringify(attempt))
  return attempt
}

export function checkUpdates(manual = false, t: Translator = createTranslator('en')) {
  if (manual) {
    if (!pendingManual) {
      pendingManual = (async () => {
        // Manual retries must run after an automatic lookup rather than inherit its cached result.
        if (pending) await pending
        return inspect(true, t)
      })().finally(() => { pendingManual = null })
    }
    return pendingManual
  }
  if (pendingManual) return pendingManual
  if (!pending) pending = inspect(manual, t).finally(() => { pending = null })
  return pending
}
