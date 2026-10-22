/** Preview shortcuts must never grant access in a production build. */
export function isDemoMode(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.DEMO_MODE === 'true'
}

export function isSeedEnabled(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.ALLOW_SEED === 'true'
}
