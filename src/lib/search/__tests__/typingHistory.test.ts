/** TEST 2026-10-03 — search history records searches, not keystrokes. */
import { describe, it, expect } from 'vitest'
import { decideTypedEntry, continuesTyping, TYPING_WINDOW_MS } from '../typingHistory'

const t0 = 1_000_000
describe('typing-aware search history', () => {
  it('rapid / slow typing of one query keeps replacing the provisional entry', () => {
    let last = { query: 'go', ts: t0 }
    for (const [q, dt] of [['good', 1600], ['good tiding', 3000], ['good tidings', 1800]] as const) {
      expect(decideTypedEntry(last, q, last.ts + dt, false)).toBe('replace')
      last = { query: q, ts: last.ts + dt }
    }
  })
  it('backspacing (editing) the provisional query also replaces it', () => {
    expect(decideTypedEntry({ query: 'good tidings', ts: t0 }, 'good tid', t0 + 1500, false)).toBe('replace')
  })
  it('a submitted search is recorded; submitting the provisional query finalizes it (no duplicate)', () => {
    expect(decideTypedEntry(undefined, 'good tidings', t0, true)).toBe('append')
    expect(decideTypedEntry({ query: 'good tidings', ts: t0 }, 'good tidings', t0 + 500, true)).toBe('finalize')
  })
  it('intentional repeated searches stay separate events', () => {
    expect(decideTypedEntry({ query: 'good tidings', ts: t0, final: true }, 'good tidings', t0 + 60_000, true)).toBe('append')
    expect(decideTypedEntry({ query: 'good tidings', ts: t0, final: true }, 'good tidings', t0 + 2_000, true)).toBe('append')
  })
  it('a different search is a new entry; a final entry is never replaced by typing', () => {
    expect(decideTypedEntry({ query: 'good tidings', ts: t0 }, 'faith', t0 + 1500, false)).toBe('append')
    expect(decideTypedEntry({ query: 'good', ts: t0, final: true }, 'good tidings', t0 + 1500, false)).toBe('append')
  })
  it('empty / cleared searches are ignored', () => {
    expect(decideTypedEntry({ query: 'good', ts: t0 }, '   ', t0 + 10, false)).toBe('ignore')
  })
  it('after the typing window a continuation is a new search (returning later)', () => {
    expect(continuesTyping({ query: 'good', ts: t0 }, 'good tidings', t0 + TYPING_WINDOW_MS + 1)).toBe(false)
  })
})
