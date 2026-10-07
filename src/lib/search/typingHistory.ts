/**
 * Search history that records SEARCHES, not keystrokes (TEST 2026-10-03: typing "good tidings"
 * slowly left "go", "good", "good tiding" in the history).
 *
 * A query recorded while the user is still typing is PROVISIONAL: the next query that merely
 * continues it (more letters, or backspacing) within a short window REPLACES it instead of adding a
 * new entry. A submitted search (Return, or opening a result) is FINAL: it is recorded at once,
 * and a later search — even the identical query — is a new, separate history event (the history is
 * event-based; intentional repeats are kept).
 */
export const TYPING_WINDOW_MS = 10_000
/** How long typing must pause before a provisional entry is written at all. */
export const TYPING_SETTLE_MS = 1_500

export interface TypedEntry {
  query: string
  ts: number
  /** Final (submitted / result opened) — never replaced by later typing. */
  final?: boolean
}

const norm = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ')

/** `next` is the same search still being typed / edited after `prev` (so it replaces `prev`). */
export function continuesTyping(prev: TypedEntry | undefined, next: string, now: number): boolean {
  if (!prev || prev.final) return false
  if (now - prev.ts > TYPING_WINDOW_MS) return false
  const a = norm(prev.query), b = norm(next)
  if (!a || !b) return false
  return a === b || b.startsWith(a) || a.startsWith(b)
}

export type TypingDecision = 'ignore' | 'append' | 'replace' | 'finalize'

/**
 * What to do with a query given the newest recorded entry:
 *   ignore   — empty, or a provisional repeat of an already-final identical entry just recorded
 *   replace  — still typing the provisional entry → overwrite it (keeps ONE entry)
 *   finalize — submitting exactly the provisional entry → mark it final (no duplicate)
 *   append   — a new search event
 */
export function decideTypedEntry(last: TypedEntry | undefined, query: string, now: number, submitted: boolean): TypingDecision {
  const q = norm(query)
  if (!q) return 'ignore'
  if (last && !last.final && continuesTyping(last, query, now)) {
    if (submitted && norm(last.query) === q) return 'finalize'
    return 'replace'
  }
  // A provisional (typed) query equal to the final entry recorded moments ago is the same search
  // settling, not a new one.
  if (!submitted && last && last.final && norm(last.query) === q && now - last.ts < TYPING_WINDOW_MS) return 'ignore'
  return 'append'
}
