import { useSyncExternalStore } from 'react'

/**
 * How the verse sheet opens on a verse tap (SEP25):
 *  • 'brief'   — the compact sheet: reference, Notes · Strong's · Refs · Copy, highlight colours.
 *  • 'strongs' — the same compact sheet with the verse itself and its Strong's numbers.
 * Dragging the sheet up is the third, EXPANDED state (full study view and every action) in
 * either mode. The mode changes only by an explicit choice (the Strong's button in the sheet),
 * and that choice is remembered on this device.
 */
export type VerseSheetMode = 'brief' | 'strongs'

const KEY = 'berean.verseSheetMode'
const listeners = new Set<() => void>()
let current: VerseSheetMode = read()

function read(): VerseSheetMode {
  try { return localStorage.getItem(KEY) === 'strongs' ? 'strongs' : 'brief' } catch { return 'brief' }
}

export function getVerseSheetMode(): VerseSheetMode { return current }

export function setVerseSheetMode(mode: VerseSheetMode): void {
  if (mode === current) return
  current = mode
  try { localStorage.setItem(KEY, mode) } catch { /* private mode: in-memory only */ }
  listeners.forEach((l) => l())
}

export function useVerseSheetMode(): VerseSheetMode {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l) } }, getVerseSheetMode, getVerseSheetMode)
}

/** Visible height (px, before the safe area) of the sheet's compact position for a mode. */
export function verseSheetLowPx(mode: VerseSheetMode, base: number): number {
  return mode === 'strongs' ? base + 116 : base
}
