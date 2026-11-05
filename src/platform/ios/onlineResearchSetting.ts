import { useSyncExternalStore } from 'react'

/**
 * Online research on the phone (spec §7.3): a per-device setting, kept in localStorage like the
 * other phone-only preferences. Off until the user chooses; "Automatic" needs Deep Search, which
 * the phone lacks, so only Off and Ask each time exist here.
 */
export type PhoneWebSetting = 'off' | 'ask'
const KEY = 'berean.onlineResearch'
const listeners = new Set<() => void>()
let current: PhoneWebSetting = read()
function read(): PhoneWebSetting {
  try { return localStorage.getItem(KEY) === 'ask' ? 'ask' : 'off' } catch { return 'off' }
}
export function getOnlineResearch(): PhoneWebSetting { return current }
export function setOnlineResearch(v: PhoneWebSetting): void {
  if (v === current) return
  current = v
  try { localStorage.setItem(KEY, v) } catch { /* in-memory only */ }
  listeners.forEach((l) => l())
}
export function useOnlineResearch(): PhoneWebSetting {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, getOnlineResearch, getOnlineResearch)
}
