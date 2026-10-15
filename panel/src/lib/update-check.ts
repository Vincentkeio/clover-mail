import 'server-only'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getSetting, setSetting } from './settings'
import type { UpdateCheck } from './update-types'
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

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`远程服务返回 HTTP ${response.status}`)
  return { body: await response.json() as Record<string, unknown>, headers: response.headers }
}

const cacheKey = 'system_update_check_cache_v2'
const sourceRepository = /^[\w.-]+\/[\w.-]+$/.test(process.env.CLOVER_REPO || '') ? process.env.CLOVER_REPO! : 'Vincentkeio/clover-mail'
const sourceRef = process.env.CLOVER_REF || 'main'
type Cache = { day: string; fingerprint: string; checkedAt: string; result: UpdateCheck | null; error: string }
let pending: Promise<Cache> | null = null

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

async function inspectRemote(current: UpdateCheck['current']): Promise<UpdateCheck> {
  const architecture = await docker(['info', '--format', '{{.Architecture}}'])
  const { body: tokenBody } = await fetchJson(`https://ghcr.io/token?service=ghcr.io&scope=repository:${owner}/${repository}:pull`)
  const token = typeof tokenBody.token === 'string' ? tokenBody.token : typeof tokenBody.access_token === 'string' ? tokenBody.access_token : ''
  if (!token) throw new Error('镜像仓库未返回读取凭据')

  const registryUrl = `https://ghcr.io/v2/${owner}/${repository}/manifests/latest`
  const first = await fetchJson(registryUrl, { headers: { Authorization: `Bearer ${token}`, Accept: manifestTypes } })
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
    if (!descriptor || typeof descriptor.digest !== 'string') throw new Error(`发布镜像没有适用于 ${arch} 的版本`)
    selectedDigest = typeof descriptor.digest === 'string' ? descriptor.digest : selectedDigest
    const manifestResult = await fetchJson(`https://ghcr.io/v2/${owner}/${repository}/manifests/${encodeURIComponent(selectedDigest)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: manifestTypes },
    })
    selectedManifest = manifestResult.body
    selectedDigest = manifestResult.headers.get('docker-content-digest') || selectedDigest
  }

  const config = selectedManifest.config as Record<string, unknown> | undefined
  const configDigest = typeof config?.digest === 'string' ? config.digest : ''
  if (!configDigest) throw new Error('无法读取发布镜像版本信息')
  const configResult = await fetchJson(`https://ghcr.io/v2/${owner}/${repository}/blobs/${encodeURIComponent(configDigest)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const imageConfig = configResult.body
  const labels = (imageConfig.config as Record<string, unknown> | undefined)?.Labels as Record<string, string> | undefined
  const revision = labels?.['org.opencontainers.image.revision'] || ''
  const created = typeof imageConfig.created === 'string' ? imageConfig.created : ''

  const source = await fetchJson(`https://api.github.com/repos/${sourceRepository}/commits/${encodeURIComponent(sourceRef)}`, {
    headers: { 'User-Agent': 'Clover-Panel-Update-Check', Accept: 'application/vnd.github+json' },
  }).catch(() => null)
  const commit = source?.body
  const commitSha = typeof commit?.sha === 'string' ? commit.sha : ''
  const commitInfo = commit?.commit as Record<string, unknown> | undefined
  const commitMeta = commitInfo?.committer as Record<string, unknown> | undefined
  const commitMessage = typeof commitInfo?.message === 'string' ? commitInfo.message.split('\n')[0] : ''
  const commitDate = typeof commitMeta?.date === 'string' ? commitMeta.date : ''


  const sourceChanged = Boolean(commitSha && (current.sourceRevision || current.revision) && commitSha !== (current.sourceRevision || current.revision))
  // Docker's classic image store exposes the config digest as .Image. The
  // containerd image store can expose the manifest/index digest instead.
  // Compare against each digest of this exact published image, never treat
  // different digest representations alone as a newer release.
  const imageMatches = [configDigest, selectedDigest, first.headers.get('docker-content-digest')].includes(current.imageId)
  const status = !imageMatches || sourceChanged ? 'available' : current.sourceBuild ? 'source' : 'latest'
  const message = status === 'available' ? '有新版本可更新。' : status === 'source' ? '当前使用本地构建；可手动更新至最新发布版本。' : '当前已是最新版本。'
  return { checkedAt: new Date().toISOString(), status, message, current,
    latest: { tag: 'latest', digest: selectedDigest, createdAt: created, revision },
    upstream: commitSha ? { sha: commitSha, shortSha: commitSha.slice(0, 7), date: commitDate, message: commitMessage, url: `https://github.com/${sourceRepository}/commit/${commitSha}` } : null }
}

async function inspect(manual: boolean): Promise<Cache> {
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
  try { attempt.result = await inspectRemote(current) }
  catch (error) { attempt.error = error instanceof Error ? error.message : '检查更新失败，请手动重试。' }
  await setSetting(cacheKey, JSON.stringify(attempt))
  return attempt
}

export function checkUpdates(manual = false) {
  if (!pending) pending = inspect(manual).finally(() => { pending = null })
  return pending
}
