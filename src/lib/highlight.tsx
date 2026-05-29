import React from 'react'

/**
 * Splits `text` on every occurrence of `query` (case-insensitive) and returns
 * a React node where each match is wrapped in a <mark> element styled for the
 * Berean find-bar. Marks receive the `berean-find-mark` class so the panel can
 * query them after render for navigation / active-mark management.
 *
 * wordMode:
 *   'phrase' (default) — highlight the exact query phrase
 *   'all' | 'any'      — highlight each individual word in the query separately
 */
export function applyFindHighlight(text: string, query: string, wordMode: 'phrase' | 'all' | 'any' = 'phrase'): React.ReactNode {
  if (!query.trim()) return text
  let pattern: string
  if (wordMode === 'phrase') {
    const escaped = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    pattern = escaped
  } else {
    // all or any: highlight each individual word
    const words = query.trim()
      .split(/\s+/)
      .map(w => w.trim())
      .filter(w => w.length > 0)
    if (words.length === 0) return text
    pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  }
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
