import { describe, it, expect } from 'vitest'
import { snapInfoWidth } from '../NoteSidePanel'

describe('Notes inspector snap widths', () => {
  it('pulls a drag within 24px onto Compact / Standard / Wide / Large and clamps the range', () => {
    expect(snapInfoWidth(310)).toBe(300)
    expect(snapInfoWidth(270)).toBe(260)
    expect(snapInfoWidth(395)).toBe(380)
    expect(snapInfoWidth(340)).toBe(340)   // between snaps: kept
    expect(snapInfoWidth(100)).toBe(260)
    expect(snapInfoWidth(900)).toBe(460)
  })
})
