import React from 'react'

/**
 * Build a truncated snippet of `text` (max `maxLen` chars) windowed around the first
 * occurrence of `query` so the matched term is visible — instead of always showing the
 * verse/note's opening. Adds leading/trailing "…" when the window is clipped.
 *
 * wordMode 'phrase' looks for the whole query; 'all'/'any' look for the earliest of the
 * individual query words.
 */
export function makeSnippet(
  text: string,
  query: string,
  maxLen: number,
  wordMode: 'phrase' | 'all' | 'any' = 'phrase',
): string {
  if (text.length <= maxLen) return text
  const q = query.trim()
  const fromStart = () => text.slice(0, maxLen).trimEnd() + '…'
  if (!q) return fromStart()

  const lower = text.toLowerCase()
  let idx = -1
  if (wordMode === 'phrase') {
    idx = lower.indexOf(q.toLowerCase())
  } else {
    let best = Infinity
    for (const w of q.toLowerCase().split(/\s+/).filter(Boolean)) {
      const i = lower.indexOf(w)
      if (i >= 0 && i < best) best = i
    }
    idx = best === Infinity ? -1 : best
  }
  if (idx < 0 || idx < maxLen * 0.55) return fromStart()  // match already near the start

  // Window the snippet so the match sits ~30% in from the left edge.
  const lead = Math.floor(maxLen * 0.3)
  let start = Math.max(0, idx - lead)
  // Snap the start to the next word boundary so we don't cut a word in half.
  const sp = text.indexOf(' ', start)
  if (sp >= 0 && sp < idx) start = sp + 1
  let snip = text.slice(start, start + maxLen)
  if (start > 0) snip = '…' + snip.trimStart()
  if (start + maxLen < text.length) snip = snip.trimEnd() + '…'
  return snip
}

/**
 * Splits `text` on every occurrence of `query` (case-insensitive) and returns
 * a React node where each match is wrapped in a <mark> element styled for the
 * Berean find-bar. Marks receive the `berean-find-mark` class so the panel can
 * query them after render for navigation / active-mark management.
 *
 * `query` may be a single string or an array of strings — with an array, a match
 * on ANY of them is marked. This lets callers mark both the typed term and its
 * word-replacer substitution (e.g. "LORD" typed, "Yehovah" shown) in one pass.
 *
 * wordMode:
 *   'phrase' (default) — highlight the exact query phrase(s)
 *   'all' | 'any'      — highlight each individual word in the query separately
 */
export function applyFindHighlight(
  text: string,
  query: string | string[],
  wordMode: 'phrase' | 'all' | 'any' = 'phrase',
): React.ReactNode {
  const queries = (Array.isArray(query) ? query : [query])
    .map(q => q.trim())
    .filter(q => q.length > 0)
  if (queries.length === 0) return text
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let tokens: string[]
  if (wordMode === 'phrase') {
    tokens = queries.map(esc)
  } else {
    // all or any: highlight each individual word across every query
    tokens = queries.flatMap(q => q.split(/\s+/).filter(w => w.length > 0).map(esc))
  }
  tokens = [...new Set(tokens)].filter(Boolean)
  if (tokens.length === 0) return text
  const pattern = tokens.join('|')
  const splitRe = new RegExp(`(${pattern})`, 'gi')
  const matchRe = new RegExp(`^(?:${pattern})$`, 'i')
  const parts = text.split(splitRe)
  if (parts.length <= 1) return text
  return (
    <>
      {parts.map((p, i) =>
        matchRe.test(p)
          ? (
            <mark
              key={i}
              className="berean-find-mark bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm not-italic"
            >
              {p}
            </mark>
          )
          : p
      )}
    </>
  )
}
