import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, memo, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Copy, NotepadText, X, GitFork, Hash, ExternalLink, BookOpen, Search, Volume2, Tag as TagIcon } from 'lucide-react'
import { TagPickPopover } from '@/components/tags/TagPickPopover'
import { selectionToRanges, chapterRanges, rangesLabel } from '@/lib/verseTagRanges'
import StrongsInline from './StrongsInline'
import type { WordSegment } from './StrongsInline'
import { bookChapterVerseLabel, getTranslationForBook, isDedicatedTranslation } from '@/lib/parseRef'
import { useAppStore } from '@/store'
import { applyWordReplacer, applyStrongsWordReplacer } from '@/lib/wordReplacer'
import { buildVerseDisplayText, mapDisplayOffsetToOriginal, mapOriginalOffsetToDisplay } from '@/lib/verseUtils'
import { navigateToVerse, recordNavigation } from '@/lib/verseNavigation'
import { applyFindHighlight } from '@/lib/highlight'
import { usePositionedMenu, CLOSE_CONTEXT_MENUS_EVENT, dispatchCloseContextMenus } from '@/lib/usePositionedMenu'
import { extractRefsFromNote, refMatchesVerse } from '@/lib/noteRefs'
import type { NoteVerseRef } from '@/lib/noteRefs'
import { getCrossRefSources, reciprocalRefsFor } from '@/lib/crossRefIndex'
import { copyVerse as copyVerseAtRef, copyVerseRef as copyRefOnly } from '@/lib/verseClipboard'
import type { Verse, HighlightColor, Note } from '@/types'
import { RED_LETTER_CLASS, highlightDotColor } from '@/styles/highlightPalette'
import { HIGHLIGHT_COLORS, WORD_HIGHLIGHT_BG, PLAYBACK_WORD_BG, getVerseRowStyle } from './verseRowStyles'
import { splitStrongsHighlight } from '@/lib/strongsSearch'
import { parseTaggedTokens, tokenHasNoPlainText, type TaggedToken } from '@/lib/taggedTokens'
import { stripAnnotations } from '@/lib/annotationFilters'
export type { HighlightColor }
export { HIGHLIGHT_COLORS }

// Full-opacity colors for note indicator dots — mirrors HIGHLIGHT_COLORS palette
export const NOTE_DOT_COLOR: Record<string, string> = {
  yellow: '#facc15', orange: '#fb923c', amber:  '#fbbf24',
  red:    '#f87171', rose:   '#fb7185', pink:   '#f472b6',
  violet: '#a78bfa', purple: '#c084fc', indigo: '#818cf8',
  blue:   '#60a5fa', sky:    '#38bdf8', cyan:   '#22d3ee',
  teal:   '#2dd4bf', green:  '#4ade80', lime:   '#a3e635',
}

interface SelToolbarPos { x: number; y: number; startChar: number; endChar: number }

type HighlightEntry = { id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }

interface VerseRowProps {
  verse: Verse
  showStrongs: boolean
  showVerseNumber?: boolean
  noteCount?: number
  notePrimaryColor?: string
  hasNoteCrossRef?: boolean
  isHighlighted?: boolean
  /** Verse tags on this verse (translation-agnostic) — rendered as angled "luggage tag"
   *  badges looped on the verse number. Absolutely positioned; never shifts verse text. */
  verseTags?: import('@/types').VerseTagLite[]
  highlights?: HighlightEntry[]
  hiddenAnnotations?: string[]
  textId?: string
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  /** Word indices (verse.text.split(' ') convention) to highlight — set briefly after
   *  navigating in from a Strong's-number scripture search result. See ChapterView.tsx. */
  highlightStrongsWords?: number[]
  /** Plain-word part of a combined Strong's+word search ("G5485 god") — highlighted by
   *  text match alongside highlightStrongsWords, not just the Strong's-indexed word(s). */
  highlightStrongsExtraWords?: string[]
  onStrongsClick?: (num: string, verseNum?: number) => void
  onWordClick?: (word: string) => void
  /** Read Aloud (TTS) is currently reading THIS verse — see ChapterView.tsx, which computes
   *  this by comparing the store's audioPlayback state against this row's own book/chapter/verse. */
  playbackVerse?: boolean
  /** Index (SpokenWord.wordIndex — see extractSpokenText.ts) of the word currently being
   *  spoken, only meaningful when playbackVerse is true. null = between words / not yet known. */
  playbackWordIndex?: number | null
  /** The scripture tab this row belongs to — verse selection is scoped per tab. */
  tabId?: string | null
}

/**
 * Indices of tokens that fall inside an LXX supply span — text the Brenton translator
 * added that isn't in the Greek, marked with square brackets in `text_tagged`. A span
 * opens on the token whose word contains '[' and closes on the one containing ']';
 * both single-token (`[is]`) and multi-token (`[It … is]`) spans are covered. Used to
 * drop these tokens when the `lxx_supply` annotation is hidden — the token-level
 * analogue of the `\[…\]` regex strip that stripAnnotations() applies to plain text.
 */
export function supplyBracketIndices(tokens: { word: string }[]): Set<number> {
  const set = new Set<number>()
  let inSupply = false
  tokens.forEach((t, i) => {
    const opens = t.word.includes('[')
    const closes = t.word.includes(']')
    if (inSupply || opens) set.add(i)
    if (opens) inSupply = true
    if (closes) inSupply = false
  })
  return set
}

/**
 * Split a word into highlight-coloured segments based on char-level highlights.
 * `wordCharStart` is the word's absolute offset in `verse.text`.
 * Returns `null` when no charHighlight overlaps this word (caller uses plain text).
 */
function splitWordByHighlights(
  word: string,
  wordCharStart: number,
  charHighlights: { startChar: number | null; endChar: number | null; color: HighlightColor }[],
  bgMap: Record<HighlightColor, string>,
  // The word's length in the ORIGINAL verse.text. Differs from word.length when the
  // word replacer substituted a different-length word (e.g. "LORD" → "Yehovah").
  // Highlights are stored in original-text coords, so coverage is tested against this.
  origLen: number = word.length,
): WordSegment[] | null {
  const coverEnd = wordCharStart + origLen
  const relevant = charHighlights.filter(
    h => h.startChar !== null && h.endChar !== null && h.startChar < coverEnd && h.endChar > wordCharStart
  )
  if (relevant.length === 0) return null

  // Replaced word: sub-word segmentation is meaningless across a substitution, so it's
  // all-or-nothing — paint the whole display word when a highlight covers the original word.
  if (origLen !== word.length) {
    const hl = relevant.find(h => h.startChar! <= wordCharStart && h.endChar! >= coverEnd)
    return hl ? [{ text: word, bg: bgMap[hl.color] }] : null
  }

  // Unchanged word: per-character segmentation (display === original).
  const bounds = new Set<number>([0, word.length])
  for (const hl of relevant) {
    bounds.add(Math.max(0, hl.startChar! - wordCharStart))
    bounds.add(Math.min(word.length, hl.endChar! - wordCharStart))
  }
  const sorted = [...bounds].sort((a, b) => a - b)
  return sorted.slice(0, -1).map((start, i) => {
    const end = sorted[i + 1]
    const absStart = wordCharStart + start
    const absEnd = wordCharStart + end
    // A segment is highlighted if a highlight fully covers it
    const hl = relevant.find(h => h.startChar! <= absStart && h.endChar! >= absEnd)
    return { text: word.slice(start, end), bg: hl ? bgMap[hl.color] : undefined }
  })
}

// stripAnnotations moved to '@/lib/annotationFilters' so ViewerBiblePage.tsx (presenter
// window) can share the exact same regex logic instead of carrying no equivalent at all.

// StrongsInline (showStrongs mode) renders each word with an extra sibling text node for its
// Strong's-number chip (data-strongs-chip, e.g. "G4074") or, for words with no chip, an
// invisible aria-hidden placeholder ("·") that keeps chip-row heights aligned — see
// StrongsInline.tsx. Neither exists in verse.text/the display string this offset is meant to
// align with, but the plain TreeWalker below used to count them anyway, inflating every
// selection's char offset by however many chips/placeholders preceded it. That's what made
// selecting "Peter and John" in Luke 22:8 (showStrongs on) actually highlight a few characters
// to the left ("t Peter and ") — the char offset drifted more with every prior word.
function charOffsetInVerse(node: Node, offset: number, containerEl: HTMLElement): number {
  let pos = 0
  // Walks EVERY text node (no FILTER_REJECT) — a rejecting walker never visits a Strong's-chip/
  // aria-hidden text node at all, so if the browser's actual selection anchor/focus happens to
  // land inside one (a double-click landing exactly on a chip glued to a word, or a drag ending
  // right at that boundary), `curr === node` could never match and this returned -1, silently
  // hiding the whole selection toolbar — "for some words that i select... it doesnt show the
  // menu." Chip/hidden text still doesn't COUNT toward the offset (its `curr.length` isn't
  // real verse text), but landing inside one now resolves to the nearest real boundary instead
  // of failing outright.
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT)
  let curr: Text | null
  while ((curr = walker.nextNode() as Text) !== null) {
    const isAnnotation = !!(curr.parentElement)?.closest('[data-strongs-chip], [aria-hidden]')
    if (curr === node) return pos + (isAnnotation ? 0 : offset)
    if (!isAnnotation) pos += curr.length
  }
  return -1
}

// Cap how many items a hover popup shows so it never grows unmanageably tall.
const MAX_HOVER_ITEMS = 8

// ── TEMP DIAGNOSTIC ──────────────────────────────────────────────────────────────
// Set to true to log every text-selection's offset computation to the console (prefixed
// "[berean-highlight-debug]"), for confirming the Revelation/Recognitions-of-Clement
// highlight-mapping investigation live. See the console.log call in handleVerseMouseUp
// below. Flip back to false — or delete this const and that block — once confirmed;
// this is not meant to ship on.
const HIGHLIGHT_OFFSET_DEBUG = true

/**
 * Decide whether a hover popup should open above or below its trigger, and return the
 * y anchor. `estItemPx` is the approximate height of a single row. Popup is capped to
 * MAX_HOVER_ITEMS so the estimate stays bounded.
 */
function computeHoverPlacement(rect: DOMRect, itemCount: number, estItemPx: number, headerPx = 48): { y: number; placeUp: boolean } {
  const shown = Math.min(itemCount, MAX_HOVER_ITEMS)
  const estHeight = shown * estItemPx + headerPx
  const pad = 8
  const spaceBelow = window.innerHeight - rect.bottom
  // Flip up only if there isn't room below AND there's more room above.
  if (spaceBelow < estHeight + pad && rect.top > spaceBelow) {
    return { y: Math.max(pad, rect.top - estHeight - 4), placeUp: true }
  }
  return { y: rect.bottom + 4, placeUp: false }
}

/** Fetches verse text — renders inline so ref label and text sit on the same line. */
function HoverVerseText({ bookId, chapter, verse }: { bookId: string; chapter: number; verse: number }) {
  const [text, setText] = useState<string | null>(null)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  // Use active scripture tab's translation for canonical books (so LXX refs show LXX text)
  const activeTranslation = useAppStore((s) => {
    const tabId = s.activeTabId['scripture']
    const tab = tabId ? s.tabs['scripture'].find((t) => t.id === tabId) : null
    return (tab?.state as import('@/types').BibleTabState | undefined)?.translation?.toLowerCase() ?? 'kjva'
  })
  useEffect(() => {
    // Resolve the text DB for the REFERENCED book, not the active tab:
    //  - dedicated non-canonical book (Enoch, Jubilees…) → its own DB
    //  - canonical ref while a dedicated text is active (e.g. Luke ref from 1 Enoch) →
    //    fall back to KJVA, not the active 'enoch' DB (which has no Luke)
    //  - canonical ref while a canonical text (KJVA/LXX) is active → keep active (LXX refs show LXX)
    const dedicated = getTranslationForBook(bookId)
    const textId = dedicated ?? (isDedicatedTranslation(activeTranslation) ? 'kjva' : activeTranslation)
    // When verse=0 (chapter-level ref), fetch verse 1 and append ellipsis
    const queryVerse = verse === 0 ? 1 : verse
    window.bible.queryVerse(bookId, chapter, queryVerse, textId)
      .then(v => setText(v?.text ? (verse === 0 ? v.text + '…' : v.text) : null))
      .catch(() => {})
  }, [bookId, chapter, verse, activeTranslation]) // re-fetch when translation changes
  if (!text) return null
  const display = wordReplacerEnabled && wordReplacerRules.length > 0
    ? applyWordReplacer(text, wordReplacerRules) : text
  return <span className="text-[rgb(var(--color-text-muted))] text-[9px]"> {display}</span>
}

/** Expand idiom cache into a flat list of {term, id, meaning} including aliases. */
function variantsFor(term: string): string[] {
  const t = term.trim()
  if (!t) return []
  const variants = [t]
  // possessive
  variants.push(`${t}'s`)
  // plurals: words ending in 'y' (after consonant) → 'ies'
  if (/[^aeiou]y$/i.test(t)) {
    variants.push(`${t.slice(0, -1)}ies`)
  } else if (/[sxz]$/i.test(t) || /[cs]h$/i.test(t)) {
    // ends in s, x, z, ch, sh → add 'es'
    variants.push(`${t}es`)
  } else {
    // default → add 's'
    variants.push(`${t}s`)
  }
  return variants
}

function expandIdiomPatterns(cache: Array<{ id: string; term: string; meaning: string; aliases: string[]; autoVariants: boolean }>) {
  const entries: Array<{ pattern: string; id: string; meaning: string }> = []
  for (const e of cache) {
    const terms = [e.term, ...(e.aliases ?? []).filter(a => a.trim())]
    for (const t of terms) {
      const patterns = e.autoVariants ? variantsFor(t) : [t.trim()]
      for (const p of patterns) {
        if (p) entries.push({ pattern: p, id: e.id, meaning: e.meaning })
      }
    }
  }
  return entries
}

/** Wrap words in `text` that match any idiom term/alias with an underline span. */
function wrapIdiomTerms(
  text: string,
  entries: Array<{ pattern: string; id: string; meaning: string }>,
  onEnter: (e: React.MouseEvent, pattern: string, meaning: string) => void,
  onLeave: () => void,
  onClick: (e: React.MouseEvent, id: string) => void,
  onContextMenu: (e: React.MouseEvent, id: string) => void,
): React.ReactNode {
  if (!entries.length || !text) return text
  // Sort longest first to avoid partial matches overriding longer terms
  const sorted = [...entries].sort((a, b) => b.pattern.length - a.pattern.length)
  const pattern = sorted.map(e => e.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const re = new RegExp(`\\b(${pattern})\\b`, 'gi')
  const parts: React.ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const matched = m[0]
    const entry = sorted.find(e => e.pattern.toLowerCase() === matched.toLowerCase())
    parts.push(
      <span
        key={m.index}
        className="underline decoration-dotted decoration-violet-400 underline-offset-2 cursor-pointer"
        onMouseEnter={(e) => entry && onEnter(e, matched, entry.meaning)}
        onMouseLeave={onLeave}
        onClick={(e) => { e.stopPropagation(); entry && onClick(e, entry.id) }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); entry && onContextMenu(e, entry.id) }}
      >{matched}</span>
    )
    last = m.index + matched.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
}

const EMPTY_TAGS: import('@/types').VerseTagLite[] = []

// Each tag hangs from the top-right corner of the verse number (its bottom-left corner is
// pinned there via transform-origin), rotated up-and-out. Resting: tightly stacked at nearly
// the same angle so they read as ONE little bundle. Hover: they swing apart around that same
// pinned corner. Fixed strings so Tailwind's JIT emits the arbitrary-value classes.
// Rotation ONLY — no per-tag translate. They all pivot around the exact same point, so the
// fan opens like a hand of cards instead of each tag sitting at its own indent/offset.
const TAG_FAN: Array<{ base: string; hover: string }> = [
  { base: '[transform:rotate(-6deg)]',  hover: 'group-hover/vnum:[transform:rotate(-68deg)]' },
  { base: '[transform:rotate(-12deg)]', hover: 'group-hover/vnum:[transform:rotate(-44deg)]' },
  { base: '[transform:rotate(-18deg)]', hover: 'group-hover/vnum:[transform:rotate(-20deg)]' },
  { base: '[transform:rotate(-24deg)]', hover: 'group-hover/vnum:[transform:rotate(4deg)]' },
]

/** Small "luggage tag" badges hinged at the verse number's top-right corner — absolutely
 *  positioned inside the number's `relative` wrapper, so they never shift verse text. They
 *  swing apart around that corner while the number (`group/vnum`) is hovered. */
function VerseTagBadges({ tags }: { tags: import('@/types').VerseTagLite[] }) {
  const openScriptureSearchTab = useAppStore((s) => s.openScriptureSearchTab)
  const shown = tags.slice(0, 4)
  const extra = tags.length - shown.length
  return (
    <div className="absolute right-[2px] top-[9px] pointer-events-none" style={{ width: 0, height: 0 }}>
      {shown.map((t, i) => {
        const fan = TAG_FAN[Math.min(i, TAG_FAN.length - 1)]
        return (
          <button
            key={t.id}
            onClick={(e) => { e.stopPropagation(); openScriptureSearchTab(undefined, { tagIds: [t.id] }) }}
            title={t.name}
            // left/top place the badge's BOTTOM-LEFT corner at the container point (the
            // number's top-right corner); transform-origin matches so rotation pivots there.
            className={`pointer-events-auto absolute transition-transform duration-200 ease-out ${fan.base} ${fan.hover}`}
            style={{ left: 0, bottom: '-2px', transformOrigin: 'left bottom', zIndex: 12 - i }}
          >
            <svg width="15" height="10" viewBox="0 0 36 24" className="block drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.3)]">
              <path
                d="M12 1 H31 a4 4 0 0 1 4 4 V19 a4 4 0 0 1 -4 4 H12 L2 13.8 a3 3 0 0 1 0 -3.6 Z"
                fill={t.color ? highlightDotColor(t.color as HighlightColor) : 'rgb(var(--color-accent))'}
                stroke="rgba(0,0,0,0.25)"
                strokeWidth="1.5"
              />
              <circle cx="8.5" cy="12" r="2.6" fill="rgb(var(--color-surface-1))" stroke="rgba(0,0,0,0.2)" strokeWidth="1" />
            </svg>
          </button>
        )
      })}
      {extra > 0 && (
        <span className="pointer-events-none absolute left-[3px] top-[-8px] text-[7px] font-bold text-[rgb(var(--color-text-muted))]">+{extra}</span>
      )}
    </div>
  )
}
function VerseRow({ verse, showStrongs, showVerseNumber = true, noteCount = 0, notePrimaryColor, hasNoteCrossRef = false, isHighlighted = false, verseTags = EMPTY_TAGS, highlights = [], hiddenAnnotations = [], textId = 'kjva', findQuery = '', findWordMode = 'phrase', highlightStrongsWords, highlightStrongsExtraWords, onStrongsClick, onWordClick, playbackVerse = false, playbackWordIndex = null, tabId }: VerseRowProps) {
  const hasHidden = hiddenAnnotations.length > 0
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const idiomHighlightEnabled = useAppStore((s) => s.idiomHighlightEnabled)
  const idiomHoverPreviewEnabled = useAppStore((s) => s.idiomHoverPreviewEnabled)
  const idiomCache = useAppStore((s) => s.idiomCache)
  const [idiomTooltip, setIdiomTooltip] = useState<{ x: number; y: number; term: string; meaning: string } | null>(null)
  const [idiomContextMenu, setIdiomContextMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  useEffect(() => {
    if (!idiomContextMenu) return
    function onClose() { setIdiomContextMenu(null) }
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
  }, [!!idiomContextMenu])
  // idiomCache rarely changes; recomputing this on every render (highlight, selection,
  // hover state, etc. all re-render this row) was pure waste for every visible verse.
  // Also skip entirely when the feature is off — no reason to pay for it unused.
  const expandedIdioms = useMemo(
    () => (idiomHighlightEnabled ? expandIdiomPatterns(idiomCache) : []),
    [idiomCache, idiomHighlightEnabled],
  )

  // Three-phase Strong's toggle so nothing ever snaps or flashes — the words never move under
  // the reader (BiblePanel also re-pins the anchor verse every frame for the whole sequence):
  //   ON  — chips mount collapsed (grid-rows 0fr), then GROW their height out from under each
  //         word (`chipsOpen`), and only once they're fully out does the line spacing tighten
  //         (`lineTight`).
  //   OFF — the reverse: line spacing loosens first, then the chips retract their height back
  //         into the words, then they unmount.
  const STRONGS_PHASE_MS = 260
  const [renderStrongs, setRenderStrongs] = useState(showStrongs)   // in the DOM
  const [chipsOpen, setChipsOpen] = useState(showStrongs)            // grid-rows 0fr <-> 1fr
  const [lineTight, setLineTight] = useState(showStrongs)            // verse line spacing
  const prevShowStrongsRef = useRef(showStrongs)
  useEffect(() => {
    if (prevShowStrongsRef.current === showStrongs) return
    prevShowStrongsRef.current = showStrongs
    const timers: ReturnType<typeof setTimeout>[] = []
    if (showStrongs) {
      setRenderStrongs(true)
      // next frame so the 0fr -> 1fr transition actually animates from the collapsed state
      const raf = requestAnimationFrame(() => setChipsOpen(true))
      timers.push(setTimeout(() => setLineTight(true), STRONGS_PHASE_MS + 40))
      return () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout) }
    }
    setLineTight(false)
    timers.push(setTimeout(() => setChipsOpen(false), STRONGS_PHASE_MS))
    timers.push(setTimeout(() => setRenderStrongs(false), STRONGS_PHASE_MS * 2 + 40))
    return () => timers.forEach(clearTimeout)
  }, [showStrongs])
  const strippedText = hasHidden ? stripAnnotations(verse.text, textId, hiddenAnnotations) : verse.text
  const shouldReplace = wordReplacerEnabled && wordReplacerRules.length > 0
  const displayText = shouldReplace ? applyWordReplacer(strippedText, wordReplacerRules) : strippedText
  // verseForDisplay uses displayText for word-split rendering; char-offset rendering always uses original verse.text
  const verseForDisplay = (hasHidden || shouldReplace) ? { ...verse, text: displayText } : verse

  // The TRUE on-screen text used to map a DOM selection back to verse.text offsets.
  // For KJVA tagged + Strong's replacement (e.g. LORD→Yehovah, with the preceding "the"
  // suppressed), applyWordReplacer is NOT enough — it skips Strong's-number rules — so the
  // selection coordinates would be off. buildVerseDisplayText reproduces exactly what renders.
  const renderedDisplayText = useMemo(() => (
    (!hasHidden && (textId === 'kjva' || textId === 'lxx') && verse.text_tagged && shouldReplace)
      ? buildVerseDisplayText(verse.text, verse.text_tagged, textId, wordReplacerEnabled, wordReplacerRules)
      : verseForDisplay.text
  ), [hasHidden, textId, verse.text, verse.text_tagged, shouldReplace, wordReplacerEnabled, wordReplacerRules, verseForDisplay.text])
  // Parse text_tagged once per tagged-text change — parseTaggedTokens does per-word
  // regex work, and renderVerseText() runs on every render otherwise.
  const parsedTokens = useMemo(
    () => (verse.text_tagged ? parseTaggedTokens(verse.text_tagged) : null),
    [verse.text_tagged]
  )
  const renderedDisplayTextRef = useRef(renderedDisplayText)
  renderedDisplayTextRef.current = renderedDisplayText
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpVerseNoteToken = useAppStore((s) => s.bumpVerseNoteToken)
  const bumpVersePopoverToken = useAppStore((s) => s.bumpVersePopoverToken)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const openNoteInBiblePanel = useAppStore((s) => s.openNoteInBiblePanel)
  const filterBiblePanelByVerse = useAppStore((s) => s.filterBiblePanelByVerse)
  const openCrossRefsInBiblePanel = useAppStore((s) => s.openCrossRefsInBiblePanel)
  const setCrossRefSource = useAppStore((s) => s.setCrossRefSource)
  const startPlaybackFrom = useAppStore((s) => s.startPlaybackFrom)
  // NOT a useAppStore() subscription: noteChangeToken here is only ever read inside the
  // handleCrossRefIconMouseEnter callback below (to key a cache lookup), never in render
  // output. Subscribing via the hook would re-render every mounted VerseRow in the chapter
  // on ANY note change anywhere in the app, defeating this component's memo() wrap. Reading
  // it fresh from getState() at call time avoids that while still seeing the latest value.
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [crossRefHover, setCrossRefHover] = useState<{ refs: NoteVerseRef[]; x: number; y: number; placeUp: boolean } | null>(null)
  const crossRefHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const crossRefHoverRef = useRef<HTMLDivElement>(null)
  const [noteHover, setNoteHover] = useState<{ verseNotes: Note[]; refNotes: Note[]; x: number; y: number; placeUp: boolean } | null>(null)
  const noteHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noteHoverRef = useRef<HTMLDivElement>(null)

  // computeHoverPlacement's y is only an ESTIMATE (based on item count × a fixed row height),
  // computed before the popup has actually rendered — for a verse near the bottom of the
  // chapter, if the real content is taller than estimated (wrapped note titles, long verse
  // text), the popup can overflow past the bottom of the viewport, visually landing under/over
  // the cursor instead of tucked at its corner. This measures the real rendered size and
  // re-clamps both popups to the viewport, the same two-phase pattern selToolbar uses below.
  useLayoutEffect(() => {
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (noteHover && noteHoverRef.current) {
      const r = noteHoverRef.current.getBoundingClientRect()
      let x = noteHover.x
      let y = noteHover.y
      if (r.right > vw - pad) x = Math.max(pad, vw - r.width - pad)
      if (x < pad) x = pad
      if (r.bottom > vh - pad) y = Math.max(pad, vh - r.height - pad)
      if (y < pad) y = pad
      if (x !== noteHover.x || y !== noteHover.y) setNoteHover(prev => prev ? { ...prev, x, y } : null)
    }
    if (crossRefHover && crossRefHoverRef.current) {
      const r = crossRefHoverRef.current.getBoundingClientRect()
      let x = crossRefHover.x
      let y = crossRefHover.y
      if (r.right > vw - pad) x = Math.max(pad, vw - r.width - pad)
      if (x < pad) x = pad
      if (r.bottom > vh - pad) y = Math.max(pad, vh - r.height - pad)
      if (y < pad) y = pad
      if (x !== crossRefHover.x || y !== crossRefHover.y) setCrossRefHover(prev => prev ? { ...prev, x, y } : null)
    }
  }, [noteHover, crossRefHover])
  type IndicatorMenuData = { type: 'note'; note: Note } | { type: 'verse'; ref: NoteVerseRef }
  const { menu: indicatorMenu, menuRef: indicatorMenuRef, openMenu: openIndicatorMenuRaw, closeMenu: closeIndicatorMenu } =
    usePositionedMenu<IndicatorMenuData>()
  // Right-clicking a note/crossref icon opens this context menu while the cursor is still over
  // the icon that also drives the separate noteHover/crossRefHover preview popups — without
  // clearing those, the preview can visibly disappear a moment later (its own mouseleave timer)
  // right next to the still-open context menu, reading as "the menu went away."
  function openIndicatorMenu(data: IndicatorMenuData & { x: number; y: number }, opts?: { keepCrossRefHover?: boolean }) {
    if (noteHoverTimerRef.current) clearTimeout(noteHoverTimerRef.current)
    if (crossRefHoverTimerRef.current) clearTimeout(crossRefHoverTimerRef.current)
    setNoteHover(null)
    // Right-clicking a verse row that lives INSIDE the cross-ref hover popup keeps that popup
    // up (opts.keepCrossRefHover) — the list should stay visible behind the context menu until
    // the menu itself goes away (option chosen, Escape, or a click outside). See the effect
    // below that closes the popup once the indicator menu has closed.
    if (!opts?.keepCrossRefHover) setCrossRefHover(null)
    openIndicatorMenuRaw(data)
  }

  // Tie the cross-ref hover popup's lifetime to the indicator menu when it was opened from
  // within that popup (see openIndicatorMenu): once the menu closes for any reason, dismiss
  // the popup too.
  const indicatorMenuOpenRef = useRef(false)
  useEffect(() => {
    if (indicatorMenu) {
      indicatorMenuOpenRef.current = true
    } else if (indicatorMenuOpenRef.current) {
      indicatorMenuOpenRef.current = false
      setCrossRefHover(null)
    }
  }, [indicatorMenu])
  const selfTextId = textId ?? 'kjva'
  const activeScriptureTabId = useAppStore((s) => s.activeTabId['scripture'])
  const rowTabId: string | null | undefined = tabId ?? activeScriptureTabId
  const isSelected = useAppStore((s) => (rowTabId ? (s.selectedVersesByTab[rowTabId] ?? []) : []).some(
    (v) => v.bookId === verse.book_id && v.chapter === verse.chapter && v.verse === verse.verse_num && v.textId === selfTextId,
  ))
  const toggleVerseSelection = useAppStore((s) => s.toggleVerseSelection)
  const [popoverAbove, setPopoverAbove] = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [tagPick, setTagPick] = useState<{ rect: DOMRect; scope: 'verse' | 'chapter' } | null>(null)
  const [selToolbar, setSelToolbar] = useState<SelToolbarPos | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverPanelRef = useRef<HTMLDivElement>(null)
  const verseTextRef = useRef<HTMLDivElement>(null)
  const selToolbarRef = useRef<HTMLDivElement>(null)
  const words = verseForDisplay.text.split(' ')

  // Verse-level highlight: legacy (all nulls) or char-level full-verse (0 to text.length)
  const verseHL = highlights.find(h =>
    (h.startWord === null && h.startChar === null) ||
    (h.startChar === 0 && h.endChar === verse.text.length)
  )
  const activeHighlight: HighlightColor | null = verseHL?.color ?? null

  function openPopover(e?: React.MouseEvent) {
    const MENU_W = 180, MENU_H = 240, pad = 8
    if (e) {
      // Position at cursor, clamped to viewport
      const x = Math.max(pad, Math.min(e.clientX, window.innerWidth  - MENU_W - pad))
      const y = Math.max(pad, Math.min(e.clientY, window.innerHeight - MENU_H - pad))
      setPopoverPos({ x, y })
      setPopoverAbove(false) // unused when fixed-positioned; kept for safety
    } else if (popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect()
      setPopoverPos({ x: rect.left, y: rect.bottom + 4 })
      setPopoverAbove(rect.top > window.innerHeight * 0.6)
    }
    dispatchCloseContextMenus()
    setPopoverOpen(true)
    bumpVersePopoverToken()
  }

  useEffect(() => {
    if (!popoverOpen) return
    function onDown(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    function onClose() { setPopoverOpen(false) }
    document.addEventListener('mousedown', onDown)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    }
  }, [popoverOpen])


  const lxxSuffix = textId === 'lxx' ? ' LXX' : ''
  const verseRef = `${bookChapterVerseLabel(verse.book_id, verse.chapter, verse.verse_num)}${lxxSuffix}`

  function copyVerse() {
    const displayText = buildVerseDisplayText(verse.text, verse.text_tagged, textId ?? 'kjva', wordReplacerEnabled, wordReplacerRules)
    navigator.clipboard.writeText(`${verseRef} ${displayText}`).catch(() => {})
    setPopoverOpen(false)
  }

  function copyReference() {
    navigator.clipboard.writeText(verseRef).catch(() => {})
    setPopoverOpen(false)
  }

  async function addVerseNote() {
    const verseRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
    // Title carries the LXX marker so it reads as Septuagint; the note is keyed to its translation.
    const title = `${bookChapterVerseLabel(verse.book_id, verse.chapter, verse.verse_num)}${lxxSuffix}`
    const result = await window.notes.createNote({ type: 'verse', title, verseRef, content: '', textId })
    setPopoverOpen(false)
    if (result.success && result.note) {
      bumpNoteToken()
      bumpVerseNoteToken()
      openNoteInBiblePanel(result.note.id)
    }
  }

  function openVerseNotes() {
    const verseRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
    filterBiblePanelByVerse(verseRef)
    setPopoverOpen(false)
  }

  function playAudioFromHere() {
    startPlaybackFrom(verse.book_id, verse.chapter, verse.verse_num, textId ?? 'kjva')
    setPopoverOpen(false)
  }

  function openVerseCrossRefs() {
    const verseRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
    openCrossRefsInBiblePanel(verseRef)
    setPopoverOpen(false)
  }

  function openNoteCrossRefs() {
    const verseRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
    setCrossRefSource('notes')
    openCrossRefsInBiblePanel(verseRef)
  }

  function handleCrossRefIconMouseEnter(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (crossRefHoverTimerRef.current) clearTimeout(crossRefHoverTimerRef.current)
    crossRefHoverTimerRef.current = setTimeout(async () => {
      const vRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
      try {
        const all: NoteVerseRef[] = []
        const addRef = (ref: NoteVerseRef) => {
          if (ref.bookId === verse.book_id && ref.chapter === verse.chapter && ref.verse === verse.verse_num) return
          if (!all.some(r => r.bookId === ref.bookId && r.chapter === ref.chapter && r.verse === ref.verse)) {
            all.push(ref)
          }
        }

        // ── Forward: refs that THIS verse's own notes point to ──────────────────
        const verseNotes = await window.notes.getVerseNotes(vRef, textId)
        for (const note of verseNotes) {
          for (const ref of extractRefsFromNote(note.content, note.title || 'Untitled')) addRef(ref)
        }

        // ── Backward (reciprocal): notes attached to OTHER verses whose content
        //    references THIS verse → surface those notes' home verses as cross-refs.
        //    Uses the parsed cross-ref index so it catches every ref form
        //    (abbreviations, ranges, whole-chapter), not just exact-name matches.
        try {
          const sources = await getCrossRefSources(useAppStore.getState().noteChangeToken)
          // excludeChapterRefs=true: chapter-level refs ("see Numbers 5") are shown
          // in the ChapterView banner, not in the per-verse hover — they'd be noise here.
          for (const ref of reciprocalRefsFor(sources, verse.book_id, verse.chapter, verse.verse_num, true)) {
            addRef(ref)
          }
        } catch { /* best-effort */ }

        if (all.length > 0) {
          const { y, placeUp } = computeHoverPlacement(rect, all.length, 40)
          setCrossRefHover({ refs: all, x: rect.left, y, placeUp })
        }
      } catch { /* ignore */ }
    }, 300)
  }

  function handleCrossRefIconMouseLeave() {
    if (crossRefHoverTimerRef.current) clearTimeout(crossRefHoverTimerRef.current)
    crossRefHoverTimerRef.current = setTimeout(() => {
      // Don't dismiss it out from under an open context menu that was opened from inside it.
      if (!indicatorMenuOpenRef.current) setCrossRefHover(null)
    }, 150)
  }

  function handleNoteIconMouseEnter(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (noteHoverTimerRef.current) clearTimeout(noteHoverTimerRef.current)
    noteHoverTimerRef.current = setTimeout(async () => {
      const vRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
      try {
        const verseNotes = await window.notes.getVerseNotes(vRef, textId)
        // Also find general notes whose content references this verse
        const humanRef = bookChapterVerseLabel(verse.book_id, verse.chapter, verse.verse_num)
        const candidates = await window.notes.searchNotes(humanRef, 40)
        const verseNoteIds = new Set(verseNotes.map(n => n.id))
        const refNotes: Note[] = []
        for (const note of candidates) {
          if (verseNoteIds.has(note.id)) continue
          const refs = extractRefsFromNote(note.content, note.title || '')
          if (refs.some(r => refMatchesVerse(r, verse.book_id, verse.chapter, verse.verse_num))) {
            refNotes.push(note)
          }
        }
        if (verseNotes.length > 0 || refNotes.length > 0) {
          const { y, placeUp } = computeHoverPlacement(rect, verseNotes.length + refNotes.length, 32)
          setNoteHover({ verseNotes, refNotes, x: rect.left, y, placeUp })
        }
      } catch { /* ignore */ }
    }, 250)
  }

  function handleNoteIconMouseLeave() {
    if (noteHoverTimerRef.current) clearTimeout(noteHoverTimerRef.current)
    noteHoverTimerRef.current = setTimeout(() => setNoteHover(null), 150)
  }

  function handleIdiomEnter(e: React.MouseEvent, term: string, meaning: string) {
    const r = (e.target as HTMLElement).getBoundingClientRect()
    setIdiomTooltip({ x: r.left, y: r.bottom + 4, term, meaning })
  }
  function handleIdiomLeave() { setIdiomTooltip(null) }
  function handleIdiomClick(_e: React.MouseEvent, id: string) {
    setIdiomTooltip(null)
    useAppStore.getState().requestOpenNote(id)
  }
  function handleIdiomContextMenu(e: React.MouseEvent, id: string) {
    setIdiomTooltip(null)
    setIdiomContextMenu({ x: e.clientX, y: e.clientY, id })
  }

  async function applyHighlight(color: HighlightColor) {
    await window.highlights.toggle({
      bookId: verse.book_id,
      chapter: verse.chapter,
      verseNum: verse.verse_num,
      color,
      textId,
      startChar: 0,
      endChar: verse.text.length,
    })
    bumpHighlightToken()
    setPopoverOpen(false)
  }

  async function removeHighlight() {
    const fullVerseHL = highlights.find(h => h.startChar === 0 && h.endChar === verse.text.length)
    if (fullVerseHL) {
      await window.highlights.toggle({
        bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num,
        color: fullVerseHL.color, textId, startChar: 0, endChar: verse.text.length,
      })
    } else {
      await window.highlights.remove(verse.book_id, verse.chapter, verse.verse_num, textId)
    }
    bumpHighlightToken()
    setPopoverOpen(false)
  }

  const MENU_W = 200

  const handleVerseMouseUp = useCallback((e: React.MouseEvent) => {
    // Right-click (button 2) is handled by onContextMenu; skip selection toolbar for it
    // to prevent a second menu appearing when right-clicking over selected text.
    if (e.button === 2) return
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !verseTextRef.current) {
      setSelToolbar(null)
      return
    }
    if (!verseTextRef.current.contains(sel.anchorNode)) {
      setSelToolbar(null)
      return
    }
    if (!verseTextRef.current.contains(sel.focusNode)) {
      setSelToolbar(null)
      return
    }
    const range = sel.getRangeAt(0)

    // Offsets are measured against the rendered (display) text, which may differ from
    // verse.text when the word replacer / annotation hiding is active. Map them back to
    // verse.text positions so the stored char-offset highlight aligns with the selection.
    const rawStart = charOffsetInVerse(range.startContainer, range.startOffset, verseTextRef.current)
    const rawEnd = charOffsetInVerse(range.endContainer, range.endOffset, verseTextRef.current)
    const dispText = renderedDisplayTextRef.current
    const startChar = rawStart < 0 ? -1 : mapDisplayOffsetToOriginal(dispText, verse.text, rawStart)
    const endChar = rawEnd < 0 ? -1 : mapDisplayOffsetToOriginal(dispText, verse.text, rawEnd)

    // ── TEMP DIAGNOSTIC — Revelation/Recognitions-of-Clement highlight investigation ──
    // Flip HIGHLIGHT_OFFSET_DEBUG to false (or delete this block) once the repro is confirmed;
    // not meant to ship. Logs every mouseup's offset computation so a live repro can show
    // whether dispText/verse.text actually diverge on the verse where highlighting fails.
    if (HIGHLIGHT_OFFSET_DEBUG) {
      // eslint-disable-next-line no-console
      console.log('[berean-highlight-debug]', {
        ref: `${verse.book_id} ${verse.chapter}:${verse.verse_num}`,
        textId,
        dispText,
        verseText: verse.text,
        matches: dispText === verse.text,
        rawStart, rawEnd, startChar, endChar,
        toolbarSuppressed: startChar < 0 || endChar <= startChar,
      })
    }

    if (startChar < 0 || endChar <= startChar) {
      setSelToolbar(null)
      return
    }

    // Anchor a corner of the toolbar right at the cursor release point (matching the
    // below-right-then-flip pattern used by usePositionedMenu's context menus elsewhere in the
    // app), rather than centering on the cursor — avoids off-screen placement when the selection
    // spans most of the visible text (bounding rect is huge), and the useLayoutEffect pass below
    // re-clamps against the toolbar's actual measured size once it's rendered.
    const pad = 8
    // Extra breathing room between the cursor and the toolbar's nearest edge — without this,
    // the toolbar's top-left corner could land essentially right where the mouse just
    // released, making an accidental click on it (instead of dismissing the selection) easy.
    const cursorGap = 16
    const vw = window.innerWidth
    const vh = window.innerHeight
    // The toolbar itself has 3 rows of highlight-color dots plus 4 action rows below (copy
    // verse/reference/selection, add note) — roughly 200px tall, NOT a single-row bubble. Using
    // too small an estimate here meant the first-paint placement badly undershot near the
    // bottom of the viewport; the useLayoutEffect re-clamp below then had to yank the toolbar
    // far from the cursor to keep it on screen, which read as "the corner isn't at my cursor."
    const MENU_H_INIT = 210
    let menuX = e.clientX + cursorGap
    if (menuX + MENU_W + pad > vw) menuX = e.clientX - MENU_W - cursorGap
    menuX = Math.max(pad, Math.min(menuX, vw - MENU_W - pad))
    let menuY = e.clientY - MENU_H_INIT - cursorGap
    if (menuY < pad) menuY = e.clientY + cursorGap
    menuY = Math.max(pad, Math.min(menuY, vh - MENU_H_INIT - pad))

    setSelToolbar({ x: menuX, y: menuY, startChar, endChar })
    // `verse.text` is read directly above (not via a ref) to compute startChar/endChar, so
    // it MUST be a dep: an empty deps array here previously froze this closure to whichever
    // verse was mounted first and never picked up a later verse.text for the same VerseRow
    // instance (React reuses instances across chapter navigation when the row's key is just
    // the verse number — see ChapterView.tsx) — every highlight/selection after that point
    // silently mapped offsets against the WRONG chapter's text via mapDisplayOffsetToOriginal's
    // unrelated-text alignment path, producing bogus ranges or (via the startChar<0 guard
    // above) no toolbar at all. This callback is only ever used as this row's own onMouseUp,
    // not handed to a memoized child, so recreating it when verse.text changes is free.
  }, [verse.text])

  // After the selection toolbar renders, measure its actual size and clamp all four edges.
  // useLayoutEffect runs before the browser paints, so there is no visible flicker.
  useLayoutEffect(() => {
    if (!selToolbar || !selToolbarRef.current) return
    const el = selToolbarRef.current
    const r = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = selToolbar.x
    let y = selToolbar.y
    if (r.right  > vw - pad) x = vw - r.width  - pad
    if (x < pad)             x = pad
    if (r.bottom > vh - pad) y = vh - r.height - pad
    if (y < pad)             y = pad
    if (x !== selToolbar.x || y !== selToolbar.y) {
      setSelToolbar(prev => prev ? { ...prev, x, y } : null)
    }
  }, [selToolbar])

  // After the verse-number popover renders, measure its ACTUAL size and re-clamp — the
  // click-position clamp in openPopover() only guesses the height (MENU_H = 240px), but the
  // real panel (6 action rows + a divider + 3 rows of highlight swatches) renders taller than
  // that, so a click near the bottom of the viewport still let it run off-screen. Same
  // measure-then-clamp pattern as the selection toolbar above.
  useLayoutEffect(() => {
    if (!popoverOpen || !popoverPanelRef.current) return
    const el = popoverPanelRef.current
    const r = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = popoverPos.x
    let y = popoverPos.y
    if (r.right  > vw - pad) x = vw - r.width  - pad
    if (x < pad)             x = pad
    if (r.bottom > vh - pad) y = vh - r.height - pad
    if (y < pad)             y = pad
    if (x !== popoverPos.x || y !== popoverPos.y) {
      setPopoverPos({ x, y })
    }
  }, [popoverOpen, popoverPos])

  // Dismiss selection toolbar when clicking away — skip dismissal if click is inside toolbar
  useEffect(() => {
    if (!selToolbar) return
    function onDown(e: MouseEvent) {
      if (selToolbarRef.current?.contains(e.target as Node)) return
      setSelToolbar(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [selToolbar])

  // Remove all highlights overlapping [sc, ec], preserving portions outside that range
  async function removeOverlappingHighlights(sc: number, ec: number) {
    const overlapping = highlights.filter(h =>
      h.startChar !== null && h.endChar !== null &&
      h.startChar < ec && h.endChar > sc
    )
    for (const h of overlapping) {
      // Delete the full highlight by matching its exact range + color
      await window.highlights.toggle({
        bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num,
        color: h.color, textId, startChar: h.startChar!, endChar: h.endChar!,
      })
      // Re-create the portion before the selection
      if (h.startChar! < sc) {
        await window.highlights.toggle({
          bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num,
          color: h.color, textId, startChar: h.startChar!, endChar: sc,
        })
      }
      // Re-create the portion after the selection
      if (h.endChar! > ec) {
        await window.highlights.toggle({
          bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num,
          color: h.color, textId, startChar: ec, endChar: h.endChar!,
        })
      }
    }
    // Also remove legacy verse-level highlight
    if (activeHighlight && !overlapping.some(h => h.startChar === 0 && h.endChar === verse.text.length)) {
      await window.highlights.remove(verse.book_id, verse.chapter, verse.verse_num, textId)
    }
  }

  async function clearSelectionHighlights() {
    const sc = selToolbar?.startChar ?? 0
    const ec = selToolbar?.endChar ?? 0
    setSelToolbar(null)
    window.getSelection()?.removeAllRanges()
    await removeOverlappingHighlights(sc, ec)
    bumpHighlightToken()
  }

  async function applySelectionHighlight(color: HighlightColor) {
    window.getSelection()?.removeAllRanges()
    const sc = selToolbar?.startChar ?? 0
    const ec = selToolbar?.endChar ?? 0
    setSelToolbar(null)
    // Check if selection exactly matches an existing highlight with the same color (toggle off)
    const exactMatch = highlights.find(h =>
      h.startChar === sc && h.endChar === ec && h.color === color
    )
    if (exactMatch) {
      await window.highlights.toggle({
        bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num,
        color, textId, startChar: sc, endChar: ec,
      })
      bumpHighlightToken()
      return
    }
    // Remove/split overlapping highlights, then apply new color
    await removeOverlappingHighlights(sc, ec)
    try {
      await window.highlights.toggle({
        bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num, color, textId,
        startChar: sc, endChar: ec,
      })
    } catch (err) {
      // Previously a silently-swallowed .catch(() => {}) — surface it so a real IPC/SQL
      // failure doesn't look like "nothing happened" (see the highlight-not-applying investigation).
      console.error('[Berean] Failed to save highlight', err)
    }
    bumpHighlightToken()
  }

  // Find-bar: does this verse contain the query? Memoized on the actual inputs so ChapterView
  // passing the same findQuery/findWordMode to every VerseRow doesn't force this string work
  // to redo on every keystroke-triggered render of every OTHER verse in the chapter.
  const isFindMatch = useMemo(() => {
    if (!findQuery.trim()) return false
    const t = verse.text.toLowerCase()
    const q = findQuery.trim().toLowerCase()
    if (findWordMode === 'phrase') return t.includes(q)
    const words = q.split(/\s+/).filter(Boolean)
    if (findWordMode === 'all') return words.every(w => t.includes(w))
    return words.some(w => t.includes(w))
  }, [findQuery, findWordMode, verse.text])

  const baseRowStyle: React.CSSProperties | undefined = getVerseRowStyle({ isHighlighted, activeHighlight, isFindMatch, isPlaybackVerse: playbackVerse })
  // Line-height is animated inline (Tailwind's `leading-*` classes can't transition) and is
  // driven by `lineTight`, which lags the Strong's toggle by one phase (see the STRONGS_PHASE_MS
  // effect above): on toggle-ON the chips grow in first and the lines only close up afterward,
  // so the words never shift under the reader.
  const rowStyle: React.CSSProperties = {
    ...baseRowStyle,
    lineHeight: lineTight ? 1.35 : 1.75,
    transition: `${baseRowStyle?.transition ? baseRowStyle.transition + ', ' : ''}background-color 300ms ease, border-color 300ms ease, margin-bottom 260ms ease, line-height 260ms ease`,
  }

  // Determine rendering mode
  const charHighlights = highlights.filter(h => h.startChar !== null && h.endChar !== null)

  function renderVerseText() {
    // ── Scripture-search Strong's-match highlight ──────────────────────────────
    // Set only briefly (a few seconds) right after navigating in from a Strong's search
    // result — see ChapterView.tsx's flashVerse/targetVerseStrongsWords. Takes priority
    // over every other rendering mode below (red-letter, char highlights, showStrongs
    // chips, etc.) for that short window: the point is showing the user exactly which
    // word matched, not preserving every other visual detail during a transient flash.
    // Word indices come from getOccurrences/searchMultiStrongs, which count words the
    // same way `verse.text.split(' ')` does (see strongsSearch.ts), so splitting the
    // plain, untagged text here lines up correctly without needing text_tagged at all.
    if ((highlightStrongsWords && highlightStrongsWords.length > 0) || (highlightStrongsExtraWords && highlightStrongsExtraWords.length > 0)) {
      return (
        <span>
          {splitStrongsHighlight(verse.text, highlightStrongsWords ?? [], highlightStrongsExtraWords).map((seg, i, arr) => (
            <span key={i}>
              {seg.match
                ? <mark className="bg-yellow-400/30 text-[rgb(var(--color-text-primary))] rounded-sm font-semibold">{seg.text}</mark>
                : seg.text}
              {i < arr.length - 1 ? ' ' : ''}
            </span>
          ))}
        </span>
      )
    }
    // ── KJVA / LXX with text_tagged: unified Strong's + char-highlight rendering ──
    // This handles: showStrongs ON/OFF, kjva_italics hidden/shown, find highlights, and
    // char-level highlights — all simultaneously. Char positions are tracked from the
    // raw (pre-filter) token list so they align with verse.text offsets.
    // Guard `tokens.length`: a truthy-but-tokenless text_tagged (e.g. a stray whitespace
    // string, which parseTaggedTokens yields [] for) would otherwise render an empty
    // <span> — a blank verse with its number badge still showing. Fall through to the
    // plain-text path below, which renders verse.text.
    const taggedTokens = verse.text_tagged ? (parsedTokens ?? parseTaggedTokens(verse.text_tagged)) : null
    if ((textId === 'kjva' || textId === 'lxx') && taggedTokens && taggedTokens.length > 0) {
      const tokens = taggedTokens

      // Compute char start position in verse.text for each token (before any filtering).
      // Parenthetical tokens (~{H853}) have no English word — they don't advance charPos.
      // spokenIndex mirrors extractSpokenText.ts's buildSpokenWords exactly (same skip rule:
      // isParenthetical/isStrongsBracket tokens are never spoken, so they never get an index)
      // — this is what lets Read Aloud's playbackWordIndex line up with the right rendered token.
      let charPos = 0
      let spokenPos = 0
      const tokensWithCharPos = tokens.map(t => {
        const charStart = charPos
        const origLen = t.word.length // length in verse.text, before any word-replacer substitution
        // Parenthetical (~{}), Strong's-bracket (sup>( / sup>)) and empty-word alignment tokens
        // all contribute nothing to verse.text — see tokenHasNoPlainText()'s doc comment.
        const hasSpokenWord = !tokenHasNoPlainText(t)
        if (hasSpokenWord) charPos += t.word.length + 1 // word + trailing space
        const spokenIndex = hasSpokenWord ? spokenPos++ : -1
        return { ...t, charStart, origLen, spokenIndex }
      })

      const hideItalics = hiddenAnnotations.includes('kjva_italics')
      // LXX supply brackets ([word]) live inside `text_tagged` as bracket chars on the
      // span's boundary tokens — stripAnnotations()'s regex only runs on the plain-text
      // (non-tagged) path, so without this the tagged LXX render ignored `lxx_supply`.
      const hideLxxSupply = textId === 'lxx' && hiddenAnnotations.includes('lxx_supply')
      const supplyIdx = hideLxxSupply ? supplyBracketIndices(tokensWithCharPos) : null
      const baseTokens = (hideItalics || supplyIdx)
        ? tokensWithCharPos.filter((t, i) => !(hideItalics && t.isItalic) && !supplyIdx?.has(i))
        : tokensWithCharPos
      // Apply word replacer to each token's word:
      //  1. Text-pattern rules (applyWordReplacer) — skips rules with strongsNum
      //  2. Strong's-number rules (applyStrongsWordReplacer) — KJVA-precise divine name substitution
      const displayTokens = shouldReplace
        ? baseTokens.map(t => {
            if (t.isParenthetical || t.isStrongsBracket) return t
            let word = applyWordReplacer(t.word, wordReplacerRules)
            word = applyStrongsWordReplacer(word, t.strongsNum, wordReplacerRules)
            return { ...t, word }
          })
        : baseTokens

      // When a token is replaced by a Strong's rule (e.g. LORD→Yehovah), the English
      // definite article "the"/"The" that preceded it is now grammatically wrong ("the Yehovah").
      // Build a set of token indices to suppress so neither "the" nor "The" renders.
      const suppressedIndices = new Set<number>()
      if (shouldReplace) {
        const activeStrongsRules = wordReplacerRules.filter(r => r.enabled && r.strongsNum)
        if (activeStrongsRules.length > 0) {
          displayTokens.forEach((t, i) => {
            if (tokenHasNoPlainText(t) || !t.strongsNum) return
            const nums = Array.isArray(t.strongsNum) ? t.strongsNum : [t.strongsNum]
            if (!activeStrongsRules.some(r => nums.includes(r.strongsNum!))) return
            // Walk backwards past brackets/parentheticals/empty tokens to the nearest real word
            for (let j = i - 1; j >= 0; j--) {
              const prev = displayTokens[j]
              if (tokenHasNoPlainText(prev)) continue
              // Strip trailing punctuation then check for definite article
              if (prev.word.replace(/[,;:.!?]+$/, '').toLowerCase() === 'the') {
                suppressedIndices.add(j)
              }
              break
            }
          })
        }
      }

      if (renderStrongs) {
        const highlightMode = findWordMode === 'phrase' ? 'all' : findWordMode
        return (
          <span>
            {displayTokens.map((token, i) => {
              // Suppress "the"/"The" that preceded a Strong's-replaced divine name
              if (suppressedIndices.has(i)) return null
              // Build per-character highlight segments for this word (null = no overlap = plain)
              let wordSegs = token.isParenthetical
                ? null
                : splitWordByHighlights(token.word, token.charStart, charHighlights, WORD_HIGHLIGHT_BG, token.origLen)
              // Read Aloud active-word tint — takes visual priority over a real highlight
              // underneath since it's the exact word being spoken right now (transient, per plan).
              if (playbackVerse && playbackWordIndex != null && token.spokenIndex === playbackWordIndex) {
                wordSegs = [{ text: token.word, bg: PLAYBACK_WORD_BG }]
              }
              // Space after this token — check if it falls within a charHighlight (original-text coords)
              const spaceCharPos = token.charStart + token.origLen
              const spaceHl = !token.isParenthetical && i < displayTokens.length - 1
                ? charHighlights.find(h => h.startChar! <= spaceCharPos && h.endChar! > spaceCharPos)
                : undefined
              return (
                <Fragment key={i}>
                  <StrongsInline
                    word={token.isStrongsBracket ? '' : token.word}
                    strongsNum={token.strongsNum}
                    isItalic={token.isItalic}
                    isRedLetter={token.isRedLetter}
                    isParenthetical={token.isParenthetical}
                    tagged={true}
                    wordSegments={wordSegs ?? undefined}
                    findQuery={wordSegs ? '' : (isFindMatch ? findQuery : '')}
                    findWordMode={highlightMode}
                    onStrongsClick={(num) => onStrongsClick?.(num, verse.verse_num)}
                    onWordClick={onWordClick}
                  />
                  {i < displayTokens.length - 1 && (
                    spaceHl
                      ? <span style={{ backgroundColor: WORD_HIGHLIGHT_BG[spaceHl.color] }}> </span>
                      : ' '
                  )}
                </Fragment>
              )
            })}
          </span>
        )
      }

      // Plain text (no Strong's): skip no-plain-text tokens (parenthetical, alignment brackets and
      // their empty-word halves — the latter would otherwise render as a stray extra space) and
      // "the"-before-divine-name tokens.
      const plainTokens = displayTokens.filter((t, i) => !tokenHasNoPlainText(t) && !suppressedIndices.has(i))
      return (
        <span>
          {plainTokens.map((token, i) => {
            const highlightMode = findWordMode === 'phrase' ? 'all' : findWordMode
            // Per-character highlight segments (null = no overlap)
            let wordSegs = splitWordByHighlights(token.word, token.charStart, charHighlights, WORD_HIGHLIGHT_BG, token.origLen)
            if (playbackVerse && playbackWordIndex != null && token.spokenIndex === playbackWordIndex) {
              wordSegs = [{ text: token.word, bg: PLAYBACK_WORD_BG }]
            }
            // Space highlight (original-text coords)
            const spaceCharPos = token.charStart + token.origLen
            const spaceHl = i < plainTokens.length - 1
              ? charHighlights.find(h => h.startChar! <= spaceCharPos && h.endChar! > spaceCharPos)
              : undefined

            // Word content: segments OR find-highlighted plain text
            const activeIdioms = idiomHighlightEnabled && expandedIdioms.length > 0 ? expandedIdioms : []
            const wordContent = wordSegs
              ? wordSegs.map((seg, si) => (
                  <span key={si} className="transition-colors duration-150 ease-out" style={{ backgroundColor: seg.bg ?? 'transparent', borderRadius: '2px' }}>{seg.text}</span>
                ))
              : isFindMatch
              ? applyFindHighlight(token.word, findQuery, highlightMode)
              : activeIdioms.length
              ? wrapIdiomTerms(token.word, activeIdioms, handleIdiomEnter, handleIdiomLeave, handleIdiomClick, handleIdiomContextMenu)
              : token.word

            return (
              <Fragment key={i}>
                {token.isRedLetter
                  ? <span className={RED_LETTER_CLASS}>{wordContent}</span>
                  : token.isItalic
                  ? <span className="italic opacity-70">{wordContent}</span>
                  : <span>{wordContent}</span>
                }
                {i < plainTokens.length - 1 && (
                  spaceHl
                    ? <span style={{ backgroundColor: WORD_HIGHLIGHT_BG[spaceHl.color] }}> </span>
                    : ' '
                )}
              </Fragment>
            )
          })}
        </span>
      )
    }

    // ── Generic paths (non-kjva, or kjva with char highlights) ─────────────────
    // When hiding annotations OR the word replacer is substituting words (e.g. Jesus→Yeshua),
    // render the display text. Highlights are stored against verse.text, so map their ranges
    // onto the display text before painting — this must cover shouldReplace too, not just
    // hasHidden: a replaced word changes text length exactly like a stripped annotation does,
    // and skipping this branch left the plain `verse.text.slice()` fallback below rendering raw
    // (unreplaced) text while highlight offsets and the selection-toolbar's char mapping both
    // assumed the word-replaced display text was on screen — every highlight after a replaced
    // word then drifted by the replacement's length delta (e.g. "Jesus"→"Yeshua" is +1 char).
    if (hasHidden || shouldReplace) {
      if (charHighlights.length === 0) {
        return <span>{isFindMatch ? applyFindHighlight(verseForDisplay.text, findQuery, findWordMode) : verseForDisplay.text}</span>
      }
      const dispText = verseForDisplay.text
      const dispHls = charHighlights
        .map(h => ({
          s: mapOriginalOffsetToDisplay(dispText, verse.text, h.startChar!),
          e: mapOriginalOffsetToDisplay(dispText, verse.text, h.endChar!),
          color: h.color,
        }))
        .filter(h => h.e > h.s)
      const boundaries = [0, ...dispHls.flatMap(h => [h.s, h.e]), dispText.length]
      const sorted = [...new Set(boundaries)].sort((a, b) => a - b)
      return (
        <span>
          {sorted.slice(0, -1).map((start, i) => {
            const end = sorted[i + 1]
            const seg = dispText.slice(start, end)
            const hl = dispHls.find(h => h.s <= start && h.e >= end)
            return (
              <span
                key={i}
                style={hl ? { backgroundColor: WORD_HIGHLIGHT_BG[hl.color], borderRadius: '2px' } : undefined}
              >{seg}</span>
            )
          })}
        </span>
      )
    }

    if (!renderStrongs && charHighlights.length > 0) {
      // Character-segmented rendering (char highlight takes priority over find overlay)
      const boundaries = [0, ...charHighlights.flatMap(h => [h.startChar!, h.endChar!]), verse.text.length]
      const sorted = [...new Set(boundaries)].sort((a, b) => a - b)
      return (
        <span>
          {sorted.slice(0, -1).map((start, i) => {
            const end = sorted[i + 1]
            const seg = verse.text.slice(start, end)
            const hl = charHighlights.find(h => h.startChar! <= start && h.endChar! >= end)
            return (
              <span
                key={i}
                style={hl ? { backgroundColor: WORD_HIGHLIGHT_BG[hl.color], borderRadius: '2px' } : undefined}
              >{seg}</span>
            )
          })}
        </span>
      )
    }

    if (renderStrongs) {
      // No text_tagged: word-level fallback with clickable lexicon search + char-level highlights
      const highlightMode = findWordMode === 'phrase' ? 'all' : findWordMode
      // Compute per-word char positions from verse.text so they align with charHighlights offsets
      let chPos = 0
      const wordPositions = verse.text.split(' ').map(w => {
        const start = chPos
        chPos += w.length + 1
        return start
      })
      return (
        <span>
          {words.map((word, i) => {
            const wordCharStart = wordPositions[i] ?? 0
            let wordSegs = charHighlights.length > 0
              ? splitWordByHighlights(word, wordCharStart, charHighlights, WORD_HIGHLIGHT_BG)
              : null
            if (playbackVerse && playbackWordIndex === i) wordSegs = [{ text: word, bg: PLAYBACK_WORD_BG }]
            const spaceCharPos = wordCharStart + word.length
            const spaceHl = charHighlights.length > 0 && i < words.length - 1
              ? charHighlights.find(h => h.startChar! <= spaceCharPos && h.endChar! > spaceCharPos)
              : undefined
            return (
              <Fragment key={i}>
                <StrongsInline
                  word={word}
                  strongsNum={null}
                  wordSegments={wordSegs ?? undefined}
                  findQuery={wordSegs ? '' : (isFindMatch ? findQuery : '')}
                  findWordMode={highlightMode}
                  onStrongsClick={(num) => onStrongsClick?.(num, verse.verse_num)}
                  onWordClick={onWordClick}
                />
                {i < words.length - 1 && (
                  spaceHl
                    ? <span style={{ backgroundColor: WORD_HIGHLIGHT_BG[spaceHl.color] }}> </span>
                    : ' '
                )}
              </Fragment>
            )
          })}
        </span>
      )
    }

    const activeIdioms = idiomHighlightEnabled && expandedIdioms.length > 0 ? expandedIdioms : []

    // Plain / word-level rendering — apply find highlight
    if (isFindMatch && charHighlights.length === 0) {
      return <span>{applyFindHighlight(verseForDisplay.text, findQuery, findWordMode)}</span>
    }

    // Word-level rendering (with space highlighting fix). Char-offset highlights
    // (charHighlights — the format every highlight created through the current UI uses)
    // need char positions computed from the ORIGINAL verse.text, same as the showStrongs
    // branch above — this branch was previously checking ONLY the legacy startWord/endWord
    // fields, which are always null for a current-format highlight, so highlights never
    // rendered here at all (the default reading state for every text except KJVA/LXX,
    // which hit a different, already-correct branch earlier in this function).
    let chPos = 0
    const wordPositions = verse.text.split(' ').map(w => {
      const start = chPos
      chPos += w.length + 1
      return start
    })
    return (
      <span>
        {words.map((word, i) => {
          const wHL = highlights.find(h => h.startWord !== null && h.startWord <= i && i <= (h.endWord ?? i))
          const wordCharStart = wordPositions[i] ?? 0
          let wordSegs = charHighlights.length > 0
            ? splitWordByHighlights(word, wordCharStart, charHighlights, WORD_HIGHLIGHT_BG)
            : null
          const isPlaybackWord = playbackVerse && playbackWordIndex === i
          if (isPlaybackWord) wordSegs = [{ text: word, bg: PLAYBACK_WORD_BG }]
          const wordContent = activeIdioms.length
            ? wrapIdiomTerms(word, activeIdioms, handleIdiomEnter, handleIdiomLeave, handleIdiomClick, handleIdiomContextMenu)
            : word
          return (
            <Fragment key={i}>
              {wordSegs ? (
                <span data-word={i}>
                  {wordSegs.map((seg, si) => (
                    <span key={si} className="transition-colors duration-150 ease-out" style={{ backgroundColor: seg.bg ?? 'transparent', borderRadius: '2px' }}>{seg.text}</span>
                  ))}
                </span>
              ) : (
                <span
                  data-word={i}
                  className="transition-colors duration-150 ease-out"
                  style={
                    isPlaybackWord ? { backgroundColor: PLAYBACK_WORD_BG, borderRadius: '2px', padding: '1px 0' }
                    : wHL ? { backgroundColor: WORD_HIGHLIGHT_BG[wHL.color], borderRadius: '2px', padding: '1px 0' } : { backgroundColor: 'transparent' }
                  }
                >{wordContent}</span>
              )}
              {i < words.length - 1 && (() => {
                const spaceCharPos = wordCharStart + word.length
                const spaceCharHL = charHighlights.length > 0
                  ? charHighlights.find(h => h.startChar! <= spaceCharPos && h.endChar! > spaceCharPos)
                  : undefined
                if (spaceCharHL) return <span style={{ backgroundColor: WORD_HIGHLIGHT_BG[spaceCharHL.color] }}> </span>
                const spaceHL = highlights.find(h => h.startWord !== null && h.startWord! <= i && i < (h.endWord ?? -1))
                return spaceHL
                  ? <span style={{ backgroundColor: WORD_HIGHLIGHT_BG[spaceHL.color] }}> </span>
                  : ' '
              })()}
            </Fragment>
          )
        })}
      </span>
    )
  }

  return (
    <div
      data-verse={verse.verse_num}
      className={`flex gap-3 group relative ${lineTight ? 'mb-1' : 'mb-3'} ${chipsOpen ? 'strongs-chips-open' : ''} ${isSelected ? 'rounded bg-[rgb(var(--color-accent))/8] ring-1 ring-inset ring-[rgb(var(--color-accent))/30]' : ''}`}
      style={rowStyle}
    >
      {/* Verse number + popover anchor — hidden when showVerseNumber is off;
           right-clicking the verse text still opens the popover in that case */}
      <div className={`group/vnum relative flex-shrink-0 ${showVerseNumber ? '' : 'w-0 overflow-hidden'}`} ref={popoverRef}>
        <button
          onClick={(e) => {
            e.stopPropagation()
            toggleVerseSelection(rowTabId, { bookId: verse.book_id, chapter: verse.chapter, verse: verse.verse_num, textId: selfTextId })
          }}
          onContextMenu={(e) => { e.preventDefault(); openPopover(e) }}
          title={isSelected ? 'Deselect verse' : 'Select verse'}
          className={`
            inline-flex items-center justify-center text-[0.72em] font-medium leading-none
            h-[1.5em] rounded-[0.4em] cursor-pointer select-none transition-colors
            ${isSelected
              ? 'text-white bg-[rgb(var(--color-accent))] font-semibold hover:brightness-110 shadow-sm'
              : isHighlighted
                ? 'text-[rgb(var(--color-accent))] font-semibold'
                : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/10]'
            }
          `}
          style={{ width: '1.9em', minWidth: '1.9em' }}
        >
          {verse.verse_num}
        </button>
        {verseTags.length > 0 && <VerseTagBadges tags={verseTags} />}

        {popoverOpen && (
          <div
            // .context-menu for the border/shadow (flat, not .glass-panel's blur) — but with
            // the background opacity overridden via inline style to ~94% instead of fully
            // opaque: 100% opaque read as too flat/heavy for this single-verse popover
            // specifically, while the multi-verse selection toolbar below (same family of
            // menu) needed the opposite nudge (was too transparent, not enough contrast
            // against selected/highlighted text) — so each gets its own explicit background
            // opacity rather than sharing one value that can't satisfy both at once.
            ref={popoverPanelRef}
            className="fixed z-[100] min-w-[160px] rounded-shell context-menu overflow-hidden py-1"
            style={{ left: popoverPos.x, top: popoverPos.y, backgroundColor: 'rgb(var(--color-surface-2) / 0.94)' }}
          >
            <button
              onClick={copyVerse}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <Copy size={12} className="text-[rgb(var(--color-text-muted))]" />
              Copy verse
            </button>
            <button
              onClick={copyReference}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <Hash size={12} className="text-[rgb(var(--color-text-muted))]" />
              Copy reference
            </button>
            <button
              onClick={addVerseNote}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <NotepadText size={12} className="text-[rgb(var(--color-text-muted))]" />
              Add note
            </button>
            <button
              onClick={() => { openVerseNotes(); setPopoverOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <NotepadText size={12} className="text-[rgb(var(--color-text-muted))]" />
              Show all notes
            </button>
            <button
              onClick={openVerseCrossRefs}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <GitFork size={12} className="text-[rgb(var(--color-text-muted))]" />
              Show cross references
            </button>
            <button
              onClick={playAudioFromHere}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <Volume2 size={12} className="text-[rgb(var(--color-text-muted))]" />
              Play audio from here
            </button>
            <button
              onClick={(e) => { setTagPick({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), scope: 'verse' }); setPopoverOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <TagIcon size={12} className="text-[rgb(var(--color-text-muted))]" />
              Tag verse…
            </button>
            <div className="h-px bg-[rgb(var(--color-surface-4))] my-1" />
            <div className="px-3 py-2 space-y-1.5">
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-1.5">
                  {HIGHLIGHT_COLORS.slice(row * 5, row * 5 + 5).map((c) => (
                    <button
                      key={c.id}
                      onClick={() => applyHighlight(c.id)}
                      title={c.label}
                      style={{ backgroundColor: c.dot }}
                      className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 ${activeHighlight === c.id ? 'ring-2 ring-white/70 ring-offset-1' : ''}`}
                    />
                  ))}
                  {row === 2 && activeHighlight && (
                    <button
                      onClick={removeHighlight}
                      title="Remove highlight"
                      className="ml-1 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>

          </div>
        )}
      </div>

      {/* Verse text */}
      <div
        ref={verseTextRef}
        data-verse-text="true"
        onMouseUp={handleVerseMouseUp}
        onContextMenu={(e) => { e.preventDefault(); openPopover(e) }}
        className="flex-1 min-w-0 text-[rgb(var(--color-text-primary))] transition-[line-height] duration-300"
        // The row wrapper's own `leading-snug`/`leading-relaxed` classes above are meant to
        // respond to showStrongs, but a Tailwind `leading-*` class on the PARENT has nothing of
        // its own to apply line-height to once this child sets its own inline line-height —
        // inline style on a descendant always wins, so toggling Strong's used to only change
        // margin, not the actual verse-text line spacing (silently smaller density change than
        // the code appeared to intend, snapping instantly since there was no transition either).
        // Scale relative to the user's own compact/comfortable/spacious line-height setting
        // (--line-height-comfortable, synced from Settings in App.tsx) rather than a fixed
        // number, so Strong's mode stays "somewhat denser than whatever this user already
        // chose," not an independent value that ignores their preference.
        // `lineTight` (not `showStrongs`) so the density change lands a beat AFTER the chips
        // have grown in on toggle-on — words don't shift under the reader mid-appearance.
        style={{ lineHeight: lineTight ? 'calc(var(--line-height-comfortable) * 0.82)' : 'var(--line-height-comfortable)' }}
      >
        {renderVerseText()}
      </div>

      {/* ── Verse annotation pill (notes + cross-refs) ─────────────────────── */}
      {(noteCount > 0 || hasNoteCrossRef) && (
        <div className="flex-shrink-0 self-start mt-[3px] ml-0.5">
          {/* Pill wraps both icons when both present; bare icon when solo */}
          <div className={
            noteCount > 0 && hasNoteCrossRef
              ? 'flex items-center gap-px rounded-full border border-[rgb(var(--color-surface-3))] bg-[rgb(var(--color-surface-2))] px-1.5 py-0.5'
              : 'flex items-center'
          }>

            {/* Note indicator — color reflects the first note's assigned color */}
            {noteCount > 0 && (
              <button
                onMouseEnter={handleNoteIconMouseEnter}
                onMouseLeave={handleNoteIconMouseLeave}
                onClick={openVerseNotes}
                className="flex items-center gap-0.5 opacity-75 hover:opacity-100 cursor-pointer leading-none select-none transition-opacity"
                style={{ color: NOTE_DOT_COLOR[notePrimaryColor ?? 'blue'] ?? NOTE_DOT_COLOR.blue }}
              >
                <span className="w-[5px] h-[5px] rounded-full bg-current" />
                {noteCount > 1 && <span className="text-[9px] font-semibold">{noteCount}</span>}
              </button>
            )}

            {/* Divider between the two icons */}
            {noteCount > 0 && hasNoteCrossRef && (
              <div className="w-px h-2.5 bg-[rgb(var(--color-surface-4))] mx-1" />
            )}

            {/* Cross-ref indicator — verse/range specific only (chapter refs shown at chapter level) */}
            {hasNoteCrossRef && (
              <button
                onMouseEnter={handleCrossRefIconMouseEnter}
                onMouseLeave={handleCrossRefIconMouseLeave}
                onClick={openNoteCrossRefs}
                className="flex items-center text-[rgb(var(--color-text-muted))] opacity-75 hover:opacity-100 hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-opacity"
              >
                <GitFork size={10} strokeWidth={2.5} />
              </button>
            )}
          </div>

          {/* Note hover popup */}
          {noteHover && createPortal(
            (() => {
              // Cap total items across both sections, prioritizing direct verse notes.
              const vnShown = noteHover.verseNotes.slice(0, MAX_HOVER_ITEMS)
              const rnBudget = Math.max(0, MAX_HOVER_ITEMS - vnShown.length)
              const rnShown = noteHover.refNotes.slice(0, rnBudget)
              const total = noteHover.verseNotes.length + noteHover.refNotes.length
              const hiddenCount = total - vnShown.length - rnShown.length
              return (
            <div
              ref={noteHoverRef}
              className="fixed z-[9999] w-[260px] max-h-[420px] overflow-y-auto rounded-shell glass-panel"
              style={{ left: noteHover.x, top: noteHover.y }}
              onMouseEnter={() => { if (noteHoverTimerRef.current) clearTimeout(noteHoverTimerRef.current) }}
              onMouseLeave={() => setNoteHover(null)}
            >
              {/* Note hover header */}
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[rgb(var(--color-surface-3))] sticky top-0 bg-[rgb(var(--color-surface-1))] z-10">
                <p className="text-[9px] text-[rgb(var(--color-text-muted))] font-semibold uppercase tracking-wide">
                  {total === 1 ? '1 Note' : `${total} Notes`}
                </p>
                <button
                  onClick={() => { setNoteHover(null); openVerseNotes() }}
                  className="flex items-center gap-1 text-[9px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                >
                  <ExternalLink size={9} />
                  All in panel
                </button>
              </div>

              {/* Direct verse notes — cross-translation badges show which version a note belongs to */}
              {vnShown.map((note) => {
                // Show a translation badge when the note is from a different translation than the current view.
                // LXX badge: KJV view showing an LXX note.  KJV badge: LXX view showing a KJV note.
                const isCrossLxx  = note.textId === 'lxx'  && textId !== 'lxx'
                const isCrossKjva = (note.textId === 'kjva' || note.textId == null) && textId === 'lxx'
                return (
                  <button
                    key={note.id}
                    onClick={() => { setNoteHover(null); openNoteInBiblePanel(note.id) }}
                    onContextMenu={(e) => { e.preventDefault(); openIndicatorMenu({ type: 'note', note, x: e.clientX, y: e.clientY }) }}
                    className="w-full text-left px-3 py-1.5 hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors border-b border-[rgb(var(--color-surface-2))] last:border-0 group"
                  >
                    <p className="flex items-center gap-1 text-[10px] font-medium text-[rgb(var(--color-text-primary))] group-hover:text-[rgb(var(--color-accent))] line-clamp-1 transition-colors">
                      {isCrossLxx && (
                        <span className="shrink-0 inline-block px-1 py-px text-[7px] font-bold uppercase tracking-wide rounded bg-blue-500/20 text-blue-400 border border-blue-500/30">
                          LXX
                        </span>
                      )}
                      {isCrossKjva && (
                        <span className="shrink-0 inline-block px-1 py-px text-[7px] font-bold uppercase tracking-wide rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          KJV
                        </span>
                      )}
                      {note.title || 'Untitled'}
                    </p>
                    {note.content && (
                      <p className="text-[9px] text-[rgb(var(--color-text-muted))] line-clamp-1 mt-px">
                        {note.content.replace(/^---[\s\S]*?---\s*/m, '').replace(/[#*`>\[\]]/g, '').slice(0, 80)}
                      </p>
                    )}
                  </button>
                )
              })}

              {/* Referencing general notes — separated by a labelled divider */}
              {rnShown.length > 0 && (
                <>
                  <div className="flex items-center gap-2 px-3 py-1 bg-[rgb(var(--color-surface-2))]">
                    <div className="h-px flex-1 bg-[rgb(var(--color-surface-4))]" />
                    <span className="text-[8px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] opacity-70 whitespace-nowrap">
                      also references
                    </span>
                    <div className="h-px flex-1 bg-[rgb(var(--color-surface-4))]" />
                  </div>
                  {rnShown.map((note) => (
                    <button
                      key={note.id}
                      onClick={() => { setNoteHover(null); openNoteInBiblePanel(note.id) }}
                      onContextMenu={(e) => { e.preventDefault(); openIndicatorMenu({ type: 'note', note, x: e.clientX, y: e.clientY }) }}
                      className="w-full text-left px-3 py-1.5 hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors border-b border-[rgb(var(--color-surface-2))] last:border-0 group"
                    >
                      <p className="text-[10px] font-medium text-[rgb(var(--color-text-primary))] group-hover:text-[rgb(var(--color-accent))] line-clamp-1 transition-colors">
                        {note.title || 'Untitled'}
                      </p>
                      {note.content && (
                        <p className="text-[9px] text-[rgb(var(--color-text-muted))] line-clamp-1 mt-px">
                          {note.content.replace(/^---[\s\S]*?---\s*/m, '').replace(/[#*`>\[\]]/g, '').slice(0, 80)}
                        </p>
                      )}
                    </button>
                  ))}
                </>
              )}
              {hiddenCount > 0 && (
                <button
                  onClick={() => { setNoteHover(null); openVerseNotes() }}
                  className="w-full text-center px-3 py-1.5 text-[9px] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors sticky bottom-0 bg-[rgb(var(--color-surface-1))]"
                >
                  +{hiddenCount} more — open all in panel
                </button>
              )}
            </div>
              )
            })(),
            document.body
          )}

          {/* Cross-ref hover popup */}
          {crossRefHover && createPortal(
            <div
              ref={crossRefHoverRef}
              className="fixed z-[9999] w-[280px] max-h-[400px] overflow-y-auto rounded-shell glass-panel"
              style={{ left: crossRefHover.x, top: crossRefHover.y }}
              onMouseEnter={() => { if (crossRefHoverTimerRef.current) clearTimeout(crossRefHoverTimerRef.current) }}
              onMouseLeave={() => { if (!indicatorMenu) setCrossRefHover(null) }}
            >
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-[rgb(var(--color-surface-3))] sticky top-0 bg-[rgb(var(--color-surface-1))] z-10">
                <p className="text-[9px] text-[rgb(var(--color-text-muted))] font-semibold uppercase tracking-wide">
                  Note Cross-References
                </p>
                <button
                  onClick={() => { setCrossRefHover(null); openNoteCrossRefs() }}
                  className="flex items-center gap-1 text-[9px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                >
                  <ExternalLink size={9} />
                  Open in panel
                </button>
              </div>
              {crossRefHover.refs.slice(0, MAX_HOVER_ITEMS).map((r, i) => (
                <button
                  key={i}
                  onContextMenu={(e) => { e.preventDefault(); openIndicatorMenu({ type: 'verse', ref: r, x: e.clientX, y: e.clientY }, { keepCrossRefHover: true }) }}
                  onClick={() => {
                    setCrossRefHover(null)
                    navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, origin: { kind: 'cross-ref', source: 'notes', fromVerse: verse.verse_num } })
                  }}
                  className="w-full text-left px-3 py-1 hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors border-b border-[rgb(var(--color-surface-2))] last:border-0 group"
                >
                  <p className="text-[9px]" style={{ lineHeight: 1.1 }}>
                    <span className="font-mono font-semibold text-[rgb(var(--color-accent))] group-hover:underline">{r.verse > 0 ? bookChapterVerseLabel(r.bookId, r.chapter, r.verse) : bookChapterVerseLabel(r.bookId, r.chapter)}</span>
                    <HoverVerseText bookId={r.bookId} chapter={r.chapter} verse={r.verse} />
                  </p>
                </button>
              ))}
              {crossRefHover.refs.length > MAX_HOVER_ITEMS && (
                <button
                  onClick={() => { setCrossRefHover(null); openNoteCrossRefs() }}
                  className="w-full text-center px-3 py-1.5 text-[9px] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
                >
                  +{crossRefHover.refs.length - MAX_HOVER_ITEMS} more — open all in panel
                </button>
              )}
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Selection toolbar — context menu. Explicit fully-opaque backgroundColor (not just
          the .context-menu class, which should already be 100% opaque on its own) — this
          menu was reported as reading too see-through, particularly since it floats directly
          over selected/highlighted verse text, so making the override explicit here removes
          any doubt about cascade/specificity rather than relying on the shared class alone. */}
      {selToolbar && createPortal(
        <div
          ref={selToolbarRef}
          className="fixed z-[9999] min-w-[180px] rounded-shell context-menu overflow-hidden py-1"
          style={{ left: selToolbar.x, top: selToolbar.y, backgroundColor: 'rgb(var(--color-surface-2))' }}
        >
          {/* Color dot rows (3 rows × 5 colors) */}
          <div className="px-3 py-2 space-y-1.5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-1.5">
                {HIGHLIGHT_COLORS.slice(row * 5, row * 5 + 5).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => applySelectionHighlight(c.id)}
                    title={c.label}
                    style={{ backgroundColor: c.dot }}
                    className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 flex-shrink-0 ${activeHighlight === c.id ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-[rgb(var(--color-surface-1))]' : ''}`}
                  />
                ))}
                {row === 2 && (
                  <button
                    onClick={clearSelectionHighlights}
                    title="Clear highlights"
                    className="ml-1 text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            onClick={() => { copyVerse(); setSelToolbar(null) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <Copy size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Copy verse
          </button>
          <button
            onClick={() => { copyReference(); setSelToolbar(null) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <Hash size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Copy reference
          </button>
          <button
            onClick={() => {
              const text = window.getSelection()?.toString() ?? ''
              navigator.clipboard.writeText(text).catch(() => {})
              window.getSelection()?.removeAllRanges()
              setSelToolbar(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <Copy size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Copy selection
          </button>
          <div className="h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            onClick={() => { addVerseNote(); setSelToolbar(null) }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <NotepadText size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Add note to verse
          </button>
          <button
            onClick={() => {
              const text = window.getSelection()?.toString() ?? ''
              useAppStore.getState().openScriptureSearchTab(text)
              setSelToolbar(null)
            }}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <Search size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Open in new Advanced Search tab
          </button>
        </div>,
        document.body
      )}

      {/* ── Indicator right-click context menu ── */}
      {indicatorMenu && createPortal(
        <div
          ref={indicatorMenuRef}
          style={{ position: 'fixed', left: indicatorMenu.x, top: indicatorMenu.y, zIndex: 9999 }}
          className="min-w-44 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl p-1 text-xs"
        >
          {indicatorMenu.type === 'note' ? (
            <>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => { closeIndicatorMenu(); openNoteInBiblePanel(indicatorMenu.note.id) }}
              >
                <NotepadText size={12} />
                Open in panel
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  useAppStore.getState().requestOpenNote(indicatorMenu.note.id)
                  useAppStore.getState().setActiveSpace('notes')
                }}
              >
                <ExternalLink size={12} />
                Open in new tab
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  window.app.openFloatingTab('notes', { noteId: indicatorMenu.note.id })
                  useAppStore.getState().bumpFloatingTabToken()
                }}
              >
                <ExternalLink size={12} />
                Open in floating tab
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, origin: { kind: 'cross-ref', source: 'notes', fromVerse: verse.verse_num } })
                }}
              >
                <BookOpen size={12} />
                Open verse
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  const s = useAppStore.getState()
                  // Canonical ref opened from a dedicated text (e.g. Luke from 1 Enoch) → KJVA, not 'enoch'
                  const translation = (getTranslationForBook(r.bookId) ?? (isDedicatedTranslation(textId) ? 'kjva' : textId) ?? 'kjva').toUpperCase()
                  const title = bookChapterVerseLabel(r.bookId, r.chapter)
                  const originTabId = s.activeTabId[s.activeSpace] ?? undefined
                  s.addTab({
                    id: `bible-${Date.now()}`, spaceId: 'scripture', type: 'bible', title,
                    state: { bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, translation, showStrongs: false, scrollPosition: 0 },
                    ...(originTabId ? { originTabId, originSpaceId: s.activeSpace } : {}),
                  })
                  // Same origin as "Open verse" above — this menu's other cross-ref jump, just
                  // opened in a new tab instead of in-place. Previously bypassed recording
                  // entirely (only "Open verse" was wired), which per investigation was the
                  // dominant reason a real testing session recorded almost nothing: exploring
                  // cross-refs via "new tab" is a very natural habit and every one of those
                  // clicks was silently lost.
                  recordNavigation(
                    { bookId: verse.book_id, chapter: verse.chapter, verse: verse.verse_num },
                    { bookId: r.bookId, chapter: r.chapter, verse: r.verse },
                    { kind: 'cross-ref', source: 'notes', fromVerse: verse.verse_num },
                  )
                }}
              >
                <BookOpen size={12} />
                Open in new tab
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  const s = useAppStore.getState()
                  s.ensureTab('bible')
                  window.app.openFloatingTab('bible', { bookId: r.bookId, chapter: String(r.chapter), targetVerse: String(r.verse) })
                  s.bumpFloatingTabToken()
                  // Recording is a main-window concept (Study Trail's whole recorder lives
                  // there) — the verse itself opens in a separate floating window, but the
                  // navigational tangent the user took is still real and worth recording from
                  // here, same as "Open in new tab" above.
                  recordNavigation(
                    { bookId: verse.book_id, chapter: verse.chapter, verse: verse.verse_num },
                    { bookId: r.bookId, chapter: r.chapter, verse: r.verse },
                    { kind: 'cross-ref', source: 'notes', fromVerse: verse.verse_num },
                  )
                }}
              >
                <ExternalLink size={12} />
                Open in floating tab
              </button>
              <div className="my-1 h-px bg-[rgb(var(--color-surface-4))]" />
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={async () => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  const v = await window.bible.queryVerse(r.bookId, r.chapter, r.verse).catch(() => null)
                  copyVerseAtRef(r.bookId, r.chapter, r.verse, v?.text ?? '')
                }}
              >
                <Copy size={12} />
                Copy verse
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  copyRefOnly(r.bookId, r.chapter, r.verse)
                }}
              >
                <Hash size={12} />
                Copy reference
              </button>
            </>
          )}
        </div>,
        document.body
      )}

      {/* Idiom hover tooltip */}
      {idiomTooltip && idiomHoverPreviewEnabled && createPortal(
        <div
          className="fixed z-[9999] max-w-[220px] rounded-shell glass-panel px-3 py-2 pointer-events-none"
          style={{ left: idiomTooltip.x, top: idiomTooltip.y }}
        >
          <div className="text-[10px] font-semibold text-violet-400 mb-0.5">{idiomTooltip.term}</div>
          {idiomTooltip.meaning && <div className="text-xs text-[rgb(var(--color-text-secondary))]">{idiomTooltip.meaning}</div>}
          <div className="text-[9px] text-[rgb(var(--color-text-muted))] mt-1 opacity-70">Click to open · Right-click for more</div>
        </div>,
        document.body
      )}

      {/* Idiom word right-click context menu */}
      {idiomContextMenu && createPortal(
        <>
          <div className="fixed inset-0 z-[9998]" onClick={() => setIdiomContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setIdiomContextMenu(null) }} />
          <div
            className="fixed z-[9999] min-w-[170px] rounded-shell glass-panel py-1"
            style={{ left: Math.min(idiomContextMenu.x, window.innerWidth - 200), top: Math.min(idiomContextMenu.y, window.innerHeight - 160) }}
          >
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => { setIdiomContextMenu(null); useAppStore.getState().requestOpenNote(idiomContextMenu.id) }}
            >
              Open idiom note
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => {
                const cid = idiomContextMenu.id; setIdiomContextMenu(null)
                const s = useAppStore.getState()
                const originTabId = s.activeTabId[s.activeSpace] ?? undefined
                s.addTab({
                  id: `note-${cid}-${Date.now()}`, type: 'note', title: 'Idiom', state: { noteId: cid, isNew: false }, spaceId: 'notes',
                  ...(originTabId ? { originTabId, originSpaceId: s.activeSpace } : {}),
                })
              }}
            >
              Open in new tab
            </button>
            <button
              className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-left text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => {
                const cid = idiomContextMenu.id; setIdiomContextMenu(null)
                window.app?.openFloatingTab?.('note', { noteId: cid })
                useAppStore.getState().bumpFloatingTabToken()
              }}
            >
              Open in floating tab
            </button>
          </div>
        </>,
        document.body
      )}

      {tagPick && (() => {
        const ranges = tagPick.scope === 'chapter'
          ? chapterRanges(verse.book_id, verse.chapter)
          : selectionToRanges([{ bookId: verse.book_id, chapter: verse.chapter, verse: verse.verse_num }])
        return (
          <TagPickPopover
            anchorRect={tagPick.rect}
            ranges={ranges}
            label={rangesLabel(ranges)}
            kind={tagPick.scope === 'chapter' ? 'chapter' : 'verses'}
            onClose={() => setTagPick(null)}
          />
        )
      })()}
    </div>
  )
}

export default memo(VerseRow)
