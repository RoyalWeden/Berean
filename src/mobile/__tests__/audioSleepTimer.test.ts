import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  armSleepTimer, stepSleepTimer, sleepRemainingMs, formatCountdown, sleepStatusLabel, sleepPresetId, SLEEP_OFF, SLEEP_PRESETS,
  startSleepTimerRuntime, setSleepTimer, getSleepTimer, __resetSleepTimerForTests, type SleepPos,
} from '../audio/sleepTimer'

const pos = (bookId: string, chapter: number, verse: number, finished = false): SleepPos => ({ bookId, chapter, verse, finished })

describe('sleep timer state machine (TEST25-AUDIO-005)', () => {
  it('offers 5–60 minutes, end of chapter / book and off', () => {
    expect(SLEEP_PRESETS.map((p) => p.label)).toEqual(['Off', '5 minutes', '10 minutes', '15 minutes', '30 minutes', '45 minutes', '60 minutes', 'End of chapter', 'End of book'])
  })

  it('a timed timer fires exactly at its deadline and pauses', () => {
    const t = armSleepTimer({ kind: 'minutes', minutes: 5 }, 1_000, pos('DEU', 6, 1))
    expect(t).toEqual({ mode: 'time', minutes: 5, endsAt: 301_000 })
    expect(stepSleepTimer(t, { now: 300_999, prev: pos('DEU', 6, 3), next: pos('DEU', 6, 3) })).toEqual({ state: t, stop: false })
    expect(stepSleepTimer(t, { now: 301_000, prev: pos('DEU', 6, 3), next: pos('DEU', 6, 3) })).toEqual({ state: SLEEP_OFF, stop: true })
    expect(sleepRemainingMs(t, 61_000)).toBe(240_000)
    expect(sleepPresetId(t)).toBe('m5')
  })

  it('end of chapter pauses when playback leaves the chapter from its last verse', () => {
    const t = { ...armSleepTimer({ kind: 'chapter' }, 0, pos('DEU', 6, 4)), lastVerse: 25 } as const
    expect(stepSleepTimer(t, { now: 0, prev: pos('DEU', 6, 24), next: pos('DEU', 6, 25) }).stop).toBe(false)
    expect(stepSleepTimer(t, { now: 0, prev: pos('DEU', 6, 25), next: pos('DEU', 7, 1) })).toEqual({ state: SLEEP_OFF, stop: true })
  })

  it('a jump away mid-chapter re-arms on the new chapter instead of pausing', () => {
    const t = { ...armSleepTimer({ kind: 'chapter' }, 0, pos('DEU', 6, 4)), lastVerse: 25 } as const
    expect(stepSleepTimer(t, { now: 0, prev: pos('DEU', 6, 9), next: pos('JHN', 3, 16) })).toEqual({ state: { mode: 'chapter', bookId: 'JHN', chapter: 3, lastVerse: null }, stop: false })
  })

  it('an unknown last verse counts any exit as the chapter end', () => {
    const t = armSleepTimer({ kind: 'chapter' }, 0, pos('DEU', 6, 4))
    expect(stepSleepTimer(t, { now: 0, prev: pos('DEU', 6, 9), next: pos('DEU', 7, 1) }).stop).toBe(true)
  })

  it('end of book pauses when leaving the book from its last chapter only', () => {
    const t = { ...armSleepTimer({ kind: 'book' }, 0, pos('RUT', 1, 1)), lastChapter: 4 } as const
    expect(stepSleepTimer(t, { now: 0, prev: pos('RUT', 1, 22), next: pos('RUT', 2, 1) }).stop).toBe(false)
    expect(stepSleepTimer(t, { now: 0, prev: pos('RUT', 4, 22), next: pos('1SA', 1, 1) })).toEqual({ state: SLEEP_OFF, stop: true })
    expect(stepSleepTimer(t, { now: 0, prev: pos('RUT', 2, 3), next: pos('PSA', 23, 1) }).state).toEqual({ mode: 'book', bookId: 'PSA', lastChapter: null })
  })

  it('stopping audio cancels; playing out on its own clears without a pause', () => {
    const t = armSleepTimer({ kind: 'minutes', minutes: 10 }, 0, pos('DEU', 6, 1))
    expect(stepSleepTimer(t, { now: 1, prev: pos('DEU', 6, 2), next: null })).toEqual({ state: SLEEP_OFF, stop: false })
    const c = armSleepTimer({ kind: 'chapter' }, 0, pos('REV', 22, 1))
    expect(stepSleepTimer(c, { now: 1, prev: pos('REV', 22, 21), next: pos('REV', 22, 21, true) })).toEqual({ state: SLEEP_OFF, stop: false })
  })

  it('boundary presets need a playback position; off is off', () => {
    expect(armSleepTimer({ kind: 'chapter' }, 0, null)).toBe(SLEEP_OFF)
    expect(armSleepTimer({ kind: 'off' }, 0, pos('DEU', 6, 1))).toBe(SLEEP_OFF)
  })

  it('formats the countdown shown in the sheet', () => {
    expect(formatCountdown(0)).toBe('0:00')
    expect(formatCountdown(61_000)).toBe('1:01')
    expect(formatCountdown(59_500)).toBe('1:00')
    expect(formatCountdown(3_600_000)).toBe('1:00:00')
    expect(sleepStatusLabel(SLEEP_OFF, 0)).toBeNull()
    expect(sleepStatusLabel({ mode: 'chapter', bookId: 'DEU', chapter: 6, lastVerse: null }, 0)).toBe('End of chapter')
  })
})

describe('sleep timer runtime (fake timers, real store)', () => {
  let stop: () => void
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-25T21:00:00Z'))
    __resetSleepTimerForTests()
    useAppStore.setState({ audioPlayback: null, audioPlaybackRequestToken: 0, ttsAutoAdvancePauseSec: 2 })
    stop = startSleepTimerRuntime()
  })
  afterEach(() => { stop(); __resetSleepTimerForTests(); useAppStore.setState({ audioPlayback: null }); vi.useRealTimers() })

  const play = (bookId: string, chapter: number, verse = 1) => useAppStore.getState().startPlaybackFrom(bookId, chapter, verse, 'kjva')

  it('pauses (not clears) when the minutes run out — with no sheet mounted', () => {
    play('DEU', 6)
    setSleepTimer({ kind: 'minutes', minutes: 5 })
    vi.advanceTimersByTime(5 * 60_000 - 1)
    expect(useAppStore.getState().audioPlayback?.isPaused).toBe(false)
    vi.advanceTimersByTime(1)
    const ap = useAppStore.getState().audioPlayback
    expect(ap).not.toBeNull()
    expect(ap?.isPaused).toBe(true)
    expect(getSleepTimer()).toBe(SLEEP_OFF)
  })

  it('stopping audio cancels an armed timer', () => {
    play('DEU', 6)
    setSleepTimer({ kind: 'minutes', minutes: 10 })
    useAppStore.getState().stopPlayback()
    expect(getSleepTimer()).toBe(SLEEP_OFF)
    vi.advanceTimersByTime(11 * 60_000)
    expect(useAppStore.getState().audioPlayback).toBeNull()
  })

  it('end of chapter: the next chapter request is loaded paused (isPlaying false before the engine picks it up)', () => {
    play('DEU', 6)
    setSleepTimer({ kind: 'chapter' })
    useAppStore.getState().setAudioPlayback({ verse: 25 })
    play('DEU', 7) // the auto-advance request
    const ap = useAppStore.getState().audioPlayback
    expect(ap?.chapter).toBe(7)
    expect(ap?.isPlaying).toBe(false)
    expect(getSleepTimer()).toBe(SLEEP_OFF)
  })

  it('a timer reached in the gap between chapters also holds the next request paused', () => {
    play('DEU', 6)
    setSleepTimer({ kind: 'minutes', minutes: 5 })
    vi.advanceTimersByTime(5 * 60_000)
    expect(useAppStore.getState().audioPlayback?.isPaused).toBe(true)
    play('DEU', 7) // auto-advance fires after the chapter-end pause
    expect(useAppStore.getState().audioPlayback?.isPlaying).toBe(false)
    play('DEU', 8) // the hold is spent: later requests play normally
    expect(useAppStore.getState().audioPlayback?.isPlaying).toBe(true)
  })
})
