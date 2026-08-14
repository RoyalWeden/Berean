import { describe, it, expect } from 'vitest'
import type { AiLookupChatMessage } from '@/types/electron'

// ─── Progressive-results merge rules (speed round) ───────────────────────────
//
// AiLookupPanel renders an answer in two stages: `emitPartial` (aiLookup.ts, fired the moment
// retrieval is done and every DB-verified verse exists) paints the message immediately, then the
// awaited `query` response replaces it once the optional ~4s Commentary pass has landed.
//
// The merge itself is three lines inside a `setMessages` updater, but the rules it encodes are
// exactly the kind that break silently and only in a race: a straggling partial from a question
// the user has already moved on from must not paint over a newer answer, and a partial must
// never rewrite a message that has already settled. Those rules are reproduced here as pure
// functions so they can be tested without mounting the panel and faking IPC — the panel's
// updater is deliberately a direct expression of these same two predicates.

/** Mirrors the panel's partial-merge predicate: a partial may only fill the trailing assistant
 *  placeholder for the question still in flight. */
function partialApplies(prev: AiLookupChatMessage[], seq: number, currentSeq: number): boolean {
  if (seq !== currentSeq) return false
  const last = prev[prev.length - 1]
  return !!last && last.role === 'assistant' && !!last.pending
}

const msg = (over: Partial<AiLookupChatMessage> = {}): AiLookupChatMessage => ({
  role: 'assistant', content: '', createdAt: '2026-01-01T00:00:00.000Z', ...over,
})

describe('AI Lookup progressive results — merge rules', () => {
  it('applies a partial to the pending placeholder for the in-flight question', () => {
    const prev = [msg({ role: 'user', content: 'q' }), msg({ pending: true })]
    expect(partialApplies(prev, 3, 3)).toBe(true)
  })

  it('DROPS a partial whose sequence is stale — the user has since asked something else', () => {
    // The failure this guards: question A is slow, the user gives up and asks B, then A's
    // partial arrives and overwrites B's answer with results for a question no longer on screen.
    const prev = [msg({ role: 'user', content: 'b' }), msg({ pending: true })]
    expect(partialApplies(prev, 2, 3)).toBe(false)
  })

  it('DROPS a partial when the trailing message has already settled', () => {
    // Without the `pending` check, a partial landing after the final response (possible: they
    // travel on separate IPC channels with no ordering guarantee) would revert a completed
    // answer back to its pre-commentary state.
    const prev = [msg({ role: 'user', content: 'q' }), msg({ pending: false, summary: 'final' })]
    expect(partialApplies(prev, 3, 3)).toBe(false)
  })

  it('DROPS a partial when the last message is the user turn (no placeholder yet)', () => {
    expect(partialApplies([msg({ role: 'user', content: 'q' })], 1, 1)).toBe(false)
  })

  it('DROPS a partial against an empty thread', () => {
    expect(partialApplies([], 1, 1)).toBe(false)
  })

  it('strips `pending` before persisting so a reopened chat is never stuck mid-flight', () => {
    // Mirrors persist()'s destructuring. `pending` is live-render state only; a chat reloaded
    // from the DB with it still set would render a permanent in-progress message.
    const messages = [msg({ role: 'user', content: 'q' }), msg({ pending: true, summary: 's' })]
    const clean = messages.map(({ pending: _pending, ...m }) => m)
    expect(clean.every((m) => !('pending' in m))).toBe(true)
    // Everything else must survive the strip.
    expect(clean[1].summary).toBe('s')
  })
})
