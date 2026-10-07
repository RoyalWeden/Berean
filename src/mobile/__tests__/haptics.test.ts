// @vitest-environment jsdom
/** One haptics vocabulary (TEST 2026-10-03): semantic categories, throttled so nested handlers never double-buzz. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
const impact = vi.fn(async () => {})
const selectionChanged = vi.fn(async () => {})
const notification = vi.fn(async () => {})
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: (...a: unknown[]) => impact(...(a as [])), selectionChanged: () => selectionChanged(), notification: (...a: unknown[]) => notification(...(a as [])) }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))
import { haptic, _resetHapticThrottle } from '../primitives/haptics'

beforeEach(() => { impact.mockClear(); selectionChanged.mockClear(); notification.mockClear(); _resetHapticThrottle() })

describe('haptics', () => {
  it('maps meanings to iOS feedback', async () => {
    await haptic.tap(); _resetHapticThrottle()
    await haptic.select(); _resetHapticThrottle()
    await haptic.confirm(); _resetHapticThrottle()
    await haptic.warn(); _resetHapticThrottle()
    await haptic.press()
    expect(impact).toHaveBeenCalledWith({ style: 'LIGHT' })
    expect(impact).toHaveBeenCalledWith({ style: 'MEDIUM' })
    expect(selectionChanged).toHaveBeenCalledTimes(1)
    expect(notification).toHaveBeenCalledWith({ type: 'SUCCESS' })
    expect(notification).toHaveBeenCalledWith({ type: 'WARNING' })
  })
  it('a control and its primitive firing together give ONE haptic', async () => {
    await haptic.tap(); await haptic.light(); await haptic.select()
    expect(impact).toHaveBeenCalledTimes(1)
    expect(selectionChanged).toHaveBeenCalledTimes(0)
  })
})

describe('Haptic Feedback setting (TEST 2026-10-04)', () => {
  it('off silences every haptic and is remembered on this device', async () => {
    const h = await import('../primitives/haptics')
    h.setHapticsEnabled(false)
    await haptic.tap(); await haptic.select(); await haptic.confirm()
    expect(impact).not.toHaveBeenCalled()
    expect(selectionChanged).not.toHaveBeenCalled()
    expect(notification).not.toHaveBeenCalled()
    expect(localStorage.getItem('berean.haptics.enabled')).toBe('0')
    h.setHapticsEnabled(true); _resetHapticThrottle()
    await haptic.tap()
    expect(impact).toHaveBeenCalledTimes(1)
    expect(h.hapticsEnabled()).toBe(true)
  })
})
