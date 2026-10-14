import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { NextResponse } from 'next/server'
import { getCurrentAdmin, unauthorized } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const run = promisify(execFile)
const owner = 'vincentkeio'
const repository = 'clover-panel'
const image = `ghcr.io/${owner}/${repository}`
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

async function projectDirectory(): Promise<string> {
  const path = await docker(['inspect', 'clover-panel', '--format', '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'])
  if (!path.startsWith('/') || path.includes('..') || /[\r\n]/.test(path)) throw new Error('无法识别安装目录')
  return path
}

async function fetchJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(12_000) })
  if (!response.ok) throw new Error(`远程服务返回 HTTP ${response.status}`)
  return { body: await response.json() as Record<string, unknown>, headers: response.headers }
}

export async function GET() {
  if (!await getCurrentAdmin()) return unauthorized()

  try {
    const project = await projectDirectory()
    const [isSourceBuild, currentImageId, architecture] = await Promise.all([
      docker(['run', '--rm', '-v', `${project}:${project}:ro`, 'docker:cli', 'test', '-f', `${project}/.clover-local-build`]).then(() => true).catch(() => false),
      docker(['inspect', 'clover-panel', '--format', '{{.Image}}']),
      docker(['info', '--format', '{{.Architecture}}']),
    ])

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

    const source = await fetchJson(`https://api.github.com/repos/Vincentkeio/clover-mail/commits/main`, {
      headers: { 'User-Agent': 'Clover-Panel-Update-Check', Accept: 'application/vnd.github+json' },
    }).catch(() => null)
    const commit = source?.body
    const commitSha = typeof commit?.sha === 'string' ? commit.sha : ''
    const commitInfo = commit?.commit as Record<string, unknown> | undefined
    const commitMeta = commitInfo?.committer as Record<string, unknown> | undefined
    const commitMessage = typeof commitInfo?.message === 'string' ? commitInfo.message.split('\n')[0] : ''
    const commitDate = typeof commitMeta?.date === 'string' ? commitMeta.date : ''

    let status: 'latest' | 'available' | 'source' = 'source'
    let message = '已连接发布源。本机使用源码构建，无法将源码镜像与发布镜像直接比较；请查看上游最新提交。'
    if (!isSourceBuild && currentImageId === configDigest) {
      status = 'latest'
      message = '当前发布镜像已是最新版本。'
    } else if (!isSourceBuild) {
      status = 'available'
      message = '发现较新的发布镜像，可以点击“更新面板”安装。'
    }

    return NextResponse.json({
      checkedAt: new Date().toISOString(), status, message,
      current: { sourceBuild: isSourceBuild, imageId: currentImageId },
      latest: { tag: 'latest', digest: selectedDigest, createdAt: created, revision },
      upstream: commitSha ? { sha: commitSha, shortSha: commitSha.slice(0, 7), date: commitDate, message: commitMessage, url: `https://github.com/Vincentkeio/clover-mail/commit/${commitSha}` } : null,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : '检查更新失败' }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
  }
}
