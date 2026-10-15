/** Keep user-facing versions in the complete major.minor.patch form. */
export function normalizeVersion(value: unknown): string {
  if (typeof value !== 'string') return ''
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value.trim())
  if (!match || !match.slice(1).every((part) => Number.isSafeInteger(Number(part)))) return ''
  return match.slice(1).join('.')
}

export function compareVersions(left: string, right: string): number | null {
  const normalizedLeft = normalizeVersion(left)
  const normalizedRight = normalizeVersion(right)
  if (!normalizedLeft || !normalizedRight) return null
  const a = normalizedLeft.split('.').map(Number)
  const b = normalizedRight.split('.').map(Number)
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1
  }
  return 0
}
