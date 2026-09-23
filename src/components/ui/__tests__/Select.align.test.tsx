import { describe, it, expect } from 'vitest'
import { resolveSelectAlign } from '../Select'

// ─── TEST-005: the notes-tab sort Select's menu wasn't aligned with its trigger when the
// trigger sits near the right edge of the (260–420px) Bible right panel — a static
// `align="left"` default assumed there was always room to open rightward from the trigger's
// left edge, and MenuPositioner's own flip/clamp logic only checks the WINDOW edge, not the
// narrow panel's edge, so a menu that fit the window but not the panel rendered past the panel
// into whatever sat beside it. `resolveSelectAlign` is the pure decision `open()` now makes at
// click time from the trigger's real measured rect — this proves it right-aligns a trigger
// pinned to a narrow container's edge and otherwise behaves exactly like a plain 'left' open. ──

describe('resolveSelectAlign', () => {
  it('pins to the requested edge when given an explicit align', () => {
    expect(resolveSelectAlign('left', { left: 10, right: 50 }, 1400)).toBe('left')
    expect(resolveSelectAlign('right', { left: 10, right: 50 }, 1400)).toBe('right')
  })

  it('auto: opens leftward (default) when there is plenty of room on both sides', () => {
    // A trigger comfortably inside a normal-width window.
    expect(resolveSelectAlign('auto', { left: 600, right: 680 }, 1400)).toBe('left')
  })

  it('auto: flips to right-aligned when the trigger sits near a narrow container\'s right edge', () => {
    // e.g. the notes-tab sort Select pinned near the right edge of a 300px side panel: the
    // WINDOW is wide (1400px) so a naive viewport-only check would never flip, but the trigger
    // itself has almost no room to its right and plenty to its left.
    const rect = { left: 1250, right: 1290 }
    expect(resolveSelectAlign('auto', rect, 1400)).toBe('right')
  })

  it('auto: stays left-aligned when the trigger is flush against the LEFT edge instead', () => {
    const rect = { left: 4, right: 44 }
    expect(resolveSelectAlign('auto', rect, 1400)).toBe('left')
  })
})
