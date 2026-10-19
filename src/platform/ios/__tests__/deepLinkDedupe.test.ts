import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@capacitor/app', () => ({ App: { getLaunchUrl: vi.fn(), addListener: vi.fn() } }))
import { openIosDeepLink, setIosDeepLinkTarget, __resetIosDeepLinks, __iosPendingDeepLinks } from '../deepLinks'
import type { DeepLinkTarget } from '../../../lib/deepLinks'

const target = (openChat: (o: { compose: boolean }) => void): DeepLinkTarget => ({
  openVerse: vi.fn(), openNote: vi.fn(), openLexicon: vi.fn(), openVideo: vi.fn(), openPdf: vi.fn(), openSearch: vi.fn(),
  openTrail: vi.fn(), openDaily: vi.fn(), openWorkspace: vi.fn(), openSession: vi.fn(), openChat,
})

describe('iOS deep-link delivery (widget: TEST 2026-10-17)', () => {
  beforeEach(() => { __resetIosDeepLinks(); vi.useRealTimers() })

  it('a cold-launch URL reported twice (launch URL + appUrlOpen) opens once', () => {
    const openChat = vi.fn()
    openIosDeepLink('berean-dev://chat/new')   // getLaunchUrl, before the shell exists → queued
    openIosDeepLink('berean-dev://chat/new')   // appUrlOpen for the same tap
    expect(__iosPendingDeepLinks()).toEqual(['berean-dev://chat/new'])
    setIosDeepLinkTarget(target(openChat))
    expect(openChat).toHaveBeenCalledTimes(1)
  })

  it('warm: a second tap later is a new request', () => {
    vi.useFakeTimers()
    const openChat = vi.fn()
    setIosDeepLinkTarget(target(openChat))
    openIosDeepLink('berean-dev://chat/new')
    vi.advanceTimersByTime(2000)
    openIosDeepLink('berean-dev://chat/new')
    expect(openChat).toHaveBeenCalledTimes(2)
  })
})
