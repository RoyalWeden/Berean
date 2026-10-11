/**
 * Concise book labels for LISTS of books that belong to one work (TEST 2026-10-10).
 *
 * Some editions split a single work into several "books" whose canonical names all repeat the
 * work's title — `Recognitions of Clement — Book I` … `— Book X`, `Shepherd of Hermas — Visions` /
 * `— Mandates` / `— Similitudes`. In a picker that already shows the edition, repeating the title on
 * every row only crowds out the part that differs. Derived from the canonical names themselves (the
 * `Work — Part` form the data uses), never from per-book exceptions, and only for DISPLAY: book ids,
 * references and navigation are untouched.
 *
 * Rule: when two or more books in the list share the same `Work — ` prefix, each of them shows only
 * its part (`Book I` → `Book 1`, Roman numerals as plain numbers); the shared work title is returned
 * so the list can head the group with it once.
 */

const SEPARATOR = /\s+[—–]\s+/

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 }

function romanToNumber(s: string): number | null {
  if (!/^[IVXLC]+$/.test(s)) return null
  let total = 0
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN[s[i]]
    const next = ROMAN[s[i + 1]] ?? 0
    total += v < next ? -v : v
  }
  return total > 0 ? total : null
}

/** `Book IX` → `Book 9`; anything else unchanged. */
export function plainNumberedPart(part: string): string {
  const m = /^(Book|Part)\s+([IVXLC]+)$/.exec(part.trim())
  if (!m) return part
  const n = romanToNumber(m[2])
  return n ? `${m[1]} ${n}` : part
}

function splitWork(name: string): { work: string; part: string } | null {
  const m = SEPARATOR.exec(name)
  if (!m || m.index === 0) return null
  const work = name.slice(0, m.index).trim()
  const part = name.slice(m.index + m[0].length).trim()
  return work && part ? { work, part } : null
}

export interface ConciseBookLabels {
  /** Display label per book id (every book in the input has one). */
  labels: Map<string, string>
  /** Book id → the work title its label dropped (only for shortened books). */
  workOf: Map<string, string>
}

export function conciseBookLabels(books: ReadonlyArray<{ id: string; name: string }>): ConciseBookLabels {
  const counts = new Map<string, number>()
  for (const b of books) {
    const w = splitWork(b.name)
    if (w) counts.set(w.work, (counts.get(w.work) ?? 0) + 1)
  }
  const labels = new Map<string, string>()
  const workOf = new Map<string, string>()
  for (const b of books) {
    const w = splitWork(b.name)
    if (w && (counts.get(w.work) ?? 0) >= 2) {
      labels.set(b.id, plainNumberedPart(w.part))
      workOf.set(b.id, w.work)
    } else {
      labels.set(b.id, b.name)
    }
  }
  return { labels, workOf }
}
