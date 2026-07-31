import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Plus, Search, X, Filter, ChevronLeft, ChevronRight, ChevronDown, ExternalLink, GitFork, AlignJustify, BookOpen, StickyNote, Copy, Hash, ScanSearch, ArrowUpDown, Check as CheckIcon, FileText, PanelRightOpen, Columns2 } from 'lucide-react'
import { buildLexiconCopyText, normalizeStrongsNums } from '@/components/lexicon/LexiconPanel'
import { usePositionedMenu } from '@/lib/usePositionedMenu'
import NoteEditor from '@/components/notes/pm/NoteEditorPM'
import HeaderSegmentedToggle from '@/components/shell/HeaderSegmentedToggle'
import { useAppStore } from '@/store'
import { bookName, bookChapterVerseLabel, getTranslationForBook, isDedicatedTranslation, parseRef } from '@/lib/parseRef'
import { copyVerse, copyVerseRef } from '@/lib/verseClipboard'
import { getWordWindow } from '@/lib/verseUtils'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { extractRefsFromNote, refMatchesVerse } from '@/lib/noteRefs'
import {
  getChapterNotesShared, searchNotesShared, getNotesShared,
  getLexiconEntryShared, getLexiconRelatedShared, getLexiconOccurrencesShared,
  getTSKeForChapterShared, getCrossRefsForChapterShared,
} from '@/lib/panelDataCache'
import { NOTE_DOT_COLOR } from './VerseRow'
import type { ParsedRef } from '@/lib/parseRef'
import type { Note, LexiconEntry, BibleTabState } from '@/types'
import type { TSKeGroup, ChapterTSKeEntry, ChapterCrossRefEntry } from '@/types/electron'

type PanelTab = 'notes' | 'lexicon' | 'crossrefs'
type NoteScope = 'all' | 'chapter'
type NoteSort = 'modified' | 'created' | 'verse'

const PANEL_TAB_LABEL: Record<PanelTab, string> = { notes: 'Notes', lexicon: 'Lexicon', crossrefs: 'Cross Refs' }
const PANEL_TAB_ICON: Record<PanelTab, typeof StickyNote> = { notes: FileText, lexicon: BookOpen, crossrefs: GitFork }

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

function formatRef(verseRef: string): string {
  const parts = verseRef.split('.')
  if (parts.length < 2) return verseRef
  return bookChapterVerseLabel(parts[0], Number(parts[1]), parts[2] ? Number(parts[2]) : undefined)
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

// Fallback mapping used if Electron main returns old-format rows (book_num instead of book_id)
const KJVA_BOOK_NUM: Record<number, string> = {
  1:'GEN',2:'EXO',3:'LEV',4:'NUM',5:'DEU',6:'JOS',7:'JDG',8:'RUT',
  9:'1SA',10:'2SA',11:'1KI',12:'2KI',13:'1CH',14:'2CH',15:'EZR',16:'NEH',
  17:'EST',18:'JOB',19:'PSA',20:'PRO',21:'ECC',22:'SNG',23:'ISA',24:'JER',
  25:'LAM',26:'EZK',27:'DAN',28:'HOS',29:'JOL',30:'AMO',31:'OBA',32:'JON',
  33:'MIC',34:'NAM',35:'HAB',36:'ZEP',37:'HAG',38:'ZEC',39:'MAL',
  40:'1ES',41:'2ES',42:'TOB',43:'JDT',44:'ESG',45:'WIS',46:'SIR',47:'BAR',
  48:'PRA',49:'SUS',50:'BEL',51:'PRM',52:'1MA',53:'2MA',
  54:'MAT',55:'MRK',56:'LUK',57:'JHN',58:'ACT',
  59:'ROM',60:'1CO',61:'2CO',62:'GAL',63:'EPH',64:'PHP',65:'COL',
  66:'1TH',67:'2TH',68:'1TI',69:'2TI',70:'TIT',71:'PHM',72:'HEB',
  73:'JAS',74:'1PE',75:'2PE',76:'1JN',77:'2JN',78:'3JN',79:'JUD',80:'REV',
}

type OccurrenceRow = { book_id: string; chapter: number; verse_num: number; text: string; matchWordIndices?: number[] }

function normalizeOccurrenceRow(r: any): OccurrenceRow {
  if ('book_id' in r) return r as OccurrenceRow
  const book_id = KJVA_BOOK_NUM[r.book_num] ?? `book${r.book_num}`
  return { book_id, chapter: r.chapter, verse_num: r.verse ?? r.verse_num ?? 0, text: r.text ?? '', matchWordIndices: [] }
}

/** Render verse text with the matched word(s) highlighted */
function VerseWithMatchedWords({ text, matchWordIndices }: { text: string; matchWordIndices?: number[] }) {
  if (!text) return null
  if (!matchWordIndices?.length) return <span>{text}</span>
  const indexSet = new Set(matchWordIndices)
  // Filter empty strings caused by leading/trailing whitespace in verse text
  const tokens = text.split(/(\s+)/).filter(t => t !== '')
  let wordIdx = 0
  return (
    <span>
      {tokens.map((token, i) => {
        if (/^\s+$/.test(token)) return <span key={i}>{token}</span>
        const isMatch = indexSet.has(wordIdx)
        wordIdx++
        return isMatch
          ? <mark key={i} className="berean-find-mark bg-yellow-400/40 text-[rgb(var(--color-text-primary))] rounded-sm not-italic font-medium">{token}</mark>
          : <span key={i}>{token}</span>
      })}
    </span>
  )
}

/**
 * When a matched word falls late in a verse, compute a window of words around
 * it so the highlight is always visible (rather than cut off by line-clamp).
 * Returns null if the first match is already within the visible window.
 */

// ─── Standalone Lexicon (no store interaction beyond createTab) ─────────────

function LangBadge({ num }: { num: string }) {
  const isHebrew = num.startsWith('H')
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full leading-none ${
      isHebrew ? 'bg-amber-500/20 text-amber-400' : 'bg-indigo-500/20 text-indigo-400'
    }`}>
      {isHebrew ? 'Hebrew' : 'Greek'}
    </span>
  )
}

interface SidebarLexiconProps {
  initialEntry?: string | null
  onEntryChange?: (entry: string | null) => void
}

function SidebarLexicon({ initialEntry, onEntryChange }: SidebarLexiconProps) {
  const createTab = useAppStore((s) => s.createTab)
  const openLexiconEntry = useAppStore((s) => s.openLexiconEntry)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const pendingLexiconSearch = useAppStore((s) => s.pendingLexiconSearch)
  const clearLexiconSearch = useAppStore((s) => s.clearLexiconSearch)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<LexiconEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [activeEntry, setActiveEntry] = useState<LexiconEntry | null>(null)
  const [history, setHistory] = useState<LexiconEntry[]>([]) // navigation history stack
  const [related, setRelated] = useState<{ strongsNum: string; lemma: string; transliteration: string; gloss: string }[]>([])
  const [adjacent, setAdjacent] = useState<{ prev: string | null; next: string | null }>({ prev: null, next: null })
  const [occurrences, setOccurrences] = useState<OccurrenceRow[]>([])
  const [occurrencesLoading, setOccurrencesLoading] = useState(false)
  const [showAllOccurrences, setShowAllOccurrences] = useState(false)
  const [selectedResultIdx, setSelectedResultIdx] = useState(-1)
  const [copiedLexicon, setCopiedLexicon] = useState(false)
  // Full entry (definition, derivation, related terms, occurrences) shows by
  // default — an earlier collapsed-by-default pass hid these behind "Show
  // full entry" and the user explicitly asked for them back. "Show less"
  // still lets the user collapse a given entry, but a NEW entry always
  // starts expanded again rather than inheriting the previous collapse.
  const [expanded, setExpanded] = useState(true)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Track the current entry num in a ref so the initialEntry effect can skip feedback-loop
  // changes (where onEntryChange → parent → initialEntry prop reflects our own navigation).
  const activeEntryNumRef = useRef<string | null>(null)
  useEffect(() => { activeEntryNumRef.current = activeEntry?.strongsNum ?? null }, [activeEntry])
  useEffect(() => { setExpanded(true) }, [activeEntry?.strongsNum])

  // Load entry when initialEntry changes — but ONLY if it's a genuine external change
  // (i.e. the user clicked a Strong's number in a verse), not a feedback-loop update
  // caused by our own onEntryChange reporting the new entry back to the parent.
  useEffect(() => {
    if (!initialEntry) return
    if (initialEntry === activeEntryNumRef.current) return // already showing this entry
    getLexiconEntryShared(initialEntry)
      .then((entry) => { if (entry) { setHistory([]); setActiveEntry(entry) } })
      .catch(() => {})
  }, [initialEntry])

  // Persist entry changes to parent so it survives tab switches
  useEffect(() => {
    onEntryChange?.(activeEntry?.strongsNum ?? null)
  }, [activeEntry?.strongsNum]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!activeEntry) inputRef.current?.focus() }, [activeEntry])

  // Respond to word-click searches from BiblePanel
  useEffect(() => {
    if (!pendingLexiconSearch) return
    clearLexiconSearch()
    setActiveEntry(null)
    handleInput(pendingLexiconSearch)
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [pendingLexiconSearch]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!activeEntry) { setRelated([]); return }
    try {
      getLexiconRelatedShared(activeEntry.strongsNum).then(setRelated).catch(() => setRelated([]))
    } catch {
      setRelated([])
    }
  }, [activeEntry?.strongsNum])

  // Load adjacent Strong's numbers for prev/next navigation
  useEffect(() => {
    if (!activeEntry) { setAdjacent({ prev: null, next: null }); return }
    const num = activeEntry.strongsNum
    const isHebrew = num.startsWith('H')
    const n = parseInt(num.slice(1), 10)
    if (isNaN(n)) { setAdjacent({ prev: null, next: null }); return }
    const prevNum = n > 1 ? `${isHebrew ? 'H' : 'G'}${n - 1}` : null
    const nextNum = `${isHebrew ? 'H' : 'G'}${n + 1}`
    setAdjacent({ prev: prevNum, next: nextNum })
  }, [activeEntry?.strongsNum])

  // Load verse occurrences when entry changes
  useEffect(() => {
    if (!activeEntry) { setOccurrences([]); return }
    setOccurrences([])
    setShowAllOccurrences(false)
    setOccurrencesLoading(true)
    getLexiconOccurrencesShared(activeEntry.strongsNum)
      .then((rows: any[]) => {
        const normalized = rows.map(normalizeOccurrenceRow)
        setOccurrences(normalized)
        setOccurrencesLoading(false)
      })
      .catch((e) => {
        setOccurrencesLoading(false)
      })
  }, [activeEntry?.strongsNum])

  const navToVerse = useCallback((bookId: string, chapter: number, verse: number) => {
    navToVerseFromPanel(bookId, chapter, verse)
  }, [])

  function handleInput(val: string) {
    setQuery(val)
    setSelectedResultIdx(-1)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.trim().length < 2) { setResults([]); return }

    if (/^[HhGg]\d+$/i.test(val.trim())) {
      setLoading(true)
      window.lexicon.getEntry(val.trim())
        .then((e) => { setResults(e ? [e] : []); setLoading(false) })
        .catch(() => { setResults([]); setLoading(false) })
      return
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      try { setResults(await window.lexicon.search(val.trim(), 'all')) }
      catch { setResults([]) }
      setLoading(false)
    }, 300)
  }

  const navToEntry = useCallback((strongsNum: string, openNewTab = false) => {
    if (openNewTab) {
      createTab('lexicon')
      openLexiconEntry(strongsNum)
      setActiveSpace('lexicon')
      return
    }
    getLexiconEntryShared(strongsNum)
      .then((entry) => {
        if (!entry) return
        if (activeEntry) setHistory((h) => [...h, activeEntry])
        setActiveEntry(entry)
      })
      .catch(() => {})
  }, [activeEntry, createTab, openLexiconEntry, setActiveSpace])

  function goBack() {
    if (history.length > 0) {
      const prev = history[history.length - 1]
      setHistory((h) => h.slice(0, -1))
      setActiveEntry(prev)
    } else {
      setActiveEntry(null)
    }
  }

  const backLabel = history.length > 0 ? history[history.length - 1].strongsNum : 'Search'

  if (activeEntry) {
    const hasDerivation = (activeEntry.derivation?.trim().length ?? 0) > 0
    const hasExtended = (activeEntry.extendedDef?.trim().length ?? 0) > 0
    // Match explicit H/G-prefixed numbers AND bare numbers (prefix inferred from entry language)
    const langPrefix = activeEntry.strongsNum.startsWith('H') ? 'H' : 'G'
    const derivParts = hasDerivation ? activeEntry.derivation.split(/(\b[HG]\d{1,5}\b|\b\d{1,5}\b)/g) : []
    const extDefNorm = hasExtended ? normalizeStrongsNums(activeEntry.extendedDef, langPrefix) : ''

    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
          <button
            onClick={goBack}
            className="flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer rounded px-1 py-0.5 hover:bg-[rgb(var(--color-surface-4))] transition-colors"
          >
            <ArrowLeft size={12} />
            <span>{backLabel}</span>
          </button>
          <span className="text-xs font-semibold font-mono text-[rgb(var(--color-text-primary))]">{activeEntry.strongsNum}</span>
          <LangBadge num={activeEntry.strongsNum} />
          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => {
                const text = buildLexiconCopyText(activeEntry)
                navigator.clipboard.writeText(text).then(() => {
                  setCopiedLexicon(true)
                  setTimeout(() => setCopiedLexicon(false), 1800)
                }).catch(() => {})
              }}
              title="Copy Strong's number and definition"
              className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
            >
              {copiedLexicon ? <CheckIcon size={11} className="text-green-400" /> : <Copy size={11} />}
            </button>
            <button
              onClick={() => navToEntry(activeEntry.strongsNum, true)}
              title="Open in lexicon tab"
              className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
            >
              <ExternalLink size={11} />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {activeEntry.lemma && (
            <div className="text-xl font-medium text-[rgb(var(--color-text-primary))]" style={{ fontFamily: 'serif' }}>
              <span dir="rtl">{activeEntry.lemma}</span>
            </div>
          )}
          <div className="flex items-baseline gap-1.5 flex-wrap">
            {activeEntry.transliteration && <span className="text-sm text-[rgb(var(--color-text-secondary))] italic">{activeEntry.transliteration}</span>}
            {activeEntry.pronunciation && <span className="text-xs text-[rgb(var(--color-text-muted))]">({activeEntry.pronunciation})</span>}
          </div>
          {activeEntry.gloss && (
            <div className="text-xs text-[rgb(var(--color-text-primary))] font-medium bg-[rgb(var(--color-surface-4))] px-2 py-1.5 rounded">
              {activeEntry.gloss}
            </div>
          )}
          {!expanded && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full text-center text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer py-1"
            >
              Show full entry
            </button>
          )}
          {expanded && (<>
          {activeEntry.definition && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1">Definition</p>
              <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-relaxed">{activeEntry.definition}</p>
            </div>
          )}
          {hasDerivation && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1">Derivation</p>
              <p className="text-[11px] text-[rgb(var(--color-text-muted))] leading-relaxed italic">
                {derivParts.map((part, i) => {
                  // Already has H/G prefix — strip leading zeros (Greek DB pads, e.g. H07386 → H7386)
                  if (/^[HG]\d+$/.test(part)) {
                    const normalized = part[0] + String(parseInt(part.slice(1), 10))
                    return (
                      <button key={i} onClick={(e) => navToEntry(normalized, e.metaKey || e.ctrlKey)}
                        className="font-mono text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                      >{normalized}</button>
                    )
                  }
                  // Bare number (e.g. 7225 or 26) — prefix with entry's language
                  if (/^\d{1,5}$/.test(part)) {
                    const num = `${langPrefix}${parseInt(part, 10)}`
                    return (
                      <button key={i} onClick={(e) => navToEntry(num, e.metaKey || e.ctrlKey)}
                        className="font-mono text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                      >{num}</button>
                    )
                  }
                  return <span key={i}>{part}</span>
                })}
              </p>
            </div>
          )}
          {hasExtended && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1">
                {activeEntry.strongsNum.startsWith('H') ? 'BDB Notes' : 'Extended'}
              </p>
              <p className="text-[11px] text-[rgb(var(--color-text-muted))] leading-relaxed">{extDefNorm}</p>
            </div>
          )}
          {related.length > 0 && (
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] mb-1.5">Derived terms</p>
              <div className="space-y-0.5">
                {related.map((r) => (
                  <button
                    key={r.strongsNum}
                    onClick={(e) => navToEntry(r.strongsNum, e.metaKey || e.ctrlKey)}
                    className="w-full flex items-baseline gap-1.5 px-1.5 py-1 rounded hover:bg-[rgb(var(--color-surface-4))] cursor-pointer text-left transition-colors"
                  >
                    <span className="font-mono text-[9px] text-[rgb(var(--color-text-muted))] w-9 flex-shrink-0">{r.strongsNum}</span>
                    {r.lemma && <span className="text-xs font-medium text-[rgb(var(--color-text-primary))]" dir="rtl" style={{ fontFamily: 'serif' }}>{r.lemma}</span>}
                    <span className="text-[11px] text-[rgb(var(--color-text-secondary))] truncate">{r.gloss}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Verse Occurrences */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
                Occurrences{occurrences.length > 0 ? ` (${occurrences.length}${occurrences.length >= 200 ? '+' : ''})` : ''}
              </p>
              <div className="flex items-center gap-2.5">
                {occurrences.length > 0 && (
                  <button
                    onClick={() => useAppStore.getState().openScriptureSearchTab(activeEntry.strongsNum)}
                    title={`Open all ${activeEntry.strongsNum} occurrences in a tab, with the words highlighted`}
                    className="flex items-center gap-1 text-[9px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                  >
                    <ScanSearch size={10} /> open in tab
                  </button>
                )}
                {occurrences.length > 8 && (
                  <button
                    onClick={() => setShowAllOccurrences((v) => !v)}
                    className="text-[9px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer"
                  >
                    {showAllOccurrences ? 'fewer' : `all ${occurrences.length}`}
                  </button>
                )}
              </div>
            </div>
            {occurrencesLoading && (
              <p className="text-[11px] text-[rgb(var(--color-text-muted))] text-center py-2">Loading…</p>
            )}
            {!occurrencesLoading && occurrences.length === 0 && (
              <p className="text-[11px] text-[rgb(var(--color-text-muted))]">No occurrence data.</p>
            )}
            {!occurrencesLoading && occurrences.length > 0 && (
              <div className="space-y-0.5">
                {(showAllOccurrences ? occurrences : occurrences.slice(0, 8)).map((occ, i) => {
                  const bk = (() => { try { return bookName(occ.book_id) } catch { return occ.book_id } })()
                  const refLabel = `${bk} ${occ.chapter}:${occ.verse_num}`
                  return (
                    <button
                      key={i}
                      onClick={() => navToVerse(occ.book_id, occ.chapter, occ.verse_num)}
                      onContextMenu={(e) => { e.preventDefault(); _onVerseCtxMenu?.(occ.book_id, occ.chapter, occ.verse_num, e.clientX, e.clientY) }}
                      className="w-full text-left flex flex-col gap-1 px-2.5 py-2 rounded-shell border border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors group"
                    >
                      <span className="w-fit font-mono text-[9px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1 py-px group-hover:bg-[rgb(var(--color-accent))]/18 transition-colors leading-none">{refLabel}</span>
                      {occ.text && (() => {
                        const rawText = wordReplacerEnabled && wordReplacerRules.length > 0
                          ? applyWordReplacer(occ.text, wordReplacerRules)
                          : occ.text
                        const win = getWordWindow(rawText, occ.matchWordIndices)
                        const displayText = win?.windowText ?? rawText
                        const displayIndices = win?.windowMatchIndices ?? occ.matchWordIndices
                        return (
                          <p className="text-[10px] text-[rgb(var(--color-text-secondary))] leading-relaxed line-clamp-2">
                            <VerseWithMatchedWords text={displayText} matchWordIndices={displayIndices} />
                          </p>
                        )
                      })()}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="w-full text-center text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:underline cursor-pointer py-1"
          >
            Show less
          </button>
          </>)}
        </div>
        {/* Prev / Next navigation */}
        <div className="flex items-center border-t border-[rgb(var(--color-surface-4))] flex-shrink-0">
          <button
            onClick={() => adjacent.prev && navToEntry(adjacent.prev)}
            disabled={!adjacent.prev}
            className="flex-1 flex items-center gap-1 px-3 py-2 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <ChevronLeft size={12} />
            {adjacent.prev}
          </button>
          <div className="w-px h-5 bg-[rgb(var(--color-surface-4))]" />
          <button
            onClick={() => adjacent.next && navToEntry(adjacent.next)}
            disabled={!adjacent.next}
            className="flex-1 flex items-center justify-end gap-1 px-3 py-2 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            {adjacent.next}
            <ChevronRight size={12} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
        <Search size={12} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedResultIdx((i) => Math.min(i + 1, results.length - 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedResultIdx((i) => Math.max(i - 1, -1)) }
            else if (e.key === 'Enter' && results.length > 0) {
              e.preventDefault()
              const entry = selectedResultIdx >= 0 ? results[selectedResultIdx] : results[0]
              if (entry) setActiveEntry(entry)
            } else if (e.key === 'Escape') { (e.target as HTMLInputElement).blur() }
          }}
          placeholder="H7225 · G3056 · beginning..."
          className="flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none"
        />
        {query && (
          <button onClick={() => { setQuery(''); setResults([]) }} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading && <div className="px-3 py-6 text-center text-xs text-[rgb(var(--color-text-muted))]">Searching…</div>}
        {!loading && results.length === 0 && query.trim().length >= 2 && (
          <div className="px-3 py-6 text-center text-xs text-[rgb(var(--color-text-muted))]">No results for "{query}"</div>
        )}
        {!loading && results.length === 0 && query.trim().length < 2 && (
          <div className="px-4 py-8 text-center text-xs text-[rgb(var(--color-text-muted))] opacity-60">Search Strong's lexicon</div>
        )}
        {!loading && (
          <div className="flex flex-col gap-0.5 p-1.5">
            {results.map((entry, i) => (
              <button
                key={entry.strongsNum}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    navToEntry(entry.strongsNum, true)
                  } else {
                    setActiveEntry(entry)
                  }
                }}
                className={`w-full flex items-start gap-2 px-2.5 py-2 rounded-shell text-left cursor-pointer transition-colors ${i === selectedResultIdx ? 'bg-[rgb(var(--color-surface-4))]' : 'hover:bg-[rgb(var(--color-surface-3))]'}`}
              >
                <span className="w-fit font-mono text-[9px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1 py-px flex-shrink-0 mt-0.5 leading-none">{entry.strongsNum}</span>
                <div className="flex-1 min-w-0">
                  {entry.lemma && <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]" dir="rtl" style={{ fontFamily: 'serif' }}>{entry.lemma} </span>}
                  {entry.transliteration && <span className="text-[10px] text-[rgb(var(--color-text-muted))] italic">{entry.transliteration}</span>}
                  <p className="text-[11px] text-[rgb(var(--color-text-secondary))] truncate mt-0.5">{entry.gloss}</p>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Cross References tab ────────────────────────────────────────────────────

// Module-level context-menu callback so inner components can surface a verse context menu
// without prop-drilling through several layers. Set by BibleRightPanel on mount.
let _onVerseCtxMenu: ((bookId: string, chapter: number, verse: number, x: number, y: number) => void) | null = null

/** Save the current scripture position then navigate — used by all side-panel nav triggers.
 *  `noteBack` — passed only when navigating from a verse ref clicked inside a note that's open
 *  in this panel — records which note to return to, mirroring NotesPanel.tsx's own
 *  handleVerseRefClick. Without this, clicking a verse ref from a note shown here had no way
 *  back to that note at all (a real reported bug — see BiblePanel.tsx's "back to note" pill). */
function navToVerseFromPanel(bId: string, chapter: number, verse: number, endVerse?: number | null, noteBack?: { noteId: string; title: string } | null) {
  const s = useAppStore.getState()
  s.ensureTab('bible')
  const fresh = useAppStore.getState()
  const tabId = fresh.activeTabId['scripture']
  if (!tabId) return

  // Capture current position as the back-navigation target
  const curTab = fresh.tabs['scripture'].find(t => t.id === tabId)
  const cur = curTab?.state as BibleTabState | undefined
  const currentTranslation = cur?.translation ?? 'kjva'
  const scriptureBack = cur
    ? { bookId: cur.bookId, chapter: cur.chapter, verse: cur.targetVerse, label: bookChapterVerseLabel(cur.bookId, cur.chapter), translation: currentTranslation }
    : null

  // Auto-switch translation:
  //   • target book has a dedicated translation (e.g. enoch, jubilees) → use it
  //   • current translation is dedicated but target book is canonical → switch to kjva
  const dedicatedTarget = getTranslationForBook(bId)
  let newTranslation: string | undefined
  if (dedicatedTarget) {
    newTranslation = dedicatedTarget
  } else if (isDedicatedTranslation(currentTranslation)) {
    newTranslation = 'kjva'
  }

  fresh.updateTabState('scripture', tabId, {
    bookId: bId, chapter, targetVerse: verse,
    endVerse: endVerse ?? undefined,
    scrollPosition: 0,
    ...(newTranslation ? { translation: newTranslation } : {}),
    ...(scriptureBack ? { scriptureBack } : {}),
    ...(noteBack !== undefined ? { noteBack } : {}),
  })
  s.setActiveSpace('scripture')
}

function RefLabel({ bookId, chapter, verse, endVerse }: { bookId: string; chapter: number; verse: number; endVerse?: number | null }) {
  let label: string
  if (verse === 0) {
    label = bookChapterVerseLabel(bookId, chapter)
  } else if (endVerse && endVerse > verse) {
    label = `${bookChapterVerseLabel(bookId, chapter, verse)}–${endVerse}`
  } else {
    label = bookChapterVerseLabel(bookId, chapter, verse)
  }
  return <span className="font-mono text-[rgb(var(--color-accent))] group-hover:underline">{label}</span>
}

// Re-export NoteVerseRef as UserNoteRef for local use
type UserNoteRef = import('@/lib/noteRefs').NoteVerseRef

// Small inline component to lazily fetch + show verse text
/** Renders verse text inline — ref label and text sit on the same wrapped line.
 *  - verse === 0  → chapter reference: shows verse 1 text + "…"
 *  - endVerse > verse → range: concatenates all verses (up to 6) with a space
 *  - otherwise    → single verse
 */
function VerseText({ bookId, chapter, verse, endVerse }: { bookId: string; chapter: number; verse: number; endVerse?: number | null }) {
  const [text, setText] = useState('')
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  // Use the active scripture tab's translation for canonical books (so LXX cross-refs show LXX text)
  const activeTranslation = useAppStore((s) => {
    const tabId = s.activeTabId['scripture']
    const tab = tabId ? s.tabs['scripture'].find((t) => t.id === tabId) : null
    return tab ? (tab.state as BibleTabState | undefined)?.translation?.toLowerCase() ?? 'kjva' : 'kjva'
  })
  useEffect(() => {
    // Pseudepigrapha / apocrypha have their own fixed DB; canonical books use the active translation
    const textId = getTranslationForBook(bookId) ?? activeTranslation
    if (verse === 0) {
      window.bible.queryVerse(bookId, chapter, 1, textId)
        .then(v => setText(v?.text ? v.text + '…' : ''))
        .catch(() => {})
    } else if (endVerse && endVerse > verse) {
      const nums = Array.from({ length: Math.min(endVerse - verse + 1, 6) }, (_, i) => verse + i)
      Promise.all(nums.map(vn => window.bible.queryVerse(bookId, chapter, vn, textId)))
        .then(results => setText(results.map(v => v?.text ?? '').filter(Boolean).join(' ')))
        .catch(() => {})
    } else {
      window.bible.queryVerse(bookId, chapter, verse, textId)
        .then(v => setText(v?.text ?? ''))
        .catch(() => {})
    }
  }, [bookId, chapter, verse, endVerse, activeTranslation]) // re-fetch when translation changes
  if (!text) return null
  const display = wordReplacerEnabled && wordReplacerRules.length > 0
    ? applyWordReplacer(text, wordReplacerRules) : text
  return <span className="text-[rgb(var(--color-text-muted))]"> {display}</span>
}

// ─── Chapter-level TSKe view ─────────────────────────────────────────────────

/** Renders a collapsible ref row — shared by all three chapter views */
function VerseSection({
  verseNum, isActive, isCollapsed, onToggle, refCount, children,
}: {
  verseNum: number
  isActive: boolean
  isCollapsed: boolean
  onToggle: () => void
  refCount: number
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer ${
          isActive ? 'bg-[rgb(var(--color-accent))/10]' : 'hover:bg-[rgb(var(--color-surface-4))/50]'
        }`}
      >
        <span className={`font-mono text-[10px] font-bold w-8 flex-shrink-0 ${isActive ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>
          v{verseNum}
        </span>
        <span className="text-[9px] text-[rgb(var(--color-text-muted))] flex-1 tabular-nums">{refCount} ref{refCount !== 1 ? 's' : ''}</span>
        {isCollapsed
          ? <ChevronRight size={10} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
          : <ChevronDown size={10} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />}
      </button>
      {!isCollapsed && <div>{children}</div>}
    </div>
  )
}

function TSKeChapterView({ bookId, chapter, activeVerseNum }: { bookId: string; chapter: number; activeVerseNum: number | null }) {
  const [verseRefs, setVerseRefs] = useState<ChapterTSKeEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window.crossrefs?.getTSKeForChapter !== 'function') { setError(true); return }
    setLoading(true); setError(false)
    getTSKeForChapterShared(bookId, chapter)
      .then((res) => { setVerseRefs(res.error ? [] : res.verseRefs); if (res.error) setError(true) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [bookId, chapter])

  useEffect(() => {
    if (!loading && activeVerseNum && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [loading, activeVerseNum])

  function toggle(key: string) {
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }

  if (loading) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] text-center py-6 animate-pulse">Loading…</p>
  if (error) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] px-3 py-4 text-center">TSKe data unavailable.<br/><span className="text-[9px] opacity-60">Restart the app if you just updated.</span></p>
  if (verseRefs.length === 0) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] text-center py-6">No cross-references found for this chapter</p>

  // When a verse is selected, show ONLY that verse's refs (full-width, expanded)
  const visibleVerseRefs = activeVerseNum
    ? verseRefs.filter(v => v.verseNum === activeVerseNum)
    : verseRefs

  return (
    <div className="divide-y divide-[rgb(var(--color-surface-4))/30]">
      {visibleVerseRefs.map(({ verseNum, groups }) => {
        const isActive = verseNum === activeVerseNum
        const verseKey = `v${verseNum}`
        // Include ALL groups (main + reciprocal) — show reciprocal with a muted label
        const allRefs = groups.reduce((n, g) => n + g.refs.length, 0)
        const isCollapsed = !activeVerseNum && collapsed.has(verseKey)
        return (
          <div key={verseNum} ref={isActive ? activeRef : undefined}>
            {activeVerseNum ? (
              // Verse-only mode: show all groups expanded with no collapse UI
              <div className="pb-1">
                {groups.map((group, gi) => {
                  const gKey = `${verseNum}-g${gi}`
                  const gCollapsed = collapsed.has(gKey)
                  return (
                    <div key={gi}>
                      <button
                        onClick={() => toggle(gKey)}
                        className="w-full flex items-center gap-1.5 px-3 py-1.5 hover:bg-[rgb(var(--color-surface-4))/40] cursor-pointer text-left"
                      >
                        <span className={`text-[9px] font-semibold flex-1 ${group.isReciprocal ? 'text-[rgb(var(--color-text-muted))] italic' : 'text-[rgb(var(--color-text-secondary))]'}`}>
                          {group.heading ?? (group.isReciprocal ? 'Reciprocal' : 'References')}
                        </span>
                        <span className="text-[8px] text-[rgb(var(--color-text-muted))] tabular-nums">{group.refs.length}</span>
                        {gCollapsed
                          ? <ChevronRight size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                          : <ChevronDown size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />}
                      </button>
                      {!gCollapsed && (
                        <div className="flex flex-col gap-1 pl-5 pr-2 pb-1.5">
                          {group.refs.map((r, ri) => (
                            <button key={ri} onClick={() => navToVerseFromPanel(r.bookId, r.chapter, r.verse, r.endVerse)} onContextMenu={(e) => { e.preventDefault(); _onVerseCtxMenu?.(r.bookId, r.chapter, r.verse, e.clientX, e.clientY) }}
                              className="w-full text-left flex flex-col gap-1 px-2.5 py-2 rounded-shell border border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer group"
                            >
                              <span className="w-fit font-mono text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1 py-px group-hover:bg-[rgb(var(--color-accent))]/18 transition-colors leading-none">
                                {r.verse === 0
                                  ? `${bookName(r.bookId)} ${r.chapter}`
                                  : r.endVerse
                                    ? `${bookName(r.bookId)} ${r.chapter}:${r.verse}–${r.endVerse}`
                                    : `${bookName(r.bookId)} ${r.chapter}:${r.verse}`}
                              </span>
                              <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-relaxed">
                                <VerseText bookId={r.bookId} chapter={r.chapter} verse={r.verse} endVerse={r.endVerse} />
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ) : (
              // Chapter mode: collapsible verse sections (main refs only for count, but show all)
              <VerseSection
                verseNum={verseNum} isActive={isActive} isCollapsed={isCollapsed}
                onToggle={() => toggle(verseKey)} refCount={allRefs}
              >
                {groups.map((group, gi) => {
                  const gKey = `${verseNum}-g${gi}`
                  const gCollapsed = collapsed.has(gKey)
                  return (
                    <div key={gi}>
                      {group.heading && (
                        <button onClick={() => toggle(gKey)}
                          className="w-full flex items-center gap-1.5 pl-5 pr-3 py-1 hover:bg-[rgb(var(--color-surface-4))/40] cursor-pointer text-left"
                        >
                          <span className={`text-[9px] font-semibold flex-1 ${group.isReciprocal ? 'text-[rgb(var(--color-text-muted))] italic' : 'text-[rgb(var(--color-text-secondary))]'}`}>
                            {group.heading}
                          </span>
                          <span className="text-[8px] text-[rgb(var(--color-text-muted))] tabular-nums">{group.refs.length}</span>
                          {gCollapsed
                            ? <ChevronRight size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                            : <ChevronDown size={9} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />}
                        </button>
                      )}
                      {!gCollapsed && (
                        <div className="flex flex-col gap-1 pl-8 pr-2 pb-1.5">
                          {group.refs.map((r, ri) => (
                            <button key={ri} onClick={() => navToVerseFromPanel(r.bookId, r.chapter, r.verse, r.endVerse)} onContextMenu={(e) => { e.preventDefault(); _onVerseCtxMenu?.(r.bookId, r.chapter, r.verse, e.clientX, e.clientY) }}
                              className="w-full text-left flex flex-col gap-1 px-2.5 py-2 rounded-shell border border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer group"
                            >
                              <span className="w-fit font-mono text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1 py-px group-hover:bg-[rgb(var(--color-accent))]/18 transition-colors leading-none">
                                {r.verse === 0
                                  ? `${bookName(r.bookId)} ${r.chapter}`
                                  : r.endVerse
                                    ? `${bookName(r.bookId)} ${r.chapter}:${r.verse}–${r.endVerse}`
                                    : `${bookName(r.bookId)} ${r.chapter}:${r.verse}`}
                              </span>
                              <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-relaxed">
                                <VerseText bookId={r.bookId} chapter={r.chapter} verse={r.verse} endVerse={r.endVerse} />
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </VerseSection>
            )}
          </div>
        )
      })}
      <div className="px-3 py-1.5 text-[9px] text-[rgb(var(--color-text-muted))] opacity-50">Treasury of Scripture Knowledge</div>
    </div>
  )
}

// ─── Chapter-level Classic view ───────────────────────────────────────────────

function ClassicChapterView({ bookId, chapter, activeVerseNum }: { bookId: string; chapter: number; activeVerseNum: number | null }) {
  const [verseRefs, setVerseRefs] = useState<ChapterCrossRefEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof window.crossrefs?.getForChapter !== 'function') { setError(true); return }
    setLoading(true); setError(false)
    getCrossRefsForChapterShared(bookId, chapter)
      .then((res) => { setVerseRefs(res.error ? [] : res.verseRefs); if (res.error) setError(true) })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [bookId, chapter])

  useEffect(() => {
    if (!loading && activeVerseNum && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [loading, activeVerseNum])

  if (loading) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] text-center py-6 animate-pulse">Loading…</p>
  if (error) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] px-3 py-4 text-center">Cross-reference data unavailable.<br/><span className="text-[9px] opacity-60">Restart the app if you just updated.</span></p>
  if (verseRefs.length === 0) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] text-center py-6">No cross-references found for this chapter</p>

  const visibleVerseRefs = activeVerseNum
    ? verseRefs.filter(v => v.verseNum === activeVerseNum)
    : verseRefs

  return (
    <div className="divide-y divide-[rgb(var(--color-surface-4))/30]">
      {visibleVerseRefs.map(({ verseNum, refs }) => {
        const isActive = verseNum === activeVerseNum
        const isCollapsed = !activeVerseNum && collapsed.has(verseNum)
        const refList = (
          <div className="flex flex-col gap-1 pl-8 pr-2 pb-1.5">
            {refs.map((r, i) => {
              const strength = Math.max(0, Math.min(Math.ceil(r.votes / 3), 5))
              return (
                <button key={i} onClick={() => navToVerseFromPanel(r.bookId, r.chapter, r.verse, r.endVerse)} onContextMenu={(e) => { e.preventDefault(); _onVerseCtxMenu?.(r.bookId, r.chapter, r.verse, e.clientX, e.clientY) }}
                  className="w-full text-left flex flex-col gap-1 px-2.5 py-2 rounded-shell border border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer group"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="w-fit font-mono text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1 py-px group-hover:bg-[rgb(var(--color-accent))]/18 transition-colors leading-none">
                      {r.verse === 0
                        ? `${bookName(r.bookId)} ${r.chapter}`
                        : r.endVerse
                          ? `${bookName(r.bookId)} ${r.chapter}:${r.verse}–${r.endVerse}`
                          : `${bookName(r.bookId)} ${r.chapter}:${r.verse}`}
                    </span>
                    <span className="text-[8px] text-[rgb(var(--color-text-muted))] opacity-70 tracking-tight">{'●'.repeat(strength)}{'○'.repeat(5 - strength)}</span>
                  </div>
                  <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-relaxed">
                    <VerseText bookId={r.bookId} chapter={r.chapter} verse={r.verse} endVerse={r.endVerse} />
                  </p>
                </button>
              )
            })}
          </div>
        )
        return (
          <div key={verseNum} ref={isActive ? activeRef : undefined}>
            {activeVerseNum ? (
              // Verse-only mode: show all refs expanded, no collapse header
              <div className="pb-1">{refList}</div>
            ) : (
              <VerseSection
                verseNum={verseNum} isActive={isActive} isCollapsed={isCollapsed}
                onToggle={() => setCollapsed(prev => { const n = new Set(prev); n.has(verseNum) ? n.delete(verseNum) : n.add(verseNum); return n })}
                refCount={refs.length}
              >
                {refList}
              </VerseSection>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Chapter-level User Notes view ───────────────────────────────────────────

function UserNotesChapterView({
  bookId, chapter, activeVerseNum, onNoteClick,
}: {
  bookId: string
  chapter: number
  activeVerseNum: number | null
  onNoteClick?: (note: Note) => void
}) {
  const [verseNoteRefs, setVerseNoteRefs] = useState<Array<{ verseNum: number; refs: UserNoteRef[] }>>([])
  const [indirectNotes, setIndirectNotes] = useState<Array<{ note: Note; verses: number[] }>>([])
  const [indirectSectionOpen, setIndirectSectionOpen] = useState(false)
  const [expandedIndirectIds, setExpandedIndirectIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    function mergeNoteRefs(
      byVerse: Map<number, UserNoteRef[]>,
      note: Note,
      verseNum: number,
      skipBookId?: string,
      skipChapter?: number,
    ) {
      const extracted = extractRefsFromNote(note.content, note.title || 'Untitled')
      if (extracted.length === 0) return
      if (!byVerse.has(verseNum)) byVerse.set(verseNum, [])
      for (const ref of extracted) {
        if (skipBookId && ref.bookId === skipBookId && ref.chapter === skipChapter && ref.verse === verseNum) continue
        const existing = byVerse.get(verseNum)!
        if (!existing.some(r => r.bookId === ref.bookId && r.chapter === ref.chapter && r.verse === ref.verse)) {
          existing.push(ref)
        }
      }
    }

    function mergeVerseRef(byVerse: Map<number, UserNoteRef[]>, verseRefStr: string, verseNum: number, sourceTitle: string) {
      const parts = verseRefStr.split('.')
      const nbId = parts[0]
      const nCh = parseInt(parts[1] ?? '0', 10)
      const nVs = parseInt(parts[2] ?? '0', 10)
      if (!nbId || !nCh || !nVs) return
      if (!byVerse.has(verseNum)) byVerse.set(verseNum, [])
      const arr = byVerse.get(verseNum)!
      if (!arr.some(x => x.bookId === nbId && x.chapter === nCh && x.verse === nVs)) {
        arr.push({ bookId: nbId, chapter: nCh, verse: nVs, sourceNoteTitle: sourceTitle, context: '' })
      }
    }

    getChapterNotesShared(bookId, chapter, noteChangeToken)
      .then(async (verseNotes) => {
        const byVerse = new Map<number, UserNoteRef[]>()
        const indirect: Array<{ note: Note; verses: number[] }> = []

        // 1) Direct verse notes attached to this chapter
        for (const note of verseNotes) {
          const vn = parseInt((note.verseRef ?? '').split('.')[2] ?? '0', 10)
          if (!vn) continue
          mergeNoteRefs(byVerse, note, vn, bookId, chapter)
        }

        // 2) Notes whose content mentions a verse in this chapter
        const chapterLabel = `${bookName(bookId)} ${chapter}:`
        try {
          const candidates = await searchNotesShared(chapterLabel, 80, noteChangeToken)
          const verseNoteIds = new Set(verseNotes.map(n => n.id))
          for (const note of candidates) {
            if (verseNoteIds.has(note.id)) continue
            const refs = extractRefsFromNote(note.content, note.title || '')
            const chapterRefs = refs.filter(r => r.bookId === bookId && r.chapter === chapter)
            if (chapterRefs.length === 0) continue

            if (note.verseRef) {
              // Verse note on ANOTHER verse — treat as cross-ref (existing behaviour)
              for (const r of chapterRefs) {
                mergeVerseRef(byVerse, note.verseRef, r.verse, note.title || 'Untitled')
                mergeNoteRefs(byVerse, note, r.verse, bookId, chapter)
              }
            } else {
              // General / daily / topic note — surface separately so the user knows
              // the connection is indirect (the note mentions the chapter but isn't
              // attached to any specific verse).
              const verses = [...new Set(chapterRefs.map(r => r.verse).filter(v => v > 0))].sort((a, b) => a - b)
              if (!indirect.some(x => x.note.id === note.id)) {
                indirect.push({ note, verses })
              }
            }
          }
        } catch { /* ignore search errors */ }

        setVerseNoteRefs(
          Array.from(byVerse.entries()).sort((a, b) => a[0] - b[0]).map(([verseNum, refs]) => ({ verseNum, refs }))
        )
        setIndirectNotes(indirect)
      })
      .catch(() => { setVerseNoteRefs([]); setIndirectNotes([]) })
      .finally(() => setLoading(false))
  }, [bookId, chapter, noteChangeToken])

  useEffect(() => {
    if (!loading && activeVerseNum && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [loading, activeVerseNum])

  if (loading) return <p className="text-[11px] text-[rgb(var(--color-text-muted))] text-center py-6 animate-pulse">Loading…</p>
  if (verseNoteRefs.length === 0 && indirectNotes.length === 0) return (
    <div className="flex flex-col items-center justify-center px-4 py-12 text-center gap-2 text-[rgb(var(--color-text-muted))]">
      <StickyNote size={24} className="opacity-25" />
      <p className="text-xs">No cross-references found in your notes for this chapter.</p>
      <p className="text-[10px] opacity-60 max-w-[220px]">Write verse notes that reference other passages to see them here.</p>
    </div>
  )

  const visibleVerseRefs = activeVerseNum
    ? verseNoteRefs.filter(v => v.verseNum === activeVerseNum)
    : verseNoteRefs

  return (
    <div className="divide-y divide-[rgb(var(--color-surface-4))/30]">

      {/* ── Indirect connections (general/daily/topic notes) ───────────────── */}
      {indirectNotes.length > 0 && (
        <div className="border-b border-[rgb(var(--color-surface-4))/50]">
          {/* Section header — collapsible */}
          <button
            onClick={() => setIndirectSectionOpen(v => !v)}
            className="w-full flex items-center gap-2 px-3 py-1.5 bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))/60] transition-colors cursor-pointer text-left"
          >
            <span className="text-lg flex-shrink-0 select-none text-[rgb(var(--color-text-muted))]">{indirectSectionOpen ? '▾' : '▸'}</span>
            <span className="flex-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
              General mentions ({indirectNotes.length})
            </span>
            <span className="text-[8px] text-[rgb(var(--color-text-muted))] opacity-60 italic">connection may be indirect</span>
          </button>

          {indirectSectionOpen && (
            <div className="flex flex-col gap-0.5 p-1.5">
              {indirectNotes.map(({ note, verses }) => {
                const isExpanded = expandedIndirectIds.has(note.id)
                return (
                  <div key={note.id} className="rounded-shell overflow-hidden">
                    {/* Note title row */}
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-shell hover:bg-[rgb(var(--color-surface-3))] group transition-colors">
                      <button
                        onClick={() => setExpandedIndirectIds(prev => {
                          const n = new Set(prev)
                          n.has(note.id) ? n.delete(note.id) : n.add(note.id)
                          return n
                        })}
                        className="text-[10px] text-[rgb(var(--color-text-muted))] select-none cursor-pointer w-3 flex-shrink-0 leading-none hover:text-[rgb(var(--color-text-primary))] transition-colors"
                      >
                        {isExpanded ? '▾' : '▸'}
                      </button>
                      <StickyNote size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
                      <button
                        onClick={() => onNoteClick?.(note)}
                        className="flex-1 text-left text-[11px] font-medium text-[rgb(var(--color-text-secondary))] truncate cursor-pointer hover:text-[rgb(var(--color-text-primary))] transition-colors min-w-0"
                      >
                        {note.title || 'Untitled'}
                      </button>
                      {verses.length > 0 && (
                        <span className="text-[9px] text-[rgb(var(--color-text-muted))] tabular-nums flex-shrink-0">
                          {verses.length} verse{verses.length !== 1 ? 's' : ''}
                        </span>
                      )}
                      <button
                        onClick={() => onNoteClick?.(note)}
                        title="Open note"
                        className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] transition-all cursor-pointer"
                      >
                        <ExternalLink size={10} />
                      </button>
                    </div>
                    {/* Verse chips — shown when note is expanded */}
                    {isExpanded && verses.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-7 pr-2 pt-0.5 pb-1.5">
                        {verses.map(v => (
                          <button
                            key={v}
                            onClick={() => navToVerseFromPanel(bookId, chapter, v)}
                            className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-[rgb(var(--color-accent))]/10 text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))]/18 cursor-pointer transition-colors"
                          >
                            v.{v}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Verse-based cross-refs (direct verse notes) ────────────────────── */}
      {visibleVerseRefs.map(({ verseNum, refs }) => {
        const isActive = verseNum === activeVerseNum
        const isCollapsed = !activeVerseNum && collapsed.has(verseNum)
        const refList = (
          <div className="flex flex-col gap-1 pl-8 pr-2 pb-1.5">
            {refs.map((r, i) => (
              <button key={i} onClick={() => navToVerseFromPanel(r.bookId, r.chapter, r.verse, r.endVerse)} onContextMenu={(e) => { e.preventDefault(); _onVerseCtxMenu?.(r.bookId, r.chapter, r.verse, e.clientX, e.clientY) }}
                className="w-full text-left flex flex-col gap-1 px-2.5 py-2 rounded-shell border border-transparent hover:border-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer group"
              >
                <span className="w-fit font-mono text-[10px] font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded px-1 py-px group-hover:bg-[rgb(var(--color-accent))]/18 transition-colors leading-none">
                  <RefLabel bookId={r.bookId} chapter={r.chapter} verse={r.verse} endVerse={r.endVerse} />
                </span>
                <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-relaxed">
                  <VerseText bookId={r.bookId} chapter={r.chapter} verse={r.verse} endVerse={r.endVerse} />
                </p>
                <span className="flex items-center gap-1 text-[9px] text-[rgb(var(--color-text-muted))]">
                  <StickyNote size={8} className="flex-shrink-0 opacity-70" />
                  <span className="truncate">{r.sourceNoteTitle}</span>
                </span>
              </button>
            ))}
          </div>
        )
        return (
          <div key={verseNum} ref={isActive ? activeRef : undefined}>
            {activeVerseNum ? (
              <div className="pb-1">{refList}</div>
            ) : (
              <VerseSection
                verseNum={verseNum} isActive={isActive} isCollapsed={isCollapsed}
                onToggle={() => setCollapsed(prev => { const n = new Set(prev); n.has(verseNum) ? n.delete(verseNum) : n.add(verseNum); return n })}
                refCount={refs.length}
              >
                {refList}
              </VerseSection>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Cross refs tab (chapter-first) ──────────────────────────────────────────

function CrossRefsTab({
  bookId, chapter, activeVerseRef, onClearVerseFilter, onNoteClick,
}: {
  bookId: string
  chapter: number
  activeVerseRef: string | null
  onClearVerseFilter?: () => void
  onNoteClick?: (note: Note) => void
}) {
  const crossRefSource = useAppStore((s) => s.crossRefSource)
  const setCrossRefSource = useAppStore((s) => s.setCrossRefSource)

  const activeVerseNum = activeVerseRef
    ? parseInt(activeVerseRef.split('.')[2] ?? '0', 10) || null
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
        {/* Chapter / verse label */}
        <span className="text-[10px] text-[rgb(var(--color-text-muted))] flex-1 truncate min-w-0">
          {bookName(bookId)} {chapter}
          {activeVerseNum ? (
            <span className="text-[rgb(var(--color-accent))] font-medium"> · v{activeVerseNum}</span>
          ) : (
            <span className="opacity-50"> · all</span>
          )}
        </span>

        {/* Clear verse filter */}
        {activeVerseNum && onClearVerseFilter && (
          <button
            onClick={onClearVerseFilter}
            title="Show all verses in chapter"
            className="flex-shrink-0 text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer rounded p-0.5 hover:bg-[rgb(var(--color-surface-4))] transition-colors"
          >
            <X size={11} />
          </button>
        )}

        {/* Source toggle */}
        <div className="flex items-center bg-[rgb(var(--color-surface-4))] rounded p-0.5 gap-0.5 flex-shrink-0">
          {(['tske', 'classic', 'notes'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setCrossRefSource(s)}
              title={s === 'tske' ? 'Treasury of Scripture Knowledge' : s === 'classic' ? 'Classic cross-refs' : 'Cross-references from your verse notes'}
              className={`text-[9px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                crossRefSource === s
                  ? 'bg-[rgb(var(--color-surface-1))] text-[rgb(var(--color-text-primary))] shadow-sm font-medium'
                  : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))]'
              }`}
            >
              {s === 'tske' ? 'TSKe' : s === 'classic' ? 'Classic' : 'My Notes'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {crossRefSource === 'tske' && <TSKeChapterView bookId={bookId} chapter={chapter} activeVerseNum={activeVerseNum} />}
        {crossRefSource === 'classic' && <ClassicChapterView bookId={bookId} chapter={chapter} activeVerseNum={activeVerseNum} />}
        {crossRefSource === 'notes' && <UserNotesChapterView bookId={bookId} chapter={chapter} activeVerseNum={activeVerseNum} onNoteClick={onNoteClick} />}
      </div>
    </div>
  )
}

// ─── Notes tab ───────────────────────────────────────────────────────────────

interface Props {
  bookId: string
  chapter: number
  activeTab: PanelTab
  onTabChange: (tab: PanelTab) => void
  openNoteId?: string | null
  onNoteChange?: (noteId: string | null) => void
  /** Cursor offset to restore in the side-panel note editor (on tab return). */
  initialNoteCursor?: number | null
  /** True only if the user was actively editing the note when they left this tab —
   *  gates auto-focus + cursor restore so we never steal focus into the note panel. */
  autoFocusNote?: boolean
  /** Called as the side-panel note cursor moves; parent persists it for tab restore. */
  onNoteCursorChange?: (pos: number) => void
  openLexiconEntry?: string | null
  onLexiconEntryChange?: (entry: string | null) => void
  verseFilter?: string | null
  onVerseFilterChange?: (filter: string | null) => void
  /** "Expand all notes" toggle state for this slot's notes list, persisted by the parent so it
   *  survives switching tabs/slots and app restarts instead of resetting to collapsed. */
  expandAllNotes?: boolean
  onExpandAllNotesChange?: (next: boolean) => void
  /** When set, hides the tab strip and forces this tab's content to be shown */
  forcedTab?: PanelTab
  /** Called with 0–1 scroll percentage whenever any inner scroll container scrolls */
  onScrollPercent?: (pct: number) => void
  /** Which of the two independent side-panel slots this instance renders — namespaces the
   *  tab-strip's sliding-pill layoutId (see the tab strip below) and identifies this instance
   *  in the pop-out/merge/drag-and-drop context menu. */
  slotId?: 'A' | 'B'
  /** Moves `tab` into slot `toSlot`, always passed on BOTH slot instances (unconditionally) so
   *  drag-and-drop's onDrop handler can call it on whichever instance actually received the
   *  drop — the target slot is explicit (`toSlot`) rather than inferred from "which instance's
   *  own props happen to be set," which was the actual bug behind drag-and-drop doing nothing:
   *  dropping onto slot B previously tried to call a `onPopOutToSlotB` prop that was only ever
   *  passed to the slot A instance, silently no-oping via optional chaining. */
  onMoveTab?: (tab: PanelTab, toSlot: 'A' | 'B') => void
  /** True only on slot A when slot B isn't already open — gates whether "Pop out into new
   *  panel" appears in the tab context menu (there's nowhere to pop out TO otherwise). */
  canPopOut?: boolean
  /** Present only on slot B — closes the whole second panel (its own header's ✕ button). */
  onCloseSlotB?: () => void
  /** Present only on slot A, and only meaningful once slot B is open — closes slot A,
   *  promoting slot B into its place (see BiblePanel.tsx's closeSlotA). */
  onCloseSlotA?: () => void
  /** The OTHER slot's currently-active tab type (undefined when only this slot is open, or
   *  when `forcedTab` applies — a forced single-purpose panel has no tab strip at all). Used
   *  to filter that type out of THIS slot's own tab-strip buttons, so a tab that's been popped
   *  out into the other slot stops being offered here too — previously both slots' strips
   *  always showed all three types regardless of which slot actually owned which, so "popping
   *  out" a tab never actually removed it from the source panel's own strip. */
  otherSlotTab?: PanelTab | null
}

export default function BibleRightPanel({
  bookId, chapter, activeTab, onTabChange,
  openNoteId, onNoteChange,
  initialNoteCursor, autoFocusNote, onNoteCursorChange,
  openLexiconEntry: initialLexiconEntry, onLexiconEntryChange,
  verseFilter: initialVerseFilter, onVerseFilterChange,
  expandAllNotes, onExpandAllNotesChange,
  forcedTab,
  onScrollPercent,
  slotId = 'A',
  onMoveTab,
  canPopOut,
  onCloseSlotB,
  onCloseSlotA,
  otherSlotTab,
}: Props) {
  // Captured once when the side-panel note editor first mounts, so cursor restoration
  // uses the value saved before this tab was switched away (not a live-updating prop).
  const initialNoteCursorRef = useRef<number>(initialNoteCursor ?? 0)
  const visibleTab = forcedTab ?? activeTab
  // Which panel types have been shown at least once in THIS slot — once true, that tab's
  // subtree stays mounted (display:none'd, never unmounted) instead of unmounting on
  // switch-away, so its own local state (Lexicon's query/results/history/scroll position,
  // cross-ref's collapsed groups, the notes list's own scroll) survives switching to a
  // different tab and back. A tab never opened in this slot never pays its mount cost.
  const [mountedTabs, setMountedTabs] = useState<Set<PanelTab>>(() => new Set([visibleTab]))
  useEffect(() => {
    setMountedTabs((prev) => (prev.has(visibleTab) ? prev : new Set(prev).add(visibleTab)))
  }, [visibleTab])
  const sideZoom = useAppStore((s) => s.appZoom)
  const [scope, setScope] = useState<NoteScope>('chapter')
  const [sort, setSort] = useState<NoteSort>('verse')
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  // Persisted by the parent (BiblePanel.tsx) via tabState.rightPanelExpandAll[B] so it survives
  // switching tabs/slots and app restarts instead of resetting to collapsed every time.
  const expandAll = expandAllNotes ?? false
  const setExpandAll = onExpandAllNotesChange ?? (() => {})
  // Whole-chapter notes (verseRef like "GEN.1", no verse segment) are collapsed by
  // default so they don't crowd out the verse-specific notes below, which is what
  // this panel's chapter scope is really for — see the section below `filtered`.
  const [chapterNotesCollapsed, setChapterNotesCollapsed] = useState(true)
  // General/daily notes that merely mention this chapter (not chapter/verse notes
  // themselves) — collapsed by default, same treatment as chapter notes above.
  const [mentionNotesCollapsed, setMentionNotesCollapsed] = useState(true)
  const [notes, setNotes] = useState<Note[]>([])
  const [sidebarNote, setSidebarNote] = useState<Note | null>(null)
  const [noteSearch, setNoteSearch] = useState('')
  // Remember filter/sort when entering a note so they're restored on exit
  const savedScope = useRef<NoteScope>(scope)
  const savedSort = useRef<NoteSort>(sort)
  const [selectedNoteIdx, setSelectedNoteIdx] = useState(-1)
  const [verseFilter, setVerseFilter] = useState<string | null>(initialVerseFilter ?? null)
  const [referencingNotes, setReferencingNotes] = useState<Note[]>([])
  const [chapterMentionNotes, setChapterMentionNotes] = useState<Note[]>([])
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const createNoteTab = useAppStore((s) => s.createTab)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const bumpFloatingTabToken = useAppStore((s) => s.bumpFloatingTabToken)

  // Track the current sidebar note in a ref so the unmount cleanup can access it
  const sidebarNoteRef = useRef<Note | null>(null)

  // ── Side-panel item right-click context menu ──
  type SideCtxData = { type: 'note'; note: Note } | { type: 'verse'; bookId: string; chapter: number; verse: number }
  const { menu: sideCtxMenu, menuRef: sideCtxMenuRef, openMenu: openSideCtxMenu, closeMenu: closeSideCtxMenu } =
    usePositionedMenu<SideCtxData>()

  // ── Tab-strip right-click "pop out" / "merge back" menu — separate instance from
  // sideCtxMenu above (unrelated data shape: which tab, not which note/verse). ──
  const { menu: tabCtxMenu, menuRef: tabCtxMenuRef, openMenu: openTabCtxMenu, closeMenu: closeTabCtxMenu } =
    usePositionedMenu<{ tab: PanelTab }>()
  // MIME type carrying {tab, slotId} across a tab-strip drag between two independent
  // BibleRightPanel instances — dataTransfer itself is the only thing shared between sibling
  // component instances during a native HTML5 drag, no lifted ref/state needed.
  const PANEL_TAB_DRAG_MIME = 'application/x-berean-panel-tab'
  const [dragOverStrip, setDragOverStrip] = useState(false)

  // Register the module-level verse context menu callback so inner cross-ref components can call it
  useEffect(() => {
    _onVerseCtxMenu = (bId, ch, vs, x, y) => openSideCtxMenu({ type: 'verse', bookId: bId, chapter: ch, verse: vs, x, y })
    return () => { _onVerseCtxMenu = null }
  }, [openSideCtxMenu])

  // Handle verse ref clicks in the right-panel note editor — navigates the main
  // Bible panel to the referenced verse, switching translation as needed.
  function handleVerseRefClick(ref: ParsedRef) {
    navToVerseFromPanel(ref.bookId, ref.chapter, ref.verse ?? 1, ref.endVerse,
      sidebarNote ? { noteId: sidebarNote.id, title: sidebarNote.title || 'Untitled' } : null)
    // Apply translation override after the back-saving nav so translation isn't clobbered
    const store = useAppStore.getState()
    const scriptureTabId = store.activeTabId['scripture']
    if (!scriptureTabId) return
    const translationOverride =
      ref.forcedTranslation ??
      getTranslationForBook(ref.bookId) ??
      store.defaultBibleTranslation
    store.updateTabState('scripture', scriptureTabId, {
      translation: translationOverride.toUpperCase(),
    })
  }

  // Apply incoming verse filter
  useEffect(() => {
    if (initialVerseFilter === undefined) return
    setVerseFilter(initialVerseFilter ?? null)
    setSidebarNote(null)
  }, [initialVerseFilter])

  // Open a specific note when openNoteId arrives (externally triggered).
  // Guard: if sidebarNoteRef already holds this note, we triggered the prop change
  // ourselves (click → onNoteChange → rightPanelNoteId → openNoteId) — don't re-open
  // and don't clear the verse filter. External opens (VerseRow context menu) already
  // clear rightPanelVerseFilter in BiblePanel before setting rightPanelNoteId, so
  // verseFilter is cleared via the initialVerseFilter effect, not here.
  useEffect(() => {
    if (!openNoteId) return
    if (sidebarNoteRef.current?.id === openNoteId) return  // we already opened it
    window.notes.getNote(openNoteId)
      .then((note) => { if (note) openSidebarNote(note) })
      .catch(() => {})
  }, [openNoteId])

  useEffect(() => {
    if (visibleTab !== 'notes') return
    if (scope === 'chapter') {
      // Fetch verse notes for this chapter, then also search for general/daily/topic
      // notes that mention the chapter so they appear at the top as indirect connections.
      getChapterNotesShared(bookId, chapter, noteChangeToken).then(async (verseNotes) => {
        setNotes(verseNotes)
        const verseNoteIds = new Set(verseNotes.map(n => n.id))
        const label = bookName(bookId)
        try {
          // Cast a wide net via FTS on just the book name — searching for the book
          // name + bare chapter number together (as one AND query) made the second
          // term an extremely low-selectivity prefix match ("1"* matches 1, 10-19,
          // 100s...), and with a low result LIMIT ordered by recency, a real match
          // could get pushed out before ever reaching the client-side filter below.
          // Book name alone is far more selective, so a real mention survives a much
          // larger candidate set, which is then precisely tested for an actual
          // "<Book> <chapter>" mention (not just "<Book>" appearing anywhere).
          const candidates = await searchNotesShared(label, 300, noteChangeToken)
          const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          const mentionRe = new RegExp(`\\b${escaped}\\b\\D{0,10}${chapter}(?!\\d)`, 'i')
          setChapterMentionNotes(
            candidates.filter(n =>
              !verseNoteIds.has(n.id) && !n.verseRef &&
              mentionRe.test(`${n.title ?? ''} ${n.content ?? ''}`)
            )
          )
        } catch {
          setChapterMentionNotes([])
        }
      }).catch(() => { setNotes([]); setChapterMentionNotes([]) })
    } else {
      setChapterMentionNotes([])
      getNotesShared(500, 0, noteChangeToken).then(setNotes).catch(() => {})
    }
  }, [visibleTab, noteChangeToken, scope, bookId, chapter])

  // Persist open note (omit onNoteChange from deps — new ref each render)
  useEffect(() => {
    onNoteChange?.(sidebarNote?.id ?? null)
  }, [sidebarNote?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep sidebarNoteRef in sync so the unmount cleanup can access the current note
  useEffect(() => { sidebarNoteRef.current = sidebarNote }, [sidebarNote])

  // Auto-delete empty verse note on unmount (e.g. right panel closes while note is open)
  useEffect(() => {
    return () => {
      const note = sidebarNoteRef.current
      if (note && !note.content?.trim()) {
        window.notes.deleteNote(note.id).catch(() => {})
      }
    }
  }, []) // intentionally empty — runs only on unmount

  // Persist verse filter (omit onVerseFilterChange from deps — new ref each render)
  useEffect(() => {
    onVerseFilterChange?.(verseFilter)
  }, [verseFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // When a verse filter is active, also search for general notes that reference it
  useEffect(() => {
    if (!verseFilter) { setReferencingNotes([]); return }
    const parts = verseFilter.split('.')
    if (parts.length < 3) { setReferencingNotes([]); return }
    const [bId, ch, vs] = parts
    const humanRef = `${bookName(bId)} ${ch}:${vs}`
    searchNotesShared(humanRef, 60, noteChangeToken)
      .then((candidates) => {
        const result: Note[] = []
        for (const note of candidates) {
          if (note.verseRef === verseFilter) continue // already in main filtered list
          const refs = extractRefsFromNote(note.content, note.title || '')
          if (refs.some(r => r.bookId === bId && r.chapter === parseInt(ch, 10) && r.verse === parseInt(vs, 10))) {
            result.push(note)
          }
        }
        setReferencingNotes(result)
      })
      .catch(() => setReferencingNotes([]))
  }, [verseFilter, noteChangeToken])

  const filtered = useMemo(() => {
    let result = [...notes]
    // When scope === 'chapter', notes are already pre-filtered by getChapterNotes.
    // For 'all' scope, filter client-side (loaded set is already limited to 500).
    if (verseFilter) {
      result = result.filter((n) => n.verseRef === verseFilter)
    }
    if (noteSearch.trim()) {
      const q = noteSearch.trim().toLowerCase()
      result = result.filter((n) =>
        n.title?.toLowerCase().includes(q) || n.content?.toLowerCase().includes(q)
      )
    }
    result.sort((a, b) => {
      if (sort === 'verse') {
        const av = parseInt(a.verseRef?.split('.')[2] ?? '9999', 10)
        const bv = parseInt(b.verseRef?.split('.')[2] ?? '9999', 10)
        return av - bv
      }
      if (sort === 'modified') return b.updatedAt - a.updatedAt
      return b.createdAt - a.createdAt
    })
    return result
  }, [notes, sort, verseFilter, noteSearch])

  // Whole-chapter notes (verseRef has no verse segment, e.g. "GEN.1" vs "GEN.1.5")
  // vs verse-specific ones — see chapterNotesCollapsed above. When a specific
  // verse filter is active, `filtered` can never contain a chapter-level note
  // (verseRef equality requires an exact match), so this split is a no-op then.
  // Keeps each note paired with its ORIGINAL index in `filtered` (not a local
  // per-section index) since `selectedNoteIdx`'s keyboard-nav/Enter-to-open
  // indexes directly into `filtered` — rendering from these entries instead
  // of `filtered` directly must not disturb that indexing.
  const filteredWithIdx = useMemo(() => filtered.map((note, i) => ({ note, i })), [filtered])
  const chapterLevelEntries = useMemo(
    () => filteredWithIdx.filter(({ note }) => (note.verseRef?.split('.').length ?? 0) === 2),
    [filteredWithIdx],
  )
  const verseSpecificEntries = useMemo(
    () => filteredWithIdx.filter(({ note }) => (note.verseRef?.split('.').length ?? 0) !== 2),
    [filteredWithIdx],
  )

  // Close the sort menu on outside click
  useEffect(() => {
    if (!sortMenuOpen) return
    function onDown(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [sortMenuOpen])

  function handleNoteChange(content: string) {
    if (!sidebarNote) return
    const updated = { ...sidebarNote, content, updatedAt: Date.now() }
    setSidebarNote(updated)
    setNotes((prev) => prev.map((n) => (n.id === sidebarNote.id ? updated : n)))
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      window.notes.updateNote(sidebarNote.id, { content }).catch(() => {})
      bumpNoteToken()
    }, 500)
  }

  function handleSidebarLexiconRefClick(strongsId: string) {
    const store = useAppStore.getState()
    const fromNote = sidebarNote ? { noteId: sidebarNote.id, title: sidebarNote.title || 'Untitled' } : undefined
    // Create/activate the target Lexicon tab BEFORE queuing the entry —
    // openLexiconEntry's pending value is picked up by whichever Lexicon
    // tab is active at that moment, so calling it while a DIFFERENT tab is
    // still active hands the entry to the wrong tab.
    createNoteTab('lexicon')
    store.openLexiconEntry(strongsId, fromNote)
    setActiveSpace('lexicon')
  }

  async function closeSidebarNote() {
    if (sidebarNote && !sidebarNote.content?.trim()) {
      await window.notes.deleteNote(sidebarNote.id)
      setNotes((prev) => prev.filter((n) => n.id !== sidebarNote.id))
      bumpNoteToken()
    }
    setSidebarNote(null)
    // Restore the filter/sort that was active before entering the note
    setScope(savedScope.current)
    setSort(savedSort.current)
  }

  /** Open a note in the sidepanel, saving the current filter/sort first */
  function openSidebarNote(note: Note) {
    savedScope.current = scope
    savedSort.current = sort
    setSidebarNote(note)
  }

  async function createChapterNote() {
    const title = verseFilter ? formatRef(verseFilter) : `${bookName(bookId)} ${chapter}`
    const verseRef = verseFilter ?? `${bookId}.${chapter}`
    const result = await window.notes.createNote({ type: 'verse', title, verseRef, content: '' })
    if (result.success && result.note) {
      bumpNoteToken()
      openSidebarNote(result.note)
    }
  }

  function handleSidebarNoteTitle(title: string) {
    if (!sidebarNote) return
    const updated = { ...sidebarNote, title, updatedAt: Date.now() }
    setSidebarNote(updated)
    setNotes((prev) => prev.map((n) => (n.id === sidebarNote.id ? updated : n)))
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    titleSaveTimer.current = setTimeout(() => {
      window.notes.updateNote(sidebarNote.id, { title }).catch(() => {})
      bumpNoteToken()
    }, 500)
  }

  function clearVerseFilter() {
    setVerseFilter(null)
    onVerseFilterChange?.(null)
  }

  // Shared note-row renderer for both the "chapter notes" and "Direct verse
  // notes" sections — `i` is the note's index in `filtered` (not a per-
  // section index), since selectedNoteIdx's keyboard-nav/Enter-to-open reads
  // directly from `filtered`.
  function renderNoteRow(note: Note, i: number) {
    const rawSnippet = note.content
      .replace(/^---[\s\S]*?---\n?/, '')
      .replace(/[#*`_>~\[\]]/g, '')
      .trim()
    const snippet = expandAll ? rawSnippet : rawSnippet.replace(/\n/g, ' ')
    return (
      <div
        key={note.id}
        className={`relative group transition-colors ${i === selectedNoteIdx ? 'bg-[rgb(var(--color-surface-4))]' : 'hover:bg-[rgb(var(--color-surface-4))/60]'}`}
      >
        {/* The "open in notes tab" button below is absolutely positioned
            (not a flex sibling) so it doesn't reserve layout space on the
            right of every row even while invisible (opacity-0 still occupies
            its box in normal flow) — that reserved gap was what read as
            "too much padding on the right" in this list. */}
        <button
          onClick={() => { openSidebarNote(note); setSelectedNoteIdx(-1) }}
          onContextMenu={(e) => { e.preventDefault(); openSideCtxMenu({ type: 'note', note, x: e.clientX, y: e.clientY }) }}
          className="w-full text-left px-2 py-2.5 cursor-pointer min-w-0"
        >
          <div className="flex items-center gap-1.5 min-w-0">
            {/* Note color dot — the same color-coding shown as a verse indicator
                dot in the chapter view (VerseRow.tsx), surfaced here too so the
                list itself communicates each note's category at a glance. */}
            <span
              className="w-[6px] h-[6px] rounded-full flex-shrink-0"
              style={{ backgroundColor: NOTE_DOT_COLOR[note.color ?? 'blue'] ?? NOTE_DOT_COLOR.blue }}
            />
            <span className="text-xs font-medium text-[rgb(var(--color-text-primary))] truncate">
              {note.title || 'Untitled'}
            </span>
          </div>
          <div className={`text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 ${expandAll ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
            {(expandAll ? snippet : snippet.slice(0, 80)) || 'Empty note'}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            {note.verseRef && (
              <span
                className="w-fit flex-shrink-0 whitespace-nowrap font-mono text-[9px] font-semibold text-[rgb(var(--color-accent))] rounded-[2px] px-[3px] leading-[1.2] bg-[rgb(var(--color-accent))/10]"
              >
                {formatRef(note.verseRef)}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate whitespace-nowrap text-right text-[10px] text-[rgb(var(--color-text-muted))] opacity-70 tabular-nums">
              created {timeAgo(note.createdAt)}
              {note.updatedAt !== note.createdAt ? ` · modified ${timeAgo(note.updatedAt)}` : ''}
            </span>
          </div>
        </button>
        <button
          onClick={() => {
            createNoteTab('note')
            setActiveSpace('notes')
            requestOpenNote(note.id)
          }}
          title="Open in notes tab"
          className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 flex-shrink-0 p-1.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
        >
          <ExternalLink size={11} />
        </button>
      </div>
    )
  }

  return (
    <div
      className="native-buttons flex flex-col h-full"
      // Scroll events don't bubble — use the capture phase so a scroll in ANY inner scroller
      // (note editor, cross-ref list, lexicon) is caught and mirrored to the presenter.
      onScrollCapture={(e) => {
        const el = e.target as HTMLElement
        const max = el.scrollHeight - el.clientHeight
        if (max > 0 && onScrollPercent) onScrollPercent(el.scrollTop / max)
      }}
    >
      {/* Tab strip — hidden when a tab is forced externally. Real tab shapes (top-rounded
          only, active tab flush against the content below it) rather than a plain segmented
          control, with a drag/right-click "pop out"/"merge back" affordance.
          Slot B is LOCKED to the single tab it was popped out for — a fixed label, not a
          switcher — per explicit direction ("the new panel...should get just the notes tab or
          whatever tab was popped out"). Only slot A keeps the switchable multi-button strip
          (filtered to whatever's not already claimed by slot B). Both get a close button once
          a second panel exists. */}
      {!forcedTab && (
        <div className="flex items-center gap-1 px-1.5 pt-1.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
          {slotId === 'B' ? (
            <div
              draggable
              onDragStart={(e) => e.dataTransfer.setData(PANEL_TAB_DRAG_MIME, JSON.stringify({ tab: visibleTab, slotId }))}
              // Dragging this label out with nothing catching the drop merges it back into
              // the main panel — same "dragged away with no valid target" gesture as slot A's
              // own strip buttons use for the reverse (pop out) direction.
              onDragEnd={(e) => {
                if (e.dataTransfer.dropEffect === 'none') onMoveTab?.(visibleTab, 'A')
              }}
              onContextMenu={(e) => { e.preventDefault(); openTabCtxMenu({ tab: visibleTab, x: e.clientX, y: e.clientY }) }}
              onDragOver={(e) => { e.preventDefault(); setDragOverStrip(true) }}
              onDragLeave={() => setDragOverStrip(false)}
              onDrop={(e) => {
                e.stopPropagation() // don't also let BiblePanel.tsx's catch-all pop-out/merge-back handler see this
                setDragOverStrip(false)
                const raw = e.dataTransfer.getData(PANEL_TAB_DRAG_MIME)
                if (!raw) return
                const { tab, slotId: fromSlot } = JSON.parse(raw) as { tab: PanelTab; slotId: 'A' | 'B' }
                if (fromSlot === slotId) return
                onMoveTab?.(tab, slotId)
              }}
              className={`flex items-center gap-1.5 flex-1 min-w-0 px-2 py-1.5 rounded-t-shell text-[10px] font-medium text-[rgb(var(--color-accent))] bg-[rgb(var(--color-surface-2))] border-t border-x border-[rgb(var(--color-surface-4))] transition-colors cursor-grab ${dragOverStrip ? 'ring-2 ring-[rgb(var(--color-accent))/50]' : ''}`}
            >
              {(() => { const Icon = PANEL_TAB_ICON[visibleTab]; return <Icon size={11} className="flex-shrink-0" /> })()}
              <span className="truncate">{PANEL_TAB_LABEL[visibleTab]}</span>
            </div>
          ) : (
            <div
              className={`flex items-center gap-0.5 flex-1 min-w-0 rounded-t-shell transition-colors ${dragOverStrip ? 'ring-2 ring-[rgb(var(--color-accent))/50]' : ''}`}
              // Unconditional preventDefault — dataTransfer.types during dragover is unreliable
              // for custom MIME strings across Chromium/Electron versions, and this drop zone only
              // ever expects a panel-tab drag anyway; validate on the actual `drop` event via
              // getData instead (the standard HTML5 DnD pattern), not by pre-filtering dragover.
              onDragOver={(e) => { e.preventDefault(); setDragOverStrip(true) }}
              onDragLeave={() => setDragOverStrip(false)}
              onDrop={(e) => {
                e.stopPropagation() // don't also let BiblePanel.tsx's catch-all pop-out/merge-back handler see this
                setDragOverStrip(false)
                const raw = e.dataTransfer.getData(PANEL_TAB_DRAG_MIME)
                if (!raw) return
                const { tab, slotId: fromSlot } = JSON.parse(raw) as { tab: PanelTab; slotId: 'A' | 'B' }
                if (fromSlot === slotId) return // dropped back onto its own strip — no-op
                // `slotId` here is THIS instance's own slot — i.e. exactly the drop TARGET,
                // whichever slot's strip the drag actually landed on. Passing it straight through
                // as `toSlot` is what fixes the earlier bug (calling a differently-slotted prop
                // that was never passed to this instance).
                onMoveTab?.(tab, slotId)
              }}
            >
              {(['notes', 'lexicon', 'crossrefs'] as PanelTab[]).filter((tab) => tab !== otherSlotTab).map((tab) => {
                const Icon = PANEL_TAB_ICON[tab]
                const active = visibleTab === tab
                return (
                  <button
                    key={tab}
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData(PANEL_TAB_DRAG_MIME, JSON.stringify({ tab, slotId }))}
                    // Dragging a tab OUT of the strip entirely (dropped somewhere with no
                    // registered drop target — e.g. onto the scripture reading area) previously
                    // did nothing, since HTML5 DnD only has a drop target to catch when slot B
                    // ALREADY exists. dragend fires regardless of whether the drop was accepted
                    // anywhere; dropEffect stays 'none' specifically when nothing caught it, which
                    // is exactly "dragged this tab away" — treat that the same as the right-click
                    // "Pop out into new panel" action (only meaningful when there's no slot B yet
                    // to pop into, matching canPopOut's own gate on that menu item).
                    onDragEnd={(e) => {
                      if (canPopOut && e.dataTransfer.dropEffect === 'none') onMoveTab?.(tab, 'B')
                    }}
                    onContextMenu={(e) => { e.preventDefault(); openTabCtxMenu({ tab, x: e.clientX, y: e.clientY }) }}
                    onClick={() => { onTabChange(tab); void closeSidebarNote() }}
                    className={`
                      relative flex-1 flex items-center justify-center gap-1 text-[10px] py-1.5 font-medium
                      transition-colors cursor-pointer rounded-t-shell border-t border-x
                      ${active
                        ? 'text-[rgb(var(--color-accent))] border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]'
                        : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-secondary))] border-transparent'
                      }
                    `}
                  >
                    {active && (
                      <motion.div
                        layoutId={`right-panel-tab-pill-${slotId}`}
                        className="absolute inset-0 rounded-t-shell bg-[rgb(var(--color-accent))/10] pointer-events-none"
                        transition={{ type: 'spring', stiffness: 800, damping: 45 }}
                      />
                    )}
                    <Icon size={11} className="relative z-10 flex-shrink-0" />
                    <span className="relative z-10">{PANEL_TAB_LABEL[tab]}</span>
                  </button>
                )
              })}
            </div>
          )}
          {/* Close button shown on EITHER slot once a second panel exists (otherSlotTab set) —
              a single open panel relies on the shell's own toggle-side-panel affordance instead,
              matching "unless there is only one". Closing slot A promotes slot B into its place
              (see BiblePanel.tsx's closeSlotA); closing slot B just drops it, and its tab type
              becomes available again in slot A's strip (otherSlotTab naturally clears). */}
          {otherSlotTab && (
            <button
              onClick={slotId === 'B' ? onCloseSlotB : onCloseSlotA}
              title="Close panel"
              className="flex-shrink-0 p-1 rounded-shell text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
            >
              <X size={12} />
            </button>
          )}
        </div>
      )}

      {/* Tab strip context menu — pop out (slot A → new slot B) / merge back (slot B → slot A) */}
      {tabCtxMenu && createPortal(
        <div
          ref={tabCtxMenuRef}
          style={{ position: 'fixed', left: tabCtxMenu.x, top: tabCtxMenu.y, zIndex: 9999 }}
          className="min-w-44 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl p-1 text-xs"
        >
          {slotId === 'A' && canPopOut && onMoveTab && (
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => { closeTabCtxMenu(); onMoveTab(tabCtxMenu.tab, 'B') }}
            >
              <Columns2 size={12} />
              Pop out into new panel
            </button>
          )}
          {slotId === 'B' && onMoveTab && (
            <button
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
              onClick={() => { closeTabCtxMenu(); onMoveTab(tabCtxMenu.tab, 'A') }}
            >
              <PanelRightOpen size={12} />
              Merge back into main panel
            </button>
          )}
        </div>,
        document.body
      )}

      {/* Notes tab — note open */}
      {mountedTabs.has('notes') && sidebarNote && (
        <div className="flex flex-col h-full min-h-0" style={{ fontSize: `${14 * sideZoom}px`, display: visibleTab === 'notes' ? undefined : 'none' }}>
          <div className="flex items-center gap-2 px-2 py-1 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <button
              onClick={closeSidebarNote}
              className="flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer rounded px-1 py-0.5 hover:bg-[rgb(var(--color-surface-4))] transition-colors"
            >
              <ArrowLeft size={12} />
              <span>Notes</span>
            </button>
            <input
              value={sidebarNote.title ?? ''}
              onChange={(e) => handleSidebarNoteTitle(e.target.value)}
              placeholder="Untitled"
              className="flex-1 text-xs font-medium bg-transparent outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] min-w-0"
            />
            <button
              onClick={() => {
                createNoteTab('note')
                setActiveSpace('notes')
                requestOpenNote(sidebarNote.id)
              }}
              title="Open in notes tab"
              className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer flex-shrink-0"
            >
              <ExternalLink size={11} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <NoteEditor
              content={sidebarNote.content ?? ''}
              onChange={handleNoteChange}
              onVerseRefClick={handleVerseRefClick}
              onLexiconRefClick={handleSidebarLexiconRefClick}
              onCursorPosition={onNoteCursorChange}
              // Only restore the cursor + steal focus when the user was actually editing
              // this note when they left the tab (autoFocusNote). Otherwise opening the
              // scripture tab leaves focus on the reader, not the note.
              initialCursorPos={autoFocusNote ? initialNoteCursorRef.current : undefined}
              autoFocus={autoFocusNote}
              isSidePanel
            />
          </div>
        </div>
      )}

      {/* Notes tab — list */}
      {mountedTabs.has('notes') && !sidebarNote && (
        <div className="flex flex-col min-h-0 flex-1" style={{ fontSize: `${14 * sideZoom}px`, display: visibleTab === 'notes' ? undefined : 'none' }}>
          {/* Two-row header: search (full width) on top, controls below. The previous
              single-row merge packed search + scope + sort + expand-all + new-note into
              one line, which went cramped/near-overflow well before the panel's resize
              minimum — splitting keeps every control a comfortable tap target. */}
          <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <Search size={11} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
            <input
              type="text"
              value={noteSearch}
              onChange={(e) => { setNoteSearch(e.target.value); setSelectedNoteIdx(-1) }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedNoteIdx((i) => Math.min(i + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedNoteIdx((i) => Math.max(i - 1, -1)) }
                else if (e.key === 'Enter' && selectedNoteIdx >= 0 && filtered[selectedNoteIdx]) { e.preventDefault(); setSidebarNote(filtered[selectedNoteIdx]) }
                else if (e.key === 'Escape') { (e.target as HTMLInputElement).blur() }
              }}
              placeholder="Search notes…"
              className="min-w-0 flex-1 bg-transparent text-xs text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] outline-none"
            />
            {noteSearch && (
              <button onClick={() => { setNoteSearch(''); setSelectedNoteIdx(-1) }} className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer flex-shrink-0">
                <X size={11} />
              </button>
            )}
            <button
              onClick={createChapterNote}
              title="New note"
              className="flex-shrink-0 p-1 rounded-shell text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer"
            >
              <Plus size={13} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0">
            <HeaderSegmentedToggle
              value={scope}
              onChange={setScope}
              options={[
                { value: 'all',     label: 'All', title: 'All notes' },
                { value: 'chapter', label: 'Ch',  title: 'This chapter only' },
              ]}
            />
            <div className="flex-1" />
            <div ref={sortMenuRef} className="relative flex-shrink-0">
              <button
                onClick={() => setSortMenuOpen((v) => !v)}
                title="Sort notes"
                className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-shell cursor-pointer transition-colors ${
                  sortMenuOpen ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'
                }`}
              >
                <ArrowUpDown size={11} />
                <span>{sort === 'modified' ? 'Modified' : sort === 'created' ? 'Created' : 'By verse'}</span>
              </button>
              {sortMenuOpen && (
                <div className="glass-panel absolute top-full right-0 mt-1 z-50 min-w-[120px] rounded-shell overflow-hidden py-1">
                  {([['modified', 'Modified'], ['created', 'Created'], ['verse', 'By verse']] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => { setSort(val); setSortMenuOpen(false) }}
                      className={`flex items-center gap-2 w-full px-2.5 py-1 text-left text-[11px] transition-colors cursor-pointer ${
                        sort === val ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                      }`}
                    >
                      <CheckIcon size={10} className={sort === val ? 'opacity-100' : 'opacity-0'} />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setExpandAll(!expandAll)}
              title={expandAll ? 'Collapse notes' : 'Expand all notes'}
              className={`flex-shrink-0 p-1 rounded-shell cursor-pointer transition-colors ${
                expandAll
                  ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                  : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'
              }`}
            >
              <AlignJustify size={12} />
            </button>
          </div>

          {/* Verse filter indicator — genuinely conditional context, not redundant chrome */}
          {verseFilter && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-accent))/6] flex-shrink-0">
              <Filter size={10} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
              <span className="text-[10px] text-[rgb(var(--color-accent))] flex-1 truncate">{formatRef(verseFilter)}</span>
              <button onClick={clearVerseFilter} className="text-[rgb(var(--color-accent))] hover:opacity-70 cursor-pointer">
                <X size={10} />
              </button>
            </div>
          )}

          {/* Notes list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && referencingNotes.length === 0 && chapterMentionNotes.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-[rgb(var(--color-text-muted))]">
                No notes{verseFilter ? ' for this verse' : scope === 'chapter' ? ' for this chapter' : ''}
              </div>
            ) : (
              <>
                {/* General/daily/etc. notes that mention this chapter (indirect connections,
                    not chapter/verse notes themselves) — collapsed by default, same toggle
                    treatment as the "chapter notes" section below. */}
                {scope === 'chapter' && !verseFilter && chapterMentionNotes.length > 0 && (
                  <div className="border-b border-[rgb(var(--color-surface-4))]">
                    <button
                      onClick={() => setMentionNotesCollapsed((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))/60] cursor-pointer transition-colors"
                    >
                      {mentionNotesCollapsed
                        ? <ChevronRight size={10} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                        : <ChevronDown size={10} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />}
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] flex-1 text-left">
                        mentions this chapter
                      </span>
                      <span className="text-[9px] text-[rgb(var(--color-text-muted))] tabular-nums">{chapterMentionNotes.length}</span>
                    </button>
                    {!mentionNotesCollapsed && (
                      <div className="divide-y divide-[rgb(var(--color-surface-4))]">
                        {chapterMentionNotes.map((note) => {
                          const rawSnippet = note.content
                            .replace(/^---[\s\S]*?---\n?/, '')
                            .replace(/[#*`_>~\[\]]/g, '')
                            .trim().replace(/\n/g, ' ')
                          return (
                            <div key={note.id} className="relative group transition-colors hover:bg-[rgb(var(--color-surface-4))/60]">
                              <button
                                onClick={() => openSidebarNote(note)}
                                className="w-full text-left px-3 py-2.5 cursor-pointer min-w-0"
                              >
                                <div className="text-xs font-medium text-[rgb(var(--color-text-primary))] truncate">{note.title || 'Untitled'}</div>
                                <div className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 truncate">{rawSnippet.slice(0, 80) || 'Empty note'}</div>
                              </button>
                              <button
                                onClick={() => { createNoteTab('note'); setActiveSpace('notes'); requestOpenNote(note.id) }}
                                title="Open in notes tab"
                                className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 flex-shrink-0 p-1.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
                              >
                                <ExternalLink size={11} />
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Whole-chapter notes — collapsed by default so they don't crowd out the
                    verse-specific notes below, which is what this panel's chapter scope is
                    really for. Reuses the same row rendering as "Direct verse notes" below
                    via renderNoteRow, just grouped under its own toggle-able header. */}
                {chapterLevelEntries.length > 0 && (
                  <div className="border-b border-[rgb(var(--color-surface-4))]">
                    <button
                      onClick={() => setChapterNotesCollapsed((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-[rgb(var(--color-surface-3))] hover:bg-[rgb(var(--color-surface-4))/60] cursor-pointer transition-colors"
                    >
                      {chapterNotesCollapsed
                        ? <ChevronRight size={10} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />
                        : <ChevronDown size={10} className="text-[rgb(var(--color-text-muted))] flex-shrink-0" />}
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] flex-1 text-left">
                        chapter notes
                      </span>
                      <span className="text-[9px] text-[rgb(var(--color-text-muted))] tabular-nums">{chapterLevelEntries.length}</span>
                    </button>
                    {!chapterNotesCollapsed && (
                      <div className="divide-y divide-[rgb(var(--color-surface-4))]">
                        {chapterLevelEntries.map(({ note, i }) => renderNoteRow(note, i))}
                      </div>
                    )}
                  </div>
                )}

                {/* Direct verse notes */}
                <div className="divide-y divide-[rgb(var(--color-surface-4))]">
                  {verseSpecificEntries.map(({ note, i }) => renderNoteRow(note, i))}
                </div>

                {/* Referencing general notes — shown only when a verse filter is active */}
                {verseFilter && referencingNotes.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 px-3 py-1.5 border-y border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))]">
                      <div className="h-px flex-1 bg-[rgb(var(--color-surface-4))]" />
                      <span className="text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))] whitespace-nowrap">
                        also references this verse
                      </span>
                      <div className="h-px flex-1 bg-[rgb(var(--color-surface-4))]" />
                    </div>
                    <div className="divide-y divide-[rgb(var(--color-surface-4))]">
                      {referencingNotes.map((note) => {
                        const rawSnippet = note.content
                          .replace(/^---[\s\S]*?---\n?/, '')
                          .replace(/[#*`_>~\[\]]/g, '')
                          .trim()
                        const snippet = expandAll ? rawSnippet : rawSnippet.replace(/\n/g, ' ')
                        return (
                          <div
                            key={note.id}
                            className="relative group transition-colors hover:bg-[rgb(var(--color-surface-4))/60]"
                          >
                            <button
                              onClick={() => openSidebarNote(note)}
                              onContextMenu={(e) => { e.preventDefault(); openSideCtxMenu({ type: 'note', note, x: e.clientX, y: e.clientY }) }}
                              className="w-full text-left px-2 py-2.5 cursor-pointer min-w-0"
                            >
                              <div className="text-xs font-medium text-[rgb(var(--color-text-primary))] truncate">
                                {note.title || 'Untitled'}
                              </div>
                              <div className={`text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 ${expandAll ? 'whitespace-pre-wrap break-words' : 'truncate'}`}>
                                {(expandAll ? snippet : snippet.slice(0, 80)) || 'Empty note'}
                              </div>
                              <div className="text-[10px] text-[rgb(var(--color-text-muted))] mt-0.5 opacity-70 truncate whitespace-nowrap">
                                {note.verseRef ? `${formatRef(note.verseRef)} · ` : 'General · '}
                                modified {timeAgo(note.updatedAt)}
                              </div>
                            </button>
                            <button
                              onClick={() => {
                                createNoteTab('note')
                                setActiveSpace('notes')
                                requestOpenNote(note.id)
                              }}
                              title="Open in notes tab"
                              className="absolute right-1 top-1.5 opacity-0 group-hover:opacity-100 flex-shrink-0 p-1.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-all cursor-pointer"
                            >
                              <ExternalLink size={11} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Lexicon tab */}
      {mountedTabs.has('lexicon') && (
        <div className="flex-1 overflow-hidden flex flex-col" style={{ zoom: sideZoom, display: visibleTab === 'lexicon' ? undefined : 'none' }}>
          <SidebarLexicon
            initialEntry={initialLexiconEntry}
            onEntryChange={onLexiconEntryChange}
          />
        </div>
      )}

      {/* Cross References tab */}
      {mountedTabs.has('crossrefs') && (
        <div className="flex-1 overflow-hidden flex flex-col" style={{ zoom: sideZoom, display: visibleTab === 'crossrefs' ? undefined : 'none' }}>
          <CrossRefsTab
            bookId={bookId}
            chapter={chapter}
            activeVerseRef={verseFilter ?? null}
            onClearVerseFilter={onVerseFilterChange ? () => onVerseFilterChange(null) : undefined}
            onNoteClick={(note) => { setVerseFilter(null); onTabChange('notes'); openSidebarNote(note) }}
          />
        </div>
      )}

      {/* ── Side-panel right-click context menu ── */}
      {sideCtxMenu && createPortal(
        <div
          ref={sideCtxMenuRef}
          style={{ position: 'fixed', left: sideCtxMenu.x, top: sideCtxMenu.y, zIndex: 9999 }}
          className="min-w-44 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl p-1 text-xs"
        >
          {sideCtxMenu.type === 'note' ? (
            <>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => { closeSideCtxMenu(); openSidebarNote(sideCtxMenu.note) }}
              >
                <StickyNote size={12} />
                Open in panel
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeSideCtxMenu()
                  createNoteTab('note')
                  setActiveSpace('notes')
                  requestOpenNote(sideCtxMenu.note.id)
                }}
              >
                <ExternalLink size={12} />
                Open in new tab
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeSideCtxMenu()
                  window.app.openFloatingTab('notes', { noteId: sideCtxMenu.note.id })
                  bumpFloatingTabToken()
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
                onClick={() => { closeSideCtxMenu(); navToVerseFromPanel(sideCtxMenu.bookId, sideCtxMenu.chapter, sideCtxMenu.verse) }}
              >
                <BookOpen size={12} />
                Open verse
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={async () => {
                  const { bookId: bId, chapter: ch, verse: vs } = sideCtxMenu
                  closeSideCtxMenu()
                  const v = await window.bible.queryVerse(bId, ch, vs).catch(() => null)
                  copyVerse(bId, ch, vs, v?.text ?? '')
                }}
              >
                <Copy size={12} />
                Copy verse
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => { closeSideCtxMenu(); copyVerseRef(sideCtxMenu.bookId, sideCtxMenu.chapter, sideCtxMenu.verse) }}
              >
                <Hash size={12} />
                Copy reference
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeSideCtxMenu()
                  const { bookId: bId, chapter: ch, verse: vs } = sideCtxMenu
                  createNoteTab('bible')
                  const newTabId = useAppStore.getState().activeTabId['scripture']!
                  const dedicatedTarget = getTranslationForBook(bId)
                  useAppStore.getState().updateTabState('scripture', newTabId, {
                    bookId: bId, chapter: ch, targetVerse: vs, scrollPosition: 0,
                    ...(dedicatedTarget ? { translation: dedicatedTarget } : {}),
                  })
                  setActiveSpace('scripture')
                }}
              >
                <ExternalLink size={12} />
                Open in new tab
              </button>
              <button
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-shell text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
                onClick={() => {
                  closeSideCtxMenu()
                  const { bookId: bId, chapter: ch, verse: vs } = sideCtxMenu
                  window.app.openFloatingTab('bible', { bookId: bId, chapter: String(ch), targetVerse: String(vs) })
                  bumpFloatingTabToken()
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
