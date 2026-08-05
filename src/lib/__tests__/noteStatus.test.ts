import { describe, it, expect } from 'vitest'
import { NOTE_STATUSES, NOTE_STATUS_BY_ID, noteStatusMeta } from '../noteStatus'

describe('noteStatus metadata', () => {
  it('has exactly the 5 statuses the user asked for, in display order', () => {
    expect(NOTE_STATUSES.map((s) => s.id)).toEqual([
      'started', 'in-progress', 'complete', 'make-video', 'archive',
    ])
  })

  it('every status has a distinct color and a label', () => {
    const colors = new Set(NOTE_STATUSES.map((s) => s.color))
    expect(colors.size).toBe(NOTE_STATUSES.length)
    for (const s of NOTE_STATUSES) expect(s.label.length).toBeGreaterThan(0)
  })

  it('NOTE_STATUS_BY_ID is keyed by id and matches NOTE_STATUSES', () => {
    for (const s of NOTE_STATUSES) expect(NOTE_STATUS_BY_ID[s.id]).toBe(s)
  })

  it('noteStatusMeta returns null for undefined/null/unknown, and the right entry for a known id', () => {
    expect(noteStatusMeta(undefined)).toBeNull()
    expect(noteStatusMeta(null)).toBeNull()
    expect(noteStatusMeta('not-a-real-status')).toBeNull()
    expect(noteStatusMeta('complete')?.label).toBe('Complete')
  })
})
