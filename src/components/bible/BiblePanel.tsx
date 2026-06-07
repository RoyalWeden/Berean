import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Layers, PanelRight, Check, Columns2, Info, Eye, EyeOff, ArrowLeft, Search as SearchIcon, ScanSearch, LayoutDashboard, Plus, FileUp } from 'lucide-react'
import PdfPicker from '@/components/pdf/PdfPicker'
import { useAppStore } from '@/store'
import ChapterView from './ChapterView'
import CompareView from './CompareView'
import BookChapterPicker from './BookChapterPicker'
import BibleRightPanel from './BibleRightPanel'
import ErrorBoundary from '@/components/shell/ErrorBoundary'
import FindBar from '@/components/shell/FindBar'
import ScriptureSearchView from './ScriptureSearchView'
import ScriptureSearchFloating from './ScriptureSearchFloating'
import LayoutPicker from './LayoutPicker'
import { HintTooltip } from '@/components/shell/HintTooltip'
import type { Book, BibleTabState, ScriptureLayout } from '@/types'

import { ANNOTATION_KEYS, TRANSLATIONS } from '@/lib/bibleTexts'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import { isHermasBook, getHermasChapterLabel, getHermasShortLabel, getHermasPrevChapter, getHermasNextChapter } from '@/lib/hermasMap'

function normalizeBookName(name: string): string {
  return name
    .replace(/^III /, '3 ')
    .replace(/^II /, '2 ')
    .replace(/^I /, '1 ')
    .replace(/^Revelation of John$/, 'Revelation')
}

export default function BiblePanel({ floating = false }: { floating?: boolean }) {
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const updateTabState = useAppStore((s) => s.updateTabState)
  const renameTab = useAppStore((s) => s.renameTab)
  const pendingRightPanelNoteId = useAppStore((s) => s.pendingRightPanelNoteId)
  const pendingRightPanelVerseFilter = useAppStore((s) => s.pendingRightPanelVerseFilter)
  const pendingRightPanelCrossRefVerse = useAppStore((s) => s.pendingRightPanelCrossRefVerse)
  const clearRightPanelNote = useAppStore((s) => s.clearRightPanelNote)
  const clearRightPanelVerseFilter = useAppStore((s) => s.clearRightPanelVerseFilter)
  const clearRightPanelCrossRef = useAppStore((s) => s.clearRightPanelCrossRef)
  const requestLexiconSearch = useAppStore((s) => s.requestLexiconSearch)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const addTab = useAppStore((s) => s.addTab)
  const activateTab = useAppStore((s) => s.activateTab)
  const openScriptureSearchTab = useAppStore((s) => s.openScriptureSearchTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const defaultScriptureLayout = useAppStore((s) => s.defaultScriptureLayout)
  const setDefaultScriptureLayout = useAppStore((s) => s.setDefaultScriptureLayout)

  // ── Find bar (Cmd+F / type-anywhere) ────────────────────────────────────────
  const findBarOpen = useAppStore((s) => s.findBarOpen)
  const findBarQuery = useAppStore((s) => s.findBarQuery)
  const findBarAutoOpen = useAppStore((s) => s.findBarAutoOpen)
  const findBarWordMode = useAppStore((s) => s.findBarWordMode)
  const closeFindBar = useAppStore((s) => s.closeFindBar)
  const openFindBar = useAppStore((s) => s.openFindBar)
  const setFindBarQuery = useAppStore((s) => s.setFindBarQuery)
  const setFindBarWordMode = useAppStore((s) => s.setFindBarWordMode)
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activePanelId = useAppStore((s) => s.activePanelId)
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)

  // Verse-match state — populated when findBarQuery is non-empty
  const [findMatchVerseNums, setFindMatchVerseNums] = useState<number[]>([])
  const [findMatchIdx, setFindMatchIdx] = useState(0)
  const chapterViewRef = useRef<HTMLDivElement>(null)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Stores a scroll position to apply after ChapterView finishes loading its verses async.
  // The double-RAF approach is insufficient because IPC data arrives much later than 2 frames.
  const pendingScrollRef = useRef<number | null>(null)
  // Stores the top-visible verse anchor before a Strong's toggle so the same verse stays
  // visible at roughly the same screen position after the layout reflows.
  const strongsAnchorRef = useRef<{ verseNum: number; offsetPx: number } | null>(null)
  // Compare-mode column tracking
  const [compareFocusedCol, setCompareFocusedCol] = useState(0)
  const compareColRefs = useRef<(HTMLDivElement | null)[]>([])
  // Floating scripture search
  const [scriptureFloatingOpen, setScriptureFloatingOpen] = useState(false)
  // Layout picker popover
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false)
  const layoutPickerRef = useRef<HTMLDivElement>(null)
  // Compare mode — ref exposed to CompareView so the + button can add columns
  const compareAddColRef = useRef<(() => void) | null>(null)


  const activeTab = tabs['scripture'].find((t) => t.id === activeTabId['scripture'])
  const tabState = (activeTab?.state ?? {
    bookId: 'GEN', chapter: 1, translation: 'KJVA', showStrongs: false, scrollPosition: 0
  }) as BibleTabState

  const textId = (tabState.translation ?? 'KJVA').toLowerCase()
  const [books, setBooks] = useState<Book[]>([])
  const [translationOpen, setTranslationOpen] = useState(false)
  const [translationFilter, setTranslationFilter] = useState('')
  const translationRef = useRef<HTMLDivElement>(null)
  const [pdfPicker, setPdfPicker] = useState<{ x: number; y: number } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  // Always-current ref to tabState so async callbacks never read stale values
  const tabStateRef = useRef(tabState)
  const activeTabRef = useRef(activeTab)
  tabStateRef.current = tabState
  activeTabRef.current = activeTab

  // Right panel state — initialized from persisted tab state
  const [rightPanelOpen, setRightPanelOpen] = useState(() => tabState.rightPanelOpen ?? false)
  const [rightPanelWidth, setRightPanelWidth] = useState(() => tabState.rightPanelWidth ?? 280)
  const [bottomPanelHeight, setBottomPanelHeight] = useState(() => tabState.bottomPanelHeight ?? 240)
  const [rightPanelTab, setRightPanelTab] = useState<'notes' | 'lexicon' | 'crossrefs'>(() => tabState.rightPanelTab ?? 'notes')
  // Persisted right-panel content (survives collapse/expand)
  const [rightPanelNoteId, setRightPanelNoteId] = useState<string | null>(() => tabState.rightPanelNoteId ?? null)
  // Live cursor offset of the side-panel note editor — written via a ref (no re-render),
  // persisted to tab state on tab switch so it can be restored on return.
  const lastNoteCursorRef = useRef<number | null>(tabState.rightPanelNoteCursor ?? null)
  const panelRootRef = useRef<HTMLDivElement>(null)
  // True only when the keyboard focus is inside the side-panel note editor (CodeMirror).
  // In a scripture tab the side-panel note is the only CodeMirror editor, so checking
  // for a focused .cm-content within this panel reliably detects "user was in the note".
  function isSidePanelNoteFocused(): boolean {
    const el = document.activeElement
    if (!el || !(el instanceof HTMLElement)) return false
    const cm = el.closest('.cm-content')
    return !!cm && (panelRootRef.current?.contains(cm) ?? false)
  }
  const [rightPanelLexiconEntry, setRightPanelLexiconEntry] = useState<string | null>(() => tabState.rightPanelLexiconEntry ?? null)
  const [rightPanelVerseFilter, setRightPanelVerseFilter] = useState<string | null>(() => tabState.rightPanelVerseFilter ?? null)

  useEffect(() => {
    // Use refs so the async callback always reads the latest tab state, not a stale closure.
    // This prevents the redirect-to-first-book firing erroneously when both translation
    // and bookId are updated together (e.g. navigating to "HER 1:1" from a note).
    window.bible.getBooks(textId).then((rawBooks) => {
      const newBooks = rawBooks.map((b) => ({ ...b, name: normalizeBookName(b.name) }))
      setBooks(newBooks)
      const latestTab = activeTabRef.current
      const latestState = tabStateRef.current
      if (newBooks.length > 0 && latestTab && !newBooks.find((b) => b.id === latestState.bookId)) {
        const first = newBooks[0]
        updateTabState('scripture', latestTab.id, { bookId: first.id, chapter: 1, scrollPosition: 0, targetVerse: undefined, endVerse: undefined })
        renameTab('scripture', latestTab.id, `${first.name} 1`)
      }
    }).catch(() => {})
  }, [textId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore scroll position when switching back to a tab or back to the scripture space.
  // ChapterView loads verses asynchronously via IPC, so double-RAF is not enough —
  // we store the desired position in pendingScrollRef and ChapterView calls onVersesLoaded
  // after data arrives, at which point we apply the scroll.
  useEffect(() => {
    const el = chapterViewRef.current
    if (!el) return
    if (activeSpace !== 'scripture') return
    // Reset to top immediately to avoid flash of old position
    el.scrollTop = 0
    pendingScrollRef.current = null
    const savedPos = tabState.scrollPosition ?? 0
    if (savedPos === 0) return
    // Store it — will be applied by onVersesLoaded once ChapterView data arrives
    pendingScrollRef.current = savedPos
  }, [activeSpace, activeTabId['scripture'], tabState.bookId, tabState.chapter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Cancel any pending debounced scroll save when the tab changes.
  // The actual save now happens via berean:saveScrollBeforeTabChange (fired synchronously
  // from the Sidebar before activateTab, so the DOM still holds the old position).
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = null
      }
    }
  }, [activeTabId['scripture']]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save scroll position immediately on unmount (space switch — component unmounts).
  // Guard: only save if scrollTop > 0 to avoid Strict Mode double-invoke writing 0
  // and clobbering the previously-saved valid position.
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      const tab = activeTabRef.current
      const el = chapterViewRef.current
      const pos = el?.scrollTop ?? 0
      const updates: Partial<import('@/types').BibleTabState> = {}
      if (el && pos > 0) updates.scrollPosition = pos
      // Only remember the note cursor (and re-focus on return) if the user was actually
      // typing in the side-panel note editor when they left this tab.
      const noteFocused = isSidePanelNoteFocused()
      updates.rightPanelNoteFocused = noteFocused
      if (noteFocused && lastNoteCursorRef.current != null) updates.rightPanelNoteCursor = lastNoteCursorRef.current
      if (tab) {
        useAppStore.getState().updateTabState('scripture', tab.id, updates)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronously save scroll when Sidebar fires berean:saveScrollBeforeTabChange.
  // This runs BEFORE React processes the activateTab state change, ensuring the
  // scroll container still holds the current tab's position.
  useEffect(() => {
    function onSave() {
      const tab = activeTabRef.current
      const el = chapterViewRef.current
      if (!tab) return
      const updates: Partial<import('@/types').BibleTabState> = {}
      if (el) updates.scrollPosition = el.scrollTop
      const noteFocused = isSidePanelNoteFocused()
      updates.rightPanelNoteFocused = noteFocused
      if (noteFocused && lastNoteCursorRef.current != null) updates.rightPanelNoteCursor = lastNoteCursorRef.current
      useAppStore.getState().updateTabState('scripture', tab.id, updates)
    }
    window.addEventListener('berean:saveScrollBeforeTabChange', onSave)
    return () => window.removeEventListener('berean:saveScrollBeforeTabChange', onSave)
  }, [])

  // Close translation dropdown on outside click; reset filter when it closes
  useEffect(() => {
    if (!translationOpen) { setTranslationFilter(''); return }
    function onDown(e: MouseEvent) {
      if (translationRef.current && !translationRef.current.contains(e.target as Node)) {
        setTranslationOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [translationOpen])

  // Filtered translation list (type-to-filter by label or description)
  const filteredTranslations = useMemo(() => {
    const q = translationFilter.trim().toLowerCase()
    if (!q) return TRANSLATIONS
    return TRANSLATIONS.filter((t) => t.label.toLowerCase().includes(q) || t.description.toLowerCase().includes(q))
  }, [translationFilter])

  // Close info popover on outside click
  useEffect(() => {
    if (!infoOpen) return
    function onDown(e: MouseEvent) {
      if (infoRef.current && !infoRef.current.contains(e.target as Node)) setInfoOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [infoOpen])

  const currentBook = books.find((b) => b.id === tabState.bookId)
  const chapterCount = currentBook?.chapters_count ?? 50

  useEffect(() => {
    if (!activeTab) return
    if (tabState.searchMode) {
      if (activeTab.title !== 'Search') renameTab('scripture', activeTab.id, 'Search')
      return
    }
    if (!currentBook) return
    const title = tabState.endChapter && tabState.endChapter > tabState.chapter
      ? `${currentBook.name} ${tabState.chapter}–${tabState.endChapter}`
      : isHermasBook(tabState.bookId)
        ? `Hermas ${getHermasShortLabel(tabState.bookId, tabState.chapter)}`
        : `${currentBook.name} ${tabState.chapter}`
    if (activeTab.title !== title) renameTab('scripture', activeTab.id, title)
    // Record navigation in history
    useAppStore.getState().addHistoryEntry({
      type: 'bible',
      title,
      bookId: tabState.bookId,
      chapter: tabState.chapter,
      translation: textId,
    })
  }, [tabState.bookId, tabState.chapter, tabState.endChapter, tabState.searchMode, currentBook, activeTab?.id, renameTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for the keyboard shortcut to open the floating scripture search
  useEffect(() => {
    function onOpenFloating() {
      if (activeSpace === 'scripture') setScriptureFloatingOpen(true)
    }
    window.addEventListener('berean:openScriptureSearch', onOpenFloating)
    return () => window.removeEventListener('berean:openScriptureSearch', onOpenFloating)
  }, [activeSpace])

  // ── Strong's scroll-anchor helpers ───────────────────────────────────────
  // Find the topmost verse whose top edge is at or below the container's visible top,
  // then record how far its top edge is from the container's top (the "offset").
  // After the layout reflows (Strong's chips add/remove height), we scroll so that
  // same verse's top edge is back at the same offset — preventing the jump.
  function captureStrongsAnchor() {
    const container = chapterViewRef.current
    if (!container) return
    const containerTop = container.getBoundingClientRect().top
    const verseEls = container.querySelectorAll<HTMLElement>('[data-verse]')
    for (const el of verseEls) {
      const rect = el.getBoundingClientRect()
      if (rect.top >= containerTop - 4) {
        strongsAnchorRef.current = {
          verseNum: parseInt(el.dataset.verse ?? '0', 10),
          offsetPx: rect.top - containerTop,
        }
        return
      }
    }
    strongsAnchorRef.current = null
  }

  function restoreStrongsAnchor() {
    const anchor = strongsAnchorRef.current
    if (!anchor) return
    strongsAnchorRef.current = null
    const container = chapterViewRef.current
    if (!container) return
    // Use double-RAF to ensure the layout (new chip heights) has settled.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>(`[data-verse="${anchor.verseNum}"]`)
      if (!el) return
      const containerTop = container.getBoundingClientRect().top
      const elTop = el.getBoundingClientRect().top
      container.scrollTop += elTop - containerTop - anchor.offsetPx
    }))
  }

  // ── Cmd+G → toggle Strong's numbers ─────────────────────────────────────
  useEffect(() => {
    function onToggleStrongs() {
      const tab = activeTabRef.current
      if (!tab) return
      captureStrongsAnchor()
      const state = tab.state as import('@/types').BibleTabState
      updateTabState('scripture', tab.id, { showStrongs: !state.showStrongs })
    }
    window.addEventListener('berean:toggleStrongs', onToggleStrongs)
    return () => window.removeEventListener('berean:toggleStrongs', onToggleStrongs)
  }, [updateTabState]) // eslint-disable-line react-hooks/exhaustive-deps

  // Restore scroll anchor after the Strong's layout reflow settles
  useEffect(() => {
    restoreStrongsAnchor()
  }, [tabState.showStrongs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Type-anywhere digit → go to verse ────────────────────────────────────
  // Accumulate typed digits and navigate after a short pause.
  const [verseDigitAccum, setVerseDigitAccum] = useState('')
  const verseDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    function onVerseDigit(e: Event) {
      const digit = (e as CustomEvent<{ digit: string }>).detail.digit
      setVerseDigitAccum(prev => {
        const next = prev + digit
        if (verseDigitTimerRef.current) clearTimeout(verseDigitTimerRef.current)
        verseDigitTimerRef.current = setTimeout(() => {
          const verseNum = parseInt(next, 10)
          if (!isNaN(verseNum) && verseNum > 0 && activeTabRef.current) {
            const container = chapterViewRef.current
            if (container) {
              const el = container.querySelector<HTMLElement>(`[data-verse="${verseNum}"]`)
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }
            }
          }
          setVerseDigitAccum('')
        }, 1000)
        return next
      })
    }
    window.addEventListener('berean:verseDigit', onVerseDigit)
    return () => {
      window.removeEventListener('berean:verseDigit', onVerseDigit)
      if (verseDigitTimerRef.current) clearTimeout(verseDigitTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Open note in right panel when triggered from VerseRow
  useEffect(() => {
    if (!pendingRightPanelNoteId) return
    clearRightPanelNote()
    if (floating) return  // no side panel in float windows
    setRightPanelNoteId(pendingRightPanelNoteId)
    setRightPanelVerseFilter(null)
    setRightPanelTab('notes')
    setRightPanelOpen(true)
    if (activeTab) {
      updateTabState('scripture', activeTab.id, {
        rightPanelOpen: true,
        rightPanelTab: 'notes',
        rightPanelNoteId: pendingRightPanelNoteId,
        rightPanelVerseFilter: null,
      })
    }
  }, [pendingRightPanelNoteId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter right panel notes by verse when triggered from VerseRow
  useEffect(() => {
    if (!pendingRightPanelVerseFilter) return
    clearRightPanelVerseFilter()
    if (floating) return  // no side panel in float windows
    setRightPanelVerseFilter(pendingRightPanelVerseFilter)
    setRightPanelNoteId(null)
    setRightPanelTab('notes')
    setRightPanelOpen(true)
    if (activeTab) {
      updateTabState('scripture', activeTab.id, {
        rightPanelOpen: true,
        rightPanelTab: 'notes',
        rightPanelVerseFilter: pendingRightPanelVerseFilter,
        rightPanelNoteId: null,
      })
    }
  }, [pendingRightPanelVerseFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Open cross-refs right panel for a specific verse when triggered from VerseRow
  useEffect(() => {
    if (!pendingRightPanelCrossRefVerse) return
    clearRightPanelCrossRef()
    if (floating) return  // no side panel in float windows
    setRightPanelVerseFilter(pendingRightPanelCrossRefVerse)
    setRightPanelNoteId(null)
    setRightPanelTab('crossrefs')
    setRightPanelOpen(true)
    if (activeTab) {
      updateTabState('scripture', activeTab.id, {
        rightPanelOpen: true,
        rightPanelTab: 'crossrefs',
        rightPanelVerseFilter: pendingRightPanelCrossRefVerse,
        rightPanelNoteId: null,
      })
    }
  }, [pendingRightPanelCrossRefVerse]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync right-panel local state when tabState changes externally (e.g. tab combine drop).
  // We watch the tab ID so that switching to a different tab also restores its panel state.
  // The individual fields guard against overwriting user interactions in the current session.
  const prevTabId = useRef(activeTab?.id)
  useEffect(() => {
    const tabChanged = activeTab?.id !== prevTabId.current
    prevTabId.current = activeTab?.id
    // Only sync if tab changed OR if the new state has rightPanelOpen=true with a specific content.
    // This avoids clobbering panel state the user set via the UI.
    if (tabState.rightPanelOpen && (tabChanged || !rightPanelOpen)) {
      setRightPanelOpen(true)
    }
    if (tabState.rightPanelTab) setRightPanelTab(tabState.rightPanelTab)
    if (tabState.rightPanelNoteId !== undefined) setRightPanelNoteId(tabState.rightPanelNoteId ?? null)
    if (tabState.rightPanelLexiconEntry !== undefined) setRightPanelLexiconEntry(tabState.rightPanelLexiconEntry ?? null)
  }, [tabState.rightPanelOpen, tabState.rightPanelTab, tabState.rightPanelNoteId, tabState.rightPanelLexiconEntry, activeTab?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Find-bar: compute verse match list whenever query or chapter changes ──────
  // We watch the rendered chapter verses to know which ones match.
  // This runs in a useEffect so we can wait for the DOM.
  const findVerses = useCallback((q: string, compareMode: boolean, focusedCol: number, wMode: 'phrase' | 'all' | 'any'): number[] => {
    const container = compareMode
      ? compareColRefs.current[focusedCol]
      : chapterViewRef.current
    if (!q.trim() || !container) return []
    // Build match function based on word mode
    const trimmed = q.trim().toLowerCase()
    let matchFn: (text: string) => boolean
    if (wMode === 'phrase') {
      matchFn = (text) => text.toLowerCase().includes(trimmed)
    } else if (wMode === 'all') {
      const words = trimmed.split(/\s+/).filter(Boolean)
      matchFn = (text) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)) }
    } else {
      // any
      const words = trimmed.split(/\s+/).filter(Boolean)
      matchFn = (text) => { const t = text.toLowerCase(); return words.some((w) => t.includes(w)) }
    }
    const rows = container.querySelectorAll<HTMLElement>('[data-verse]')
    const matches: number[] = []
    rows.forEach((row) => {
      const text = row.querySelector('[data-verse-text]')?.textContent ?? row.textContent ?? ''
      if (matchFn(text)) {
        const vn = parseInt(row.dataset.verse ?? '0', 10)
        if (vn > 0) matches.push(vn)
      }
    })
    return matches
  }, [])

  useEffect(() => {
    if (!findBarOpen || activeSpace !== 'scripture') { setFindMatchVerseNums([]); return }
    const matches = findVerses(findBarQuery, !!tabState.compareMode, compareFocusedCol, findBarWordMode)
    setFindMatchVerseNums(matches)
    setFindMatchIdx(0)
    const container = tabState.compareMode ? compareColRefs.current[compareFocusedCol] : chapterViewRef.current
    if (matches.length > 0 && container) {
      const el = container.querySelector<HTMLElement>(`[data-verse="${matches[0]}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [findBarQuery, findBarOpen, findBarWordMode, activeSpace, tabState.bookId, tabState.chapter, tabState.compareMode, compareFocusedCol]) // eslint-disable-line react-hooks/exhaustive-deps

  function findPrev() {
    if (findMatchVerseNums.length === 0) return
    const prev = (findMatchIdx - 1 + findMatchVerseNums.length) % findMatchVerseNums.length
    setFindMatchIdx(prev)
    const container = tabState.compareMode ? compareColRefs.current[compareFocusedCol] : chapterViewRef.current
    const el = container?.querySelector<HTMLElement>(`[data-verse="${findMatchVerseNums[prev]}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function findNext() {
    if (findMatchVerseNums.length === 0) return
    const next = (findMatchIdx + 1) % findMatchVerseNums.length
    setFindMatchIdx(next)
    const container = tabState.compareMode ? compareColRefs.current[compareFocusedCol] : chapterViewRef.current
    const el = container?.querySelector<HTMLElement>(`[data-verse="${findMatchVerseNums[next]}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function navigate(bookId: string, chapter: number, endChapter?: number) {
    if (!activeTab) return
    const book = books.find((b) => b.id === bookId)
    const title = endChapter
      ? (book ? `${book.name} ${chapter}–${endChapter}` : `${bookId} ${chapter}–${endChapter}`)
      : isHermasBook(bookId)
        ? `Hermas ${getHermasShortLabel(bookId, chapter)}`
        : (book ? `${book.name} ${chapter}` : `${bookId} ${chapter}`)
    updateTabState('scripture', activeTab.id, { bookId, chapter, endChapter, scrollPosition: 0, targetVerse: undefined, endVerse: undefined, noteBack: null, scriptureBack: null })
    renameTab('scripture', activeTab.id, title)
  }

  function prevChapter() {
    if (tabState.endChapter) {
      // In multi-chapter mode, go to previous single chapter
      navigate(tabState.bookId, tabState.chapter - 1)
    } else if (isHermasBook(tabState.bookId)) {
      const prev = getHermasPrevChapter(tabState.bookId, tabState.chapter)
      if (prev !== null) navigate(tabState.bookId, prev)
      // else: already at first Hermas chapter, no cross-book wrap for pseudepigrapha
    } else if (tabState.chapter > 1) {
      navigate(tabState.bookId, tabState.chapter - 1)
    } else {
      const bookIdx = books.findIndex((b) => b.id === tabState.bookId)
      if (bookIdx > 0) { const prev = books[bookIdx - 1]; navigate(prev.id, prev.chapters_count) }
    }
  }

  function nextChapter() {
    if (tabState.endChapter) {
      // In multi-chapter mode, go to next single chapter after the range
      navigate(tabState.bookId, tabState.endChapter + 1)
    } else if (isHermasBook(tabState.bookId)) {
      const next = getHermasNextChapter(tabState.bookId, tabState.chapter)
      if (next !== null) navigate(tabState.bookId, next)
      // else: already at last Hermas chapter
    } else if (tabState.chapter < chapterCount) {
      navigate(tabState.bookId, tabState.chapter + 1)
    } else {
      const bookIdx = books.findIndex((b) => b.id === tabState.bookId)
      if (bookIdx < books.length - 1) navigate(books[bookIdx + 1].id, 1)
    }
  }

  function toggleRightPanel() {
    const next = !rightPanelOpen
    setRightPanelOpen(next)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelOpen: next })
  }

  function handleRightPanelTabChange(tab: 'notes' | 'lexicon' | 'crossrefs') {
    setRightPanelTab(tab)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelTab: tab })
  }

  function handleRightPanelNoteChange(noteId: string | null) {
    setRightPanelNoteId(noteId)
    // A different note is now open — the remembered cursor was for the previous note,
    // so reset it to avoid restoring a stale offset.
    lastNoteCursorRef.current = null
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelNoteId: noteId, rightPanelNoteCursor: null })
  }

  function handleRightPanelNoteCursorChange(pos: number) {
    lastNoteCursorRef.current = pos
  }

  function handleRightPanelLexiconChange(entry: string | null) {
    setRightPanelLexiconEntry(entry)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelLexiconEntry: entry })
  }

  function handleRightPanelVerseFilterChange(filter: string | null) {
    setRightPanelVerseFilter(filter)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelVerseFilter: filter })
  }

  // Called by ChapterView after it finishes loading verses via IPC.
  // At that point the content is in the DOM and we can reliably restore scroll.
  const onVersesLoaded = useCallback(() => {
    const pos = pendingScrollRef.current
    if (!pos || pos === 0) return
    pendingScrollRef.current = null
    const el = chapterViewRef.current
    if (el) {
      el.scrollTop = pos
    }
  }, []) // refs never change identity

  function handleStrongsClick(strongsNum: string) {
    // No side panel in floating windows — skip opening it
    if (!floating) {
      setRightPanelLexiconEntry(strongsNum)
      setRightPanelTab('lexicon')
      setRightPanelOpen(true)
      if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelLexiconEntry: strongsNum, rightPanelTab: 'lexicon', rightPanelOpen: true })
    }
    // Track in history with chain parent = most recent history entry
    const recentId = useAppStore.getState().history[0]?.id
    useAppStore.getState().addHistoryEntry({
      type: 'strongs-click',
      title: strongsNum,
      strongsNum,
      parentId: recentId,
    })
  }

  function handleWordClick(word: string) {
    if (floating) return  // no side panel in float windows
    setRightPanelTab('lexicon')
    setRightPanelOpen(true)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelTab: 'lexicon', rightPanelOpen: true })
    requestLexiconSearch(word)
  }

  // Layout helpers
  // In floating windows, always use 'reading' (full-width, no side panel).
  // This suppresses every panel-embedding layout variant (panel-bottom, notes-top, etc.)
  // without touching the persisted scriptureLayout — the main window restores it on put-back.
  const currentLayout: ScriptureLayout = floating ? 'reading' : (tabState.scriptureLayout ?? defaultScriptureLayout ?? 'standard')
  function setLayout(layout: ScriptureLayout) {
    if (activeTab) updateTabState('scripture', activeTab.id, { scriptureLayout: layout })
  }
  // Horizontal resize drag handle (standard / panel-left / notes-wide / scripture-wide / study-grid / notes-right / lexicon-crossref)
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  function handleResizeMouseDown(e: React.MouseEvent) {
    resizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth }
    e.preventDefault()

    function onMove(e: MouseEvent) {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startX - e.clientX
      setRightPanelWidth(Math.max(200, Math.min(520, resizeRef.current.startWidth + delta)))
    }
    function onUp(e: MouseEvent) {
      if (!resizeRef.current) return
      const delta = resizeRef.current.startX - e.clientX
      const finalWidth = Math.max(200, Math.min(520, resizeRef.current.startWidth + delta))
      setRightPanelWidth(finalWidth)
      if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelWidth: finalWidth })
      resizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Vertical resize drag handle (for bottom panel layouts)
  const vResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  function handleVResizeMouseDown(e: React.MouseEvent) {
    vResizeRef.current = { startY: e.clientY, startHeight: rightPanelWidth }
    e.preventDefault()
    function onMove(e: MouseEvent) {
      if (!vResizeRef.current) return
      const delta = vResizeRef.current.startY - e.clientY
      setRightPanelWidth(Math.max(120, Math.min(480, vResizeRef.current.startHeight + delta)))
    }
    function onUp(e: MouseEvent) {
      if (!vResizeRef.current) return
      const delta = vResizeRef.current.startY - e.clientY
      const finalHeight = Math.max(120, Math.min(480, vResizeRef.current.startHeight + delta))
      setRightPanelWidth(finalHeight)
      if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelWidth: finalHeight })
      vResizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Vertical resize specifically for the lexicon-crossref bottom row height
  const lcResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  function handleLCVResizeMouseDown(e: React.MouseEvent) {
    lcResizeRef.current = { startY: e.clientY, startHeight: bottomPanelHeight }
    e.preventDefault()
    function onMove(e: MouseEvent) {
      if (!lcResizeRef.current) return
      const delta = lcResizeRef.current.startY - e.clientY
      setBottomPanelHeight(Math.max(120, Math.min(520, lcResizeRef.current.startHeight + delta)))
    }
    function onUp(e: MouseEvent) {
      if (!lcResizeRef.current) return
      const delta = lcResizeRef.current.startY - e.clientY
      const finalHeight = Math.max(120, Math.min(520, lcResizeRef.current.startHeight + delta))
      setBottomPanelHeight(finalHeight)
      if (activeTab) updateTabState('scripture', activeTab.id, { bottomPanelHeight: finalHeight })
      lcResizeRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Dedicated search tab — render ONLY ScriptureSearchView (no toolbar) ──────
  if (tabState.searchMode) {
    const isDedicatedSearchTab = activeTab?.id === 'scripture-search-dedicated'
    return (
      <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
        <ScriptureSearchView
          initialQuery={tabState.scriptureSearchQuery}
          persistedState={{
            textId: tabState.searchTextId,
            wordMode: tabState.searchWordMode,
            testamentFilter: tabState.searchTestamentFilter,
            bookFilter: tabState.searchBookFilter,
            sortMode: tabState.searchSortMode,
            scrollTop: tabState.searchScrollTop,
          }}
          onStateChange={(s) => {
            if (activeTab) updateTabState('scripture', activeTab.id, {
              searchTextId: s.textId,
              searchWordMode: s.wordMode,
              searchTestamentFilter: s.testamentFilter,
              searchBookFilter: s.bookFilter,
              searchSortMode: s.sortMode,
              searchScrollTop: s.scrollTop,
            })
          }}
          onNavigate={(bookId, chapter, verse, tid) => {
            if (!activeTab) return
            const newTranslation = tid.toUpperCase()
            const savedQuery = tabState.scriptureSearchQuery ?? ''
            const book = books.find((b) => b.id === bookId)
            const title = isHermasBook(bookId)
              ? `Hermas ${getHermasShortLabel(bookId, chapter)}`
              : book ? `${book.name} ${chapter}` : `${bookId} ${chapter}`
            // Navigate within this tab (search → reader), preserving search state for back button
            updateTabState('scripture', activeTab.id, {
              translation: newTranslation, bookId, chapter, targetVerse: verse,
              scrollPosition: 0, searchMode: false, noteBack: null,
              searchBack: savedQuery ? { query: savedQuery } : null,
            })
            renameTab('scripture', activeTab.id, title)
          }}
          onOpenInNewTab={(bookId, chapter, verse, tid) => {
            const book = books.find((b) => b.id === bookId)
            const title = isHermasBook(bookId)
              ? `Hermas ${getHermasShortLabel(bookId, chapter)}`
              : book ? `${book.name} ${chapter}` : `${bookId} ${chapter}`
            addTab({ id: `bible-${Date.now()}`, spaceId: 'scripture', type: 'bible', title,
              state: { translation: tid.toUpperCase(), bookId, chapter, targetVerse: verse, scrollPosition: 0, showStrongs: false } })
          }}
          onOpenInFloating={(bookId, chapter, verse) => {
            window.app.openFloatingTab('bible', { bookId, chapter: String(chapter), targetVerse: String(verse) })
          }}
          onClose={() => {
            if (isDedicatedSearchTab && activeTab) {
              closeTab('scripture', activeTab.id)
            } else if (activeTab) {
              updateTabState('scripture', activeTab.id, { searchMode: false })
            }
          }}
        />
      </div>
    )
  }

  const isCompareMode = tabState.compareMode || currentLayout === 'compare-notes'

  return (
    <div
      ref={panelRootRef}
      className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]"
      onMouseDown={() => setActivePanelId('bible')}
    >
      {/* Reference bar */}
      <div className={`flex items-center gap-2 py-2 border-b border-[rgb(var(--color-surface-4))] flex-shrink-0 bg-[rgb(var(--color-surface-2))] ${floating ? 'pl-[76px] pr-4 app-drag-region' : 'px-4 app-drag-region'}`}>
        {!isCompareMode && !floating && tabState.noteBack && (
          <button
            onClick={() => {
              requestOpenNote(tabState.noteBack!.noteId)
              ensureTab('note')
              if (activeTab) updateTabState('scripture', activeTab.id, { noteBack: null })
            }}
            title={`Back to "${tabState.noteBack.title}"`}
            className="flex items-center gap-1 text-xs text-[rgb(var(--color-accent))] hover:underline cursor-pointer flex-shrink-0 max-w-[140px] truncate"
          >
            <ArrowLeft size={11} className="flex-shrink-0" />
            <span className="truncate">{tabState.noteBack.title}</span>
          </button>
        )}
        {!isCompareMode && tabState.scriptureBack && (
          <button
            onClick={() => {
              if (!activeTab || !tabState.scriptureBack) return
              const { bookId, chapter, verse } = tabState.scriptureBack
              updateTabState('scripture', activeTab.id, {
                bookId, chapter,
                targetVerse: verse,
                scrollPosition: 0,
                scriptureBack: null,
              })
            }}
            title={`Back to ${tabState.scriptureBack.label}`}
            className="flex items-center gap-1 text-xs text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:underline cursor-pointer flex-shrink-0 max-w-[140px] truncate"
          >
            <ArrowLeft size={11} className="flex-shrink-0" />
            <span className="truncate">{tabState.scriptureBack.label}</span>
          </button>
        )}
        {!isCompareMode && !floating && tabState.searchBack && (
          <button
            onClick={() => {
              if (!activeTab) return
              updateTabState('scripture', activeTab.id, { searchMode: true, searchBack: null })
            }}
            title={`Back to search${tabState.searchBack.query ? `: "${tabState.searchBack.query}"` : ''}`}
            className="flex items-center gap-1 text-xs text-[rgb(var(--color-accent))] hover:underline cursor-pointer flex-shrink-0 max-w-[180px]"
          >
            <ArrowLeft size={11} className="flex-shrink-0" />
            <span className="truncate">
              Search{tabState.searchBack.query ? `: "${tabState.searchBack.query}"` : ' results'}
            </span>
          </button>
        )}
        {isCompareMode ? (
          <button
            onClick={() => compareAddColRef.current?.()}
            title="Add compare panel"
            className="flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/25] cursor-pointer transition-colors font-medium flex-shrink-0"
          >
            <Plus size={12} />
            <span>Add panel</span>
          </button>
        ) : (
          <>
        <BookChapterPicker
          books={books}
          currentBookId={tabState.bookId}
          currentChapter={tabState.chapter}
          onNavigate={navigate}
        />
        <div ref={translationRef} className="relative">
          <button
            onClick={() => setTranslationOpen((v) => !v)}
            className="text-xs font-medium px-2 py-0.5 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-5,var(--color-surface-4)))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer"
          >
            {TRANSLATIONS.find((t) => t.id === textId)?.label ?? tabState.translation.toUpperCase()}
          </button>
          {translationOpen && (
            <div className="absolute top-full left-0 mt-1 z-50 w-[420px] max-h-96 overflow-y-auto bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl py-1">
              {/* Type-to-filter input */}
              <div className="px-2 pb-1 sticky top-0 bg-[rgb(var(--color-surface-1))] z-10">
                <input
                  autoFocus
                  value={translationFilter}
                  onChange={(e) => setTranslationFilter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { setTranslationOpen(false); setTranslationFilter('') }
                    if (e.key === 'Enter' && filteredTranslations.length > 0 && activeTab) {
                      const t = filteredTranslations[0]
                      const mappedChapter = mapChapterOnTranslationSwitch(tabState.bookId, tabState.chapter, textId, t.id)
                      updateTabState('scripture', activeTab.id, {
                        translation: t.id.toUpperCase(),
                        ...(mappedChapter !== tabState.chapter ? { chapter: mappedChapter, scrollPosition: 0, targetVerse: undefined, endVerse: undefined } : {}),
                      })
                      setTranslationOpen(false); setTranslationFilter('')
                    }
                  }}
                  placeholder="Filter translations…"
                  className="w-full text-xs bg-[rgb(var(--color-surface-4))] rounded px-2 py-1.5 outline-none text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
                />
              </div>
              {filteredTranslations.map((t) => (
                <button
                  key={t.id}
                  onClick={() => {
                    if (activeTab) {
                      const mappedChapter = mapChapterOnTranslationSwitch(
                        tabState.bookId,
                        tabState.chapter,
                        textId,           // current translation
                        t.id,             // new translation
                      )
                      updateTabState('scripture', activeTab.id, {
                        translation: t.id.toUpperCase(),
                        ...(mappedChapter !== tabState.chapter ? {
                          chapter: mappedChapter,
                          scrollPosition: 0,
                          targetVerse: undefined,
                          endVerse: undefined,
                        } : {}),
                      })
                    }
                    setTranslationOpen(false)
                  }}
                  className={`flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors cursor-pointer ${
                    textId === t.id
                      ? 'text-[rgb(var(--color-accent))]'
                      : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                  }`}
                >
                  <Check size={12} className={textId === t.id ? 'opacity-100' : 'opacity-0'} />
                  <span className="text-xs font-medium w-20 flex-shrink-0">{t.label}</span>
                  <span className="text-[10px] text-[rgb(var(--color-text-muted))] truncate">{t.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* PDF import / library button */}
        {!floating && (
          <button
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              setPdfPicker({ x: r.left, y: r.bottom + 4 })
            }}
            title="PDF library — import or open a PDF"
            className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-accent))] transition-colors cursor-pointer flex-shrink-0"
          >
            <FileUp size={14} />
          </button>
        )}

        {/* Annotation info button */}
        {ANNOTATION_KEYS[textId] && (
          <div ref={infoRef} className="relative">
            <button
              onClick={() => setInfoOpen((v) => !v)}
              title="Text annotations key"
              className={`p-1 rounded transition-colors cursor-pointer ${infoOpen ? 'text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
            >
              <Info size={13} />
            </button>
            {infoOpen && (
              <div className="absolute top-full left-0 mt-1 z-50 w-72 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden"
                onMouseDown={(e) => e.stopPropagation()}>
                {(() => {
                  const annInfo = ANNOTATION_KEYS[textId]
                  const hidden = tabState.hiddenAnnotations ?? []
                  const allKeys = annInfo?.keys.map(k => k.key) ?? []
                  const allHidden = allKeys.length > 0 && allKeys.every(k => hidden.includes(k))

                  function toggleKey(key: string) {
                    const curr = tabState.hiddenAnnotations ?? []
                    const next = curr.includes(key) ? curr.filter(x => x !== key) : [...curr, key]
                    activeTab && updateTabState('scripture', activeTab.id, { hiddenAnnotations: next })
                  }

                  function toggleAll() {
                    const next = allHidden ? [] : allKeys
                    activeTab && updateTabState('scripture', activeTab.id, { hiddenAnnotations: next })
                  }

                  const hasKeys = (annInfo?.keys.length ?? 0) > 0
                  return (
                    <>
                      <div className="px-3 py-2 border-b border-[rgb(var(--color-surface-4))] flex items-center justify-between">
                        <span className="text-xs font-semibold text-[rgb(var(--color-text-secondary))]">
                          {TRANSLATIONS.find(t => t.id === textId)?.label ?? textId.toUpperCase()} — Annotations
                        </span>
                        {annInfo?.canHide && hasKeys && (
                          <button
                            onClick={toggleAll}
                            className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
                              allHidden
                                ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                                : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'
                            }`}
                          >
                            {allHidden ? <Eye size={10} /> : <EyeOff size={10} />}
                            {allHidden ? 'Show all' : 'Hide all'}
                          </button>
                        )}
                      </div>
                      {/* Source / edition description — shown above annotation keys */}
                      {annInfo?.description && (
                        <p className="px-3 pt-2 pb-1 text-[11px] leading-relaxed text-[rgb(var(--color-text-muted))] italic">
                          {annInfo.description}
                        </p>
                      )}
                      {hasKeys && (
                        <div className={`px-3 space-y-2.5 ${annInfo?.description ? 'pt-1 pb-2 border-t border-[rgb(var(--color-surface-4))]' : 'py-2'}`}>
                          {annInfo?.keys.map((k) => {
                            const isHidden = hidden.includes(k.key)
                            return (
                              <div key={k.key} className="flex gap-2 items-start">
                                <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
                                  {annInfo.canHide && (
                                    <button
                                      onClick={() => toggleKey(k.key)}
                                      title={isHidden ? 'Show this annotation' : 'Hide this annotation'}
                                      className={`cursor-pointer transition-colors ${isHidden ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                                    >
                                      {isHidden ? <EyeOff size={10} /> : <Eye size={10} />}
                                    </button>
                                  )}
                                  <code className={`text-[10px] font-mono px-1.5 py-0.5 rounded text-[rgb(var(--color-text-primary))] ${isHidden ? 'bg-[rgb(var(--color-surface-4))] line-through opacity-50' : 'bg-[rgb(var(--color-surface-4))]'}`}>{k.symbol}</code>
                                </div>
                                <span className={`text-[11px] leading-relaxed ${isHidden ? 'text-[rgb(var(--color-text-muted))] line-through' : 'text-[rgb(var(--color-text-secondary))]'}`}>{k.meaning}</span>
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {!hasKeys && !annInfo?.description && (
                        <p className="px-3 py-2 text-[11px] text-[rgb(var(--color-text-muted))]">No annotation markers in this text.</p>
                      )}
                    </>
                  )
                })()}
              </div>
            )}
          </div>
        )}
          </>
        )}
        {isCompareMode ? null : (
          <>
            <button onClick={prevChapter} className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
              <ChevronLeft size={18} />
            </button>
            <button onClick={nextChapter} className="p-1 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
              <ChevronRight size={18} />
            </button>
          </>
        )}

        <div className="flex-1" />
        {/* Find in chapter (Cmd+F) */}
        <HintTooltip label="Find in chapter" shortcut="⌘F">
        <button
          onClick={() => {
            setActivePanelId('bible')
            if (findBarOpen && activePanelId === 'bible') {
              closeFindBar()
            } else {
              openFindBar(false, '')
            }
          }}
          className={`p-1 rounded transition-colors cursor-pointer ${
            findBarOpen && activePanelId === 'bible'
              ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
              : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
          }`}
        >
          <ScanSearch size={15} />
        </button>
        </HintTooltip>
        {/* Scripture floating search */}
        <HintTooltip label="Search scripture" shortcut="⌘/">
        <button
          onClick={() => { setScriptureFloatingOpen((v) => !v); if (!scriptureFloatingOpen) closeFindBar() }}
          className={`p-1 rounded transition-colors cursor-pointer ${
            scriptureFloatingOpen
              ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
              : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
          }`}
        >
          <SearchIcon size={15} />
        </button>
        </HintTooltip>
        <HintTooltip label="Compare translations">
        <button
          onClick={() => {
            if (activeTab) {
              const turning = !tabState.compareMode
              updateTabState('scripture', activeTab.id, { compareMode: turning })
              if (turning) {
                useAppStore.getState().addHistoryEntry({
                  type: 'compare',
                  title: `Compare — ${activeTab.title}`,
                  bookId: tabState.bookId,
                  chapter: tabState.chapter,
                  translation: textId,
                })
              }
            }
          }}
          className={`p-1 rounded transition-colors cursor-pointer ${
            tabState.compareMode
              ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
              : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
          }`}
        >
          <Columns2 size={15} />
        </button>
        </HintTooltip>
        <HintTooltip label="Toggle Strong's numbers" shortcut="⌘G">
        <button
          onClick={() => { if (!activeTab) return; captureStrongsAnchor(); updateTabState('scripture', activeTab.id, { showStrongs: !tabState.showStrongs }) }}
          className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
            tabState.showStrongs
              ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
              : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'
          }`}
        >
          <Layers size={14} />
          <span>Strong's</span>
        </button>
        </HintTooltip>
        {/* Layout picker — hidden in floating windows (layout is locked to 'reading') */}
        {!floating && (
          <div ref={layoutPickerRef} className="relative">
            <HintTooltip label="Change layout">
            <button
              onClick={() => setLayoutPickerOpen((v) => !v)}
              className={`p-1 rounded transition-colors cursor-pointer ${
                layoutPickerOpen
                  ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                  : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
              }`}
            >
              <LayoutDashboard size={15} />
            </button>
            </HintTooltip>
            {layoutPickerOpen && (
              <LayoutPicker
                current={currentLayout}
                onSelect={setLayout}
                onClose={() => setLayoutPickerOpen(false)}
                defaultLayout={defaultScriptureLayout}
                onSaveDefault={setDefaultScriptureLayout}
              />
            )}
          </div>
        )}
        {/* Toggle right panel — hidden in floating windows (no side panel there) */}
        {!floating && ['standard', 'panel-left', 'notes-wide', 'scripture-wide', 'notes-right'].includes(currentLayout) && (
          <HintTooltip label={rightPanelOpen ? 'Close side panel' : 'Open side panel'}>
          <button
            onClick={toggleRightPanel}
            className={`p-1 rounded transition-colors cursor-pointer ${
              rightPanelOpen
                ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
            }`}
          >
            <PanelRight size={15} />
          </button>
          </HintTooltip>
        )}
      </div>

      {/* Floating scripture search (SearchIcon toolbar button or Cmd+/) */}
      {scriptureFloatingOpen && (
        <ScriptureSearchFloating
          onNavigate={(bookId, chapter, verse, tid) => {
            navigate(bookId, chapter)
            if (activeTab) {
              const newTranslation = tid.toUpperCase()
              updateTabState('scripture', activeTab.id, { targetVerse: verse, translation: newTranslation })
            }
            setScriptureFloatingOpen(false)
          }}
          onAdvancedSearch={(q) => {
            setScriptureFloatingOpen(false)
            openScriptureSearchTab(q)
          }}
          onClose={() => setScriptureFloatingOpen(false)}
          currentTextId={textId}
        />
      )}

      {/* PDF library picker */}
      {pdfPicker && <PdfPicker anchor={pdfPicker} onClose={() => setPdfPicker(null)} />}

      {/* Verse digit overlay — shown while accumulating a type-anywhere verse number */}
      {verseDigitAccum && (
        <div className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl flex items-center gap-2 pointer-events-none select-none">
          <span className="text-xs text-[rgb(var(--color-text-muted))]">Go to verse</span>
          <span className="text-lg font-bold text-[rgb(var(--color-text-primary))] font-mono">{verseDigitAccum}</span>
        </div>
      )}

      {/* Find bar (Cmd+F / type-anywhere) — floating, hidden in search mode */}
      <FindBar
        visible={findBarOpen && activePanelId === 'bible' && !tabState.searchMode}
        query={findBarQuery}
        onQueryChange={setFindBarQuery}
        onClose={closeFindBar}
        matchCount={findMatchVerseNums.length}
        currentMatch={findMatchIdx}
        onPrev={findPrev}
        onNext={findNext}
        autoOpen={findBarAutoOpen}
        showAdvancedSearch={true}
        showWordMode={true}
        wordMode={findBarWordMode}
        onWordModeChange={setFindBarWordMode}
        rightOffset={rightPanelOpen ? rightPanelWidth + 16 : 16}
      />

      {/* Content area — layout-aware */}
      {renderContentArea()}
    </div>
  )

  // ── Layout rendering ─────────────────────────────────────────────────────────

  function renderContentArea() {
    const findQuery = findBarOpen && activePanelId === 'bible' ? findBarQuery : ''

    const findWMode = findBarOpen && activePanelId === 'bible' ? findBarWordMode : 'phrase'

    // Shared scripture view block
    const scriptureView = tabState.compareMode ? (
      <CompareView
        bookId={tabState.bookId}
        chapter={tabState.chapter}
        targetVerse={tabState.targetVerse}
        findQuery={findQuery}
        findWordMode={findWMode}
        onColumnFocus={(idx) => { setCompareFocusedCol(idx); setFindMatchVerseNums([]); setFindMatchIdx(0) }}
        onColumnRef={(idx, el) => { compareColRefs.current[idx] = el }}
        books={books}
        addColRef={compareAddColRef}
      />
    ) : (
      <div
        ref={chapterViewRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          // Capture both values NOW so they survive a tab switch before the timer fires
          const scrollTop = e.currentTarget.scrollTop
          const tabId = activeTabRef.current?.id
          if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
          scrollSaveTimerRef.current = setTimeout(() => {
            if (tabId) updateTabState('scripture', tabId, { scrollPosition: scrollTop })
          }, 150)
        }}
      >
        {tabState.endChapter && tabState.endChapter > tabState.chapter
          ? Array.from({ length: tabState.endChapter - tabState.chapter + 1 }, (_, i) => tabState.chapter + i).map((ch) => (
              <ChapterView
                key={ch}
                bookId={tabState.bookId}
                chapter={ch}
                showStrongs={tabState.showStrongs}
                textId={textId}
                targetVerse={undefined}
                endVerse={undefined}
                hiddenAnnotations={tabState.hiddenAnnotations}
                findQuery={findQuery}
                findWordMode={findWMode}
                onStrongsClick={handleStrongsClick}
                onWordClick={handleWordClick}
                onVersesLoaded={ch === tabState.chapter ? onVersesLoaded : undefined}
              />
            ))
          : (
              <ChapterView
                bookId={tabState.bookId}
                chapter={tabState.chapter}
                showStrongs={tabState.showStrongs}
                textId={textId}
                targetVerse={tabState.targetVerse}
                endVerse={tabState.endVerse}
                hiddenAnnotations={tabState.hiddenAnnotations}
                findQuery={findQuery}
                findWordMode={findWMode}
                onStrongsClick={handleStrongsClick}
                onWordClick={handleWordClick}
                onVersesLoaded={onVersesLoaded}
              />
            )
        }
      </div>
    )

    // Shared right panel (tabs UI)
    const panelEl = (forcedTab?: 'notes' | 'lexicon' | 'crossrefs') => (
      <ErrorBoundary label="Right panel error">
        <BibleRightPanel
          bookId={tabState.bookId}
          chapter={tabState.chapter}
          activeTab={rightPanelTab}
          onTabChange={handleRightPanelTabChange}
          openNoteId={rightPanelNoteId}
          onNoteChange={handleRightPanelNoteChange}
          initialNoteCursor={tabState.rightPanelNoteCursor}
          autoFocusNote={tabState.rightPanelNoteFocused === true}
          onNoteCursorChange={handleRightPanelNoteCursorChange}
          openLexiconEntry={rightPanelLexiconEntry}
          onLexiconEntryChange={handleRightPanelLexiconChange}
          verseFilter={rightPanelVerseFilter}
          onVerseFilterChange={handleRightPanelVerseFilterChange}
          forcedTab={forcedTab}
        />
      </ErrorBoundary>
    )

    const hDivider = (
      <div
        onMouseDown={handleResizeMouseDown}
        className="w-1 flex-shrink-0 cursor-col-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-[rgb(var(--color-surface-4))]"
      />
    )
    const vDivider = (
      <div
        onMouseDown={handleVResizeMouseDown}
        className="h-1 flex-shrink-0 cursor-row-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-[rgb(var(--color-surface-4))]"
      />
    )
    const panelSize = Math.max(160, Math.min(600, rightPanelWidth))

    switch (currentLayout) {
      // ── No side panel ────────────────────────────────────────────────────────
      case 'reading':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
          </div>
        )

      case 'scripture-focus':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0 justify-center bg-[rgb(var(--color-surface-3))]">
            <div className="w-full max-w-3xl overflow-hidden flex flex-col min-h-0 bg-[rgb(var(--color-surface-1))]">
              {scriptureView}
            </div>
          </div>
        )

      // ── Standard (panel right) ───────────────────────────────────────────────
      case 'standard':
      default:
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {rightPanelOpen && (
              <>
                {hDivider}
                <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
                  {panelEl()}
                </div>
              </>
            )}
          </div>
        )

      // ── Panel left ───────────────────────────────────────────────────────────
      case 'panel-left':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            {rightPanelOpen && (
              <>
                <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
                  {panelEl()}
                </div>
                {hDivider}
              </>
            )}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
          </div>
        )

      // ── Notes wide (60/40) ───────────────────────────────────────────────────
      case 'notes-wide':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-[2] overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {rightPanelOpen && (
              <>
                {hDivider}
                <div className="flex-[3] flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))] min-w-0">
                  {panelEl()}
                </div>
              </>
            )}
          </div>
        )

      // ── Scripture wide (65/35) ───────────────────────────────────────────────
      case 'scripture-wide':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-[3] overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {rightPanelOpen && (
              <>
                {hDivider}
                <div className="flex-[1.5] flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))] min-w-0">
                  {panelEl()}
                </div>
              </>
            )}
          </div>
        )

      // ── Notes only right (no tab strip) ─────────────────────────────────────
      case 'notes-right':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {rightPanelOpen && (
              <>
                {hDivider}
                <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
                  {panelEl('notes')}
                </div>
              </>
            )}
          </div>
        )

      // ── Panel bottom (full width) ────────────────────────────────────────────
      case 'panel-bottom':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {vDivider}
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl()}
            </div>
          </div>
        )

      // ── Notes bottom (full width, notes only) ────────────────────────────────
      case 'notes-bottom':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {vDivider}
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl('notes')}
            </div>
          </div>
        )

      // ── Notes top ────────────────────────────────────────────────────────────
      case 'notes-top':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl('notes')}
            </div>
            {vDivider}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
          </div>
        )

      // ── Compare + notes below ────────────────────────────────────────────────
      case 'compare-notes':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">
              <CompareView
                bookId={tabState.bookId}
                chapter={tabState.chapter}
                targetVerse={tabState.targetVerse}
                findQuery={findQuery}
                onColumnFocus={(idx) => { setCompareFocusedCol(idx); setFindMatchVerseNums([]); setFindMatchIdx(0) }}
                onColumnRef={(idx, el) => { compareColRefs.current[idx] = el }}
                books={books}
                addColRef={compareAddColRef}
              />
            </div>
            {vDivider}
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl('notes')}
            </div>
          </div>
        )

      // ── Study grid: Scripture left | Lexicon above / CrossRefs below right ───
      case 'study-grid':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {hDivider}
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 border-b border-[rgb(var(--color-surface-4))]">
                {panelEl('lexicon')}
              </div>
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                {panelEl('crossrefs')}
              </div>
            </div>
          </div>
        )

      // ── 2×2: Scripture TL | Lexicon TR | Notes BL | CrossRefs BR ─────────────
      // Horizontal (right column width) and vertical (bottom row height) resize independently.
      case 'lexicon-crossref': {
        const lcVDivider = (
          <div
            onMouseDown={handleLCVResizeMouseDown}
            className="h-1 flex-shrink-0 cursor-row-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-[rgb(var(--color-surface-4))]"
          />
        )
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Top row */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
              {hDivider}
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
                {panelEl('lexicon')}
              </div>
            </div>
            {lcVDivider}
            {/* Bottom row — height independent from right column width */}
            <div style={{ height: Math.max(120, Math.min(520, bottomPanelHeight)) }} className="flex-shrink-0 flex overflow-hidden">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[rgb(var(--color-surface-2))]">
                {panelEl('notes')}
              </div>
              <div className="w-px bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
                {panelEl('crossrefs')}
              </div>
            </div>
          </div>
        )
      }

      // ── Commentary: Wide notes left | Scripture right ─────────────────────────
      case 'commentary':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl('notes')}
            </div>
            {hDivider}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
          </div>
        )

      // ── Triple column: Notes | Scripture | Lexicon ────────────────────────────
      case 'triple-col':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl('notes')}
            </div>
            {hDivider}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {hDivider}
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
              {panelEl('lexicon')}
            </div>
          </div>
        )

      // ── Split bottom: Scripture top | Notes left + Lexicon right ─────────────
      case 'split-bottom': {
        const sbHeight = Math.max(120, Math.min(520, bottomPanelHeight))
        const sbVDivider = (
          <div
            onMouseDown={handleLCVResizeMouseDown}
            className="h-1 flex-shrink-0 cursor-row-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-[rgb(var(--color-surface-4))]"
          />
        )
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {sbVDivider}
            <div style={{ height: sbHeight }} className="flex-shrink-0 flex overflow-hidden">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 bg-[rgb(var(--color-surface-2))]">
                {panelEl('notes')}
              </div>
              <div className="w-px bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden bg-[rgb(var(--color-surface-2))]">
                {panelEl('lexicon')}
              </div>
            </div>
          </div>
        )
      }
    }
  }
}
