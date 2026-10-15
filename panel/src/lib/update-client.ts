'use client'

import { useSyncExternalStore } from 'react'
import type { UpdateState } from './update-types'

const initial: UpdateState = { result: null, error: '', checkedAt: '', checking: false, manualChecking: false }
let state = initial
let pendingAuto: Promise<void> | null = null
let pendingManual: Promise<void> | null = null
const listeners = new Set<() => void>()
function publish(next: UpdateState) { state = next; listeners.forEach((listener) => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useUpdateStatus() { return useSyncExternalStore(subscribe, () => state, () => initial) }

async function requestUpdateCheck(manual: boolean) {
  try {
    const response = await fetch('/api/v1/system/update-check', { method: manual ? 'POST' : 'GET', cache: 'no-store', signal: AbortSignal.timeout(90_000) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '检查更新失败，请稍后手动重试。')
    publish({ result: body.result, error: body.error || '', checkedAt: body.checkedAt, checking: true, manualChecking: Boolean(pendingManual) })
  } catch (error) {
    publish({ ...state, checking: true, manualChecking: Boolean(pendingManual), error: error instanceof Error ? error.message : '检查更新失败。' })
  }
}

/** This only queries versions. Updating services requires a separate confirmed POST. */
export function checkForUpdates(manual = false) {
  if (manual) {
    if (pendingManual) return pendingManual
    publish({ ...state, checking: true, manualChecking: true, error: '' })
    pendingManual = (async () => {
      // Let an automatic daily check finish first, then issue a real forced check.
      if (pendingAuto) await pendingAuto
      await requestUpdateCheck(true)
    })().finally(() => {
      pendingManual = null
      publish({ ...state, checking: Boolean(pendingAuto), manualChecking: false })
    })
    return pendingManual
  }

  if (pendingManual) return pendingManual
  if (pendingAuto) return pendingAuto
  publish({ ...state, checking: true, manualChecking: false, error: '' })
  pendingAuto = (async () => {
    try {
      await requestUpdateCheck(false)
    } finally {
      pendingAuto = null
      publish({ ...state, checking: Boolean(pendingManual), manualChecking: Boolean(pendingManual) })
    }
  })()
  return pendingAuto
}
