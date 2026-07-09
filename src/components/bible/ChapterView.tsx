import { useState, useEffect, useRef, useCallback } from 'react'
import { Copy, StickyNote, X, BookOpen } from 'lucide-react'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import VerseRow from './VerseRow'
import { useAppStore } from '@/store'
import { bookName, getTranslationForBook, isDedicatedTranslation } from '@/lib/parseRef'
import { isHermasBook } from '@/lib/hermasMap'
import { extractRefsFromNote } from '@/lib/noteRefs'
import { getCrossRefSources, flagReciprocalVerses, chapterCrossRefSources } from '@/lib/crossRefIndex'
import type { CrossRefSource } from '@/lib/crossRefIndex'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { zoomedFontSize } from '@/lib/zoom'
import type { Verse, HighlightColor } from '@/types'
import { HIGHLIGHT_COLORS } from './VerseRow'

type HLColor = HighlightColor
const HL_COLORS: { id: HLColor; dot: string; label: string }[] = HIGHLIGHT_COLORS.map(c => ({ id: c.id, dot: c.dot, label: c.label }))

interface TaylorRef { bookId: string; chapter: number; verse: number; raw: string; text: string }

/** Navigate the active scripture tab to a cross-referenced verse, switching translation if needed. */
function navigateToScriptureRef(target: { bookId: string; chapter: number; verse: number }) {
  const s = useAppStore.getState()
  s.ensureTab('bible')
  const fresh = useAppStore.getState()
  const tabId = fresh.activeTabId['scripture']
  if (!tabId) return
  const curTab = fresh.tabs['scripture'].find((t) => t.id === tabId)
  const curState = curTab?.state as import('@/types').BibleTabState | undefined
  const currentTranslation = curState?.translation ?? 'kjva'
  const dedicatedTarget = getTranslationForBook(target.bookId)
  const newTranslation = dedicatedTarget ?? (isDedicatedTranslation(currentTranslation) ? 'kjva' : undefined)
  fresh.updateTabState('scripture', tabId, {
    bookId: target.bookId, chapter: target.chapter, targetVerse: target.verse, scrollPosition: 0,
    ...(newTranslation ? { translation: newTranslation } : {}),
  })
  fresh.setActiveSpace('scripture')
}

/**
 * Chapter-level scripture cross-references parsed from Charles Taylor's footnotes.
 * Shown beneath the chapter only when the Taylor Hermas translation is active.
 */
function HermasTaylorFootnoteRefs({ bookId, chapter, textId }: { bookId: string; chapter: number; textId?: string }) {
  const [refs, setRefs] = useState<TaylorRef[]>([])
  const active = textId === 'hermas_taylor' && isHermasBook(bookId)
  useEffect(() => {
    if (!active) { setRefs([]); return }
    let cancelled = false
    window.crossrefs?.getHermasTaylorChapter?.(bookId, chapter)
      .then((res) => { if (!cancelled) setRefs(res?.refs ?? []) })
      .catch(() => { if (!cancelled) setRefs([]) })
    return () => { cancelled = true }
  }, [active, bookId, chapter])
  if (!active || refs.length === 0) return null
  return (
    <div className="mt-6 pt-4 border-t border-[rgb(var(--color-surface-3))]">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[rgb(var(--color-text-muted))] mb-2">
        Scripture references (Taylor footnotes)
      </p>
      <div className="flex flex-wrap gap-1.5">
        {refs.map((r, i) => (
          <button
            key={i}
            title={r.text || r.raw}
            onClick={() => navigateToScriptureRef(r)}
            className="text-[11px] font-mono px-2 py-0.5 rounded border border-[rgb(var(--color-surface-3))] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
          >
            {bookName(r.bookId)} {r.chapter}:{r.verse}
          </button>
        ))}
      </div>
    </div>
  )
}

interface ChapterViewProps {
  bookId: string
  chapter: number
  showStrongs: boolean
  textId?: string
  targetVerse?: number
  endVerse?: number
  hiddenAnnotations?: string[]
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  onStrongsClick?: (num: string) => void
  onWordClick?: (word: string) => void
  onVersesLoaded?: () => void
  /** Tighter padding + no max width — used for compare columns. */
  compact?: boolean
}

interface VerseSelection { vn: number; startChar: number; endChar: number }
interface MultiVerseToolbar { x: number; y: number; verseNums: number[]; verseSelections: VerseSelection[] }

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

/** Single clickable verse chip in the chapter banner — hover shows verse text, click navigates. */
function ChapterRefChip({ source }: { source: CrossRefSource }) {
  const [verseText, setVerseText] = useState<string | null>(null)
  const [tip, setTip] = useState<{ placeBelow: boolean } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const verseStr = `${bookName(source.homeBookId)} ${source.homeChapter}:${source.homeVerse}`
  const titleIsRef = !source.title || source.title === 'Untitled' || source.title.trim() === verseStr

  // Tooltip height estimate: reference line + ~4 lines of verse text ≈ 100px
  const TIP_H = 110

  function handleMouseEnter() {
    timerRef.current = setTimeout(async () => {
      const rect = btnRef.current?.getBoundingClientRect()
      // Place below when there isn't enough room above (with a small buffer)
      const placeBelow = !rect || rect.top < TIP_H + 12
      if (!verseText) {
        const row = await window.bible.queryVerse(source.homeBookId, source.homeChapter, source.homeVerse).catch(() => null)
        if (row) setVerseText(row.text ?? null)
      }
      setTip({ placeBelow })
    }, 280)
  }

  function handleMouseLeave() {
    if (timerRef.current) clearTimeout(timerRef.current)
    setTip(null)
  }

  function handleClick() {
    const s = useAppStore.getState()
    s.ensureTab('bible')
    const fresh = useAppStore.getState()
    const tabId = fresh.activeTabId['scripture']
    if (tabId) {
      fresh.updateTabState('scripture', tabId, {
        bookId: source.homeBookId,
        chapter: source.homeChapter,
        targetVerse: source.homeVerse,
        scrollPosition: 0,
      })
    }
    fresh.setActiveSpace('scripture')
  }

  return (
    <span className="relative inline-block">
      <button
        ref={btnRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onClick={handleClick}
        className="text-[11px] text-[rgb(var(--color-text-muted))] opacity-75 hover:opacity-100 hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer whitespace-nowrap"
      >
        {verseStr}
        {!titleIsRef && <span className="opacity-50"> — {source.title}</span>}
      </button>
      {tip && verseText && (
        <div
          className={`absolute left-0 z-[200] w-[260px] rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] px-3 py-2 pointer-events-none ${
            tip.placeBelow ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
          }`}
        >
          <p className="text-[9px] font-mono font-semibold text-[rgb(var(--color-accent))] mb-1">{verseStr}</p>
          <p className="text-[11px] text-[rgb(var(--color-text-primary))] leading-snug line-clamp-4">{verseText}</p>
        </div>
      )}
    </span>
  )
}

function ChapterCrossRefBanner({ sources, bookId, chapter }: { sources: CrossRefSource[]; bookId: string; chapter: number }) {
  const [open, setOpen] = useState(false)
  const n = sources.length
  const label = `${n} note${n === 1 ? '' : 's'} cite${n === 1 ? 's' : ''} ${bookName(bookId)} ${chapter} (chapter)`
  return (
    <div className="mb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-[rgb(var(--color-text-muted))] opacity-55 hover:opacity-85 transition-opacity text-[11px] cursor-pointer select-none"
      >
        <BookOpen size={11} strokeWidth={1.8} />
        <span>{label}</span>
        <span className="text-[9px] opacity-60 ml-0.5">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="mt-1.5 ml-4 flex flex-wrap gap-x-3 gap-y-0.5">
          {sources.map((s, i) => <ChapterRefChip key={i} source={s} />)}
        </div>
      )}
    </div>
  )
}

export default function ChapterView({ bookId, chapter, showStrongs, textId, targetVerse, endVerse, hiddenAnnotations, findQuery, findWordMode = 'phrase', onStrongsClick, onWordClick, onVersesLoaded, compact = false }: ChapterViewProps) {
  const bibleFontSize = zoomedFontSize(useAppStore((s) => s.bibleFontSize), useAppStore((s) => s.panelZoom.scripture))
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const highlightChangeToken = useAppStore((s) => s.highlightChangeToken)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)

  const [verses, setVerses] = useState<Verse[]>([])
  const [noteCounts, setNoteCounts] = useState<Record<number, number>>({})
  const [verseHasNoteCrossRefs, setVerseHasNoteCrossRefs] = useState<Record<number, boolean>>({})
  const [chapterSources, setChapterSources] = useState<CrossRefSource[]>([])
  const [highlights, setHighlights] = useState<Record<number, Array<{ id: string; color: HLColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }>>>({})
  const [loading, setLoading] = useState(true)
  const [multiToolbar, setMultiToolbar] = useState<MultiVerseToolbar | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const versesRef = useRef(verses)
  useEffect(() => { versesRef.current = verses }, [verses])
  const highlightsRef = useRef(highlights)
  useEffect(() => { highlightsRef.current = highlights }, [highlights])

  useEffect(() => {
    setLoading(true)
    window.bible.queryChapter(bookId, chapter, textId)
      .then((data) => { setVerses(data); setLoading(false) })
      .catch(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapter, textId])

  // Keep a stable ref so the effect below can call the latest callback without
  // adding it to the dependency array (which would re-run on every render).
  const onVersesLoadedRef = useRef(onVersesLoaded)
  useEffect(() => { onVersesLoadedRef.current = onVersesLoaded }, [onVersesLoaded])

  // Notify parent AFTER React has committed the verses to the DOM so that the
  // scroll container has real height and scrollTop assignment actually takes effect.
  // `loading` goes true→false exactly once per chapter fetch, at which point verses
  // are in the DOM and it's safe to set scrollTop on the outer container.
  useEffect(() => {
    if (loading || verses.length === 0) return
    onVersesLoadedRef.current?.()
  }, [loading, verses.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.notes.getChapterCounts(bookId, chapter, textId ?? 'kjva')
      .then(setNoteCounts)
      .catch(() => {})
  }, [bookId, chapter, textId, noteChangeToken])

  // Cross-ref indicator: flag verses that participate in a note-based cross-ref,
  // in BOTH directions —
  //   forward:  a note on verse A references another verse  → flag A
  //   backward: a note on another verse references verse B   → flag B (reciprocal)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const flags: Record<number, boolean> = {}

      // Forward: a verse note here references some other verse/chapter
      const notes = await window.notes.getChapterNotes(bookId, chapter, textId ?? 'kjva').catch(() => [])
      for (const note of notes) {
        const vn = parseInt((note.verseRef ?? '').split('.')[2] ?? '0', 10)
        if (!vn) continue
        const refs = extractRefsFromNote(note.content, note.title || '')
        // A ref counts as "other" only when it is NOT the note's own verse AND is a specific
        // verse (not a whole-chapter ref — those are shown in the banner, not per-verse).
        const hasOther = refs.some(r =>
          !r.isChapter && r.verse !== 0 &&
          !(r.bookId === bookId && r.chapter === chapter && r.verse === vn)
        )
        if (hasOther) flags[vn] = true
      }

      // Backward: verse notes (anywhere) whose content references a verse in this
      // chapter → flag the referenced verse so its reciprocal cross-ref shows.
      // Uses the parsed cross-ref index, so it catches every ref form (abbreviations,
      // ranges, whole-chapter refs), not just exact-name text matches.
      try {
        const sources = await getCrossRefSources(noteChangeToken)
        const verseNums = versesRef.current.map((v) => v.verse_num)
        // excludeChapterRefs=true: chapter-level refs go to the banner, not per-verse GitFork
        flagReciprocalVerses(sources, bookId, chapter, verseNums, flags, true)
        if (!cancelled) setChapterSources(chapterCrossRefSources(sources, bookId, chapter))
      } catch { /* best-effort */ }

      if (!cancelled) setVerseHasNoteCrossRefs(flags)
    })()
    return () => { cancelled = true }
  }, [bookId, chapter, textId, noteChangeToken, verses.length])

  useEffect(() => {
    window.highlights.getChapter(bookId, chapter, textId ?? 'kjva')
      .then(setHighlights)
      .catch(() => {})
  }, [bookId, chapter, textId, highlightChangeToken])

  useEffect(() => {
    if (!targetVerse || !containerRef.current || verses.length === 0) return
    const el = containerRef.current.querySelector(`[data-verse="${targetVerse}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [targetVerse, verses.length])

  // Dismiss toolbar on outside click
  useEffect(() => {
    if (!multiToolbar) return
    function onDown() { setMultiToolbar(null) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [multiToolbar])

  // Keyboard shortcuts when multi-verse toolbar is open
  useEffect(() => {
    if (!multiToolbar) return
    const mt = multiToolbar

    function applyReplacerV(v: Verse) {
      return buildVerseDisplayText(v.text, v.text_tagged, textId ?? 'kjva', wordReplacerEnabled, wordReplacerRules)
    }

    function lxxSuffix() { return textId === 'lxx' ? ' LXX' : '' }

    function onKey(e: KeyboardEvent) {
      if (!e.metaKey && !e.ctrlKey) return
      if (e.key === 'c' && !e.shiftKey) {
        e.preventDefault()
        // Formatted: reference header + one verse per line with verse numbers
        const vns = mt.verseNums
        const lines = vns.map((vn) => {
          const v = versesRef.current.find((v) => v.verse_num === vn)
          return v ? `${vn} ${applyReplacerV(v)}` : ''
        }).filter(Boolean)
        const bName = bookName(bookId)
        const ref = vns.length === 1
          ? `${bName} ${chapter}:${vns[0]}${lxxSuffix()}`
          : `${bName} ${chapter}:${vns[0]}-${vns[vns.length - 1]}${lxxSuffix()}`
        navigator.clipboard.writeText([ref, ...lines].join('\n')).catch(() => {})
        window.getSelection()?.removeAllRanges()
        setMultiToolbar(null)
      } else if (e.key === 'c' && e.shiftKey) {
        e.preventDefault()
        // Plain text: all verses on one line, no verse numbers
        const text = mt.verseNums.map((vn) => {
          const v = versesRef.current.find((v) => v.verse_num === vn)
          return v ? applyReplacerV(v) : ''
        }).filter(Boolean).join(' ')
        navigator.clipboard.writeText(text).catch(() => {})
        window.getSelection()?.removeAllRanges()
        setMultiToolbar(null)
      }
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [multiToolbar, wordReplacerEnabled, wordReplacerRules, textId])

  const handleContainerMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !containerRef.current) return
    const range = sel.getRangeAt(0)

    const verseEls = containerRef.current.querySelectorAll('[data-verse]')
    const verseSelections: VerseSelection[] = []
    for (const el of verseEls) {
      if (!range.intersectsNode(el)) continue
      const vn = parseInt((el as HTMLElement).dataset.verse ?? '-1', 10)
      if (vn < 1) continue
      const textEl = (el as HTMLElement).querySelector('[data-verse-text]') as HTMLElement | null
      if (!textEl) continue
      const verseData = versesRef.current.find(v => v.verse_num === vn)
      if (!verseData) continue

      // Compute char offsets within this verse's text element (exact, not word-snapped)
      const sc = textEl.contains(range.startContainer)
        ? Math.max(0, charOffsetInVerse(range.startContainer, range.startOffset, textEl))
        : 0
      const ec = textEl.contains(range.endContainer)
        ? charOffsetInVerse(range.endContainer, range.endOffset, textEl)
        : verseData.text.length

      if (ec > sc) verseSelections.push({ vn, startChar: sc, endChar: Math.min(ec, verseData.text.length) })
    }
    if (verseSelections.length < 2) return
    const intersecting = verseSelections.map((s) => s.vn)

    // Pass cursor-adjacent position; MenuPositioner clamps all 4 corners.
    const rect = range.getBoundingClientRect()
    setMultiToolbar({ x: rect.left + rect.width / 2, y: rect.top, verseNums: intersecting, verseSelections })
  }, [])

  // Remove/split highlights that overlap [sc, ec] in a single verse
  async function removeOverlappingHighlightsForVerse(vn: number, sc: number, ec: number) {
    const tid = textId ?? 'kjva'
    const verseHLs = highlightsRef.current[vn] ?? []
    const charHLs = verseHLs.filter(h => h.startChar !== null && h.endChar !== null)
    const overlapping = charHLs.filter(h => h.startChar! < ec && h.endChar! > sc)
    for (const h of overlapping) {
      await window.highlights.toggle({ bookId, chapter, verseNum: vn, color: h.color, textId: tid, startChar: h.startChar!, endChar: h.endChar! })
      if (h.startChar! < sc) await window.highlights.toggle({ bookId, chapter, verseNum: vn, color: h.color, textId: tid, startChar: h.startChar!, endChar: sc })
      if (h.endChar! > ec) await window.highlights.toggle({ bookId, chapter, verseNum: vn, color: h.color, textId: tid, startChar: ec, endChar: h.endChar! })
    }
    // Also clear legacy word-based or full-verse highlights
    const hasLegacy = verseHLs.some(h => h.startChar === null && h.startWord === null)
    if (hasLegacy) await window.highlights.remove(bookId, chapter, vn, tid)
  }

  async function highlightRange(color: HLColor) {
    if (!multiToolbar) return
    const tid = textId ?? 'kjva'
    const { verseSelections } = multiToolbar
    window.getSelection()?.removeAllRanges()
    setMultiToolbar(null)
    for (const s of verseSelections) {
      await removeOverlappingHighlightsForVerse(s.vn, s.startChar, s.endChar)
      await window.highlights.toggle({ bookId, chapter, verseNum: s.vn, color, textId: tid, startChar: s.startChar, endChar: s.endChar })
    }
    bumpHighlightToken()
  }

  async function clearRangeHighlights() {
    if (!multiToolbar) return
    const { verseSelections } = multiToolbar
    window.getSelection()?.removeAllRanges()
    setMultiToolbar(null)
    for (const s of verseSelections) {
      await removeOverlappingHighlightsForVerse(s.vn, s.startChar, s.endChar)
    }
    bumpHighlightToken()
  }

  // Check if any verse in the selection overlaps existing highlights
  function selectionHasHighlights(): boolean {
    if (!multiToolbar) return false
    return multiToolbar.verseSelections.some(s => {
      const verseHLs = highlights[s.vn] ?? []
      return verseHLs.some(h => {
        if (h.startChar !== null && h.endChar !== null) return h.startChar < s.endChar && h.endChar > s.startChar
        return true // legacy whole-verse highlight counts as overlapping
      })
    })
  }

  function applyReplacer(v: Verse) {
    return buildVerseDisplayText(v.text, v.text_tagged, textId ?? 'kjva', wordReplacerEnabled, wordReplacerRules)
  }

  function copyFormatted() {
    if (!multiToolbar) return
    const vns = multiToolbar.verseNums
    const lxxSuffix = textId === 'lxx' ? ' LXX' : ''
    const lines = vns.map((vn) => {
      const v = verses.find((v) => v.verse_num === vn)
      return v ? `${vn} ${applyReplacer(v)}` : ''
    }).filter(Boolean)
    const bName = bookName(bookId)
    const ref = vns.length === 1
      ? `${bName} ${chapter}:${vns[0]}${lxxSuffix}`
      : `${bName} ${chapter}:${vns[0]}-${vns[vns.length - 1]}${lxxSuffix}`
    navigator.clipboard.writeText([ref, ...lines].join('\n')).catch(() => {})
    window.getSelection()?.removeAllRanges()
    setMultiToolbar(null)
  }

  function copyText() {
    if (!multiToolbar) return
    const text = multiToolbar.verseNums.map((vn) => {
      const v = verses.find((v) => v.verse_num === vn)
      return v ? applyReplacer(v) : ''
    }).filter(Boolean).join(' ')
    navigator.clipboard.writeText(text).catch(() => {})
    window.getSelection()?.removeAllRanges()
    setMultiToolbar(null)
  }

  async function addRangeNote() {
    if (!multiToolbar) return
    const vns = multiToolbar.verseNums
    const bName = bookName(bookId)
    const lxxSuffix = textId === 'lxx' ? ' LXX' : ''
    const title = `${bName} ${chapter}:${vns[0]}-${vns[vns.length - 1]}${lxxSuffix}`
    const verseRef = `${bookId}.${chapter}.${vns[0]}`
    const result = await window.notes.createNote({ type: 'verse', title, verseRef, content: '', textId: textId ?? 'kjva' })
    window.getSelection()?.removeAllRanges()
    setMultiToolbar(null)
    if (result.success && result.note) {
      bumpNoteToken()
      ensureTab('note')
      requestOpenNote(result.note.id)
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-6 space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="w-6 h-4 bg-[rgb(var(--color-surface-4))] rounded flex-shrink-0 mt-1" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-[rgb(var(--color-surface-4))] rounded w-full" />
              {i % 2 === 0 && <div className="h-4 bg-[rgb(var(--color-surface-4))] rounded w-3/4" />}
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (verses.length === 0) {
    return (
      <div className="px-8 py-12 text-center text-[rgb(var(--color-text-muted))]">
        No verses found for {bookId} {chapter}.
      </div>
    )
  }

  return (
    <div ref={containerRef} className={`berean-scripture-text ${compact ? 'px-3 py-3' : 'px-8 py-6 max-w-3xl'}`} style={{ fontSize: bibleFontSize }} onMouseUp={handleContainerMouseUp}>

      {/* Chapter-level cross-ref banner — shown when notes elsewhere reference this whole chapter */}
      {chapterSources.length > 0 && (
        <ChapterCrossRefBanner sources={chapterSources} bookId={bookId} chapter={chapter} />
      )}

      {verses.map((verse) => {
        const isHighlighted = targetVerse !== undefined && (
          endVerse !== undefined
            ? verse.verse_num >= targetVerse && verse.verse_num <= endVerse
            : verse.verse_num === targetVerse
        )
        return (
          <VerseRow
            key={verse.verse_num}
            verse={verse}
            showStrongs={showStrongs}
            showVerseNumber={showVerseNumbers}
            noteCount={noteCounts[verse.verse_num] ?? 0}
            hasNoteCrossRef={verseHasNoteCrossRefs[verse.verse_num] ?? false}
            isHighlighted={isHighlighted}
            highlights={highlights[verse.verse_num] ?? []}
            hiddenAnnotations={hiddenAnnotations}
            textId={textId}
            findQuery={findQuery}
            findWordMode={findWordMode}
            onStrongsClick={onStrongsClick}
            onWordClick={onWordClick}
          />
        )
      })}

      {/* Scripture cross-references from Taylor's footnotes (Taylor Hermas only) */}
      <HermasTaylorFootnoteRefs bookId={bookId} chapter={chapter} textId={textId} />

      {/* Multi-verse selection toolbar — context menu */}
      {multiToolbar && (
        <MenuPositioner x={multiToolbar.x} y={multiToolbar.y}
          className="min-w-[200px] rounded-lg shadow-xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] overflow-hidden py-1"
          onMouseDown={(e: React.MouseEvent) => e.stopPropagation()}
        >
          {/* Color grid: 3 rows × 5 colors */}
          <div className="px-3 py-2 space-y-1.5">
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-1.5">
                {HL_COLORS.slice(row * 5, row * 5 + 5).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => highlightRange(c.id)}
                    title={`Highlight ${c.label}`}
                    style={{ backgroundColor: c.dot }}
                    className="w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 flex-shrink-0"
                  />
                ))}
                {row === 2 && selectionHasHighlights() && (
                  <button
                    onClick={clearRangeHighlights}
                    title="Clear highlights from selection"
                    className="ml-auto text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            onClick={copyFormatted}
            className="flex items-center justify-between gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <span className="flex items-center gap-2">
              <Copy size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
              Copy verses
            </span>
            <span className="text-[10px] text-[rgb(var(--color-text-muted))] font-mono">⌘C</span>
          </button>
          <button
            onClick={copyText}
            className="flex items-center justify-between gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <span className="flex items-center gap-2">
              <Copy size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
              Copy selection
            </span>
            <span className="text-[10px] text-[rgb(var(--color-text-muted))] font-mono">⇧⌘C</span>
          </button>
          <div className="h-px bg-[rgb(var(--color-surface-4))]" />
          <button
            onClick={addRangeNote}
            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <StickyNote size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
            Add note on range
          </button>
        </MenuPositioner>
      )}
    </div>
  )
}
