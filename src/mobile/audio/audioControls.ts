import { useSyncExternalStore } from 'react'

/**
 * "Hide Controls" (TEST25-AUDIO-004): hides the floating play/pause while audio keeps playing; the
 * top-right audio button stays so the sheet (and "Show Controls") is always reachable. Module state
 * — it outlives the sheet — and it resets to shown when audio stops, so the next session starts
 * with its controls visible.
 */
let hidden = false
const listeners = new Set<() => void>()
export function getAudioControlsHidden(): boolean { return hidden }
export function setAudioControlsHidden(v: boolean): void {
  if (v === hidden) return
  hidden = v
  listeners.forEach((l) => l())
}
function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }
export function useAudioControlsHidden(): boolean { return useSyncExternalStore(subscribe, getAudioControlsHidden, getAudioControlsHidden) }

/** Speed steps the sheet's speed button cycles through (the same values the old player offered). */
export const SPEED_STEPS = [0.8, 1, 1.2, 1.5] as const
export function nextSpeed(rate: number): number {
  const i = SPEED_STEPS.findIndex((r) => Math.abs(r - rate) < 0.001)
  return i < 0 ? 1 : SPEED_STEPS[(i + 1) % SPEED_STEPS.length]
}
export function speedLabel(rate: number): string {
  return `${Number(rate.toFixed(2))}×`
}

/** Honest progress label — Read Aloud has no exact durations, so position is counted in verses. */
export function verseProgressLabel(verseNum: number, lastVerseNum: number | null): { elapsed: string; total: string } {
  return { elapsed: `v. ${verseNum}`, total: lastVerseNum ? `of ${lastVerseNum}` : '' }
}
