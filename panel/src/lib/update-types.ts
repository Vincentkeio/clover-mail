export type UpdateCheck = {
  checkedAt: string
  status: 'latest' | 'available' | 'source'
  message: string
  current: { sourceBuild: boolean; imageId: string; revision: string; sourceRevision: string; version: string }
  latest: { tag: string; digest: string; createdAt: string; revision: string }
  upstream: { sha: string; shortSha: string; date: string; message: string; url: string } | null
}

export type UpdateState = { result: UpdateCheck | null; error: string; checkedAt: string; checking: boolean }
