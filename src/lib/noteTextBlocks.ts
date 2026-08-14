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
import { buildVerseDisplayText } from '@/lib/verseUtils'
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
// Optional ", Book N" subdivision (+ optional comma before chapter:verse) added for
// multi-book editions like Recognitions of Clement — mirrors parseRef's own regex (see
// that file's comment for the matching round-trip bug this was missing half of: the app
// itself GENERATES "Recognitions, Book 10, 41:8"-shaped text via bookChapterVerseLabel,
// which this regex couldn't recognize at all before, so a pasted/typed verse in that
// format never triggered verse-block auto-detection.
// Each book-name word may carry a trailing comma too (`,?` after every word slot, not just
// before "Book N"/the final chapter:verse) — Hermas's canonical bookName() label is
// "Hermas, Visions" / "Hermas, Mandates" / "Hermas, Similitudes" with a comma baked in
// between the two words, and verseClipboard.ts's copy-verse output for those now puts a
// further comma before the chapter:verse too ("Hermas, Similitudes, 35:1 <text>").
export const SINGLE_VERSE_LINE_RE =
  /^(\s*)((?:[1-3][ \t]+)?[A-Za-z][a-z]+,?(?:[ \t]+[A-Za-z][a-z]+,?){0,2}(?:,?[ \t]+Book[ \t]+\d{1,3})?,?[ \t]+\d{1,3}:\d{1,3}(?:[-–]\d{1,3})?)[ \t]+(\S.*)$/
export const VERSE_BODY_LINE_RE = /^\s*\d{1,3}[ \t]+\S/

/**
 * For a single-line block "Book c:v <body>", if the body begins with an "LXX " marker
 * (as produced when copying a Septuagint verse), fold it into the reference label and
 * return the cleaned body. e.g. ("Isaiah 9:12", "LXX But the people…") →
 * { refLabel: "Isaiah 9:12 LXX", body: "But the people…", lxx: true }.
 *
 * `markerLen` is the exact character length of whatever literally-typed marker text
 * (e.g. "LXX ", "lxx  ") was consumed from the FRONT of `body` — callers computing a
 * document decoration span for the ref need this to extend that span past the original
 * ref-only match and actually cover the "LXX" word, since it's still literally sitting in
 * the body's own character range even though it's folded into `refLabel` here (a plain
 * string, not itself a position). Without it (blockDecorations.ts's original bug — see
 * that file's use site), the ref pill's styled span stopped right after "Isaiah 9:12" and
 * "LXX" rendered as unstyled body text, reported as "the LXX text isn't formatted with the
 * rest of the verse reference."
 */
export function splitLeadingLxx(refStr: string, body: string): { refLabel: string; body: string; lxx: boolean; markerLen: number } {
  const m = body.match(/^LXX[ \t]+(\S.*)$/i)
  if (m) return { refLabel: `${refStr} LXX`, body: m[1], lxx: true, markerLen: m[0].length - m[1].length }
  return { refLabel: refStr, body, lxx: false, markerLen: 0 }
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
      // VERSE_BODY_LINE_RE alone ("digit(s) + whitespace + text") can't tell a verse-number
      // body line ("6 And Seth lived...") apart from a numbered-book reference's OWN ref+body
      // line ("2 Peter 3:5 this talks about..." / "1 John 2:4-5 ...") — both match it. Exclude
      // anything that ALSO looks like a full "Book c:v body" line itself (SINGLE_VERSE_LINE_RE),
      // or a BARE reference with no body attached ("1 John 2:4-5" alone, the ref line of a new
      // multi-line block — parseRef succeeds on it directly even without trailing body text) —
      // both are a new block starting, not a continuation of this one.
      if (body.every(l => VERSE_BODY_LINE_RE.test(l) && !SINGLE_VERSE_LINE_RE.test(l) && !parseRef(l.trim()))) {
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
// The final book-word component allows an optional trailing digit run (\d*) so fused
// per-book shorthand ids like "RCL1" (Recognitions of Clement, book 1) — letters directly
// abutting a digit with no space — are captured as one token instead of the required
// whitespace-before-the-chapter-number failing to match at "RCL"+"1" and silently dropping
// the whole reference. parseRef() still has to resolve the captured phrase to a real book,
// so this doesn't introduce false positives beyond what already silently fails downstream.
// Group 2 (optional) captures a "Book N" subdivision (e.g. "Recognitions, Book 10 41:8") —
// Recognitions of Clement's real addressing is 3-level Book.Chapter.Verse; the number is
// re-joined with the book phrase before parseRef() in findVerseRefMatches below, which
// resolves the combined "book + Book N" token to the right per-book id (e.g. RCL10).
// The (?!Book[ \t]+\d) lookaheads (on both the {0,2} prefix-word slots and the final
// required word) keep the ordinary book-phrase word matching from swallowing "Book" as
// a plain word before the explicit group gets a chance — without them, the no-comma form
// "Recognitions Book 10 41:8" matched "Recognitions Book" as the book phrase and silently
// dropped "41:8" (the comma form worked by accident, since a comma isn't part of the
// ordinary prefix-word separator).
// The `,?` immediately before the required `[ \t]+` (right after the "Book N" group) was
// missing entirely — bookChapterVerseLabel (parseRef.ts) GENERATES "Recognitions, Book 10,
// 41:8" with a comma in BOTH spots, but only the first comma was optional here; a comma
// between "Book N" and the chapter:verse broke the match outright (no fallback path), so
// text the app itself produces silently never got auto-linked. Same underlying bug as
// parseRef.ts's own regex and SINGLE_VERSE_LINE_RE above — all three needed the same fix.
// Each ordinary book-name word may also carry a trailing comma (`,?` after every word slot,
// not just before "Book N") — Hermas's canonical bookName() label has one baked in ("Hermas,
// Similitudes"), and its copy-verse output now adds a further comma before the chapter:verse
// too. The comma stays attached to its word when findVerseRefMatches later splits bookPhrase
// on whitespace, so it round-trips through the phrase-reconstruction below unchanged.
const VERSE_REF_SCAN_RE =
  /((?:[1-3][ \t]+)?(?:(?!Book[ \t]+\d)[A-Za-z][a-z]*\.?,?[ \t]+){0,2}(?!Book[ \t]+\d)[A-Za-z][a-z]+\d*\.?,?)(?:,?[ \t]*(Book[ \t]+\d{1,3}))?,?[ \t]+(\d{1,3}(?:[-–]\d{1,3})?(?::\d{1,3}(?:[ \t]*[-–][ \t]*\d{1,3})?)?)([ \t]+LXX\b)?/gi

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
    const bookSub = m[2]
    const numPart = m[3]
    const lxx = !!m[4]
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
      const candidateRef = words.slice(start).join(' ') + (bookSub ? ' ' + bookSub : '') + ' ' + numPart
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
// it. A miss kicks off a background fetch (debounced — see VERSE_LOOKUP_DEBOUNCE_MS
// below), then re-decorates when it resolves.
//
// Every onResolved callback registered while a key is pending gets called once it resolves —
// NOT just the first one. Multiple call sites race to be the "first" caller for the same key on
// the very first redraw of a note (createRefDecorationsPlugin's exclusion-range pass in
// refDecorations.ts calls buildBlockDecorations with a no-op onResolved just to get block
// ranges; blockDecorations.ts's own decorations() prop calls it again with the REAL onResolved
// that dispatches a refresh transaction — a `decorations` prop is invoked for every plugin on
// the same redraw, in plugin-array order, so whichever runs first "wins" the pending slot if
// only the first callback were kept). Calling every registered callback once the fetch resolves
// closes that gap regardless of which caller happened to arrive first.
const verseRatioCache = new Map<string, number>()

// Every distinct (refText, candidate-text) pair typed during a session gets its own cache
// entry, and the debounce above still means a long editing session composing many verse blocks
// accumulates a growing number of unique keys (one per candidate text that ever settled long
// enough to be looked up) — a slow leak with nothing to evict it otherwise. A full LRU is more
// machinery than this needs; capping to "clear everything once it gets large" is cheap and good
// enough for a per-session convenience cache (a cleared entry just means the next lookup for
// that exact text re-fetches, not a correctness issue).
const VERSE_RATIO_CACHE_MAX = 500
function cacheVerseRatio(key: string, ratio: number): void {
  if (verseRatioCache.size >= VERSE_RATIO_CACHE_MAX) verseRatioCache.clear()
  verseRatioCache.set(key, ratio)
}

function verseCacheKey(refText: string, candidate: string): string {
  return refText + ' ' + candidate.replace(/\s+/g, ' ').trim().toLowerCase()
}

// ─── Debounce the actual DB round-trip ─────────────────────────────────────────
// verseCacheKey includes the full candidate BODY text, so while the user is still typing
// inside a verse-block's body, every keystroke produces a fresh cache-miss key — without this,
// each one fired its own undebounced `fetchActualVerseText` IPC round-trip (see that function
// and verseTextAccepted below), with no way to cancel a now-superseded in-flight one. Same
// *shape* of bug as blockHandles.ts's pre-fix per-keystroke gutter rebuild, one layer down (an
// async DB call instead of DOM work) — visually, the `.pm-verse-block-checking` pulse never
// settled to "accepted" while still typing, only once the user paused.
//
// Keyed by refText (not the full cache key) — a debounce keyed on the ever-changing candidate
// text would never coalesce anything, since every keystroke would get its OWN fresh key and
// therefore its own fresh timer. Grouping by refText and always tracking the LATEST candidate
// seen for it is what actually collapses a burst of keystrokes into one eventual fetch.
const VERSE_LOOKUP_DEBOUNCE_MS = 300
interface PendingVerseLookup { key: string; candidate: string; callbacks: Array<() => void> }
const versePendingByRef = new Map<string, PendingVerseLookup>()
const verseDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

interface BibleQueryWindow {
  bible?: { queryChapter?: (b: string, c: number, t?: string) => Promise<Array<{ verse_num: number; text: string; text_tagged?: string }>> }
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
  const taggedParts: string[] = []
  for (let ch = startCh; ch <= endCh; ch++) {
    const verses = await w.bible.queryChapter(ref.bookId, ch, textId)
    if (!Array.isArray(verses)) continue
    for (const v of verses) {
      const inRange = endCh === startCh && ref.verse != null
        ? v.verse_num >= ref.verse && v.verse_num <= (ref.endVerse ?? ref.verse)
        : true
      if (!inRange) continue
      parts.push(v.text)
      taggedParts.push(v.text_tagged ?? '')
    }
  }
  if (!parts.length) return null
  const st = useAppStore.getState()
  // buildVerseDisplayText applies BOTH plain text-pattern rules and Strong's-number rules
  // (e.g. LORD→Yehovah, keyed off the H3068/H3069/H3050 tags in text_tagged) — the same
  // function VerseRow itself uses to render/copy verse text. A plain applyWordReplacer()
  // call here (the previous approach) silently skipped all Strong's-number rules, since
  // those need per-token tag data applyWordReplacer alone doesn't have — so pasting a
  // verse using "Yehovah" (the default LORD-replacement rule) would never actually match
  // the fetched "actual" text, which stayed "the LORD" forever, regardless of settings.
  // Falls back cleanly to plain-text-only replacement for non-KJVA texts (LXX etc, which
  // have no text_tagged) since buildVerseDisplayText only uses tagged tokens when
  // textId === 'kjva' AND every verse actually returned tagged data.
  const hasFullTagCoverage = taggedParts.every((t) => t.trim().length > 0)
  const actual = buildVerseDisplayText(
    parts.join(' '),
    hasFullTagCoverage ? taggedParts.join(' ') : null,
    textId, st.wordReplacerEnabled, st.wordReplacerRules,
  )
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

  // Register/update the pending lookup for this refText — grouped by refText (not the
  // ever-changing `key`) so a burst of keystrokes all landing on the SAME verse-block ref
  // updates one shared record (always pointing at whichever candidate is CURRENT) instead of
  // each keystroke creating its own separate, eventually-abandoned pending entry. Any onResolved
  // callback queued for an earlier, now-superseded candidate still gets called once the debounce
  // finally fires — harmless: it just prompts a repaint, and the doc has moved on since anyway.
  const existing = versePendingByRef.get(refText)
  if (existing) {
    existing.key = key
    existing.candidate = candidate
    existing.callbacks.push(onResolved)
  } else {
    versePendingByRef.set(refText, { key, candidate, callbacks: [onResolved] })
  }

  const existingTimer = verseDebounceTimers.get(refText)
  if (existingTimer) clearTimeout(existingTimer)
  verseDebounceTimers.set(refText, setTimeout(() => {
    verseDebounceTimers.delete(refText)
    const pending = versePendingByRef.get(refText)
    versePendingByRef.delete(refText)
    if (!pending) return
    fetchActualVerseText(refText)
      .then((actual) => {
        // verseTextMatchRatio(candidate, actual) — candidate first, matching its own
        // documented contract ("fraction of CANDIDATE words found in ACTUAL"). These were
        // swapped here, which instead computed "fraction of the real verse's words found in
        // the user's pasted text" against the wrong denominator (actual's word count, not
        // the candidate's) — same rough ballpark for a verbatim paste, but not what the
        // 0.9 threshold is documented/tuned against.
        // A missing/unresolvable verse (bad book/translation, DB miss) is NOT evidence the
        // candidate text is real verse content — fail closed (ratio 0, reject) instead of the
        // previous ratio-1 auto-accept, which silently treated arbitrary trailing text as
        // verified verse text whenever the lookup itself failed for any reason.
        cacheVerseRatio(pending.key, actual ? verseTextMatchRatio(pending.candidate, actual) : 0)
        pending.callbacks.forEach((cb) => cb())
      })
      .catch(() => {
        cacheVerseRatio(pending.key, 0)
        pending.callbacks.forEach((cb) => cb())
      })
  }, VERSE_LOOKUP_DEBOUNCE_MS))

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
