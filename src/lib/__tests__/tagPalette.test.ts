import { describe, it, expect } from 'vitest'
import { computeTagSlotTriples, resolveTagColor, tagSlotVar, TAG_SLOT_COUNT } from '@/lib/tagPalette'

const parse = (t: string) => t.split(' ').map(Number)

describe('computeTagSlotTriples', () => {
  it('returns 12 valid, distinct "r g b" triples', () => {
    const dark = computeTagSlotTriples({ isDark: true })
    expect(dark).toHaveLength(TAG_SLOT_COUNT)
    for (const t of dark) {
      const [r, g, b] = parse(t)
      for (const c of [r, g, b]) expect(c).toBeGreaterThanOrEqual(0), expect(c).toBeLessThanOrEqual(255)
    }
    expect(new Set(dark).size).toBe(TAG_SLOT_COUNT)
  })

  it('produces different palettes for dark vs light backgrounds', () => {
    const dark = computeTagSlotTriples({ isDark: true })
    const light = computeTagSlotTriples({ isDark: false })
    expect(dark).not.toEqual(light)
  })
})

describe('resolveTagColor', () => {
  it('prefers a literal highlight-id override', () => {
    expect(resolveTagColor({ color: 'blue', colorSlot: 3 })).toBe('rgb(var(--highlight-blue))')
  })

  it('uses the slot when there is no override', () => {
    expect(resolveTagColor({ color: null, colorSlot: 5 })).toBe(tagSlotVar(5))
  })

  it('ignores a bare-integer color and uses the slot', () => {
    expect(resolveTagColor({ color: '7', colorSlot: 2 })).toBe(tagSlotVar(2))
  })

  it('falls back to neutral with neither', () => {
    expect(resolveTagColor({ color: null, colorSlot: null })).toBe('rgb(var(--color-text-muted))')
    expect(resolveTagColor(null)).toBe('rgb(var(--color-text-muted))')
  })

  it('passes a raw CSS colour through', () => {
    expect(resolveTagColor({ color: '#abcdef', colorSlot: null })).toBe('#abcdef')
  })
})
