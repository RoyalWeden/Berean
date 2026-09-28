import { useEffect, useSyncExternalStore } from 'react'
import { useAppStore, type AudioPlaybackState } from '@/store'

/**
 * Read Aloud auto-follow on the phone (TEST25-AUDIO-007).
 *
 * The reader (the shared ChapterView) already keeps the spoken verse in view and marks it. This
 * module decides WHETHER it may: a manual scroll of the reader while audio is active pauses
 * following (`isAudioFollowPaused()`, which ChapterView's auto-follow checks — the desktop never
 * starts this runtime, so there it is always false and nothing changes); following resumes
 * by itself when the spoken chapter changes, or when the user taps "Follow reading" — which also
 * brings the spoken verse back into view right away.
 */

export interface FollowState { paused: boolean; key: string | null }
export type FollowEvent = { type: 'user-scroll' } | { type: 'resume' } | { type: 'playback'; key: string | null }

export const FOLLOW_INITIAL: FollowState = { paused: false, key: null }

/** `${bookId}:${chapter}:${textId}` of the spoken chapter, or null when nothing plays. */
export function followKey(ap: Pick<AudioPlaybackState, 'bookId' | 'chapter' | 'textId'> | null): string | null {
  return ap ? `${ap.bookId}:${ap.chapter}:${ap.textId}` : null
}

export function reduceFollow(s: FollowState, e: FollowEvent): FollowState {
  switch (e.type) {
    case 'user-scroll': return s.key == null || s.paused ? s : { ...s, paused: true }
    case 'resume': return s.paused ? { ...s, paused: false } : s
    case 'playback': return e.key === s.key ? s : { paused: false, key: e.key }
  }
}

/** Vertical finger travel that counts as the user scrolling the text (not a tap, not a chapter swipe). */
export const USER_SCROLL_MIN_PX = 10
export function isUserScrollGesture(dx: number, dy: number): boolean {
  return Math.abs(dy) >= USER_SCROLL_MIN_PX && Math.abs(dy) > Math.abs(dx)
}

/** Reader scrollers the gesture must start in (the pager's panes and continuous scroll alike). */
const READER_SELECTOR = '.mobile-reader'

let state: FollowState = FOLLOW_INITIAL
const listeners = new Set<() => void>()
function dispatch(e: FollowEvent) {
  const next = reduceFollow(state, e)
  if (next === state) return
  const changed = next.paused !== state.paused
  state = next
  if (changed) listeners.forEach((l) => l())
}
/** Read by ChapterView's Read Aloud auto-follow: true = leave the scroll position alone. */
export function isAudioFollowPaused(): boolean { return state.paused }
function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb) } }

/** Scroll the spoken verse into view in the visible reader (not a parked / preview pane). */
export function scrollToSpokenVerse(doc: Document = document): boolean {
  const ap = useAppStore.getState().audioPlayback
  if (!ap) return false
  const rows = doc.querySelectorAll<HTMLElement>(`${READER_SELECTOR} [data-verse-row][data-book="${ap.bookId}"][data-chapter="${ap.chapter}"][data-verse="${ap.verse}"]`)
  const el = Array.from(rows).find((r) => !r.closest('[aria-hidden="true"]'))
  if (!el) return false
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  el.scrollIntoView?.({ behavior: reduce ? 'auto' : 'smooth', block: 'center' })
  return true
}

/** "Follow reading": resume following and bring the spoken verse back into view. */
export function resumeAudioFollow(): void {
  dispatch({ type: 'resume' })
  scrollToSpokenVerse()
}

export function startAudioFollowRuntime(doc: Document = document): () => void {
  state = FOLLOW_INITIAL
  dispatch({ type: 'playback', key: followKey(useAppStore.getState().audioPlayback) })
  const unsub = useAppStore.subscribe((s, prev) => {
    if (s.audioPlayback === prev.audioPlayback) return
    dispatch({ type: 'playback', key: followKey(s.audioPlayback) })
  })
  let start: { x: number; y: number } | null = null
  const onStart = (e: TouchEvent) => {
    const t = e.touches[0]
    const inReader = (e.target as Element | null)?.closest?.(READER_SELECTOR)
    start = t && inReader && e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null
  }
  const onMove = (e: TouchEvent) => {
    const t = e.touches[0]
    if (!start || !t || state.paused || state.key == null) return
    if (isUserScrollGesture(t.clientX - start.x, t.clientY - start.y)) { start = null; dispatch({ type: 'user-scroll' }) }
  }
  const onEnd = () => { start = null }
  // Mouse wheel / trackpad (simulator, iPad pointer) scrolling the reader counts too.
  const onWheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) < 1 || !(e.target as Element | null)?.closest?.(READER_SELECTOR)) return
    dispatch({ type: 'user-scroll' })
  }
  doc.addEventListener('touchstart', onStart, { capture: true, passive: true })
  doc.addEventListener('touchmove', onMove, { capture: true, passive: true })
  doc.addEventListener('touchend', onEnd, { capture: true, passive: true })
  doc.addEventListener('touchcancel', onEnd, { capture: true, passive: true })
  doc.addEventListener('wheel', onWheel, { capture: true, passive: true })
  return () => {
    unsub()
    doc.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions)
    doc.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions)
    doc.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions)
    doc.removeEventListener('touchcancel', onEnd, { capture: true } as EventListenerOptions)
    doc.removeEventListener('wheel', onWheel, { capture: true } as EventListenerOptions)
    dispatch({ type: 'playback', key: null })
    state = FOLLOW_INITIAL
  }
}

/** Mount once (the floating audio controls do). */
export function useAudioFollowRuntime(): void {
  useEffect(() => startAudioFollowRuntime(), [])
}

/** Whether following is paused (drives the "Follow" resume chip and the sheet button). */
export function useAudioFollowPaused(): boolean {
  return useSyncExternalStore(subscribe, isAudioFollowPaused, isAudioFollowPaused)
}
