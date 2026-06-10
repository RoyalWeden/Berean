import { describe, it, expect } from 'vitest'
import { clampZoom, adjustZoom, zoomPercent, zoomedFontSize, ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from '../zoom'

describe('clampZoom', () => {
  it('keeps values in range', () => {
    expect(clampZoom(1)).toBe(1)
    expect(clampZoom(1.5)).toBe(1.5)
  })
  it('clamps below min and above max', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN)
    expect(clampZoom(99)).toBe(ZOOM_MAX)
  })
  it('rounds float drift to 2 decimals', () => {
    expect(clampZoom(1.0000001)).toBe(1)
    expect(clampZoom(1.2999999)).toBe(1.3)
  })
  it('falls back to default for non-finite', () => {
    expect(clampZoom(NaN)).toBe(ZOOM_DEFAULT)
    expect(clampZoom(Infinity)).toBe(ZOOM_DEFAULT)
  })
})

describe('adjustZoom', () => {
  it('steps in and out by one increment', () => {
    expect(adjustZoom(1, 1)).toBe(1.1)
    expect(adjustZoom(1, -1)).toBe(0.9)
  })
  it('does not exceed bounds', () => {
    expect(adjustZoom(ZOOM_MAX, 1)).toBe(ZOOM_MAX)
    expect(adjustZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN)
  })
  it('round-trips in/out back to start', () => {
    expect(adjustZoom(adjustZoom(1.2, 1), -1)).toBe(1.2)
  })
  it('stays clean across many steps (no float drift)', () => {
    let z = 1
    for (let i = 0; i < 5; i++) z = adjustZoom(z, 1)
    expect(z).toBe(1.5)
    for (let i = 0; i < 5; i++) z = adjustZoom(z, -1)
    expect(z).toBe(1)
  })
})

describe('zoomPercent', () => {
  it('formats as a percentage', () => {
    expect(zoomPercent(1)).toBe('100%')
    expect(zoomPercent(1.25)).toBe('125%')
    expect(zoomPercent(0.5)).toBe('50%')
  })
  it('clamps before formatting', () => {
    expect(zoomPercent(99)).toBe('300%')
  })
})

describe('zoomedFontSize', () => {
  it('scales a base size', () => {
    expect(zoomedFontSize(16, 1)).toBe(16)
    expect(zoomedFontSize(16, 1.5)).toBe(24)
    expect(zoomedFontSize(16, 0.5)).toBe(8)
  })
  it('clamps the multiplier', () => {
    expect(zoomedFontSize(16, 99)).toBe(48) // 16 * 3
  })
})
