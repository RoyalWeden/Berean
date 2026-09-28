import { useSyncExternalStore } from 'react'

/**
 * Reading text width (TEST25-SCRIPTURE-008) — side margins of the Scripture column on the phone,
 * a per-device reading preference: 'wide' (edge to edge), 'normal', 'narrow' (a book-like measure).
 * Applied through `html[data-reader-width]`; the reader CSS turns it into column padding.
 */
export type ReaderWidth = 'wide' | 'normal' | 'narrow'
const KEY = 'berean.readerWidth'
const listeners = new Set<() => void>()
let current: ReaderWidth = read()
function read(): ReaderWidth {
  try { const v = localStorage.getItem(KEY); return v === 'wide' || v === 'narrow' ? v : 'normal' } catch { return 'normal' }
}
function apply(): void { try { document.documentElement.dataset.readerWidth = current } catch { /* no DOM */ } }
apply()
export function getReaderWidth(): ReaderWidth { return current }
export function setReaderWidth(w: ReaderWidth): void {
  if (w === current) return
  current = w
  try { localStorage.setItem(KEY, w) } catch { /* in-memory only */ }
  apply()
  listeners.forEach((l) => l())
}
export function useReaderWidth(): ReaderWidth {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, getReaderWidth, getReaderWidth)
}
