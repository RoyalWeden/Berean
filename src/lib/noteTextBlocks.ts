// Shared plain-text detection/formatting utilities for note content —
// verse references, verse blocks, lexicon blocks, callouts, and bullet
// glyph styles. Extracted from the legacy CodeMirror 6 note editor
// (NoteEditor.tsx) during the ProseMirror migration (see
// src/components/notes/pm/) so both the old and new editors could share a
// single source of truth during the transition, and so the new editor has
// no dependency on the (now deleted) CM6 file.
//
// These are pure text-detection functions with no editor-framework
// dependency (no CodeMirror, no ProseMirror) — they operate on plain
// strings and are consumed by pm/parser.ts, pm/refDecorations.ts,
// pm/blockDecorations.ts, and pm/nodeViews.ts.

import { parseRef, getTranslationForBook, AMBIGUOUS_PATTERNS, isExactBookToken } from '@/lib/parseRef'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { useAppStore } from '@/store'

// ─── Bullet glyph styles ────────────────────────────────────────────────────
// Pure rendering preference (global app setting) — markdown always stays
// plain "-"/"*" regardless of which glyph set is displayed.
export const BULLET_STYLE_DEFS: Record<string, { label: string; symbols: string[] }> = {
  classic:    { label: 'Classic',    symbols: ['•', '◦', '▸', '◦', '·'] },
  geometric:  { label: 'Geometric',  symbols: ['◆', '◇', '▪', '▫', '·'] },
  arrows:     { label: 'Arrows',     symbols: ['›', '»', '→', '⟩', '·'] },
  dash:       { label: 'Dash',       symbols: ['—', '–', '−', '‒', '·'] },
  star:       { label: 'Star',       symbols: ['★', '☆', '✦', '✧', '·'] },
}

// ─── Callouts ───────────────────────────────────────────────────────────────
export const CALLOUT_META: Record<string, { icon: string; label: string; bg: string; border: string; color: string }> = {
  NOTE:      { icon: 'ℹ', label: 'Note',      bg: 'rgba(59,130,246,0.08)',  border: 'rgba(59,130,246,0.6)',  color: '#60a5fa' },
  TIP:       { icon: '💡', label: 'Tip',       bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.6)',   color: '#4ade80' },
  WARNING:   { icon: '⚠', label: 'Warning',   bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.6)',  color: '#fbbf24' },
  IMPORTANT: { icon: '★', label: 'Important', bg: 'rgba(168,85,247,0.08)',  border: 'rgba(168,85,247,0.6)',  color: '#c084fc' },
  CAUTION:   { icon: '✕', label: 'Caution',   bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.6)',   color: '#f87171' },
}

// ─── Verse blocks ───────────────────────────────────────────────────────────
// Recognised patterns (the reference must be verse-level, i.e. contain ":"):
//   A) Multi-line: "Luke 16:29-31\n29 text\n30 text\n31 text"
//   B) Single-line: "1 John 2:4 He that saith…"
// NOT triggered: a bare reference like "Luke 16:29-31" (no verse text follows).
export const SINGLE_VERSE_LINE_RE =
  /^(\s*)((?:[1-3][ \t]+)?[A-Za-z][a-z]+(?:[ \t]+[A-Za-z][a-z]+){0,2}[ \t]+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?)[ \t]+(\S.*)$/
export const VERSE_BODY_LINE_RE = /^\s*\d{1,3}[ \t]+\S/

/**
 * For a single-line block "Book c:v <body>", if the body begins with an "LXX " marker
 * (as produced when copying a Septuagint verse), fold it into the reference label and
 * return the cleaned body. e.g. ("Isaiah 9:12", "LXX But the people…") →
 * { refLabel: "Isaiah 9:12 LXX", body: "But the people…", lxx: true }.
 */
export function splitLeadingLxx(refStr: string, body: string): { refLabel: string; body: string; lxx: boolean } {
  const m = body.match(/^LXX[ \t]+(\S.*)$/i)
  if (m) return { refLabel: `${refStr} LXX`, body: m[1], lxx: true }
  return { refLabel: refStr, body, lxx: false }
}

export interface VerseBlockMatch {
  kind: 'multi' | 'single'
  ref: string
  refLength: number
  lineCount: number
}

export function detectVerseBlock(text: string): VerseBlockMatch | null {
  if (!text.trim()) return null
  const nonEmpty = text.split('\n').map(l => l.trimEnd()).filter(l => l.trim())
  if (nonEmpty.length === 0) return null

  if (nonEmpty.length >= 2) {
    const refLine = nonEmpty[0].trim()
    if (refLine.includes(':') && parseRef(refLine)) {
      const body = nonEmpty.slice(1)
      if (body.every(l => VERSE_BODY_LINE_RE.test(l))) {
        return { kind: 'multi', ref: refLine, refLength: refLine.length, lineCount: nonEmpty.length }
      }
    }
  }

  const m = SINGLE_VERSE_LINE_RE.exec(nonEmpty[0])
  if (m && parseRef(m[2].trim())) {
    return { kind: 'single', ref: m[2].trim(), refLength: m[2].trim().length, lineCount: 1 }
  }

  return null
}

// ─── Inline verse-reference finder ────────────────────────────────────────────
// Finds EVERY verse reference in a string, so a single line can contain any
// number of references (e.g. "Romans 10:1-2 vs Deuteronomy 18:15-19").
// Book names can be 1–3 words ("Song of Songs", "1 John"). The broad regex may
// greedily grab a leading non-book word ("vs Deuteronomy"); we recover by retrying
// parseRef on progressively shorter suffixes until one parses, then adjust the
// match start so only the real reference is decorated.
const VERSE_REF_SCAN_RE =
  /((?:[1-3][ \t]+)?(?:[A-Za-z][a-z]*\.?[ \t]+){0,2}[A-Za-z][a-z]+\.?)[ \t]+(\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?)([ \t]+LXX\b)?/gi

export interface VerseRefMatch {
  index: number
  length: number
  refText: string
  lxx: boolean
}

export function findVerseRefMatches(text: string): VerseRefMatch[] {
  const out: VerseRefMatch[] = []
  VERSE_REF_SCAN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = VERSE_REF_SCAN_RE.exec(text)) !== null) {
    const bookPhrase = m[1]
    const numPart = m[2]
    const lxx = !!m[3]
    const words = bookPhrase.split(/[ \t]+/).filter(Boolean)
    const wordStarts: number[] = []
    let search = 0
    for (const w of words) {
      const i = bookPhrase.indexOf(w, search)
      wordStarts.push(i)
      search = i + w.length
    }
    let matched = false
    for (let start = 0; start < words.length; start++) {
      const candidateRef = words.slice(start).join(' ') + ' ' + numPart
      if (parseRef(candidateRef)) {
        const bookWords = words.slice(start)
        const lastBookWord = bookWords[bookWords.length - 1].toLowerCase().replace(/\.$/, '')
        const fullBookPhrase = bookWords.join(' ')
        if (AMBIGUOUS_PATTERNS.has(lastBookWord) || !isExactBookToken(fullBookPhrase)) {
          const hasColon = numPart.includes(':')
          const firstCharOfBook = bookPhrase[wordStarts[start]] ?? ''
          const isCapitalised = /[A-Z]/.test(firstCharOfBook)
          if (!hasColon && !isCapitalised) continue
        }
        const refStart = m.index + wordStarts[start]
        const fullEnd = m.index + m[0].length
        out.push({ index: refStart, length: fullEnd - refStart, refText: candidateRef, lxx })
        matched = true
        break
      }
    }
    if (!matched && words.length > 0) {
      const rewind = m.index + wordStarts[0] + words[0].length
      if (rewind > m.index) VERSE_REF_SCAN_RE.lastIndex = rewind
    }
  }
  return out
}

// ─── Verse-text match ratio (for the "actually contains the verse text" check) ──
// Returns the fraction (0..1) of candidate words that appear in the actual verse
// text (multiset overlap). Used to avoid formatting a line where the user is just
// commenting on a verse (e.g. "Genesis 5:4 my thoughts here").
export function verseTextMatchRatio(candidate: string, actual: string): number {
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)
      .filter(w => w && !/^[hg]\d+$/.test(w))
  const cand = norm(candidate)
  const act = norm(actual)
  if (cand.length === 0) return 0
  const counts = new Map<string, number>()
  for (const w of act) counts.set(w, (counts.get(w) ?? 0) + 1)
  let hit = 0
  for (const w of cand) {
    const c = counts.get(w) ?? 0
    if (c > 0) { hit++; counts.set(w, c - 1) }
  }
  return hit / cand.length
}

// ─── Async verse-text verification cache ──────────────────────────────────────
// Resolving real verse text requires the Bible DB (async). We cache the computed
// ratio per (ref + candidate-text) so the synchronous decoration builder can read
// it. A miss kicks off a background fetch, then re-decorates when it resolves.
const verseRatioCache = new Map<string, number>()
const versePending = new Set<string>()

function verseCacheKey(refText: string, candidate: string): string {
  return refText + ' ' + candidate.replace(/\s+/g, ' ').trim().toLowerCase()
}

interface BibleQueryWindow {
  bible?: { queryChapter?: (b: string, c: number, t?: string) => Promise<Array<{ verse_num: number; text: string }>> }
}

/**
 * Strip an LXX marker (trailing " LXX" suffix or leading "lxx:"/"LXX:" prefix) from a
 * reference string. Returns the bare reference for parseRef plus whether LXX was present.
 */
export function stripLxxMarker(refText: string): { ref: string; lxx: boolean } {
  const suffix = refText.match(/^(.*?)[ \t]+LXX\s*$/i)
  if (suffix) return { ref: suffix[1].trim(), lxx: true }
  const prefix = refText.match(/^(?:lxx|LXX):\s*(.*)$/)
  if (prefix) return { ref: prefix[1].trim(), lxx: true }
  return { ref: refText, lxx: false }
}

async function fetchActualVerseText(refText: string): Promise<string | null> {
  const { ref: bareRef, lxx } = stripLxxMarker(refText)
  const ref = parseRef(bareRef)
  if (!ref) return null
  const w = (typeof window !== 'undefined' ? (window as unknown as BibleQueryWindow) : null)
  if (!w?.bible?.queryChapter) return null
  const def = useAppStore.getState().defaultBibleTranslation || 'kjva'
  const textId = (lxx ? 'lxx' : (getTranslationForBook(ref.bookId) ?? def)).toLowerCase()
  const startCh = ref.chapter
  const endCh = ref.endChapter ?? ref.chapter
  const parts: string[] = []
  for (let ch = startCh; ch <= endCh; ch++) {
    const verses = await w.bible.queryChapter(ref.bookId, ch, textId)
    if (!Array.isArray(verses)) continue
    for (const v of verses) {
      if (endCh === startCh && ref.verse != null) {
        const lo = ref.verse
        const hi = ref.endVerse ?? ref.verse
        if (v.verse_num >= lo && v.verse_num <= hi) parts.push(v.text)
      } else {
        parts.push(v.text)
      }
    }
  }
  if (!parts.length) return null
  let actual = parts.join(' ')
  const st = useAppStore.getState()
  if (st.wordReplacerEnabled && st.wordReplacerRules.length > 0) {
    actual = applyWordReplacer(actual, st.wordReplacerRules)
  }
  return actual
}

/**
 * Returns true (format it), false (don't), or null (pending — don't format yet).
 * When the Bible DB is unavailable (tests / fallback), returns true (structural).
 * On a cache miss, schedules a background fetch and calls onResolved() afterward.
 */
export function verseTextAccepted(
  refText: string, candidate: string, threshold: number, onResolved: () => void,
): boolean | null {
  const w = (typeof window !== 'undefined' ? (window as unknown as BibleQueryWindow) : null)
  if (!w?.bible?.queryChapter) return true
  const key = verseCacheKey(refText, candidate)
  if (verseRatioCache.has(key)) return verseRatioCache.get(key)! >= threshold
  if (versePending.has(key)) return null
  versePending.add(key)
  fetchActualVerseText(refText)
    .then((actual) => {
      verseRatioCache.set(key, actual ? verseTextMatchRatio(actual, candidate) : 1)
      versePending.delete(key)
      onResolved()
    })
    .catch(() => {
      verseRatioCache.set(key, 1)
      versePending.delete(key)
      onResolved()
    })
  return null
}

// Synchronous variant for preview/print — reads cache, falls back to structural.
export function verseTextAcceptedSync(refText: string, candidate: string, threshold: number): boolean {
  const key = verseCacheKey(refText, candidate)
  if (verseRatioCache.has(key)) return verseRatioCache.get(key)! >= threshold
  return true
}

// ─── Lexicon blocks ─────────────────────────────────────────────────────────
// Two-line format pasted from the copy button: "G5485 χάρις cháris;\nfrom G5463; ..."
export const LEXICON_BLOCK_HEADER_RE = /^([HG]\d{1,5})\s+\S/
