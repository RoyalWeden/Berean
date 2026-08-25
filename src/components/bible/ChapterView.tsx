import { useState, useEffect, useRef, useCallback, useId, memo, Fragment } from 'react'
import { flushSync } from 'react-dom'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Copy, StickyNote, X, BookOpen } from 'lucide-react'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import ShortcutKeys from '@/components/shell/ShortcutKeys'
import VerseRow from './VerseRow'
import { useAppStore } from '@/store'
import { bookName, getTranslationForBook, isDedicatedTranslation } from '@/lib/parseRef'
import { navigateToVerse } from '@/lib/verseNavigation'
import { versificationNote } from '@/lib/translationChapterMap'
import { isHermasBook } from '@/lib/hermasMap'
import { extractRefsFromNote } from '@/lib/noteRefs'
import { getCrossRefSources, flagReciprocalVerses, chapterCrossRefSources } from '@/lib/crossRefIndex'
import { scrollVerseIntoView, VERSE_JUMP_INSTANT, VERSE_FOLLOW_DOWN, VERSE_FOLLOW_UP } from '@/lib/scrollToVerse'
import type { CrossRefSource } from '@/lib/crossRefIndex'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { zoomedFontSize } from '@/lib/zoom'
import { chapterCacheKey, getCachedVerses, setCachedVerses } from '@/lib/chapterCache'
import type { Verse, HighlightColor } from '@/types'
import { HIGHLIGHT_COLORS } from './VerseRow'

type HLColor = HighlightColor
const HL_COLORS: { id: HLColor; dot: string; label: string }[] = HIGHLIGHT_COLORS.map(c => ({ id: c.id, dot: c.dot, label: c.label }))
// Stable empty-array reference so verses with no highlights pass React.memo's shallow
// equality on <VerseRow>; a fresh `?? []` literal would fail it on every render.
type VerseHighlight = { id: string; color: HLColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }
const EMPTY_HIGHLIGHTS: VerseHighlight[] = []

/**
 * Merge a freshly-fetched per-verse record into the previous one, keeping the OLD value
 * reference for any key whose contents are unchanged. `noteChangeToken`/`highlightChangeToken`
 * are global bump counters (any note/highlight edit anywhere bumps them), so a naive
 * `setState(freshData)` hands every VerseRow a brand-new object/array identity on every
 * edit — even verses nothing happened to — which breaks VerseRow's React.memo and forces
 * the whole chapter to re-render on every keystroke in an unrelated note. Comparing by
 * value (JSON.stringify — these records are small, per-chapter) and reusing the prior
 * reference when equal scopes the re-render down to just the verse(s) that actually changed.
 */
function mergeStableRecord<V>(prev: Record<number, V>, next: Record<number, V>): Record<number, V> {
  const nextKeys = Object.keys(next)
  const prevKeys = Object.keys(prev)
  let changed = nextKeys.length !== prevKeys.length
  const merged: Record<number, V> = {}
  for (const k of nextKeys) {
    const nv = next[k as unknown as number]
    const pv = prev[k as unknown as number]
    if (pv !== undefined && JSON.stringify(pv) === JSON.stringify(nv)) {
      merged[k as unknown as number] = pv
    } else {
      merged[k as unknown as number] = nv
      changed = true
    }
  }
  return changed ? merged : prev
}

interface TaylorRef { bookId: string; chapter: number; verse: number; raw: string; text: string }

/** Navigate the active scripture tab to a cross-referenced verse, switching translation if needed. */
function navigateToScriptureRef(target: { bookId: string; chapter: number; verse: number }) {
  navigateToVerse({ ...target, origin: { kind: 'cross-ref', source: 'tske', reason: 'Hermas Taylor footnote' } })
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
  /** What matched in the scripture search result that navigated here, so the landed verse
   *  can highlight the specific term/word instead of just flashing the whole row — see
   *  BiblePanel.tsx's onNavigate handler and ScriptureSearchView's SearchNavHighlight. */
  targetVerseQuery?: string
  targetVerseWordMode?: 'phrase' | 'all' | 'any'
  targetVerseStrongsWords?: number[]
  targetVerseStrongsExtraWords?: string[]
  endVerse?: number
  hiddenAnnotations?: string[]
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  onStrongsClick?: (num: string, verseNum?: number) => void
  onWordClick?: (word: string) => void
  onVersesLoaded?: () => void
  /** Fired once after the scroll-to-verse effect scrolls to `targetVerse`, so the
      caller can clear it and make the scroll a one-shot (not re-fired on remount). */
  onTargetVerseConsumed?: () => void
  /** Flash-highlight a verse without scrolling to it or treating it as a search-style
   *  navigation (no history entry, doesn't touch targetVerse) — used when a Strong's
   *  toggle or KJV/LXX switch reflows the page around an already-visible verse, so the
   *  eye has something to land on confirming "you're still here." A fresh object
   *  (new `nonce`) re-triggers the flash even for the same verse number as last time. */
  flashAnchor?: { verse: number; nonce: number } | null
  /** Fired when a chapter/translation switch has been loading long enough (200ms) to be
      worth surfacing — lets the caller show a small indicator near the controls that
      triggered the switch (e.g. the LXX/KJV button), which is more visible than anything
      placed inside the scrollable verse list itself. Always fired with `false` once the
      load finishes, even if it never crossed the threshold. */
  onSlowLoadChange?: (loading: boolean) => void
  /** Tighter padding + no max width — used for compare columns. */
  compact?: boolean
  /** Identity of the scripture tab this instance is showing content for. BiblePanel.tsx no
   *  longer remounts on tab switch (see its own prevBibleTabIdForResetRef), which means THIS
   *  component can now be the same instance across a switch to a completely different tab's
   *  book/chapter — without knowing that happened, its own mount-scoped local state (verses,
   *  note dots, the KJV/LXX crossfade's "did the translation actually change" tracking) would
   *  keep showing the OUTGOING tab's data/behavior for one render. Passed through so this
   *  component can detect the change itself and reset — see prevTabIdForResetRef below. */
  tabId?: string | null
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
          className={`absolute left-0 z-[200] w-[260px] rounded-shell glass-panel px-3 py-2 pointer-events-none ${
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
        className="flex items-center gap-1.5 text-[rgb(var(--color-text-muted))] opacity-75 hover:opacity-100 transition-opacity text-[11px] cursor-pointer select-none"
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

/**
 * Shown above the verse list whenever this book/chapter/translation is one the Septuagint
 * renumbers relative to the KJV (Psalms/Jeremiah/Joel/Malachi) or restructures more
 * fundamentally (Ezra, Esther-Greek, Baruch, Proverbs, Sirach) — see translationChapterMap.ts's
 * versificationNote(). Reported: "I can't find the Septuagint version of Psalm 10... Psalm 10
 * LXX shows as Psalm 11" — that's genuine, historically accurate Brenton-edition numbering, not
 * a bug (confirmed against the actual verse text — LXX Ps 10 really is MT/KJV Ps 11), so this
 * surfaces the "why" right on the page instead of leaving it silently unexplained. Always
 * visible (not collapsed behind a toggle like ChapterCrossRefBanner above) since it's one short
 * line and, unlike a note-citation list, is exactly the kind of thing someone lands on this
 * chapter specifically wondering about.
 */
function VersificationBanner({ bookId, chapter, textId }: { bookId: string; chapter: number; textId?: string }) {
  const note = textId ? versificationNote(bookId, chapter, textId) : null
  if (!note) return null
  return (
    <div className="mb-4 flex items-start gap-1.5 text-[11px] text-[rgb(var(--color-text-muted))] opacity-80">
      <BookOpen size={11} strokeWidth={1.8} className="flex-shrink-0 mt-[1px]" />
      <span>{note}</span>
    </div>
  )
}

function ChapterView({ bookId, chapter, showStrongs, textId, targetVerse, targetVerseQuery, targetVerseWordMode, targetVerseStrongsWords, targetVerseStrongsExtraWords, endVerse, hiddenAnnotations, findQuery, findWordMode = 'phrase', onStrongsClick, onWordClick, onVersesLoaded, onTargetVerseConsumed, onSlowLoadChange, flashAnchor, compact = false, tabId }: ChapterViewProps) {
  const bibleFontSize = zoomedFontSize(useAppStore((s) => s.bibleFontSize), useAppStore((s) => s.appZoom))
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const highlightChangeToken = useAppStore((s) => s.highlightChangeToken)
  const bumpHighlightToken = useAppStore((s) => s.bumpHighlightToken)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  // Read Aloud writes a new audioPlayback object on every spoken word (every word-boundary
  // event). Subscribing to `s.audioPlayback` directly would re-render EVERY mounted ChapterView
  // instance (e.g. every compare-view column) on every one of those ticks, even chapters that
  // aren't the one playing. This selector collapses to a stable `null` for any tick that isn't
  // about THIS bookId/chapter/textId — zustand's default Object.is comparison then bails the
  // re-render for those instances, so only the chapter actually being read re-renders per word.
  const audioPlayback = useAppStore(
    useCallback((s) => {
      const ap = s.audioPlayback
      if (!ap || ap.bookId !== bookId || ap.chapter !== chapter || ap.textId !== textId) return null
      return ap
    }, [bookId, chapter, textId])
  )

  // Warm-start from chapterCache when this chapter/textId was already fetched by a previous
  // ChapterView mount (e.g. switching back to a tab) — avoids showing the loading skeleton for
  // a chapter we've already loaded once (see chapterCache.ts).
  const [verses, setVerses] = useState<Verse[]>(() => getCachedVerses(chapterCacheKey(bookId, chapter, textId ?? 'kjva')) ?? [])
  // Which (bookId, chapter, textId) the current `verses` array actually belongs to — lets the
  // scroll-to-verse effect tell "real new-chapter data" apart from "old chapter's verses still
  // in state while a switch is in flight" without needing to clear `verses` to signal that (see
  // the fetch effect below for why clearing it was the cause of the KJV/LXX switch flash).
  const [versesKey, setVersesKey] = useState<string | null>(() =>
    getCachedVerses(chapterCacheKey(bookId, chapter, textId ?? 'kjva')) ? chapterCacheKey(bookId, chapter, textId ?? 'kjva') : null
  )
  const [noteCounts, setNoteCounts] = useState<Record<number, number>>({})
  const [noteColorsMap, setNoteColorsMap] = useState<Record<number, string>>({})
  const [verseHasNoteCrossRefs, setVerseHasNoteCrossRefs] = useState<Record<number, boolean>>({})
  const [chapterSources, setChapterSources] = useState<CrossRefSource[]>([])
  const [highlights, setHighlights] = useState<Record<number, Array<{ id: string; color: HLColor; startWord: number | null; endWord: number | null; startChar: number | null; endChar: number | null }>>>({})
  const [loading, setLoading] = useState(() => getCachedVerses(chapterCacheKey(bookId, chapter, textId ?? 'kjva')) === null)
  // Shown only once a chapter/translation switch has been in flight longer than a beat —
  // most loads are near-instant (local SQLite), so this stays hidden for those; it's just a
  // signal for the rare slower ones (cold cache, a big chapter, translation switch under load)
  // so the UI doesn't look unresponsive with nothing on screen changing.
  const [showSlowLoadIndicator, setShowSlowLoadIndicator] = useState(false)
  const [multiToolbar, setMultiToolbar] = useState<MultiVerseToolbar | null>(null)
  // Flash-highlight for the verse just navigated to (e.g. from search) — kept alive on a timer,
  // independent of `targetVerse` itself, which the parent clears right after the scroll fires
  // (see onTargetVerseConsumed) so the scroll-restore logic in BiblePanel doesn't re-trigger on
  // tab remount. Without this split, the highlight would vanish the instant it appeared.
  const [flashVerse, setFlashVerse] = useState<{
    verse: number; end?: number
    query?: string; wordMode?: 'phrase' | 'all' | 'any'; strongsWords?: number[]; strongsExtraWords?: string[]
  } | null>(null)
  const flashVerseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Verse we just scrollIntoView'd for, kept until the cross-ref banner effect
  // confirms settled so a corrective re-scroll can fire once layout has
  // finished shifting (see the two scroll effects below).
  const lastScrolledVerseRef = useRef<number | undefined>(undefined)
  // Incremented on every fetch effect run; a resolved promise whose generation no longer
  // matches was superseded by a later switch and its data is discarded.
  const fetchGenRef = useRef(0)
  // Tracks the previous fetch's textId so the effect below can tell "translation actually
  // changed" (KJV/LXX switch — worth a crossfade) apart from "same translation, new chapter"
  // (plain next/prev navigation — should stay snappy, not softened with a transition).
  const prevTextIdRef = useRef(textId)
  // Unique per mounted ChapterView instance (continuous scroll and multi-chapter range
  // view can mount several at once, and split-panel layouts can mount several BiblePanels)
  // — the CSS spec allows only one element at a time to carry a given view-transition-name,
  // so a static name would throw once more than one instance is on screen simultaneously.
  const rawInstanceId = useId()
  const viewTransitionName = `chapter-${rawInstanceId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  // Holds the in-flight transition (if any) so a rapid second toggle can cancel it via
  // skipTransition() instead of letting two transitions race for the same named element.
  const pendingViewTransitionRef = useRef<{ finished: Promise<unknown>; skipTransition: () => void } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const versesRef = useRef(verses)
  useEffect(() => { versesRef.current = verses }, [verses])
  const highlightsRef = useRef(highlights)
  useEffect(() => { highlightsRef.current = highlights }, [highlights])
  const onSlowLoadChangeRef = useRef(onSlowLoadChange)
  useEffect(() => { onSlowLoadChangeRef.current = onSlowLoadChange }, [onSlowLoadChange])

  useEffect(() => {
    setLoading(true)
    // Deliberately do NOT clear `verses` here (it used to via setVerses([])) — that reset was
    // added to stop the scroll-to-verse effect from firing against stale (previous-chapter) DOM,
    // but it also meant every chapter/translation switch briefly showed the empty-state skeleton
    // before real data replaced it (the "flash" on KJV/LXX switching). Keeping the previous
    // chapter's verses on screen during the fetch avoids that; `versesKey` (set only once the
    // real data for THIS bookId/chapter/textId lands) is what the scroll effect below checks
    // instead, so it still can't fire against stale DOM.
    const gen = ++fetchGenRef.current
    const isTranslationSwitch = prevTextIdRef.current !== textId
    prevTextIdRef.current = textId
    const slowTimer = setTimeout(() => { setShowSlowLoadIndicator(true); onSlowLoadChangeRef.current?.(true) }, 200)
    window.bible.queryChapter(bookId, chapter, textId)
      .then((data) => {
        if (fetchGenRef.current !== gen) return // superseded by a newer switch — ignore stale data
        const commit = () => {
          setVerses(data)
          setVersesKey(chapterCacheKey(bookId, chapter, textId ?? 'kjva'))
          setLoading(false)
          setCachedVerses(chapterCacheKey(bookId, chapter, textId ?? 'kjva'), data)
        }
        // Crossfade specifically for a translation switch (KJV/LXX) — the old chapter's verses
        // are still on screen (see the no-clear comment above), so without this the swap to the
        // new text's different word count/wrapping lands as a hard instant cut, which is exactly
        // the "hard to follow" jump the View Transition on the Strong's toggle already solves.
        // Plain chapter navigation (same textId) deliberately skips this and stays instant/snappy.
        // ALSO skipped whenever scrolled away from the top — see toggleStrongsForTab's comment
        // in BiblePanel.tsx for why (the transition's un-clipped snapshot can bleed over the
        // top bar in that case); containerRef's own parent IS the scrollable viewport div.
        const scrolledToTop = (containerRef.current?.parentElement?.scrollTop ?? 0) < 2
        if (isTranslationSwitch && scrolledToTop && typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
          // A still-running transition from a rapid previous switch would otherwise race
          // this one for the same named element — skip it first so only the latest wins.
          pendingViewTransitionRef.current?.skipTransition()
          const vt = document.startViewTransition(() => flushSync(commit))
          pendingViewTransitionRef.current = vt
          vt.finished.finally(() => { if (pendingViewTransitionRef.current === vt) pendingViewTransitionRef.current = null })
        } else {
          commit()
        }
      })
      .catch(() => { if (fetchGenRef.current === gen) setLoading(false) })
      .finally(() => { clearTimeout(slowTimer); setShowSlowLoadIndicator(false); onSlowLoadChangeRef.current?.(false) })
    return () => clearTimeout(slowTimer)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, chapter, textId])

  // Verses present in the KJV for this same book+chapter but absent from the LXX's own
  // verse_num sequence — e.g. Jeremiah 8 omits KJV verses 11-12; Brenton's LXX preserves
  // KJV-aligned verse numbers WITH gaps rather than renumbering densely, so this is
  // detectable straight from the LXX chapter's own returned verse list once we know which
  // numbers KJV has for the same chapter. Only meaningful where LXX and KJV use the SAME
  // chapter numbering — skipped entirely for Psalms/Joel/Malachi (always remapped) and
  // Jeremiah 26+ (remapped there too — see translationChapterMap.ts), where a literal
  // book+chapter match doesn't mean the same passage at all, and any resulting "gap"
  // wouldn't be a real cross-text comparison.
  const [missingLxxVerses, setMissingLxxVerses] = useState<Set<number>>(new Set())

  // ── Reset mount-scoped local state when the TAB this instance belongs to changes ──────────
  // Mirrors BiblePanel.tsx's own prevBibleTabIdForResetRef (same render-phase-reset technique,
  // not a useEffect, so the correct tab's content is already in place for THIS render's paint —
  // no one-frame flash of the outgoing tab's chapter). Needed because BiblePanel no longer
  // remounts this component on a scripture-tab switch: without this, the fetch effect above's
  // deliberate "keep stale verses on screen during a fetch" behavior (comment a few lines up —
  // correct for WITHIN-tab navigation like next/prev chapter) also fired for a cross-tab switch
  // to a different book, briefly redrawing the OUTGOING tab's chapter before the new one loaded.
  // `prevTextIdRef` needed the same treatment: without resetting it, switching from a KJVA tab to
  // an LXX tab (different tabs, unrelated to the KJV/LXX toggle button) could be misread as a
  // same-tab translation switch and spuriously trigger the View Transition crossfade.
  const prevTabIdForResetRef = useRef(tabId)
  if (prevTabIdForResetRef.current !== tabId) {
    prevTabIdForResetRef.current = tabId
    const key = chapterCacheKey(bookId, chapter, textId ?? 'kjva')
    const cached = getCachedVerses(key)
    // Same warm-start-from-cache logic the initial useState lazy initializers above use — a
    // real mount would have started from exactly this, so this reset reproduces it precisely
    // rather than unconditionally blanking to an empty/loading state.
    setVerses(cached ?? [])
    setVersesKey(cached ? key : null)
    setLoading(cached === null)
    setNoteCounts({})
    setNoteColorsMap({})
    setVerseHasNoteCrossRefs({})
    setChapterSources([])
    setHighlights({})
    setMissingLxxVerses(new Set())
    setShowSlowLoadIndicator(false)
    setMultiToolbar(null)
    setFlashVerse(null)
    if (flashVerseTimerRef.current) { clearTimeout(flashVerseTimerRef.current); flashVerseTimerRef.current = null }
    lastScrolledVerseRef.current = undefined
    // The NEW tab's own textId — so the very next fetch effect run correctly reads this as "not
    // a translation switch" (same reasoning as the file-level comment on prevTextIdRef itself).
    prevTextIdRef.current = textId
  }

  useEffect(() => {
    const eligible = textId === 'lxx' && !['PSA', 'JOL', 'MAL'].includes(bookId.toUpperCase())
      && !(bookId.toUpperCase() === 'JER' && chapter >= 26)
    if (!eligible || verses.length === 0) { setMissingLxxVerses(new Set()); return }
    let cancelled = false
    window.bible.queryChapter(bookId, chapter, 'kjva')
      .then((kjvVerses) => {
        if (cancelled) return
        const lxxNums = new Set(verses.map((v) => v.verse_num))
        const maxLxx = Math.max(...lxxNums)
        const missing = new Set<number>()
        for (const v of kjvVerses) {
          if (v.verse_num < maxLxx && !lxxNums.has(v.verse_num)) missing.add(v.verse_num)
        }
        setMissingLxxVerses(missing)
      })
      .catch(() => { if (!cancelled) setMissingLxxVerses(new Set()) })
    return () => { cancelled = true }
  }, [bookId, chapter, textId, verses])

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

  // Note-count dots, cross-ref flags, and highlights used to be three fully independent
  // effects, each committing its own state the moment its own IPC call resolved. All three are
  // fast local SQLite queries that land within a few ms of each other, but "each commits the
  // instant it resolves" still means three separate renders — reported as the chapter "loading
  // weird," verse text appearing first and note dots/highlights visibly popping in a beat later
  // on top of it, instead of the whole chapter appearing settled in one paint. Combined into one
  // effect that fires all three fetches in parallel and commits their results together via a
  // single `Promise.all` — same individual fetch logic as before, just one batched commit
  // instead of three staggered ones. Trade-off: any one of the three triggers (a note edit, a
  // highlight edit, or the verse list itself changing) now re-fetches all three instead of just
  // the one that actually needs it — harmless (all three are idempotent, cheap local queries),
  // and far simpler than threading through which trigger fired.
  useEffect(() => {
    let cancelled = false
    const noteCountsP = window.notes.getChapterCounts(bookId, chapter, textId ?? 'kjva').catch(() => ({}))
    const highlightsP = window.highlights.getChapter(bookId, chapter, textId ?? 'kjva')
      .catch((err) => {
        // Surface this rather than silently falling back to {} — an empty result here wipes
        // every highlight in the chapter via mergeStableRecord, which used to look like
        // "highlights just disappeared" with no trace of why.
        console.error('[Berean] Failed to load chapter highlights', err)
        return {}
      })
    const crossRefP = (async () => {
      const flags: Record<number, boolean> = {}

      // Forward: a verse note here references some other verse/chapter
      const notes = await window.notes.getChapterNotes(bookId, chapter, textId ?? 'kjva').catch(() => [])
      const colorMap: Record<number, string> = {}
      for (const note of notes) {
        const vn = parseInt((note.verseRef ?? '').split('.')[2] ?? '0', 10)
        if (!vn) continue
        if (note.color && !colorMap[vn]) colorMap[vn] = note.color
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
      let chapterSourcesResult: ReturnType<typeof chapterCrossRefSources> = []
      try {
        const sources = await getCrossRefSources(noteChangeToken)
        const verseNums = versesRef.current.map((v) => v.verse_num)
        // excludeChapterRefs=true: chapter-level refs go to the banner, not per-verse
        flagReciprocalVerses(sources, bookId, chapter, verseNums, flags, true)
        chapterSourcesResult = chapterCrossRefSources(sources, bookId, chapter)
      } catch { /* best-effort */ }

      return { flags, colorMap, chapterSourcesResult }
    })()

    Promise.all([noteCountsP, highlightsP, crossRefP]).then(([noteCountsData, highlightsData, crossRef]) => {
      if (cancelled) return
      setNoteCounts((prev) => mergeStableRecord(prev, noteCountsData))
      setHighlights((prev) => mergeStableRecord(prev, highlightsData))
      setVerseHasNoteCrossRefs((prev) => mergeStableRecord(prev, crossRef.flags))
      setNoteColorsMap((prev) => mergeStableRecord(prev, crossRef.colorMap))
      setChapterSources(crossRef.chapterSourcesResult)
    })
    return () => { cancelled = true }
  }, [bookId, chapter, textId, noteChangeToken, highlightChangeToken, verses.length])

  useEffect(() => {
    if (!targetVerse || !containerRef.current || verses.length === 0) return
    // `verses` can still hold the PREVIOUS chapter's data for one render — bookId/chapter/
    // targetVerse all update together, but the real new-chapter data only lands once the fetch
    // effect's promise resolves. versesKey is only set at that point, so this bails out (without
    // consuming targetVerse) until `verses` genuinely belongs to the chapter/text currently being
    // shown — avoiding scrolling to (and clearing targetVerse for) a same-numbered verse that
    // happens to exist in the stale, previous chapter.
    if (versesKey !== `${bookId}:${chapter}:${textId}`) return
    const el = containerRef.current.querySelector(`[data-verse="${targetVerse}"]`)
    if (!el) return
    // Instant, not smooth, and aligned to the top of the viewport (not centered) — a
    // smooth-scroll animation can get interrupted/fought by other layout-settling effects
    // firing around the same time (cross-ref banner, note counts, etc.), which is how this
    // ended up silently not scrolling at all in practice. An instant jump can't be
    // interrupted mid-animation the same way.
    scrollVerseIntoView(el, VERSE_JUMP_INSTANT)
    lastScrolledVerseRef.current = targetVerse
    if (flashVerseTimerRef.current) clearTimeout(flashVerseTimerRef.current)
    // Carries whatever the search result matched (targetVerseQuery/Word/StrongsWords, read
    // as props in this same render pass — they're cleared together with targetVerse right
    // after this) so the verse can highlight the specific term, not just flash the whole row.
    setFlashVerse({
      verse: targetVerse, end: endVerse,
      query: targetVerseQuery, wordMode: targetVerseWordMode,
      strongsWords: targetVerseStrongsWords, strongsExtraWords: targetVerseStrongsExtraWords,
    })
    // 1800ms wasn't long enough for the user to actually register which verse
    // just got highlighted before it faded — bumped to give it a fair chance
    // to be noticed.
    flashVerseTimerRef.current = setTimeout(() => setFlashVerse(null), 3000)
    onTargetVerseConsumed?.()
  }, [targetVerse, verses.length, versesKey, bookId, chapter, textId])

  // Flash-highlight a verse the caller already scrolled/anchored to itself (Strong's
  // toggle, KJV/LXX switch) — deliberately independent of the targetVerse/onTargetVerse-
  // Consumed machinery above, which is for search-style navigation and feeds history
  // recording; this is purely a "you're still here" visual cue after a layout reflow.
  useEffect(() => {
    if (!flashAnchor) return
    if (flashVerseTimerRef.current) clearTimeout(flashVerseTimerRef.current)
    setFlashVerse({ verse: flashAnchor.verse })
    flashVerseTimerRef.current = setTimeout(() => setFlashVerse(null), 1400)
  }, [flashAnchor])

  // Correct the scroll position once the chapter cross-ref banner has settled.
  // The banner (ChapterCrossRefBanner, rendered above the verse list when
  // chapterSources.length > 0) is populated by a separate async effect and can
  // mount AFTER the smooth-scroll above has already committed to its target
  // pixel offset — a layout shift mid-animation isn't honored by CSS smooth-
  // scroll, so the scroll can land short of the verse's real (shifted-down)
  // position on any chapter that has notes/cross-refs. This re-issues the
  // scroll once chapterSources updates (which happens exactly once per
  // chapter, when that async fetch resolves — including to an empty array
  // for chapters with no cross-refs, a harmless no-op re-scroll in that case),
  // then clears the ref so it doesn't refire for unrelated later updates
  // (e.g. a note added while reading). If chapterSources happens to settle
  // BEFORE the scroll effect above runs, this simply no-ops — the initial
  // scroll will already be accurate since the banner is already in place.
  useEffect(() => {
    const verse = lastScrolledVerseRef.current
    if (!verse || !containerRef.current) return
    const el = containerRef.current.querySelector(`[data-verse="${verse}"]`)
    // Top-aligned to match the primary effect above; instant since a layout shift from the
    // cross-ref banner mounting can land right after the initial jump and this just corrects
    // for it — not meant to be seen animating.
    scrollVerseIntoView(el, VERSE_JUMP_INSTANT)
    lastScrolledVerseRef.current = undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapterSources])

  // Auto-follow Read Aloud: as playback advances to a new verse, keep it in view — but only
  // scroll when it's actually left the visible area, not on every verse (that would fight the
  // user reading ahead/back manually while listening). Deliberately independent of the
  // targetVerse machinery above (that's for one-shot search-style navigation); this re-checks
  // on every verse change for as long as this chapter is the one actually playing.
  useEffect(() => {
    if (!audioPlayback || !containerRef.current) return
    if (audioPlayback.bookId !== bookId || audioPlayback.chapter !== chapter || audioPlayback.textId !== textId) return
    const container = containerRef.current
    // containerRef itself is just the (naturally tall, unclipped) content div — its own rect
    // spans the WHOLE chapter, not the visible window. The actual scrollable/clipping viewport
    // is its PARENT (see the scrolledToTop comment elsewhere in this file, which already relies
    // on this same relationship) — using containerRef's own rect here meant "is the verse below
    // the visible area" was comparing against the bottom of ALL rendered content instead of the
    // real viewport, which a child element's rect can essentially never exceed. That's why
    // scrolling back up (and, just as broken, back down) never actually triggered.
    const viewport = container.parentElement ?? container
    const el = container.querySelector(`[data-verse="${audioPlayback.verse}"]`)
    if (!el) return
    const elRect = el.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const isBelow = elRect.bottom > viewportRect.bottom
    const isAbove = elRect.top < viewportRect.top
    if (isBelow) scrollVerseIntoView(el, VERSE_FOLLOW_DOWN)
    else if (isAbove) scrollVerseIntoView(el, VERSE_FOLLOW_UP)
  }, [audioPlayback?.verse, audioPlayback?.bookId, audioPlayback?.chapter, audioPlayback?.textId, bookId, chapter, textId])

  useEffect(() => () => { if (flashVerseTimerRef.current) clearTimeout(flashVerseTimerRef.current) }, [])

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

  const handleContainerMouseUp = useCallback((e: React.MouseEvent) => {
    const clientX = e.clientX
    const clientY = e.clientY
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

    // Anchor at the actual cursor release point, not the selection's bounding-box center/top —
    // for a multi-line/multi-verse selection that bbox can be tall and wide, so its center-top
    // often lands nowhere near where the mouse actually is. MenuPositioner clamps all 4 corners
    // to the viewport regardless.
    setMultiToolbar({ x: clientX, y: clientY, verseNums: intersecting, verseSelections })
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

  // Only show the skeleton on a genuine first load (no verses at all yet) — reusing it for
  // every chapter/translation switch is what caused the "flash" some switches showed: the
  // query (a local SQLite read) usually resolves within a frame or two, so the skeleton would
  // mount, paint, then immediately get replaced, which is only visible depending on exact
  // query/paint timing (hence "doesn't always happen"). Keeping the previous verses on screen
  // until the new ones are ready avoids the flash entirely.
  //
  // Also gated on `showSlowLoadIndicator` (the same 200ms-debounced flag set by the
  // `slowTimer` above) rather than firing the instant `loading` flips true — a COLD first
  // visit to a chapter this session still hits this branch (no cached verses at all), and
  // the typical local-SQLite fetch resolves within a frame or two, so the skeleton would
  // mount, paint, and get replaced almost immediately: exactly the "briefly looks different"
  // flash reported on switching to the Scripture tab. Waiting the same 200ms means the
  // common fast case renders straight to real content with no skeleton at all; only a
  // genuinely slow load (the same threshold already used for the small loading spinner
  // below) shows it.
  if (loading && verses.length === 0 && showSlowLoadIndicator) {
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

  // Guarded on `!loading` too — without it, a cold-load's brief pre-200ms window (skeleton
  // withheld above, see the comment there) fell through to here and showed "No verses found"
  // for a fraction of a second before the real content arrived, which is a worse flash than
  // the skeleton it replaced.
  if (verses.length === 0 && !loading) {
    return (
      <div className="px-8 py-12 text-center text-[rgb(var(--color-text-muted))]">
        No verses found for {bookId} {chapter}.
      </div>
    )
  }

  if (verses.length === 0) {
    // Still loading, still inside the pre-200ms grace window — render nothing rather than
    // either the skeleton or the "not found" message; real content replaces this almost
    // immediately for the common fast (local SQLite) case.
    return null
  }

  return (
    // Single Tooltip.Provider for this whole chapter's worth of Strong's-number chips, instead
    // of StrongsTooltip.tsx instantiating its own per word (potentially hundreds per chapter).
    // Radix's Provider exists specifically so adjacent triggers can share a `skipDelayDuration`
    // window (fast rehover while scanning) — an independent provider per word meant every single
    // Strong's chip re-incurred the full 300ms open-delay, so skimming across several tagged
    // words in a row read as consistently laggy rather than snappy. One provider PER ChapterView
    // instance (not a single app-wide singleton) is the right granularity, not just a convenient
    // one: multiple instances can be mounted at once (compare-mode columns, continuous scroll,
    // multi-chapter range view — see viewTransitionName's own uniqueness comment above), and the
    // fast-rehover grouping should only apply WITHIN one chapter's own words, not bleed across
    // unrelated compare columns.
    <Tooltip.Provider delayDuration={300}>
    <div ref={containerRef} className={`berean-scripture-text relative ${compact ? 'px-3 py-3' : 'px-8 py-6 max-w-3xl'}`} style={{ fontSize: bibleFontSize, viewTransitionName } as React.CSSProperties} onMouseUp={handleContainerMouseUp}>

      {/* Self-contained fallback for callers that don't wire onSlowLoadChange (e.g. CompareView's
          columns) — sticky so it stays visible regardless of scroll position. */}
      {showSlowLoadIndicator && (
        <div className="sticky top-2 z-10 float-right -mt-1 -mr-1 flex items-center gap-1.5 px-2 py-1 rounded-full bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-md text-[10px] text-[rgb(var(--color-text-muted))]">
          <span className="w-3 h-3 rounded-full border-2 border-[rgb(var(--color-accent))] border-t-transparent animate-spin" />
          Loading…
        </div>
      )}

      <VersificationBanner bookId={bookId} chapter={chapter} textId={textId} />

      {/* Chapter-level cross-ref banner — shown when notes elsewhere reference this whole chapter */}
      {chapterSources.length > 0 && (
        <ChapterCrossRefBanner sources={chapterSources} bookId={bookId} chapter={chapter} />
      )}

      {verses.map((verse, verseIdx) => {
        // Any KJV verse numbers that fall in the gap between the previous rendered verse
        // and this one — see the missingLxxVerses effect above for how/why these are
        // detected. Rendered as a small muted marker ahead of this verse, matching the
        // note-count/cross-ref pill's own subtle "informational, not alarming" styling
        // (muted color, small text, opacity-75) rather than a distracting banner.
        const prevNum = verseIdx > 0 ? verses[verseIdx - 1].verse_num : 0
        const missingBefore = missingLxxVerses.size === 0 ? [] : [...missingLxxVerses]
          .filter((n) => n > prevNum && n < verse.verse_num)
          .sort((a, b) => a - b)
        const isHighlighted = flashVerse !== null && (
          flashVerse.end !== undefined
            ? verse.verse_num >= flashVerse.verse && verse.verse_num <= flashVerse.end
            : verse.verse_num === flashVerse.verse
        )
        // Search-navigation highlight — only meaningful for the exact landed verse (word
        // indices in particular are only valid for that one verse's own text), not the
        // whole flashed range. Overrides the chapter-wide findQuery/findWordMode (which
        // reflects the separate Find-in-chapter bar) just for this row, for as long as the
        // flash itself lasts.
        const isSearchNavTarget = isHighlighted && verse.verse_num === flashVerse?.verse
        const rowFindQuery = isSearchNavTarget && flashVerse?.query ? flashVerse.query : findQuery
        const rowFindWordMode = isSearchNavTarget && flashVerse?.query ? (flashVerse.wordMode ?? 'phrase') : findWordMode
        const rowHighlightStrongsWords = isSearchNavTarget ? flashVerse?.strongsWords : undefined
        const rowHighlightStrongsExtraWords = isSearchNavTarget ? flashVerse?.strongsExtraWords : undefined
        // Read Aloud (TTS) — comparing against the store's audioPlayback state here (rather
        // than each VerseRow subscribing itself) is what makes compare-mode columns showing
        // the same book/chapter highlight in sync automatically: they all read the same
        // ChapterView-computed booleans from the same store slice.
        const isPlaybackVerse = audioPlayback !== null
          && audioPlayback.bookId === bookId
          && audioPlayback.chapter === chapter
          && audioPlayback.textId === textId
          && audioPlayback.verse === verse.verse_num
        const rowPlaybackWordIndex = isPlaybackVerse ? audioPlayback!.wordIndex : null
        return (
          <Fragment key={verse.verse_num}>
            {missingBefore.length > 0 && (() => {
              const contiguous = missingBefore.every((n, i) => i === 0 || n === missingBefore[i - 1] + 1)
              const label = missingBefore.length === 1
                ? `v.${missingBefore[0]}`
                : contiguous
                  ? `vv.${missingBefore[0]}-${missingBefore[missingBefore.length - 1]}`
                  : `vv.${missingBefore.join(', ')}`
              return (
                <p
                  className="px-3 py-0.5 text-[10px] text-[rgb(var(--color-text-muted))] opacity-60 select-none"
                  title="Present in the KJV but not in this Septuagint text"
                >
                  — {label} not in LXX —
                </p>
              )
            })()}
            {verse.title && (
              <div className="px-3 pt-3 pb-0.5 text-[11px] text-[rgb(var(--color-text-muted))] opacity-75">
                {verse.title}
              </div>
            )}
            <VerseRow
              verse={verse}
              showStrongs={showStrongs}
              showVerseNumber={showVerseNumbers}
              noteCount={noteCounts[verse.verse_num] ?? 0}
              notePrimaryColor={noteColorsMap[verse.verse_num]}
              hasNoteCrossRef={verseHasNoteCrossRefs[verse.verse_num] ?? false}
              isHighlighted={isHighlighted}
              highlights={highlights[verse.verse_num] ?? EMPTY_HIGHLIGHTS}
              hiddenAnnotations={hiddenAnnotations}
              textId={textId}
              findQuery={rowFindQuery}
              findWordMode={rowFindWordMode}
              highlightStrongsWords={rowHighlightStrongsWords}
              highlightStrongsExtraWords={rowHighlightStrongsExtraWords}
              onStrongsClick={onStrongsClick}
              onWordClick={onWordClick}
              playbackVerse={isPlaybackVerse}
              playbackWordIndex={rowPlaybackWordIndex}
            />
          </Fragment>
        )
      })}

      {/* Scripture cross-references from Taylor's footnotes (Taylor Hermas only) */}
      <HermasTaylorFootnoteRefs bookId={bookId} chapter={chapter} textId={textId} />

      {/* Multi-verse selection toolbar — the actual "Copy verses"/"Copy selection"/
          "Add note on range" menu (VerseRow.tsx has its own, separate word/phrase-
          selection toolbar that already uses `.context-menu`). This one was still on
          `.glass-panel`, whose 72%-opacity background (see global.css) reads as much
          more transparent than the rest of the app's popup menus — switched to the
          same opaque `.context-menu` treatment for consistency. */}
      {multiToolbar && (
        <MenuPositioner x={multiToolbar.x} y={multiToolbar.y}
          className="min-w-[200px] rounded-shell context-menu overflow-hidden py-1"
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
            <ShortcutKeys keys="⌘C" className="flex-shrink-0" />
          </button>
          <button
            onClick={copyText}
            className="flex items-center justify-between gap-2 w-full px-3 py-1.5 text-xs text-left hover:bg-[rgb(var(--color-surface-4))] cursor-pointer transition-colors text-[rgb(var(--color-text-primary))]"
          >
            <span className="flex items-center gap-2">
              <Copy size={11} className="flex-shrink-0 text-[rgb(var(--color-text-muted))]" />
              Copy selection
            </span>
            {/* "⌘⇧C", not "⇧⌘C" — this was the app's one place spelling a Shift+Command
                combo with the modifiers in the opposite order from every other surface
                (and from CLAUDE.md §14's own shortcut table, which puts Cmd first). */}
            <ShortcutKeys keys="⌘⇧C" className="flex-shrink-0" />
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
    </Tooltip.Provider>
  )
}

// Every chapter mounted-but-offscreen in ContinuousChapterScroll re-renders whenever its parent
// does without this — hiddenAnnotations/onStrongsClick/onWordClick etc. are typically stable
// references from the parent, so memo lets scrolled-away chapters skip re-rendering entirely.
export default memo(ChapterView)
