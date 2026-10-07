/**
 * Match-aware excerpt builder for Scripture search results.
 *
 * Unlike the older `buildAllWordsSnippet` (ScriptureSearchView.tsx), this is mode-aware
 * (all/any/phrase), always keeps at least one full match span intact (never truncates
 * through the middle of a matched word/phrase), and snaps both window edges to word
 * boundaries so a truncated result never starts or ends mid-word. Ellipses are added
 * only where text was actually removed, so a reader can trust "…" to mean "there was
 * more here."
 *
 * Pure function — no React, no DOM — so it's usable from both the search row renderer
 * and from tests.
 */

export interface Snippet {
  text: string
  /** Index into the ORIGINAL text where the kept slice starts (0 when untruncated). */
  sliceStart: number
  /** Index into the ORIGINAL text where the kept slice ends, exclusive (text.length when
   *  untruncated). */
  sliceEnd: number
  /** Length of the leading ellipsis, if any (0 or 1) — annotation ranges remapped into this
   *  snippet's coordinates need to shift past it. */
  prefixLen: number
}

export type MatchExcerptMode = 'all' | 'any' | 'phrase'

export interface MatchExcerptOptions {
  mode: MatchExcerptMode
  /** Character budget for the kept slice (ellipses are added on top of this, not counted
   *  against it — matching the historical behavior of buildAllWordsSnippet/makeSnippet). */
  budget: number
}

interface MatchRange {
  start: number
  end: number
}

const ESCAPE_RE = /[.*+?^${}()|[\]\\]/g
function escapeRegExp(s: string): string {
  return s.replace(ESCAPE_RE, '\\$&')
}

/** Splits a query into non-empty whitespace-separated words. */
function queryWords(query: string): string[] {
  return query.trim().split(/\s+/).filter((w) => w.length > 0)
}

/**
 * Finds all match ranges for the given query/mode in `text`.
 *
 * - phrase: the whole phrase, case-insensitive, whitespace-flexible (any run of whitespace
 *   in the query matches any run of whitespace in the text).
 * - all / any: each distinct query word, matched as a word-prefix (`\bword\w*`), case
 *   insensitive. (Scoring the difference between "all" needing every word present and "any"
 *   needing just one is the caller's concern upstream — by the time we're excerpting, the
 *   verse already matched; here we just want to show as much of the matched vocabulary as
 *   fits.)
 */
function findMatchRanges(text: string, query: string, mode: MatchExcerptMode): MatchRange[] {
  const trimmed = query.trim()
  if (!trimmed) return []

  if (mode === 'phrase') {
    const escaped = trimmed.split(/\s+/).map(escapeRegExp).join('\\s+')
    if (!escaped) return []
    const re = new RegExp(escaped, 'gi')
    const ranges: MatchRange[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      ranges.push({ start: m.index, end: m.index + m[0].length })
    }
    return ranges
  }

  const words = queryWords(trimmed)
  const ranges: MatchRange[] = []
  for (const w of words) {
    const escaped = escapeRegExp(w)
    if (!escaped) continue
    const re = new RegExp(`\\b${escaped}\\w*`, 'gi')
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue }
      ranges.push({ start: m.index, end: m.index + m[0].length })
    }
  }
  ranges.sort((a, b) => a.start - b.start || a.end - b.end)
  return ranges
}

/** Number of distinct query words (by lowercase text) covered by matches whose range falls
 *  within [winStart, winEnd]. For phrase mode, each full-phrase match range counts as 1. */
function coverageScore(
  ranges: Array<MatchRange & { key: string }>,
  winStart: number,
  winEnd: number,
): number {
  const seen = new Set<string>()
  for (const r of ranges) {
    if (r.start >= winStart && r.end <= winEnd) seen.add(r.key)
  }
  return seen.size
}

/** Snaps `start` forward and `end` backward to the nearest word boundaries (whitespace),
 *  without crossing the matched span [matchStart, matchEnd), and without expanding past
 *  the original [0, textLen) bounds. */
function snapToWordBoundaries(
  text: string,
  start: number,
  end: number,
  matchStart: number,
  matchEnd: number,
): { start: number; end: number } {
  let s = start
  // Move s forward to the start of a word (skip until just after whitespace, or to 0).
  if (s > 0) {
    while (s < matchStart && s < text.length && !/\s/.test(text[s - 1] ?? ' ')) s++
  }
  if (s > matchStart) s = matchStart // never eat into the match
  let e = end
  if (e < text.length) {
    while (e > matchEnd && e > 0 && !/\s/.test(text[e] ?? ' ')) e--
  }
  if (e < matchEnd) e = matchEnd // never eat into the match
  return { start: s, end: e }
}

/** Trims stray leading/trailing whitespace/punctuation-space from the kept slice, adjusting
 *  sliceStart/sliceEnd to match exactly what text was kept. */
function trimSliceEdges(text: string, start: number, end: number): { start: number; end: number } {
  let s = start
  let e = end
  while (s < e && /[\s,;:]/.test(text[s])) s++
  while (e > s && /[\s,;:]/.test(text[e - 1])) e--
  return { start: s, end: e }
}

export function buildMatchExcerpt(
  text: string,
  query: string,
  opts: MatchExcerptOptions,
): Snippet {
  const { mode, budget } = opts
  if (text.length <= budget) {
    return { text, sliceStart: 0, sliceEnd: text.length, prefixLen: 0 }
  }

  const rawRanges = findMatchRanges(text, query, mode)
  if (rawRanges.length === 0) {
    // No match found at all (e.g. query doesn't actually appear, or empty query) — fall back
    // to the start of the text, word-snapped, with a trailing ellipsis.
    let end = Math.min(text.length, budget)
    if (end < text.length) {
      while (end > 0 && !/\s/.test(text[end]) && !/\s/.test(text[end - 1] ?? ' ')) end--
      if (end === 0) end = Math.min(text.length, budget) // degenerate: no whitespace at all
    }
    const trimmed = trimSliceEdges(text, 0, end)
    const suffix = trimmed.end < text.length ? '…' : ''
    return {
      text: `${text.slice(trimmed.start, trimmed.end)}${suffix}`,
      sliceStart: trimmed.start,
      sliceEnd: trimmed.end,
      prefixLen: 0,
    }
  }

  // Tag each range with a "coverage key" — for all/any, the lowercase matched word (so repeat
  // occurrences of the same word don't inflate distinct-word coverage); for phrase, a shared
  // key since there's only one "thing" to cover.
  const keyed = rawRanges.map((r) => ({
    ...r,
    key: mode === 'phrase' ? 'phrase' : text.slice(r.start, r.end).toLowerCase(),
  }))

  const totalDistinctWords = new Set(keyed.map((r) => r.key)).size

  // Candidate windows: for every match range, try starting the window there and see how much
  // distinct coverage fits within `budget` characters going forward. Also try windows anchored
  // so each match range is the LAST one included (covers trailing context better for later
  // matches). Using the match start positions as candidate anchors keeps this O(n^2) on the
  // number of matches, which is always small for search excerpts.
  let best: { start: number; end: number; score: number; matchStart: number; matchEnd: number } | null = null

  for (const anchor of keyed) {
    const winStart = anchor.start
    const winEnd = Math.min(text.length, winStart + budget)
    const score = coverageScore(keyed, winStart, winEnd)
    // Track the full matched span intersecting this window, so later edge-snapping never
    // cuts through a match that was supposed to be covered.
    let spanStart = anchor.start
    let spanEnd = anchor.end
    for (const r of keyed) {
      if (r.start >= winStart && r.end <= winEnd) {
        spanStart = Math.min(spanStart, r.start)
        spanEnd = Math.max(spanEnd, r.end)
      }
    }
    const candidate = { start: winStart, end: winEnd, score, matchStart: spanStart, matchEnd: spanEnd }
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.start < best.start)
    ) {
      best = candidate
    }
  }

  // Also consider windows that END at each match's end (so a match near the end of the window
  // budget is covered with leading context rather than cut off) — same tie-break rule.
  for (const anchor of keyed) {
    const winEnd = anchor.end
    const winStart = Math.max(0, winEnd - budget)
    const score = coverageScore(keyed, winStart, winEnd)
    let spanStart = anchor.start
    let spanEnd = anchor.end
    for (const r of keyed) {
      if (r.start >= winStart && r.end <= winEnd) {
        spanStart = Math.min(spanStart, r.start)
        spanEnd = Math.max(spanEnd, r.end)
      }
    }
    const candidate = { start: winStart, end: winEnd, score, matchStart: spanStart, matchEnd: spanEnd }
    if (
      !best ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.start < best.start)
    ) {
      best = candidate
    }
  }

  if (!best) {
    // Unreachable given rawRanges.length > 0, but keep TypeScript happy and be defensive.
    const end = Math.min(text.length, budget)
    return { text: `${text.slice(0, end)}…`, sliceStart: 0, sliceEnd: end, prefixLen: 0 }
  }

  void totalDistinctWords // (kept for potential future early-exit optimization; coverage already drives selection)

  let { matchStart, matchEnd } = best

  // If the matched span itself exceeds the budget, keep the first full match (the earliest
  // one within the chosen window) and as much as fits after it.
  const firstMatchInWindow = keyed
    .filter((r) => r.start >= best!.start && r.end <= matchEnd + (best!.end - best!.start))
    .sort((a, b) => a.start - b.start)[0] ?? keyed[0]
  if (matchEnd - matchStart > budget) {
    matchStart = firstMatchInWindow.start
    matchEnd = Math.min(text.length, matchStart + budget)
  }

  // Distribute leftover budget as context around the matched span, favouring a little more
  // trailing context.
  const spanLen = matchEnd - matchStart
  const leftover = Math.max(0, budget - spanLen)
  const trailing = Math.ceil(leftover * 0.6)
  const leading = leftover - trailing

  let windowStart = Math.max(0, matchStart - leading)
  let windowEnd = Math.min(text.length, matchEnd + trailing)
  // If one side ran out of text, give the unused budget to the other side.
  const usedLeading = matchStart - windowStart
  const usedTrailing = windowEnd - matchEnd
  if (usedLeading < leading) {
    windowEnd = Math.min(text.length, windowEnd + (leading - usedLeading))
  }
  if (usedTrailing < trailing) {
    windowStart = Math.max(0, windowStart - (trailing - usedTrailing))
  }
  // Re-clamp to budget in case both extensions overshot (shouldn't happen, but be safe).
  if (windowEnd - windowStart > budget) {
    // Shrink from whichever side has more slack relative to the match.
    const overshoot = windowEnd - windowStart - budget
    const trailSlack = windowEnd - matchEnd
    const shrinkTrail = Math.min(overshoot, trailSlack)
    windowEnd -= shrinkTrail
    const remaining = overshoot - shrinkTrail
    if (remaining > 0) windowStart += remaining
  }

  const snapped = snapToWordBoundaries(text, windowStart, windowEnd, matchStart, matchEnd)
  const trimmed = trimSliceEdges(text, snapped.start, snapped.end)

  const sliceStart = trimmed.start
  const sliceEnd = trimmed.end
  const prefix = sliceStart > 0 ? '…' : ''
  const suffix = sliceEnd < text.length ? '…' : ''
  return {
    text: `${prefix}${text.slice(sliceStart, sliceEnd)}${suffix}`,
    sliceStart,
    sliceEnd,
    prefixLen: prefix.length,
  }
}

/**
 * Estimates a reasonable character budget for an excerpt given a pixel width, font size, and
 * number of lines to fill. Uses ~0.5× the font size as the average glyph width (a common rough
 * estimate for proportional body text), clamped to a sane [60, 600] range so a tiny/huge
 * container can't produce a degenerate budget.
 */
export function excerptBudgetForWidth(widthPx: number, fontPx: number, lines: number): number {
  const avgGlyphWidth = fontPx * 0.5
  if (avgGlyphWidth <= 0) return 60
  const charsPerLine = widthPx / avgGlyphWidth
  const budget = Math.round(charsPerLine * Math.max(1, lines))
  return Math.min(600, Math.max(60, budget))
}
