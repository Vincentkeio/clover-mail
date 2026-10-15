'use client'

import { useSyncExternalStore } from 'react'
import type { UpdateState } from './update-types'

const initial: UpdateState = { result: null, error: '', checkedAt: '', checking: false }
let state = initial
let pending: Promise<void> | null = null
const listeners = new Set<() => void>()
function publish(next: UpdateState) { state = next; listeners.forEach((listener) => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useUpdateStatus() { return useSyncExternalStore(subscribe, () => state, () => initial) }

/** This only queries versions. Updating services requires a separate confirmed POST. */
export function checkForUpdates(manual = false) {
  if (pending) return pending
  publish({ ...state, checking: true, error: '' })
  pending = (async () => {
    try {
      const response = await fetch('/api/v1/system/update-check', { method: manual ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(90_000) })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || '检查更新失败，请稍后手动重试。')
      publish({ result: body.result, error: body.error || '', checkedAt: body.checkedAt, checking: false })
    } catch (error) {
      publish({ ...state, checking: false, error: error instanceof Error ? error.message : '检查更新失败。' })
    } finally { pending = null }
  })()
  return pending
}
