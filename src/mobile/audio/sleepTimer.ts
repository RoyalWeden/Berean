import { useEffect, useSyncExternalStore } from 'react'
import { useAppStore, type AudioPlaybackState } from '@/store'
import { ttsEngine } from '@/lib/tts/ttsEngine'

/**
 * Read Aloud sleep timer on the phone (TEST25-AUDIO-005).
 *
 * A deterministic state machine: the timer is either off, armed until a timestamp, or armed until
 * a boundary in the text (the end of the chapter / book being read). `stepSleepTimer` is pure —
 * given the clock and the previous / next playback position it says what the timer becomes and
 * whether playback must pause now. The runtime below owns the one clock (a single setTimeout for
 * the armed-until timestamp) and feeds store changes through the step, so the timer lives outside
 * any sheet: closing the audio sheet never cancels it; stopping audio does.
 *
 * Reaching the timer PAUSES (never clears) playback, so play continues where it stopped.
 */

export type SleepPreset = { kind: 'off' } | { kind: 'minutes'; minutes: number } | { kind: 'chapter' } | { kind: 'book' }

export type SleepTimerState =
  | { mode: 'off' }
  | { mode: 'time'; minutes: number; endsAt: number }
  /** `lastVerse` — the chapter's last spoken verse once known (null = unknown: any exit counts). */
  | { mode: 'chapter'; bookId: string; chapter: number; lastVerse: number | null }
  /** `lastChapter` — the book's last chapter once known (null = unknown: any exit counts). */
  | { mode: 'book'; bookId: string; lastChapter: number | null }

export interface SleepPos { bookId: string; chapter: number; verse: number; finished: boolean }

export const SLEEP_OFF: SleepTimerState = { mode: 'off' }

export const SLEEP_PRESETS: Array<{ id: string; label: string; preset: SleepPreset }> = [
  { id: 'off', label: 'Off', preset: { kind: 'off' } },
  ...[5, 10, 15, 30, 45, 60].map((m) => ({ id: `m${m}`, label: `${m} minutes`, preset: { kind: 'minutes', minutes: m } as SleepPreset })),
  { id: 'chapter', label: 'End of chapter', preset: { kind: 'chapter' } },
  { id: 'book', label: 'End of book', preset: { kind: 'book' } },
]

export function armSleepTimer(preset: SleepPreset, now: number, pos: SleepPos | null): SleepTimerState {
  switch (preset.kind) {
    case 'minutes': return { mode: 'time', minutes: preset.minutes, endsAt: now + preset.minutes * 60_000 }
    case 'chapter': return pos ? { mode: 'chapter', bookId: pos.bookId, chapter: pos.chapter, lastVerse: null } : SLEEP_OFF
    case 'book': return pos ? { mode: 'book', bookId: pos.bookId, lastChapter: null } : SLEEP_OFF
    default: return SLEEP_OFF
  }
}

/** Which preset the state was armed from (for the picker's checkmark). */
export function sleepPresetId(state: SleepTimerState): string {
  if (state.mode === 'time') return `m${state.minutes}`
  return state.mode === 'off' ? 'off' : state.mode
}

/**
 * One step of the machine. Leaving the armed chapter / book counts as reaching it only when the
 * last position was at its end (the last spoken verse / last chapter, or unknown); a jump away
 * mid-way (the user started another passage) re-arms on the new chapter / book instead.
 */
export function stepSleepTimer(state: SleepTimerState, e: { now: number; prev: SleepPos | null; next: SleepPos | null }): { state: SleepTimerState; stop: boolean } {
  if (state.mode === 'off') return { state, stop: false }
  const { now, prev, next } = e
  // Audio stopped → cancelled. Played out on its own (end of the Bible / queue) → nothing to pause.
  if (!next) return { state: SLEEP_OFF, stop: false }
  if (next.finished && !prev?.finished) return { state: SLEEP_OFF, stop: false }
  if (state.mode === 'time') return now >= state.endsAt ? { state: SLEEP_OFF, stop: true } : { state, stop: false }
  if (state.mode === 'chapter') {
    if (next.bookId === state.bookId && next.chapter === state.chapter) return { state, stop: false }
    const wasHere = !!prev && prev.bookId === state.bookId && prev.chapter === state.chapter
    if (wasHere && (state.lastVerse == null || prev!.verse >= state.lastVerse)) return { state: SLEEP_OFF, stop: true }
    return { state: { mode: 'chapter', bookId: next.bookId, chapter: next.chapter, lastVerse: null }, stop: false }
  }
  if (next.bookId === state.bookId) return { state, stop: false }
  const wasHere = !!prev && prev.bookId === state.bookId
  if (wasHere && (state.lastChapter == null || prev!.chapter >= state.lastChapter)) return { state: SLEEP_OFF, stop: true }
  return { state: { mode: 'book', bookId: next.bookId, lastChapter: null }, stop: false }
}

/** Milliseconds left on a timed timer (null for off / boundary timers). */
export function sleepRemainingMs(state: SleepTimerState, now: number): number | null {
  return state.mode === 'time' ? Math.max(0, state.endsAt - now) : null
}

export function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Short status for the sheet: "12:04", "End of chapter", "End of book", or null when off. */
export function sleepStatusLabel(state: SleepTimerState, now: number): string | null {
  if (state.mode === 'off') return null
  if (state.mode === 'time') return formatCountdown(sleepRemainingMs(state, now) ?? 0)
  return state.mode === 'chapter' ? 'End of chapter' : 'End of book'
}

// ── runtime ─────────────────────────────────────────────────────────────────────────────────

let current: SleepTimerState = SLEEP_OFF
const listeners = new Set<() => void>()
function commit(next: SleepTimerState) {
  if (next === current) return
  current = next
  listeners.forEach((l) => l())
}
export function getSleepTimer(): SleepTimerState { return current }
export function subscribeSleepTimer(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }
export function useSleepTimer(): SleepTimerState { return useSyncExternalStore(subscribeSleepTimer, getSleepTimer, getSleepTimer) }

function posOf(ap: AudioPlaybackState | null): SleepPos | null {
  return ap ? { bookId: ap.bookId, chapter: ap.chapter, verse: ap.verse, finished: ap.finished } : null
}

/** Arms (or clears) the timer from the current playback position. */
export function setSleepTimer(preset: SleepPreset): void {
  const ap = useAppStore.getState().audioPlayback
  commit(armSleepTimer(preset, Date.now(), posOf(ap)))
  fillBoundary()
}

/** Learn the chapter's last verse / the book's last chapter for a boundary timer (async, best-effort:
 *  while unknown, any exit from the chapter / book counts as its end). */
function fillBoundary(): void {
  const st = current
  const ap = useAppStore.getState().audioPlayback
  if (!ap) return
  if (st.mode === 'chapter' && st.lastVerse == null) {
    if (ap.endVerse != null && ap.bookId === st.bookId && ap.chapter === st.chapter) { commit({ ...st, lastVerse: ap.endVerse }); return }
    const q = typeof window !== 'undefined' ? window.bible?.queryChapter : undefined
    if (!q) return
    q(st.bookId, st.chapter, ap.textId).then((vs) => {
      if (current !== st || vs.length === 0) return
      commit({ ...st, lastVerse: vs[vs.length - 1].verse_num })
    }).catch(() => {})
  } else if (st.mode === 'book' && st.lastChapter == null) {
    const g = typeof window !== 'undefined' ? window.bible?.getBooks : undefined
    if (!g) return
    g(ap.textId).then((books) => {
      const b = books.find((x) => x.id === st.bookId)
      if (current !== st || !b) return
      commit({ ...st, lastChapter: b.chapters_count })
    }).catch(() => {})
  }
}

/**
 * Starts the runtime against the app store. Returns a disposer. Pausing:
 *  • a new chapter request just arrived (auto-advance / next queue item) → it is loaded paused
 *    (`isPlaying: false` before useTTSPlayback picks the request up — the same path as "autoplay
 *    when the player opens" off), so the next chapter never becomes audible;
 *  • otherwise → the ordinary pause; if the engine sat in the gap between chapters, the next
 *    request inside that gap is also held paused.
 */
export function startSleepTimerRuntime(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let holdUntil = 0
  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null } }
  const pauseNow = (requestJustArrived: boolean) => {
    const s = useAppStore.getState()
    const ap = s.audioPlayback
    if (!ap) return
    if (requestJustArrived) { s.setAudioPlayback({ isPlaying: false, isPaused: false }); return }
    if (!ttsEngine.isActive) holdUntil = Date.now() + (Math.max(0, s.ttsAutoAdvancePauseSec) + 5) * 1000
    if (ap.isPlaying && !ap.isPaused) s.togglePlayPause()
  }
  const schedule = () => {
    clearTimer()
    if (current.mode !== 'time') return
    timer = setTimeout(() => {
      timer = null
      const pos = posOf(useAppStore.getState().audioPlayback)
      const r = stepSleepTimer(current, { now: Date.now(), prev: pos, next: pos })
      commit(r.state)
      if (r.stop) pauseNow(false)
      schedule()
    }, Math.max(0, current.endsAt - Date.now()))
  }
  const unsubTimer = subscribeSleepTimer(schedule)
  schedule()
  const unsubStore = useAppStore.subscribe((s, prev) => {
    const a = s.audioPlayback, b = prev.audioPlayback
    const requestArrived = s.audioPlaybackRequestToken !== prev.audioPlaybackRequestToken
    if (holdUntil) {
      if (!a || Date.now() > holdUntil) holdUntil = 0
      else if (requestArrived) { holdUntil = 0; s.setAudioPlayback({ isPlaying: false, isPaused: false }); return }
      else if (b?.isPaused && !a.isPaused) holdUntil = 0 // the user pressed play
    }
    if (a === b) return
    const moved = !a || !b || a.bookId !== b.bookId || a.chapter !== b.chapter || a.finished !== b.finished
    if (!moved) return
    const r = stepSleepTimer(current, { now: Date.now(), prev: posOf(b), next: posOf(a) })
    const rearmed = r.state !== current && r.state.mode !== 'off'
    commit(r.state)
    if (r.stop) pauseNow(requestArrived)
    else if (rearmed) fillBoundary()
  })
  return () => { unsubStore(); unsubTimer(); clearTimer() }
}

/** Mount once (the floating audio controls do). */
export function useSleepTimerRuntime(): void {
  useEffect(() => startSleepTimerRuntime(), [])
}

/** Test hook: reset module state. */
export function __resetSleepTimerForTests(): void { current = SLEEP_OFF; listeners.clear() }
