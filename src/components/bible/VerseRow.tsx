import { useState, useRef, useEffect, useLayoutEffect, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { Copy, StickyNote, X, GitFork, Hash, ExternalLink, BookOpen } from 'lucide-react'
import StrongsInline from './StrongsInline'
import type { WordSegment } from './StrongsInline'
import { bookName, getTranslationForBook } from '@/lib/parseRef'
import { useAppStore } from '@/store'
import { applyWordReplacer, applyStrongsWordReplacer } from '@/lib/wordReplacer'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { applyFindHighlight } from '@/lib/highlight'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import { extractRefsFromNote, refMatchesVerse } from '@/lib/noteRefs'
import type { NoteVerseRef } from '@/lib/noteRefs'
import type { Verse, HighlightColor, Note } from '@/types'
export type { HighlightColor }

export const HIGHLIGHT_COLORS: { id: HighlightColor; bg: string; dot: string; label: string }[] = [
  { id: 'yellow',  bg: 'bg-yellow-400/20 hover:bg-yellow-400/30',   dot: 'bg-yellow-400',   label: 'Yellow'  },
  { id: 'orange',  bg: 'bg-orange-400/20 hover:bg-orange-400/30',   dot: 'bg-orange-400',   label: 'Orange'  },
  { id: 'amber',   bg: 'bg-amber-400/20 hover:bg-amber-400/30',     dot: 'bg-amber-400',    label: 'Amber'   },
  { id: 'red',     bg: 'bg-red-400/20 hover:bg-red-400/30',         dot: 'bg-red-400',      label: 'Red'     },
  { id: 'rose',    bg: 'bg-rose-400/20 hover:bg-rose-400/30',       dot: 'bg-rose-400',     label: 'Rose'    },
  { id: 'pink',    bg: 'bg-pink-400/20 hover:bg-pink-400/30',       dot: 'bg-pink-400',     label: 'Pink'    },
  { id: 'violet',  bg: 'bg-violet-400/20 hover:bg-violet-400/30',   dot: 'bg-violet-400',   label: 'Violet'  },
  { id: 'purple',  bg: 'bg-purple-400/20 hover:bg-purple-400/30',   dot: 'bg-purple-400',   label: 'Purple'  },
  { id: 'indigo',  bg: 'bg-indigo-400/20 hover:bg-indigo-400/30',   dot: 'bg-indigo-400',   label: 'Indigo'  },
  { id: 'blue',    bg: 'bg-blue-400/20 hover:bg-blue-400/30',       dot: 'bg-blue-400',     label: 'Blue'    },
  { id: 'sky',     bg: 'bg-sky-400/20 hover:bg-sky-400/30',         dot: 'bg-sky-400',      label: 'Sky'     },
  { id: 'cyan',    bg: 'bg-cyan-400/20 hover:bg-cyan-400/30',       dot: 'bg-cyan-400',     label: 'Cyan'    },
  { id: 'teal',    bg: 'bg-teal-400/20 hover:bg-teal-400/30',       dot: 'bg-teal-500',     label: 'Teal'    },
  { id: 'green',   bg: 'bg-green-400/20 hover:bg-green-400/30',     dot: 'bg-green-500',    label: 'Green'   },
  { id: 'lime',    bg: 'bg-lime-400/20 hover:bg-lime-400/30',       dot: 'bg-lime-400',     label: 'Lime'    },
]

const HIGHLIGHT_ROW_BG: Record<HighlightColor, string> = {
  yellow: 'rgba(234,179,8,0.15)',   orange: 'rgba(251,146,60,0.15)',  amber:  'rgba(251,191,36,0.15)',
  red:    'rgba(248,113,113,0.15)', rose:   'rgba(251,113,133,0.15)', pink:   'rgba(244,114,182,0.15)',
  violet: 'rgba(167,139,250,0.15)', purple: 'rgba(192,132,252,0.15)', indigo: 'rgba(129,140,248,0.15)',
  blue:   'rgba(96,165,250,0.15)',  sky:    'rgba(56,189,248,0.15)',  cyan:   'rgba(34,211,238,0.15)',
  teal:   'rgba(45,212,191,0.15)',  green:  'rgba(74,222,128,0.15)',  lime:   'rgba(163,230,53,0.15)',
}

const HIGHLIGHT_BORDER: Record<HighlightColor, string> = {
  yellow: 'rgba(234,179,8,0.7)',   orange: 'rgba(251,146,60,0.7)',  amber:  'rgba(251,191,36,0.7)',
  red:    'rgba(248,113,113,0.7)', rose:   'rgba(251,113,133,0.7)', pink:   'rgba(244,114,182,0.7)',
  violet: 'rgba(167,139,250,0.7)', purple: 'rgba(192,132,252,0.7)', indigo: 'rgba(129,140,248,0.7)',
  blue:   'rgba(96,165,250,0.7)',  sky:    'rgba(56,189,248,0.7)',  cyan:   'rgba(34,211,238,0.7)',
  teal:   'rgba(45,212,191,0.7)',  green:  'rgba(74,222,128,0.7)',  lime:   'rgba(163,230,53,0.7)',
}

const WORD_HIGHLIGHT_BG: Record<HighlightColor, string> = {
  yellow: 'rgba(234,179,8,0.5)',   orange: 'rgba(251,146,60,0.5)',  amber:  'rgba(251,191,36,0.5)',
  red:    'rgba(248,113,113,0.5)', rose:   'rgba(251,113,133,0.5)', pink:   'rgba(244,114,182,0.5)',
  violet: 'rgba(167,139,250,0.5)', purple: 'rgba(192,132,252,0.5)', indigo: 'rgba(129,140,248,0.5)',
  blue:   'rgba(96,165,250,0.5)',  sky:    'rgba(56,189,248,0.5)',  cyan:   'rgba(34,211,238,0.5)',
  teal:   'rgba(45,212,191,0.5)',  green:  'rgba(74,222,128,0.5)',  lime:   'rgba(163,230,53,0.5)',
}

interface SelToolbarPos { x: number; y: number; startChar: number; endChar: number }

type HighlightEntry = { id: string; color: HighlightColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }

interface VerseRowProps {
  verse: Verse
  showStrongs: boolean
  showVerseNumber?: boolean
  noteCount?: number
  hasNoteCrossRef?: boolean
  isHighlighted?: boolean
  highlights?: HighlightEntry[]
  hiddenAnnotations?: string[]
  textId?: string
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  onStrongsClick?: (num: string) => void
  onWordClick?: (word: string) => void
}

interface TaggedToken {
  word: string
  strongsNum: string | string[] | null  // string[] = multi-Strongs (e.g. divided{H914|H996})
  isItalic: boolean
  isRedLetter: boolean
  isParenthetical: boolean  // true for ~{H853} tokens — grammatical particle, no English word
  isStrongsBracket: boolean // true for sup>(  sup>) alignment brackets — never rendered as plain text
}

/**
 * Parse `text_tagged` column format into structured tokens.
 * Format per token (space-separated):
 *   word{H7225}     – word with Strong's number
 *   word{}          – word present in source but no Strong's (e.g. conjunctions, articles)
 *   *word{}         – KJV italic (translator-supplied) word, no Strong's
 *   !word{G1063}    – red-letter word (Yeshua's speech) with or without Strong's
 *   ~{H853}         – parenthetical Strongs: grammatical particle, no English equivalent
 *   word{H914|H996} – multi-Strongs: word bound to multiple Hebrew/Greek roots
 */
function parseTaggedTokens(tagged: string): TaggedToken[] {
  const tokens: TaggedToken[] = []
  for (let part of tagged.split(' ')) {
    if (!part) continue

    // Strip malformed <sup> / </sup> fragments — some KJVA DB entries have `sup>` and
    // `/sup>` literal text (the '<' was stripped during data import).
    // Track whether this token came from a sup> wrapper: if so, and the remaining
    // word is only a bracket char (( ) [ ]), it's a Strong's alignment marker that
    // must NOT render as visible text (it doesn't appear in the plain verse text).
    const wasSupWrapped = /^\/sup>|^sup>/i.test(part)
    part = part.replace(/^\/sup>/i, '').replace(/^sup>/i, '')
    if (!part) continue

    // Parenthetical token: ~{H853} — no associated English word
    if (part.startsWith('~{') && part.endsWith('}')) {
      const strongsRaw = part.slice(2, -1).trim()
      tokens.push({ word: '', strongsNum: strongsRaw || null, isItalic: false, isRedLetter: false, isParenthetical: true, isStrongsBracket: false })
      continue
    }

    const isRedLetter = part.startsWith('!')
    const afterRed = isRedLetter ? part.slice(1) : part
    const isItalic = afterRed.startsWith('*')
    const raw = isItalic ? afterRed.slice(1) : afterRed
    const braceIdx = raw.lastIndexOf('{')
    if (braceIdx !== -1 && raw.endsWith('}')) {
      const word = raw.slice(0, braceIdx)
      const strongsRaw = raw.slice(braceIdx + 1, -1).trim()
      // Multi-Strongs: split on '|' to get primary + secondary numbers
      const parts = strongsRaw ? strongsRaw.split('|') : []
      const strongsNum = parts.length > 1 ? parts : (parts[0] || null)
      // A sup>-wrapped bare bracket with no Strongs is a pure alignment marker, not text
      const isStrongsBracket = wasSupWrapped && !strongsNum && /^[()[\]]+$/.test(word)
      tokens.push({ word, strongsNum, isItalic, isRedLetter, isParenthetical: false, isStrongsBracket })
    } else {
      tokens.push({ word: raw, strongsNum: null, isItalic, isRedLetter, isParenthetical: false, isStrongsBracket: false })
    }
  }
  return tokens
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
): WordSegment[] | null {
  const wordEnd = wordCharStart + word.length
  const relevant = charHighlights.filter(
    h => h.startChar !== null && h.endChar !== null && h.startChar < wordEnd && h.endChar > wordCharStart
  )
  if (relevant.length === 0) return null

  // Build boundary set within [0, word.length]
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

function cleanPunctuation(s: string): string {
  return s
    .replace(/,\s*,/g, ',')
    .replace(/\s+([,;:.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

// A.M. date pattern: [1307 A.M.] or [1307-1320 A.M.] or [1307 Anno Mundi]
const JUB_DATE_RE = /\s*\[[\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi)\s*\]/gi
// Non-date square brackets: [text] — excludes the A.M. date form
const JUB_BRACKET_RE = /\s*\[(?![\d][\d\s\-,]*\s*(?:A\.M\.|Anno\s+Mundi))[^\]]*\]/g
// Angle brackets: <text>
const JUB_RESTORED_RE = /\s*<([^>]*)>/g
// Single-letter stanza markers: (b) (c) (d)
const JUB_STANZA_RE = /\s*\([a-z]\)\s*/g
// Parenthetical supply: (word) — but NOT single letters (those are stanza markers)
const JUB_SUPPLY_RE = /\s*\((?![a-z]\))([^)]*)\)/g

function stripAnnotations(text: string, textId: string, hiddenAnnotations: string[]): string {
  if (hiddenAnnotations.length === 0) return text
  let result = text
  switch (textId) {
    case 'lxx':
      if (hiddenAnnotations.includes('lxx_supply')) result = result.replace(/\s*\[([^\]]*)\]/g, '')
      return cleanPunctuation(result)
    case 'enoch':
      if (hiddenAnnotations.includes('enoch_supply'))    result = result.replace(/\s*\(([^)]*)\)/g, '')
      if (hiddenAnnotations.includes('enoch_uncertain')) result = result.replace(/\s*\[([^\]]*)\]/g, '')
      if (hiddenAnnotations.includes('enoch_restored'))  result = result.replace(/\s*〈([^〉]*)〉/g, '')
      return cleanPunctuation(result)
    case 'jubilees':
      // Strip in a specific order so regexes don't interfere with each other
      if (hiddenAnnotations.includes('jubilees_date'))     result = result.replace(JUB_DATE_RE, '')
      if (hiddenAnnotations.includes('jubilees_bracket'))  result = result.replace(JUB_BRACKET_RE, '')
      if (hiddenAnnotations.includes('jubilees_restored')) result = result.replace(JUB_RESTORED_RE, '')
      if (hiddenAnnotations.includes('jubilees_stanza'))   result = result.replace(JUB_STANZA_RE, ' ')
      if (hiddenAnnotations.includes('jubilees_supply'))   result = result.replace(JUB_SUPPLY_RE, '')
      return cleanPunctuation(result)
    default:
      return text
  }
}

function charOffsetInVerse(node: Node, offset: number, containerEl: HTMLElement): number {
  let pos = 0
  const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT)
  let curr: Text | null
  while ((curr = walker.nextNode() as Text) !== null) {
    if (curr === node) return pos + offset
    pos += curr.length
  }
  return -1
}

// Cap how many items a hover popup shows so it never grows unmanageably tall.
const MAX_HOVER_ITEMS = 8

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
  useEffect(() => {
    const textId = getTranslationForBook(bookId) ?? 'kjva'
    // When verse=0 (chapter-level ref), fetch verse 1 and append ellipsis
    const queryVerse = verse === 0 ? 1 : verse
    window.bible.queryVerse(bookId, chapter, queryVerse, textId)
      .then(v => setText(v?.text ? (verse === 0 ? v.text + '…' : v.text) : null))
      .catch(() => {})
  }, [bookId, chapter, verse])
  if (!text) return null
  const display = wordReplacerEnabled && wordReplacerRules.length > 0
    ? applyWordReplacer(text, wordReplacerRules) : text
  return <span className="text-[rgb(var(--color-text-muted))] text-[9px]"> {display}</span>
}

export default function VerseRow({ verse, showStrongs, showVerseNumber = true, noteCount = 0, hasNoteCrossRef = false, isHighlighted = false, highlights = [], hiddenAnnotations = [], textId = 'kjva', findQuery = '', findWordMode = 'phrase', onStrongsClick, onWordClick }: VerseRowProps) {
  const hasHidden = hiddenAnnotations.length > 0
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const strippedText = hasHidden ? stripAnnotations(verse.text, textId, hiddenAnnotations) : verse.text
  const shouldReplace = wordReplacerEnabled && wordReplacerRules.length > 0
  const displayText = shouldReplace ? applyWordReplacer(strippedText, wordReplacerRules) : strippedText
  // verseForDisplay uses displayText for word-split rendering; char-offset rendering always uses original verse.text
  const verseForDisplay = (hasHidden || shouldReplace) ? { ...verse, text: displayText } : verse
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const bumpVerseNoteToken = useAppStore((s) => s.bumpVerseNoteToken)
  const bumpVersePopoverToken = useAppStore((s) => s.bumpVersePopoverToken)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const openNoteInBiblePanel = useAppStore((s) => s.openNoteInBiblePanel)
  const filterBiblePanelByVerse = useAppStore((s) => s.filterBiblePanelByVerse)
  const openCrossRefsInBiblePanel = useAppStore((s) => s.openCrossRefsInBiblePanel)
  const setCrossRefSource = useAppStore((s) => s.setCrossRefSource)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [crossRefHover, setCrossRefHover] = useState<{ refs: NoteVerseRef[]; x: number; y: number; placeUp: boolean } | null>(null)
  const crossRefHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [noteHover, setNoteHover] = useState<{ verseNotes: Note[]; refNotes: Note[]; x: number; y: number; placeUp: boolean } | null>(null)
  const noteHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  type IndicatorMenuData = { type: 'note'; note: Note } | { type: 'verse'; ref: NoteVerseRef }
  const { menu: indicatorMenu, menuRef: indicatorMenuRef, openMenu: openIndicatorMenu, closeMenu: closeIndicatorMenu } =
    usePositionedMenu<IndicatorMenuData>()
  const [popoverAbove, setPopoverAbove] = useState(false)
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [selToolbar, setSelToolbar] = useState<SelToolbarPos | null>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
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
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [popoverOpen])


  const lxxSuffix = textId === 'lxx' ? ' LXX' : ''
  const verseRef = `${bookName(verse.book_id)} ${verse.chapter}:${verse.verse_num}${lxxSuffix}`

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
    const title = `${bookName(verse.book_id)} ${verse.chapter}:${verse.verse_num}${lxxSuffix}`
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
        // Only use verse notes directly attached to this verse — same source as
        // the ChapterView cross-ref indicator logic. General notes that merely
        // mention the verse inline are excluded so the hover matches what the
        // side panel's "My Notes" cross-ref view shows.
        const verseNotes = await window.notes.getVerseNotes(vRef, textId)
        const all: NoteVerseRef[] = []
        for (const note of verseNotes) {
          for (const ref of extractRefsFromNote(note.content, note.title || 'Untitled')) {
            if (ref.bookId === verse.book_id && ref.chapter === verse.chapter && ref.verse === verse.verse_num) continue
            if (!all.some(r => r.bookId === ref.bookId && r.chapter === ref.chapter && r.verse === ref.verse)) {
              all.push(ref)
            }
          }
        }
        if (all.length > 0) {
          const { y, placeUp } = computeHoverPlacement(rect, all.length, 40)
          setCrossRefHover({ refs: all, x: rect.left, y, placeUp })
        }
      } catch { /* ignore */ }
    }, 300)
  }

  function handleCrossRefIconMouseLeave() {
    if (crossRefHoverTimerRef.current) clearTimeout(crossRefHoverTimerRef.current)
    crossRefHoverTimerRef.current = setTimeout(() => setCrossRefHover(null), 150)
  }

  function handleNoteIconMouseEnter(e: React.MouseEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (noteHoverTimerRef.current) clearTimeout(noteHoverTimerRef.current)
    noteHoverTimerRef.current = setTimeout(async () => {
      const vRef = `${verse.book_id}.${verse.chapter}.${verse.verse_num}`
      try {
        const verseNotes = await window.notes.getVerseNotes(vRef, textId)
        // Also find general notes whose content references this verse
        const humanRef = `${bookName(verse.book_id)} ${verse.chapter}:${verse.verse_num}`
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

    const startChar = charOffsetInVerse(range.startContainer, range.startOffset, verseTextRef.current)
    const endChar = charOffsetInVerse(range.endContainer, range.endOffset, verseTextRef.current)

    if (startChar < 0 || endChar <= startChar) {
      setSelToolbar(null)
      return
    }

    // Anchor to the cursor release position — avoids off-screen placement when
    // the selection spans most of the visible text (bounding rect is huge).
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const MENU_H_INIT = 260
    let menuX = e.clientX - MENU_W / 2
    menuX = Math.max(pad, Math.min(menuX, vw - MENU_W - pad))
    let menuY = e.clientY - MENU_H_INIT - pad
    if (menuY < pad) menuY = e.clientY + pad
    menuY = Math.max(pad, Math.min(menuY, vh - MENU_H_INIT - pad))

    setSelToolbar({ x: menuX, y: menuY, startChar, endChar })
  }, [])

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
    await window.highlights.toggle({
      bookId: verse.book_id, chapter: verse.chapter, verseNum: verse.verse_num, color, textId,
      startChar: sc, endChar: ec,
    }).catch(() => {})
    bumpHighlightToken()
  }

  // Find-bar: does this verse contain the query?
  const isFindMatch = (() => {
    if (!findQuery.trim()) return false
    const t = verse.text.toLowerCase()
    const q = findQuery.trim().toLowerCase()
    if (findWordMode === 'phrase') return t.includes(q)
    const words = q.split(/\s+/).filter(Boolean)
    if (findWordMode === 'all') return words.every(w => t.includes(w))
    return words.some(w => t.includes(w))
  })()

  const rowStyle: React.CSSProperties | undefined = isHighlighted
    ? { backgroundColor: 'var(--verse-highlight-bg)', borderLeft: '3px solid rgb(var(--color-accent))', paddingLeft: '0.5rem', marginLeft: '-0.75rem', borderRadius: '0 4px 4px 0' }
    : activeHighlight
    ? { backgroundColor: HIGHLIGHT_ROW_BG[activeHighlight], borderLeft: `3px solid ${HIGHLIGHT_BORDER[activeHighlight]}`, paddingLeft: '0.5rem', marginLeft: '-0.75rem', borderRadius: '0 4px 4px 0' }
    : isFindMatch
    ? { backgroundColor: 'rgba(234,179,8,0.08)', borderLeft: '3px solid rgba(234,179,8,0.5)', paddingLeft: '0.5rem', marginLeft: '-0.75rem', borderRadius: '0 4px 4px 0' }
    : undefined

  // Determine rendering mode
  const charHighlights = highlights.filter(h => h.startChar !== null && h.endChar !== null)

  function renderVerseText() {
    // ── KJVA with text_tagged: unified italic + Strong's + char-highlight rendering ──
    // This handles: showStrongs ON/OFF, kjva_italics hidden/shown, find highlights, and
    // char-level highlights — all simultaneously. Char positions are tracked from the
    // raw (pre-filter) token list so they align with verse.text offsets.
    if (textId === 'kjva' && verse.text_tagged) {
      const tokens = parseTaggedTokens(verse.text_tagged)

      // Compute char start position in verse.text for each token (before any filtering).
      // Parenthetical tokens (~{H853}) have no English word — they don't advance charPos.
      let charPos = 0
      const tokensWithCharPos = tokens.map(t => {
        const charStart = charPos
        // Parenthetical (~{}) and Strong's-bracket (sup>() sup>)) tokens have no plain-text word
        if (!t.isParenthetical && !t.isStrongsBracket) charPos += t.word.length + 1 // word + trailing space
        return { ...t, charStart }
      })

      const hideItalics = hiddenAnnotations.includes('kjva_italics')
      const baseTokens = hideItalics ? tokensWithCharPos.filter(t => !t.isItalic) : tokensWithCharPos
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
            if (t.isParenthetical || t.isStrongsBracket || !t.strongsNum) return
            const nums = Array.isArray(t.strongsNum) ? t.strongsNum : [t.strongsNum]
            if (!activeStrongsRules.some(r => nums.includes(r.strongsNum!))) return
            // Walk backwards past brackets/parentheticals to find the nearest real token
            for (let j = i - 1; j >= 0; j--) {
              const prev = displayTokens[j]
              if (prev.isParenthetical || prev.isStrongsBracket) continue
              // Strip trailing punctuation then check for definite article
              if (prev.word.replace(/[,;:.!?]+$/, '').toLowerCase() === 'the') {
                suppressedIndices.add(j)
              }
              break
            }
          })
        }
      }

      if (showStrongs) {
        const highlightMode = findWordMode === 'phrase' ? 'all' : findWordMode
        return (
          <span>
            {displayTokens.map((token, i) => {
              // Suppress "the"/"The" that preceded a Strong's-replaced divine name
              if (suppressedIndices.has(i)) return null
              // Build per-character highlight segments for this word (null = no overlap = plain)
              const wordSegs = token.isParenthetical
                ? null
                : splitWordByHighlights(token.word, token.charStart, charHighlights, WORD_HIGHLIGHT_BG)
              // Space after this token — check if it falls within a charHighlight
              const spaceCharPos = token.charStart + token.word.length
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
                    onStrongsClick={onStrongsClick}
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

      // Plain text (no Strong's): skip parenthetical, bracket, and "the"-before-divine-name tokens
      const plainTokens = displayTokens.filter((t, i) => !t.isParenthetical && !t.isStrongsBracket && !suppressedIndices.has(i))
      return (
        <span>
          {plainTokens.map((token, i) => {
            const highlightMode = findWordMode === 'phrase' ? 'all' : findWordMode
            // Per-character highlight segments (null = no overlap)
            const wordSegs = splitWordByHighlights(token.word, token.charStart, charHighlights, WORD_HIGHLIGHT_BG)
            // Space highlight
            const spaceCharPos = token.charStart + token.word.length
            const spaceHl = i < plainTokens.length - 1
              ? charHighlights.find(h => h.startChar! <= spaceCharPos && h.endChar! > spaceCharPos)
              : undefined

            // Word content: segments OR find-highlighted plain text
            const wordContent = wordSegs
              ? wordSegs.map((seg, si) => (
                  <span key={si} style={seg.bg ? { backgroundColor: seg.bg, borderRadius: '2px' } : undefined}>{seg.text}</span>
                ))
              : (isFindMatch ? applyFindHighlight(token.word, findQuery, highlightMode) : token.word)

            return (
              <Fragment key={i}>
                {token.isRedLetter
                  ? <span className="text-red-400">{wordContent}</span>
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
    // When hiding annotations, render plain stripped text
    if (hasHidden) {
      return <span>{isFindMatch ? applyFindHighlight(verseForDisplay.text, findQuery, findWordMode) : verseForDisplay.text}</span>
    }

    if (!showStrongs && charHighlights.length > 0) {
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

    if (showStrongs) {
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
            const wordSegs = charHighlights.length > 0
              ? splitWordByHighlights(word, wordCharStart, charHighlights, WORD_HIGHLIGHT_BG)
              : null
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
                  onStrongsClick={onStrongsClick}
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

    // Plain / word-level rendering — apply find highlight
    if (isFindMatch && charHighlights.length === 0) {
      return <span>{applyFindHighlight(verseForDisplay.text, findQuery, findWordMode)}</span>
    }

    // Word-level rendering (with space highlighting fix)
    return (
      <span>
        {words.map((word, i) => {
          const wHL = highlights.find(h => h.startWord !== null && h.startWord <= i && i <= (h.endWord ?? i))
          return (
            <Fragment key={i}>
              <span
                data-word={i}
                style={wHL ? { backgroundColor: WORD_HIGHLIGHT_BG[wHL.color], borderRadius: '2px', padding: '1px 0' } : undefined}
              >{word}</span>
              {i < words.length - 1 && (() => {
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
      className={`flex gap-3 group relative ${showStrongs ? 'mb-1 leading-snug' : 'mb-3 leading-relaxed'}`}
      style={rowStyle}
    >
      {/* Verse number + popover anchor — hidden when showVerseNumber is off;
           right-clicking the verse text still opens the popover in that case */}
      <div className={`relative flex-shrink-0 ${showVerseNumber ? '' : 'w-0 overflow-hidden'}`} ref={popoverRef}>
        <button
          onClick={() => popoverOpen ? setPopoverOpen(false) : openPopover()}
          onContextMenu={(e) => { e.preventDefault(); openPopover(e) }}
          className={`
            w-7 text-right text-xs font-medium rounded
            pt-0.5 cursor-pointer select-none transition-colors
            ${isHighlighted
              ? 'text-[rgb(var(--color-accent))] font-semibold'
              : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/10]'
            }
          `}
        >
          {verse.verse_num}
        </button>

        {popoverOpen && (
          <div
            className="fixed z-[100] min-w-[160px] bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden py-1"
            style={{ left: popoverPos.x, top: popoverPos.y }}
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
              <StickyNote size={12} className="text-[rgb(var(--color-text-muted))]" />
              Add note
            </button>
            <button
              onClick={() => { openVerseNotes(); setPopoverOpen(false) }}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <StickyNote size={12} className="text-[rgb(var(--color-text-muted))]" />
              Show all notes
            </button>
            <button
              onClick={openVerseCrossRefs}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer"
            >
              <GitFork size={12} className="text-[rgb(var(--color-text-muted))]" />
              Show cross references
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
                      className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 ${c.dot} ${activeHighlight === c.id ? 'ring-2 ring-white/70 ring-offset-1' : ''}`}
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
        className="flex-1 min-w-0 text-[rgb(var(--color-text-primary))]"
        style={{ lineHeight: 'var(--line-height-comfortable)' }}
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

            {/* Note indicator */}
            {noteCount > 0 && (
              <button
                onMouseEnter={handleNoteIconMouseEnter}
                onMouseLeave={handleNoteIconMouseLeave}
                onClick={openVerseNotes}
                className="flex items-center gap-0.5 text-[rgb(var(--color-accent))] opacity-75 hover:opacity-100 cursor-pointer leading-none select-none transition-opacity"
              >
                <span className="text-[10px] font-bold">●</span>
                {noteCount > 1 && <span className="text-[9px] font-semibold">{noteCount}</span>}
              </button>
            )}

            {/* Divider between the two icons */}
            {noteCount > 0 && hasNoteCrossRef && (
              <div className="w-px h-2.5 bg-[rgb(var(--color-surface-4))] mx-1" />
            )}

            {/* Cross-ref indicator */}
            {hasNoteCrossRef && (
              <button
                onMouseEnter={handleCrossRefIconMouseEnter}
                onMouseLeave={handleCrossRefIconMouseLeave}
                onClick={openNoteCrossRefs}
                className="flex items-center text-[rgb(var(--color-text-muted))] opacity-70 hover:opacity-100 cursor-pointer transition-opacity"
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
              className="fixed z-[9999] w-[260px] max-h-[420px] overflow-y-auto rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
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
              className="fixed z-[9999] w-[280px] max-h-[400px] overflow-y-auto rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
              style={{ left: crossRefHover.x, top: crossRefHover.y }}
              onMouseEnter={() => { if (crossRefHoverTimerRef.current) clearTimeout(crossRefHoverTimerRef.current) }}
              onMouseLeave={() => setCrossRefHover(null)}
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
                  onContextMenu={(e) => { e.preventDefault(); openIndicatorMenu({ type: 'verse', ref: r, x: e.clientX, y: e.clientY }) }}
                  onClick={() => {
                    setCrossRefHover(null)
                    const s = useAppStore.getState()
                    s.ensureTab('bible')
                    const fresh = useAppStore.getState()
                    const tabId = fresh.activeTabId['scripture']
                    if (tabId) {
                      const originLabel = `${bookName(verse.book_id)} ${verse.chapter}:${verse.verse_num}`
                      fresh.updateTabState('scripture', tabId, {
                        bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, scrollPosition: 0,
                        scriptureBack: { bookId: verse.book_id, chapter: verse.chapter, verse: verse.verse_num, label: originLabel },
                      })
                    }
                    fresh.setActiveSpace('scripture')
                  }}
                  className="w-full text-left px-3 py-1 hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors border-b border-[rgb(var(--color-surface-2))] last:border-0 group"
                >
                  <p className="text-[9px]" style={{ lineHeight: 1.1 }}>
                    <span className="font-mono font-semibold text-[rgb(var(--color-accent))] group-hover:underline">{bookName(r.bookId)} {r.chapter}{r.verse > 0 ? `:${r.verse}` : ''}</span>
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

      {/* Selection toolbar — context menu */}
      {selToolbar && createPortal(
        <div
          ref={selToolbarRef}
          className="fixed z-[9999] min-w-[180px] rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] overflow-hidden py-1"
          style={{ left: selToolbar.x, top: selToolbar.y }}
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
                    className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 flex-shrink-0 ${c.dot} ${activeHighlight === c.id ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-[rgb(var(--color-surface-1))]' : ''}`}
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
            <StickyNote size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Add note to verse
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
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => { closeIndicatorMenu(); openNoteInBiblePanel(indicatorMenu.note.id) }}
              >
                <StickyNote size={12} />
                Open in panel
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
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
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
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
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  const s = useAppStore.getState()
                  s.ensureTab('bible')
                  const fresh = useAppStore.getState()
                  const tabId = fresh.activeTabId['scripture']
                  if (tabId) {
                    const label = `${bookName(verse.book_id)} ${verse.chapter}:${verse.verse_num}`
                    fresh.updateTabState('scripture', tabId, {
                      bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, scrollPosition: 0,
                      scriptureBack: { bookId: verse.book_id, chapter: verse.chapter, verse: verse.verse_num, label },
                    })
                  }
                  fresh.setActiveSpace('scripture')
                }}
              >
                <BookOpen size={12} />
                Open verse
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  const s = useAppStore.getState()
                  const translation = (getTranslationForBook(r.bookId) ?? textId ?? 'kjva').toUpperCase()
                  const title = `${bookName(r.bookId)} ${r.chapter}`
                  s.addTab({
                    id: `bible-${Date.now()}`, spaceId: 'scripture', type: 'bible', title,
                    state: { bookId: r.bookId, chapter: r.chapter, targetVerse: r.verse, translation, showStrongs: false, scrollPosition: 0 },
                  })
                }}
              >
                <BookOpen size={12} />
                Open in new tab
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeIndicatorMenu()
                  const r = indicatorMenu.ref
                  const s = useAppStore.getState()
                  s.ensureTab('bible')
                  window.app.openFloatingTab('bible', { bookId: r.bookId, chapter: String(r.chapter), targetVerse: String(r.verse) })
                  s.bumpFloatingTabToken()
                }}
              >
                <ExternalLink size={12} />
                Open in floating tab
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
