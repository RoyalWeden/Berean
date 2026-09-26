// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { useAppStore } from '@/store'
import { reduceFollow, isUserScrollGesture, followKey, FOLLOW_INITIAL, startAudioFollowRuntime, resumeAudioFollow, isAudioFollowPaused } from '../audio/followState'
import { nextSpeed, speedLabel, verseProgressLabel, getAudioControlsHidden, setAudioControlsHidden } from '../audio/audioControls'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))
vi.mock('@/platform/ios/plugins', () => ({ BereanAudio: {
  addListener: () => Promise.resolve({ remove: () => Promise.resolve() }),
  activateSession: () => Promise.resolve(), deactivateSession: () => Promise.resolve(), setNowPlaying: () => Promise.resolve(),
} }))

describe('auto-follow state (TEST25-AUDIO-007)', () => {
  it('a manual scroll pauses following only while something plays', () => {
    expect(reduceFollow(FOLLOW_INITIAL, { type: 'user-scroll' })).toBe(FOLLOW_INITIAL)
    const playing = reduceFollow(FOLLOW_INITIAL, { type: 'playback', key: 'DEU:6:kjva' })
    expect(reduceFollow(playing, { type: 'user-scroll' })).toEqual({ paused: true, key: 'DEU:6:kjva' })
  })
  it('resumes on a chapter change or "Follow reading", not on a new verse of the same chapter', () => {
    const paused = { paused: true, key: 'DEU:6:kjva' }
    expect(reduceFollow(paused, { type: 'playback', key: 'DEU:6:kjva' })).toBe(paused)
    expect(reduceFollow(paused, { type: 'playback', key: 'DEU:7:kjva' })).toEqual({ paused: false, key: 'DEU:7:kjva' })
    expect(reduceFollow(paused, { type: 'resume' })).toEqual({ paused: false, key: 'DEU:6:kjva' })
  })
  it('counts vertical drags as scrolling, not taps or chapter swipes', () => {
    expect(isUserScrollGesture(0, 4)).toBe(false)
    expect(isUserScrollGesture(40, 12)).toBe(false)
    expect(isUserScrollGesture(3, -18)).toBe(true)
    expect(followKey(null)).toBeNull()
  })

  it('runtime: a touch-drag in the reader pauses; a chapter change resumes; Follow scrolls to the spoken verse', () => {
    useAppStore.setState({ audioPlayback: null })
    const dispose = startAudioFollowRuntime(document)
    useAppStore.getState().startPlaybackFrom('DEU', 6, 9, 'kjva')
    document.body.innerHTML = '<div class="mobile-reader"><div data-verse-row data-book="DEU" data-chapter="6" data-verse="9" id="v9">x</div></div>'
    const row = document.getElementById('v9')!
    const touch = (type: string, y: number) => {
      const ev = new Event(type, { bubbles: true }) as unknown as TouchEvent
      Object.defineProperty(ev, 'touches', { value: [{ clientX: 100, clientY: y }] })
      row.dispatchEvent(ev as unknown as Event)
    }
    touch('touchstart', 300); touch('touchmove', 280)
    expect(isAudioFollowPaused()).toBe(true)
    const spy = vi.fn()
    row.scrollIntoView = spy
    resumeAudioFollow()
    expect(isAudioFollowPaused()).toBe(false)
    expect(spy).toHaveBeenCalledTimes(1)
    touch('touchstart', 300); touch('touchmove', 250)
    expect(isAudioFollowPaused()).toBe(true)
    useAppStore.getState().startPlaybackFrom('DEU', 7, 1, 'kjva')
    expect(isAudioFollowPaused()).toBe(false)
    dispose()
    useAppStore.getState().stopPlayback()
    document.body.innerHTML = ''
  })
})

describe('audio controls helpers', () => {
  it('cycles the speed through the old player values', () => {
    expect(nextSpeed(1)).toBe(1.2)
    expect(nextSpeed(1.5)).toBe(0.8)
    expect(nextSpeed(1.37)).toBe(1)
    expect(speedLabel(1)).toBe('1×')
    expect(speedLabel(1.2)).toBe('1.2×')
  })
  it('labels progress in verses (no invented durations)', () => {
    expect(verseProgressLabel(9, 25)).toEqual({ elapsed: 'v. 9', total: 'of 25' })
    expect(verseProgressLabel(9, null)).toEqual({ elapsed: 'v. 9', total: '' })
  })
})

describe('floating audio controls (TEST25-AUDIO-001/002/004)', () => {
  let host: HTMLDivElement
  let root: ReturnType<typeof createRoot>
  beforeEach(async () => {
    ;(window as unknown as { bible: unknown }).bible = {
      queryChapter: () => Promise.resolve(Array.from({ length: 25 }, (_, i) => ({ verse_num: i + 1 }))),
      getBooks: () => Promise.resolve([]),
    }
    const { AudioBar } = await import('../audio/AudioBar')
    const { SheetHost } = await import('../primitives/Sheet')
    useAppStore.setState({ audioPlayback: null })
    setAudioControlsHidden(false)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => { root.render(<SheetHost><div className="mobile-root"><AudioBar /></div></SheetHost>) })
  })
  afterEach(() => { act(() => root.unmount()); host.remove(); useAppStore.setState({ audioPlayback: null }) })

  it('renders nothing until audio is active, then a play/pause and a top-right audio button', () => {
    expect(host.querySelector('.m-audio-fab')).toBeNull()
    act(() => { useAppStore.getState().startPlaybackFrom('DEU', 6, 1, 'kjva') })
    const fab = host.querySelector('.m-audio-fab') as HTMLButtonElement
    expect(fab.getAttribute('aria-label')).toBe('Pause reading')
    expect(host.querySelector('.m-audio-topbtn')?.getAttribute('aria-label')).toContain('Deuteronomy 6')
    expect(host.querySelector('.mobile-audio-bar')).toBeNull() // the old bottom bar is gone
    act(() => { useAppStore.getState().togglePlayPause() })
    expect(fab.getAttribute('aria-label')).toBe('Play reading')
  })

  it('Hide Controls hides only the play/pause; the top-right button stays; stopping resets it', () => {
    act(() => { useAppStore.getState().startPlaybackFrom('DEU', 6, 1, 'kjva') })
    act(() => { setAudioControlsHidden(true) })
    expect(host.querySelector('.m-audio-fab-wrap')?.classList.contains('is-hidden')).toBe(true)
    expect(host.querySelector('.m-audio-topbtn')).not.toBeNull()
    act(() => { useAppStore.getState().stopPlayback() })
    expect(getAudioControlsHidden()).toBe(false)
  })

  it('the top-right button opens the audio sheet with the passage title, and the play/pause hides under it', () => {
    act(() => { useAppStore.getState().startPlaybackFrom('DEU', 6, 1, 'kjva') })
    act(() => { (host.querySelector('.m-audio-topbtn') as HTMLButtonElement).click() })
    expect(document.querySelector('.m-audio-sheet-title')?.textContent).toBe('Deuteronomy 6')
    expect(document.querySelector('.m-audio-sheet-source')?.textContent).toContain('KJVA')
    expect(host.querySelector('.m-audio-fab-wrap')?.classList.contains('is-hidden')).toBe(true)
    expect(document.body.textContent).toContain('Hide Controls')
  })
})
