import { useState, useEffect, useRef, useCallback, Fragment } from 'react'
import { ChevronLeft, ChevronRight, X, Info } from 'lucide-react'
import BookChapterPicker from './BookChapterPicker'
import ChapterView from './ChapterView'
import ActionPillGroup from '@/components/shell/ActionPillGroup'
import { ANNOTATION_KEYS, TRANSLATIONS, EDITIONS } from '@/lib/bibleTexts'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import { normalizeBookName } from '@/lib/parseRef'
import { zoomedFontSize } from '@/lib/zoom'
import { computePresenterBand as computeBandGeometry } from '@/lib/presenterBand'
import { encodeScrollPosition, decodeScrollPosition } from '@/lib/verseScrollSync'
import { useAppStore } from '@/store'
import type { Verse, Book } from '@/types'
import type { ViewerVisibleRegion } from '@/types/electron'

function applyFindHighlight(text: string, query: string, wordMode: 'phrase' | 'all' | 'any' = 'phrase'): React.ReactNode {
  if (!query.trim()) return text
  let pattern: string
  if (wordMode === 'phrase') {
    pattern = query.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  } else {
    const words = query.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean)
    if (!words.length) return text
    pattern = words.join('|')
  }
  const splitRe = new RegExp(`(${pattern})`, 'gi')
  const matchRe = new RegExp(`^(?:${pattern})$`, 'i')
  const parts = text.split(splitRe)
  if (parts.length <= 1) return text
  return (
    <>
      {parts.map((p, i) =>
        matchRe.test(p)
          ? <mark key={i} style={{ backgroundColor: 'rgba(234,179,8,0.42)', borderRadius: '2px', padding: '0 1px' }}>{p}</mark>
          : p
      )}
    </>
  )
}

interface ColState {
  id: string
  textId: string
  bookId: string
  chapter: number
  verses: Verse[]
  loading: boolean
}

interface Props {
  bookId: string
  chapter: number
  /** Translation the incoming bookId/chapter are expressed in (the source tab's text).
   *  Used to remap chapters for columns in a different versification (KJV↔LXX Jer/Psalms). */
  sourceTextId?: string
  targetVerse?: number
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  showStrongs?: boolean
  onColumnFocus?: (colIdx: number) => void
  onColumnRef?: (colIdx: number, el: HTMLDivElement | null) => void
  onStrongsClick?: (num: string) => void
  onWordClick?: (word: string) => void
  books?: Book[]
  addColRef?: React.MutableRefObject<((target?: { bookId: string; chapter: number; textId?: string }) => void) | null>
  /** When compare is entered via "Add panel", the picked ref is added as an extra column on mount. */
  initialAddPanel?: { bookId: string; chapter: number; textId?: string } | null
  onConsumeInitialPanel?: () => void
  /** Called when removing a column would leave a single column — lets the host exit compare mode. */
  onCollapseToSingle?: (last: { bookId: string; chapter: number; textId: string }) => void
  /** Columns saved in tab state — restored on mount so chapter navigation survives a tab switch. */
  initialColumns?: Array<{ textId: string; bookId: string; chapter: number }>
  /** Persist the current columns to tab state whenever they change. */
  onColumnsChange?: (cols: Array<{ textId: string; bookId: string; chapter: number }>) => void
  /** Scroll any column and every OTHER column sharing its exact bookId+chapter (a
   *  different translation of the same passage) follows by verse position. */
  syncScrollEnabled?: boolean
  /** Reports whether syncing is currently possible (2+ columns share a chapter) —
   *  recomputed live as columns/chapters change, so the host's toggle button can
   *  gray itself out without a separate "auto-disable" mechanism. */
  onSyncEligibleChange?: (eligible: boolean) => void
}

// ── Annotation info popover (read-only, per column) ───────────────────────────

function ColInfoPopover({ textId, onClose }: { textId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const annInfo = ANNOTATION_KEYS[textId]
  if (!annInfo) return null
  const label = TRANSLATIONS.find(t => t.id === textId)?.label ?? textId.toUpperCase()

  return (
    <div
      ref={ref}
      className="absolute top-full right-0 mt-1 z-50 w-64 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden"
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-[rgb(var(--color-surface-4))]">
        <span className="text-xs font-semibold text-[rgb(var(--color-text-secondary))]">
          {label} — Annotations
        </span>
      </div>
      <div className="px-3 py-2 space-y-2.5">
        {annInfo.keys.map(k => (
          <div key={k.key} className="flex gap-2 items-start">
            <code className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] flex-shrink-0 mt-0.5">
              {k.symbol}
            </code>
            <span className="text-[11px] leading-relaxed text-[rgb(var(--color-text-secondary))]">{k.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Main compare view ──────────────────────────────────────────────────────────
// Each column's header used to be a separate `TranslationDropdown` (this file) plus a
// plain book/chapter picker on its own row — that duplicated functionality
// `BookChapterPicker` already has built in via its `editions`/`currentTextId`/
// `onSelectTranslation` props (the same ones BiblePanel.tsx's single-panel toolbar
// already uses), so it's been removed in favor of one unified pill per column,
// matching that toolbar's visual language. See the column header render below.

export default function CompareView({ bookId, chapter, sourceTextId = 'kjva', targetVerse, findQuery = '', findWordMode = 'phrase', showStrongs = false, onColumnFocus, onColumnRef, onStrongsClick, onWordClick, books: propBooks, addColRef, initialAddPanel, onConsumeInitialPanel, onCollapseToSingle, initialColumns, onColumnsChange, syncScrollEnabled = false, onSyncEligibleChange }: Props) {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const bibleFontSize = zoomedFontSize(useAppStore((s) => s.bibleFontSize), useAppStore((s) => s.appZoom))
  const [booksByText, setBooksByText] = useState<Record<string, Book[]>>({})
  // Holds a pending onCollapseToSingle argument — scheduled outside the setColumns updater
  // to avoid calling parent state-setters during render (React warning + Zustand push).
  const pendingCollapseRef = useRef<{ bookId: string; chapter: number; textId: string } | null>(null)
  useEffect(() => {
    if (pendingCollapseRef.current && onCollapseToSingle) {
      const arg = pendingCollapseRef.current
      pendingCollapseRef.current = null
      onCollapseToSingle(arg)
    }
  })
  const [columns, setColumns] = useState<ColState[]>(() => {
    // Restored from tab state (returning to the tab after it was unmounted): rebuild the
    // exact columns the user left, including any chapter navigation they did.
    if (initialColumns && initialColumns.length > 0) {
      return initialColumns.map((c, i) => ({
        id: `col-${i}`, textId: c.textId, bookId: c.bookId, chapter: c.chapter, verses: [], loading: true,
      }))
    }
    // Entered via "Add panel": start with just the CURRENT view; the picked ref is appended
    // by the consume effect → current + picked = 2 columns.
    if (initialAddPanel) {
      return [{ id: 'col-0', textId: sourceTextId, bookId, chapter, verses: [], loading: true }]
    }
    // Entered via "Compare translations": KJV vs LXX of the same reference.
    return [
      { id: 'col-0', textId: 'kjva', bookId, chapter: mapChapterOnTranslationSwitch(bookId, chapter, sourceTextId, 'kjva'), verses: [], loading: true },
      { id: 'col-1', textId: 'lxx',  bookId, chapter: mapChapterOnTranslationSwitch(bookId, chapter, sourceTextId, 'lxx'),  verses: [], loading: true },
    ]
  })
  const [focusedCol, setFocusedCol] = useState(0)
  const [infoOpenFor, setInfoOpenFor] = useState<string | null>(null)
  // Per-column flex-grow weights so the dividers between columns can be dragged to resize.
  // Keyed by column ID (not array index) — with drag-to-reorder now changing a column's
  // index without changing its identity, an index-keyed array would need every reorder to
  // also carefully re-splice this in lockstep or widths silently land on the wrong column;
  // keying by id sidesteps that class of bug entirely.
  const [colFlex, setColFlex] = useState<Record<string, number>>({})
  const rowRef = useRef<HTMLDivElement>(null)
  const colRefs = useRef<(HTMLDivElement | null)[]>([])
  const fetchingRef = useRef<Set<string>>(new Set())
  const requestedBooksRef = useRef<Set<string>>(new Set())
  const colIdCounter = useRef(initialColumns && initialColumns.length > 0 ? initialColumns.length : 2)

  function ensureBooksFor(textId: string) {
    if (requestedBooksRef.current.has(textId)) return
    requestedBooksRef.current.add(textId)
    window.bible.getBooks(textId)
      .then(bks => setBooksByText(prev => ({ ...prev, [textId]: bks.map(b => ({ ...b, name: normalizeBookName(b.name) })) })))
      .catch(() => {})
  }

  useEffect(() => {
    ensureBooksFor('kjva')
    ensureBooksFor('lxx')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (propBooks && propBooks.length > 0) {
      setBooksByText(prev => prev['kjva'] ? prev : { ...prev, kjva: propBooks })
      requestedBooksRef.current.add('kjva')
    }
  }, [propBooks]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep addColRef pointing at the latest addColumn
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  // Persist columns (text/book/chapter only) to tab state so chapter navigation, column
  // adds/removes, and translation changes survive leaving and returning to the tab.
  const persistKey = columns.map(c => `${c.textId}:${c.bookId}:${c.chapter}`).join('|')
  const onColumnsChangeRef = useRef(onColumnsChange)
  onColumnsChangeRef.current = onColumnsChange
  useEffect(() => {
    onColumnsChangeRef.current?.(columns.map(c => ({ textId: c.textId, bookId: c.bookId, chapter: c.chapter })))
  }, [persistKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!addColRef) return
    addColRef.current = (target) => {
      const cols = columnsRef.current
      const last = cols[cols.length - 1] ?? { textId: 'kjva', bookId, chapter }
      const newId = `col-${colIdCounter.current++}`
      // If a target ref was supplied (via "add panel" search), use it; otherwise default
      // to the last column's book/chapter and the next unused translation.
      let textId: string, bookId2: string, chapter2: number
      if (target) {
        textId = target.textId ?? last.textId
        bookId2 = target.bookId
        chapter2 = target.chapter
      } else {
        const usedIds = new Set(cols.map(c => c.textId))
        textId = (TRANSLATIONS.find(t => !usedIds.has(t.id)) ?? TRANSLATIONS[0]).id
        bookId2 = last.bookId
        chapter2 = last.chapter
      }
      ensureBooksFor(textId)
      setColumns(prev => [...prev, {
        id: newId,
        textId,
        bookId: bookId2,
        chapter: chapter2,
        verses: [],
        loading: true,
      }])
    }
    return () => { if (addColRef) addColRef.current = null }
  }) // runs every render to keep addColumn fresh

  // Verse loading + rendering is delegated to <ChapterView> per column (so highlights,
  // notes, and Strong's all work) — CompareView no longer fetches verse text itself.

  // Consume a pending "Add panel" target once, on mount: append it as an extra column.
  const consumedInitialRef = useRef(false)
  useEffect(() => {
    if (consumedInitialRef.current || !initialAddPanel) return
    consumedInitialRef.current = true
    const t = initialAddPanel
    const newId = `col-${colIdCounter.current++}`
    const textId = t.textId ?? 'kjva'
    ensureBooksFor(textId)
    setColumns(prev => [...prev, { id: newId, textId, bookId: t.bookId, chapter: t.chapter, verses: [], loading: true }])
    onConsumeInitialPanel?.()
  }, [initialAddPanel]) // eslint-disable-line react-hooks/exhaustive-deps

  function removeColumn(colId: string) {
    setColumns(prev => {
      if (prev.length <= 1) return prev
      const next = prev.filter(c => c.id !== colId)
      // Removing down to a single column → schedule collapse via ref (not during render).
      if (next.length === 1 && onCollapseToSingle) {
        const c = next[0]
        pendingCollapseRef.current = { bookId: c.bookId, chapter: c.chapter, textId: c.textId }
      }
      return next
    })
  }

  // ── Drag-to-reorder columns ────────────────────────────────────────────────
  // Replaces the old move-left/move-right arrow buttons. Hand-rolled native HTML5
  // drag events (dataTransfer + a cloned-node custom drag image), the same event
  // model TabBar.tsx already uses for tab reordering — kept consistent with that
  // rather than introducing a second drag paradigm (e.g. framer-motion's Reorder,
  // which would also fight with startColumnResize's own raw mousedown/mousemove
  // handling on the adjacent column dividers). Only a column's header row is
  // draggable, not the whole column (which holds selectable/scrollable verse text).
  const [draggingColIdx, setDraggingColIdx] = useState<number | null>(null)
  const [dragOverColIdx, setDragOverColIdx] = useState<number | null>(null)
  const [dragInsertBefore, setDragInsertBefore] = useState(true)
  const draggingColIdxRef = useRef<number | null>(null)

  function handleColDragStart(e: React.DragEvent, idx: number) {
    draggingColIdxRef.current = idx
    setDraggingColIdx(idx)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('berean-compare-col', String(idx))
    const el = e.currentTarget as HTMLElement
    const rect = el.getBoundingClientRect()
    const clone = el.cloneNode(true) as HTMLElement
    Object.assign(clone.style, {
      position: 'fixed', top: '-9999px', left: '0px',
      width: `${rect.width}px`, height: `${rect.height}px`,
      margin: '0', pointerEvents: 'none', opacity: '1',
      background: getComputedStyle(el).backgroundColor,
    })
    document.body.appendChild(clone)
    e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top)
    setTimeout(() => document.body.removeChild(clone), 0)
  }

  function handleColDragOver(e: React.DragEvent, idx: number) {
    if (draggingColIdxRef.current === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    setDragOverColIdx(idx)
    setDragInsertBefore(relX < 0.5)
  }

  function handleColDrop(e: React.DragEvent) {
    e.preventDefault()
    const fromIdx = draggingColIdxRef.current
    draggingColIdxRef.current = null
    setDraggingColIdx(null)
    const toIdx = dragOverColIdx
    const before = dragInsertBefore
    setDragOverColIdx(null)
    if (fromIdx === null || toIdx === null || fromIdx === toIdx) return
    setColumns(prev => {
      const next = [...prev]
      const [moved] = next.splice(fromIdx, 1)
      let insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx
      if (!before) insertAt += 1
      next.splice(Math.max(0, Math.min(next.length, insertAt)), 0, moved)
      return next
    })
  }

  function handleColDragEnd() {
    draggingColIdxRef.current = null
    setDraggingColIdx(null)
    setDragOverColIdx(null)
  }

  // ── Sync scroll across columns sharing the same passage ──────────────────────
  // Only columns with the SAME bookId+chapter (different translations of the same
  // passage — e.g. KJV vs LXX, or the two Hermas translations) sync with each
  // other; with 3+ columns where only some match, those sync as their own group
  // while the rest scroll independently, rather than an all-or-nothing toggle.
  function syncGroupFor(colIdx: number): number[] {
    const col = columns[colIdx]
    if (!col) return []
    return columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.bookId === col.bookId && c.chapter === col.chapter)
      .map(({ i }) => i)
  }

  // Reports eligibility (2+ columns currently share a chapter) whenever columns
  // change, so the host's toggle button can gray itself out live — e.g. navigating
  // one column to a different chapter drops it out of sync without needing an
  // explicit "disable" action from the user.
  useEffect(() => {
    const groupSizes = new Map<string, number>()
    for (const c of columns) {
      const key = `${c.bookId}:${c.chapter}`
      groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1)
    }
    const eligible = Math.max(0, ...groupSizes.values()) >= 2
    onSyncEligibleChange?.(eligible)
  }, [columns, onSyncEligibleChange])

  // Which column is currently "driving" a sync-scroll write — a column id (not a
  // boolean) so that with 3+ columns, a genuinely new user-initiated scroll on a
  // DIFFERENT column during the brief release window isn't also swallowed. Released
  // on the next animation frame, after the synchronous scrollTop writes below have
  // had a chance to fire (and be ignored by) the peers' own onScroll handlers.
  const scrollSyncSourceRef = useRef<string | null>(null)

  function handleSyncScroll(colIdx: number, el: HTMLElement) {
    if (!syncScrollEnabled) return
    const col = columns[colIdx]
    if (!col) return
    if (scrollSyncSourceRef.current !== null && scrollSyncSourceRef.current !== col.id) return
    const group = syncGroupFor(colIdx)
    if (group.length < 2) return
    const pos = encodeScrollPosition(el)
    if (!pos) return
    scrollSyncSourceRef.current = col.id
    for (const otherIdx of group) {
      if (otherIdx === colIdx) continue
      const otherEl = colRefs.current[otherIdx]
      if (!otherEl) continue
      const target = decodeScrollPosition(otherEl, pos)
      // Direct write, not scrollTo({behavior:'smooth'}) — needs to track the driving
      // column 1:1 during the gesture for a fluid feel; smoothing here would make
      // the follower visibly lag behind.
      if (target !== null) otherEl.scrollTop = target
    }
    const sourceId = col.id
    requestAnimationFrame(() => { if (scrollSyncSourceRef.current === sourceId) scrollSyncSourceRef.current = null })
  }

  function navigateColumn(colId: string, newBookId: string, newChapter: number) {
    setColumns(prev => prev.map(c =>
      c.id === colId ? { ...c, bookId: newBookId, chapter: newChapter, verses: [], loading: true } : c
    ))
  }

  function changeTranslation(colId: string, newTextId: string) {
    ensureBooksFor(newTextId)
    setColumns(prev => prev.map(c => {
      if (c.id !== colId) return c
      // Remap the chapter into the new translation's versification (KJV↔LXX Jer/Psalms).
      const mappedChapter = mapChapterOnTranslationSwitch(c.bookId, c.chapter, c.textId, newTextId)
      return { ...c, textId: newTextId, chapter: mappedChapter, verses: [], loading: true }
    }))
  }

  // Keep the flex-weight map in sync with the current columns (new columns start at
  // weight 1; a removed column's leftover weight is dropped, not just orphaned).
  useEffect(() => {
    setColFlex(prev => {
      const next: Record<string, number> = {}
      for (const c of columns) next[c.id] = prev[c.id] ?? 1
      return next
    })
  }, [columns])

  // ── Mirror the compare layout to the presenter window ────────────────────────
  const comparePushRaf = useRef<number | null>(null)
  const colBandRaf = useRef<Record<number, number>>({})
  const colScrollRef = useRef<number[]>([])             // per-column scroll percent
  // Per-column presenter visible region + computed outline band.
  const [compareRegions, setCompareRegions] = useState<Record<number, ViewerVisibleRegion>>({})
  const [colBands, setColBands] = useState<Record<number, { top: number; height: number } | null>>({})

  function pushCompareToViewer() {
    const st = useAppStore.getState()
    if (!st.viewerWindowOpen || st.viewerPaused || st.viewerBlank) return
    window.app.pushViewerContent?.({
      kind: 'compare',
      columns: columns.map(c => ({ textId: c.textId, bookId: c.bookId, chapter: c.chapter })),
      scrollPercents: columns.map((_, i) => colScrollRef.current[i] ?? 0),
    })
  }
  const columnsKey = columns.map(c => `${c.textId}@${c.bookId}.${c.chapter}`).join('|')
  const viewerWindowOpen = useAppStore((s) => s.viewerWindowOpen)
  // Push whenever the columns change or the presenter opens.
  useEffect(() => { pushCompareToViewer() }, [columnsKey, viewerWindowOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  // useViewerSync asks us to (re)push when it detects compare mode (e.g. presenter ready).
  useEffect(() => {
    const handler = () => pushCompareToViewer()
    window.addEventListener('berean:requestComparePush', handler)
    return () => window.removeEventListener('berean:requestComparePush', handler)
  }) // no deps: always use the latest columns

  // Receive each presenter column's visible region → outline band over the matching main column.
  useEffect(() => {
    const handler = (e: Event) => {
      const r = (e as CustomEvent).detail as ViewerVisibleRegion
      if (r.colIndex === undefined) return
      setCompareRegions(prev => ({ ...prev, [r.colIndex!]: r }))
    }
    window.addEventListener('berean:compareRegion', handler)
    return () => window.removeEventListener('berean:compareRegion', handler)
  }, [])

  // Latest values for the band computation (read inside callbacks without stale closures).
  const compareRegionsRef = useRef(compareRegions)
  compareRegionsRef.current = compareRegions
  const viewerWindowOpenRef = useRef(viewerWindowOpen)
  viewerWindowOpenRef.current = viewerWindowOpen
  // Compute a column's outline band from its presenter region + its own scroll/verse positions.
  const computeColBand = useCallback((colIdx: number) => {
    const region = compareRegionsRef.current[colIdx]
    const c = colRefs.current[colIdx]
    if (!viewerWindowOpenRef.current || !region || !c || c.scrollHeight <= 0) { setColBands(p => ({ ...p, [colIdx]: null })); return }
    const cTop = c.getBoundingClientRect().top
    const tops: Record<number, number> = {}
    for (const node of Array.from(c.querySelectorAll('[data-verse]'))) {
      const ex = node as HTMLElement
      const n = Number(ex.dataset.verse)
      if (Number.isFinite(n)) tops[n] = ex.getBoundingClientRect().top - cTop + c.scrollTop
    }
    const band = computeBandGeometry({
      visibleFraction: region.visibleFraction, verseFracs: region.verseFracs, mainTops: tops,
      mainScrollHeight: c.scrollHeight, mainClientHeight: c.clientHeight, mainScrollTop: c.scrollTop,
    })
    setColBands(p => ({ ...p, [colIdx]: band }))
  }, [])
  // Recompute bands when regions update.
  useEffect(() => {
    const raf = requestAnimationFrame(() => columns.forEach((_, i) => computeColBand(i)))
    return () => cancelAnimationFrame(raf)
  }, [compareRegions, columnsKey, computeColBand]) // eslint-disable-line react-hooks/exhaustive-deps

  // Drag a divider between columns `idx` and `idx+1`, transferring flex weight between them.
  function startColumnResize(idx: number, e: React.MouseEvent) {
    e.preventDefault()
    const row = rowRef.current
    if (!row) return
    const totalW = row.clientWidth
    const startX = e.clientX
    const leftId = columns[idx]?.id
    const rightId = columns[idx + 1]?.id
    if (!leftId || !rightId) return
    const base = { left: colFlex[leftId] ?? 1, right: colFlex[rightId] ?? 1 }
    const sumTwo = base.left + base.right
    function move(ev: MouseEvent) {
      const frac = (ev.clientX - startX) / Math.max(1, totalW) * columns.length
      const left = Math.max(0.25, Math.min(sumTwo - 0.25, base.left + frac))
      const right = sumTwo - left
      setColFlex((prev) => ({ ...prev, [leftId]: left, [rightId]: right }))
    }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); document.body.style.cursor = '' }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // Each column renders its own verse list independently — no shared alignment.
  // If column A has 12 verses and column B has 15, they each show their own count.

  return (
    <div ref={rowRef} className="flex-1 overflow-hidden flex">
      {columns.map((col, colIdx) => {
        const isFocused = focusedCol === colIdx
        const booksForCol = booksByText[col.textId] ?? propBooks ?? []
        const currentBook = booksForCol.find(b => b.id === col.bookId)
        const maxChapter = currentBook?.chapters_count ?? 999
        const hasInfo = !!ANNOTATION_KEYS[col.textId]

        return (
         <Fragment key={col.id}>
          <div
            ref={el => {
              colRefs.current[colIdx] = el
              onColumnRef?.(colIdx, el)
            }}
            onClick={() => { setFocusedCol(colIdx); onColumnFocus?.(colIdx) }}
            onScroll={(e) => {
              const el = e.currentTarget
              const max = el.scrollHeight - el.clientHeight
              colScrollRef.current[colIdx] = max > 0 ? el.scrollTop / max : 0
              // Only this column's scroll is pushed (others keep their own positions).
              if (comparePushRaf.current) cancelAnimationFrame(comparePushRaf.current)
              comparePushRaf.current = requestAnimationFrame(() => pushCompareToViewer())
              // Throttled the same way as the push above — computeColBand does a querySelectorAll
              // + getBoundingClientRect pass over every verse in the column, which is too expensive
              // to run synchronously on every scroll event across every mounted column.
              if (colBandRaf.current[colIdx]) cancelAnimationFrame(colBandRaf.current[colIdx])
              colBandRaf.current[colIdx] = requestAnimationFrame(() => computeColBand(colIdx))
              handleSyncScroll(colIdx, el)
            }}
            className="overflow-y-auto min-w-0 flex flex-col relative"
            style={{ flexGrow: colFlex[col.id] ?? 1, flexBasis: 0 }}
            onDragOver={(e) => handleColDragOver(e, colIdx)}
            onDrop={handleColDrop}
          >
            {/* Drag-reorder insert-line indicator — left/right edge of the column being
                dragged over (horizontal equivalent of TabBar.tsx's top/bottom insert line,
                since columns sit side-by-side rather than stacked). */}
            {dragOverColIdx === colIdx && draggingColIdx !== colIdx && (
              <div
                className={`absolute top-0 bottom-0 w-0.5 bg-[rgb(var(--color-accent))] z-20 pointer-events-none ${dragInsertBefore ? 'left-0' : 'right-0'}`}
              />
            )}
            {/* Presenter visible-region outline for this column */}
            {colBands[colIdx] && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-[5]"
                style={{
                  top: colBands[colIdx]!.top, height: colBands[colIdx]!.height,
                  border: '2px solid rgb(var(--color-accent))',
                  background: 'rgb(var(--color-accent) / 0.06)', borderRadius: 6,
                }}
              />
            )}
            {/* Column header — one row: prev | unified book+chapter+edition pill | next,
                then info/close. Draggable (grab anywhere on the row, matching TabBar.tsx's
                "grab the whole tab" reorder feel) — NOT the column body below, which holds
                selectable/scrollable verse text. */}
            <div
              draggable
              onDragStart={(e) => handleColDragStart(e, colIdx)}
              onDragEnd={handleColDragEnd}
              className={`sticky top-0 z-10 border-b border-[rgb(var(--color-surface-4))] flex items-center gap-1 px-1.5 py-1 cursor-grab active:cursor-grabbing ${isFocused ? 'bg-[rgb(var(--color-surface-3))]' : 'bg-[rgb(var(--color-surface-2))]'} ${draggingColIdx === colIdx ? 'opacity-40' : ''}`}
              onClick={e => e.stopPropagation()}
            >
              {/* min-w-0 so the pill can still shrink/truncate in a genuinely narrow column,
                  but no longer `w-full` — it was stretching to fill the ENTIRE column width
                  (leaving a wide stretch of empty pill after the book/chapter/edition text)
                  instead of hugging its own content like the single-panel toolbar's pill does. */}
              <ActionPillGroup className="min-w-0 flex-shrink" align="stretch">
                <button
                  onClick={() => navigateColumn(col.id, col.bookId, Math.max(1, col.chapter - 1))}
                  disabled={col.chapter <= 1}
                  className="flex items-center justify-center w-6 h-6 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] disabled:opacity-30 disabled:cursor-default transition-colors cursor-pointer flex-shrink-0"
                >
                  <ChevronLeft size={12} />
                </button>
                <BookChapterPicker
                  books={booksForCol}
                  currentBookId={col.bookId}
                  currentChapter={col.chapter}
                  onNavigate={(bId, ch) => navigateColumn(col.id, bId, ch)}
                  editions={EDITIONS}
                  currentTextId={col.textId}
                  onSelectTranslation={(id) => changeTranslation(col.id, id)}
                  segmented
                  compact
                  wrapperClassName="relative min-w-0"
                />
                <button
                  onClick={() => navigateColumn(col.id, col.bookId, Math.min(maxChapter, col.chapter + 1))}
                  disabled={col.chapter >= maxChapter}
                  className="flex items-center justify-center w-6 h-6 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] disabled:opacity-30 disabled:cursor-default transition-colors cursor-pointer flex-shrink-0"
                >
                  <ChevronRight size={12} />
                </button>
              </ActionPillGroup>
              {/* Spacer pins info/close to the row's right edge now that the pill itself no
                  longer stretches to fill the row on its own. */}
              <div className="flex-1" />
              {hasInfo && (
                <div className="relative flex-shrink-0">
                  <button
                    onClick={() => setInfoOpenFor(infoOpenFor === col.id ? null : col.id)}
                    title="Annotation key"
                    // Same background-box hover treatment as its chevron/close peers in this
                    // row (was text-color-only, the one button in the toolbar that didn't
                    // highlight a background on hover — inconsistent as the cursor moved
                    // across the row).
                    className={`p-0.5 rounded transition-colors cursor-pointer ${infoOpenFor === col.id ? 'text-[rgb(var(--color-text-primary))] bg-[rgb(var(--color-surface-4))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'}`}
                  >
                    <Info size={11} />
                  </button>
                  {infoOpenFor === col.id && (
                    <ColInfoPopover textId={col.textId} onClose={() => setInfoOpenFor(null)} />
                  )}
                </div>
              )}
              <button
                onClick={() => removeColumn(col.id)}
                disabled={columns.length <= 1}
                title="Close panel"
                className="flex-shrink-0 p-0.5 rounded transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:text-red-400 hover:bg-[rgb(var(--color-surface-4))] disabled:opacity-30 disabled:cursor-default"
              >
                <X size={11} />
              </button>
            </div>

            {/* Verse content — full ChapterView so highlights, notes, and Strong's all work */}
            <ChapterView
              bookId={col.bookId}
              chapter={col.chapter}
              textId={col.textId}
              showStrongs={showStrongs}
              targetVerse={targetVerse}
              findQuery={isFocused ? findQuery : ''}
              findWordMode={findWordMode}
              onStrongsClick={onStrongsClick}
              onWordClick={onWordClick}
              compact
            />
          </div>
          {colIdx < columns.length - 1 && (
            <div
              onMouseDown={(e) => startColumnResize(colIdx, e)}
              title="Drag to resize columns"
              className="flex-shrink-0 w-1 cursor-col-resize bg-[rgb(var(--color-surface-4))] hover:bg-[rgb(var(--color-accent))/60] transition-colors"
            />
          )}
         </Fragment>
        )
      })}
    </div>
  )
}
