import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Layers, PanelRight, PanelRightDashed, Check, Columns2, Info, Eye, EyeOff, ArrowLeftRight, Search as SearchIcon, LayoutDashboard, Monitor } from 'lucide-react'
import { createPortal, flushSync } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import PdfPicker from '@/components/pdf/PdfPicker'
import { useAppStore } from '@/store'
import ChapterView from './ChapterView'
import ContinuousChapterScroll, { type ContinuousChapterScrollHandle } from './ContinuousChapterScroll'
import CompareView from './CompareView'
import BookChapterPicker from './BookChapterPicker'
import BibleRightPanel from './BibleRightPanel'
import ErrorBoundary from '@/components/shell/ErrorBoundary'
import TabHeaderPortal from '@/components/shell/TabHeaderPortal'
import HeaderOverflowMenu from '@/components/shell/HeaderOverflowMenu'
import ActionPillGroup from '@/components/shell/ActionPillGroup'
import FindBar from '@/components/shell/FindBar'
import ScriptureSearchView from './ScriptureSearchView'
import LayoutPicker from './LayoutPicker'
import { HintTooltip } from '@/components/shell/HintTooltip'
import { computeViewerPayload, setMainBibleScrollPercent } from '@/hooks/useViewerSync'
import { computePresenterBand as computeBandGeometry, measureContentHeight } from '@/lib/presenterBand'
import { computeSelectionRanges, pointToLaser } from '@/lib/presenterOverlay'
import type { Book, BibleTabState, ScriptureLayout } from '@/types'
import type { ViewerVisibleRegion } from '@/types/electron'

import { ANNOTATION_KEYS, TRANSLATIONS, EDITIONS, editionForTextId } from '@/lib/bibleTexts'
import { bookName, normalizeBookName } from '@/lib/parseRef'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import { isHermasBook, getHermasChapterLabel, getHermasShortLabel, getHermasPrevChapter, getHermasNextChapter, hermasVariantForTextId } from '@/lib/hermasMap'
import { hasPrologueChapter } from '@/lib/prologueBooks'

export default function BiblePanel({ floating = false }: { floating?: boolean }) {
  // Narrowed to this panel's own space — subscribing to the whole `tabs` record (all 5 spaces)
  // meant a tab-state write in ANY space (scroll position, panel resize, YouTube layout, etc.)
  // re-rendered this component too, since the store replaces the whole record's reference on
  // every per-space write. `tabs.scripture`'s own reference only changes when scripture's own
  // array actually changes, so this only re-renders on writes that are actually relevant here.
  const tabs = useAppStore((s) => s.tabs.scripture)
  const activeTabId = useAppStore((s) => s.activeTabId.scripture)
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
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
  const openSearch = useAppStore((s) => s.openSearch)
  const closeTab = useAppStore((s) => s.closeTab)
  const defaultScriptureLayout = useAppStore((s) => s.defaultScriptureLayout)
  const setDefaultScriptureLayout = useAppStore((s) => s.setDefaultScriptureLayout)
  const viewerWindowOpen = useAppStore((s) => s.viewerWindowOpen)
  const viewerPaused = useAppStore((s) => s.viewerPaused)
  // Anything that can reflow verse layout in THIS panel without changing the
  // scroll container's own box size (so the ResizeObserver below won't catch
  // it — it only fires on the observed element's own content-box resizing,
  // not a descendant's internal reflow from a font-size change) must be an
  // explicit dep of the recompute effect, or the outline band silently goes
  // stale until the next unrelated scroll event happens to force a refresh.
  const bibleFontSize = useAppStore((s) => s.bibleFontSize)
  const appZoom = useAppStore((s) => s.appZoom)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const idiomHighlightEnabled = useAppStore((s) => s.idiomHighlightEnabled)
  // Region of scripture currently visible in the presenter window (for the outline band)
  const [viewerVisibleRegion, setViewerVisibleRegion] = useState<ViewerVisibleRegion | null>(null)
  const [presenterBand, setPresenterBand] = useState<{ top: number; height: number; firstVerse: number | null; lastVerse: number | null } | null>(null)
  const laserRAFRef = useRef<number | null>(null)
  const selectionRAFRef = useRef<number | null>(null)
  const lastSelectionSentRef = useRef(false)
  // Laser dwell: move freely within the committed word, but require a brief settle before
  // committing to a different word (so the pointer doesn't dart between words too eagerly).
  const lastLaserWordRef = useRef<string | null>(null)
  const pendingLaserWordRef = useRef<string | null>(null)
  const pendingLaserRef = useRef<{ bookId: string; chapter: number; laser: import('@/lib/presenterOverlay').OverlayLaser } | null>(null)
  const laserDwellTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // While a find-bar jump is in flight, suppress proportional scroll sync so the explicit
  // "center this verse" command drives the presenter cleanly (no tug-of-war).
  const findScrollSuppressRef = useRef(0)
  // The verse the presenter is currently centered on via a find-bar jump (null when the
  // presenter is mirroring the main panel proportionally). While set, the outline band is
  // computed from this verse's centered position instead of the main panel's scroll percent.
  const findCenterVerseRef = useRef<number | null>(null)
  // Virtual scroll percent for driving the presenter via the wheel when the main panel's
  // content fits entirely (so there's no real scroll to mirror).
  const virtualScrollPctRef = useRef(0)

  // ── Find bar (Cmd+F / type-anywhere) ────────────────────────────────────────
  const findBarOpen = useAppStore((s) => s.findBarOpen)
  const findBarQuery = useAppStore((s) => s.findBarQuery)
  const findBarAutoOpen = useAppStore((s) => s.findBarAutoOpen)
  const findBarWordMode = useAppStore((s) => s.findBarWordMode)
  const closeFindBar = useAppStore((s) => s.closeFindBar)
  const setFindBarQuery = useAppStore((s) => s.setFindBarQuery)
  const setFindBarWordMode = useAppStore((s) => s.setFindBarWordMode)
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activePanelId = useAppStore((s) => s.activePanelId)

  // Escape closes the find bar even when focus isn't inside its own input — FindBar.tsx
  // already handles Escape on its input's onKeyDown, but the auto-open ("type anywhere")
  // path can leave focus somewhere else (e.g. the triggering keystroke landed in the
  // verse view before the bar mounted/refocused), so that per-input handler alone doesn't
  // reliably cover every case. This is a document-level backstop that always works
  // regardless of what currently has focus.
  useEffect(() => {
    if (!findBarOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') closeFindBar()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [findBarOpen, closeFindBar])
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)

  // Verse-match state — populated when findBarQuery is non-empty
  const [findMatchVerseNums, setFindMatchVerseNums] = useState<number[]>([])
  const [findMatchIdx, setFindMatchIdx] = useState(0)
  const chapterViewRef = useRef<HTMLDivElement>(null)
  const continuousScrollRef = useRef<ContinuousChapterScrollHandle | null>(null)
  // Holds the in-flight Strong's-toggle view transition (if any) — see toggleStrongsForTab.
  const pendingStrongsTransitionRef = useRef<{ finished: Promise<unknown>; skipTransition: () => void } | null>(null)
  const continuousChapterScroll = useAppStore((s) => s.continuousChapterScroll)
  const scrollSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const searchTabRenameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewerScrollRAFRef = useRef<number | null>(null)
  // Stores a scroll position to apply after ChapterView finishes loading its verses async.
  // The double-RAF approach is insufficient because IPC data arrives much later than 2 frames.
  const pendingScrollRef = useRef<number | null>(null)
  // Stores the top-visible verse anchor before a Strong's toggle or KJV/LXX switch so the
  // same verse stays visible at roughly the same screen position after the layout reflows.
  const strongsAnchorRef = useRef<{ verseNum: number; offsetPx: number } | null>(null)
  // Briefly highlights the anchor verse right after it's restored, so the eye has an
  // obvious landing point confirming "you're still here" through the Strong's/KJV-LXX
  // reflow — see ChapterView's flashAnchor prop. A fresh nonce re-triggers the flash even
  // when it's the same verse number as the previous toggle.
  const [flashAnchor, setFlashAnchor] = useState<{ verse: number; nonce: number } | null>(null)
  // Compare-mode column tracking
  const [compareFocusedCol, setCompareFocusedCol] = useState(0)
  const compareColRefs = useRef<(HTMLDivElement | null)[]>([])
  // Layout picker popover — now opened from the overflow menu (see items
  // below), so its anchor is computed from that trigger row's own rect
  // rather than a fixed inline button.
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false)
  const [layoutPickerAnchor, setLayoutPickerAnchor] = useState<{ left: number; top: number } | null>(null)
  // "Add panel" pickers didn't previously pass BookChapterPicker's editions/currentTextId/
  // onSelectTranslation props at all, even though the picker component already supports them
  // (the main reading picker below does) — so there was simply no UI to pick a different
  // edition when adding a compare panel; it silently always used the current tab's edition.
  const [addPanelTextId, setAddPanelTextId] = useState<string | null>(null)
  // Compare mode — ref exposed to CompareView so the + button can add columns
  const compareAddColRef = useRef<((target?: { bookId: string; chapter: number; textId?: string }) => void) | null>(null)
  // When "Add panel" is used to enter compare from a normal tab, the picked ref is parked
  // here so the freshly-mounted CompareView can add it as a column.
  const pendingComparePanelRef = useRef<{ bookId: string; chapter: number; textId?: string } | null>(null)


  const activeTab = tabs.find((t) => t.id === activeTabId)
  const tabState = (activeTab?.state ?? {
    bookId: 'GEN', chapter: 1, translation: 'KJVA', showStrongs: false, scrollPosition: 0
  }) as BibleTabState

  const textId = (tabState.translation ?? 'KJVA').toLowerCase()
  const [books, setBooks] = useState<Book[]>([])
  // Book ids present in the KJVA<->LXX counterpart edition, used to decide whether the
  // quick KJV/LXX switch button applies to the CURRENT book (not just OT books — many
  // Apocrypha books like Sirach exist in both editions too).
  const [counterpartBookIds, setCounterpartBookIds] = useState<Set<string>>(new Set())
  const [pdfPicker, setPdfPicker] = useState<{ x: number; y: number } | null>(null)
  const [infoOpen, setInfoOpen] = useState(false)
  const infoRef = useRef<HTMLButtonElement>(null)
  const infoPanelRef = useRef<HTMLDivElement>(null)
  // Fixed-position anchor for the portaled panel — computed from the trigger button's rect on
  // open, since the panel is portaled to document.body (see the button's onClick below for why).
  const [infoPos, setInfoPos] = useState<{ x: number; y: number } | null>(null)
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

  // Load the counterpart edition's book ids so the quick KJV/LXX switch button only shows
  // for books that actually exist in the target edition (this mirrors the availability check
  // in selectPickerTranslation, so the button never offers a switch that would just bounce
  // the user to the target's first book).
  useEffect(() => {
    const counterpart = textId === 'kjva' ? 'lxx' : textId === 'lxx' ? 'kjva' : null
    if (!counterpart) { setCounterpartBookIds(new Set()); return }
    window.bible.getBooks(counterpart)
      .then((bks) => setCounterpartBookIds(new Set((bks as Book[]).map((b) => b.id))))
      .catch(() => setCounterpartBookIds(new Set()))
  }, [textId])

  // Restore scroll position when switching back to a tab or back to the scripture space.
  // ChapterView loads verses asynchronously via IPC, so double-RAF is not enough —
  // we store the desired position in pendingScrollRef and ChapterView calls onVersesLoaded
  // after data arrives, at which point we apply the scroll.
  useEffect(() => {
    if (continuousChapterScroll) return  // continuous mode is handled by the effect below instead
    const el = chapterViewRef.current
    if (!el) return
    if (activeSpace !== 'scripture') return
    // Read targetVerse via the ref, NOT tabState.targetVerse directly, and deliberately do NOT
    // list it as a dependency below — confirmed regression: when it WAS a dependency, this
    // effect refired the instant ChapterView cleared targetVerse after a successful scroll
    // (onTargetVerseConsumed), and the unconditional `el.scrollTop = 0` a few lines down wiped
    // out that scroll immediately after it landed. Reading the ref instead still lets this
    // effect make the right call using the CURRENT targetVerse value when a genuine navigation
    // (book/chapter/tab/space change) fires it, without also firing on the pure consumption.
    const hasTargetVerse = !!tabStateRef.current?.targetVerse
    // TEMPORARY DIAGNOSTIC — remove once the scroll-to-verse bug is confirmed fixed.
    console.warn('[BereanDebug] scroll-restore effect fired, resetting scrollTop=0', { hasTargetVerse, targetVerse: tabStateRef.current?.targetVerse, bookId: tabState.bookId, chapter: tabState.chapter })
    // Reset to top immediately to avoid flash of old position
    el.scrollTop = 0
    // Reset the mirrored scroll percent so the presenter doesn't briefly apply the previous
    // chapter's position to a freshly-loaded chapter before the new scroll fires — EXCEPT
    // when a specific targetVerse is pending (e.g. a search-navigation): forcing
    // scrollPercent to 0 here would tell the viewer "jump to top of chapter," permanently
    // pre-empting its own verse-centering path (ViewerBiblePage.tsx only takes that path
    // when scrollPercent is undefined) before this window's own targetVerse-scroll (fired
    // later, once ChapterView's data loads) ever gets a chance to run. Leaving the scroll
    // percent/chapterKey stale here makes computeViewerPayload() report `undefined` for
    // this chapter, so the viewer centers on `verse` instead — see useViewerSync.ts.
    if (!hasTargetVerse) {
      setMainBibleScrollPercent(0, `${tabState.bookId}:${tabState.chapter}`)
    }
    virtualScrollPctRef.current = 0
    pendingScrollRef.current = null
    // A pending targetVerse owns scrolling for this load (see the scroll-to-verse effect in
    // ChapterView.tsx) — restoring the old saved scrollPosition here would fight it. Some
    // navigation paths that set targetVerse don't also clear scrollPosition, so this guard
    // is the actual fix; onVersesLoaded has a second backstop check for the same reason.
    if (hasTargetVerse) return
    const savedPos = tabState.scrollPosition ?? 0
    if (savedPos === 0) return
    // Store it — will be applied by onVersesLoaded once ChapterView data arrives
    pendingScrollRef.current = savedPos
  }, [activeSpace, activeTabId, tabState.bookId, tabState.chapter, continuousChapterScroll]) // eslint-disable-line react-hooks/exhaustive-deps

  // Continuous Chapter Scroll's own equivalent of the effect above, deliberately NOT keyed
  // on tabState.chapter: ContinuousChapterScroll calls onChapterChange (updating
  // tabState.chapter) continuously as the user scrolls past chapter headings, so reusing
  // the same chapter-keyed effect here would reset scrollTop to 0 on every chapter boundary
  // crossed during ordinary scrolling. Keying only on the tab/space switch itself restores
  // the saved position once, without fighting the user's own scrolling. An earlier version
  // had no continuous-mode handling at all, so scroll position was silently dropped on every
  // tab switch while Continuous Chapter Scroll was enabled.
  useEffect(() => {
    if (!continuousChapterScroll) return
    if (activeSpace !== 'scripture') return
    pendingScrollRef.current = null
    const savedPos = tabState.scrollPosition ?? 0
    if (savedPos === 0) return
    pendingScrollRef.current = savedPos
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpace, activeTabId, continuousChapterScroll])

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
  }, [activeTabId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Presenter visible-region outline ─────────────────────────────────────────
  // Subscribe to the presenter's visible fraction (changes only on its load/zoom/resize).
  useEffect(() => {
    if (floating) return
    if (typeof window.app.onViewerVisibleRegion !== 'function') {
      console.warn('[Presenter outline] onViewerVisibleRegion missing from preload — restart the app')
      return
    }
    window.app.onViewerVisibleRegion((region) => {
      const r = region as ViewerVisibleRegion
      // Compare-view columns carry a colIndex — route those to CompareView via an event.
      if (r.colIndex !== undefined) { window.dispatchEvent(new CustomEvent('berean:compareRegion', { detail: r })); return }
      setViewerVisibleRegion(r)
    })
  }, [floating])

  // ActivePanel.tsx keys the active tab's panel by tab id, so switching
  // scripture tabs (even to a different tab already on the SAME chapter)
  // fully unmounts and remounts this BiblePanel instance — wiping the local
  // viewerVisibleRegion/presenterBand state above. The viewer only re-fires
  // its own report when bookId/chapter/textId actually change (see
  // ViewerBiblePage.tsx's reportVisible deps), so a same-chapter tab switch,
  // or unpausing without ever changing chapters, previously left this fresh
  // mount with no region and a permanently blank outline. Explicitly
  // request one on mount and on every chapter change instead of relying on
  // the viewer's own content-change detection to happen to fire.
  useEffect(() => {
    if (floating || !viewerWindowOpen || viewerPaused) return
    window.app.requestViewerVisibleRegion?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating, viewerWindowOpen, viewerPaused, tabState.bookId, tabState.chapter])

  // Compute the band by anchoring the presenter's visible window on shared verse positions,
  // combined with this panel's OWN live scroll position. Accurate across different window
  // sizes / zoom / wrapping, and updates instantly while scrolling (no IPC round-trip).
  const computePresenterBand = useCallback(() => {
    const region = viewerVisibleRegion
    const c = getScrollEl()
    if (floating || !viewerWindowOpen || !region || !c) { setPresenterBand(null); return }
    if (region.bookId !== tabState.bookId || region.chapter !== tabState.chapter) { setPresenterBand(null); return }
    const f = region.visibleFraction
    if (!(f > 0) || c.scrollHeight <= 0) { setPresenterBand(null); return }

    // Measure this panel's verse content-tops live (cheap for one chapter) so the band can
    // never drift from a stale layout cache.
    const cTop = c.getBoundingClientRect().top
    const tops: Record<number, number> = {}
    let contentBottom = 0
    for (const node of Array.from(c.querySelectorAll('[data-verse]'))) {
      const elx = node as HTMLElement
      const n = Number(elx.dataset.verse)
      if (!Number.isFinite(n)) continue
      const r = elx.getBoundingClientRect()
      tops[n] = r.top - cTop + c.scrollTop
      const bottom = r.bottom - cTop + c.scrollTop
      if (bottom > contentBottom) contentBottom = bottom
    }
    // Use content height (last verse bottom), matching the presenter's reporting, so the band
    // doesn't extend into the empty space below the last verse on short chapters. Shared
    // measureContentHeight helper (not a locally re-typed "+ 4") so this can't independently
    // drift from ViewerBiblePage.tsx's own copy of the same measurement.
    const mainH = measureContentHeight(c.scrollHeight, contentBottom)

    const fits = c.scrollHeight - c.clientHeight <= 0
    // When a find-bar jump has centered a verse in the presenter, the presenter is NOT
    // mirroring the main panel proportionally — so derive the scroll percent from where that
    // verse sits, centered, in the presenter's content (otherwise the band lands mid-verse).
    let scrollPercentOverride = fits ? virtualScrollPctRef.current : undefined
    const fv = findCenterVerseRef.current
    if (fv != null && f < 1) {
      const vf = region.verseFracs[fv]
      if (vf != null) scrollPercentOverride = Math.max(0, Math.min(1, (vf - f / 2) / (1 - f)))
    }
    setPresenterBand(computeBandGeometry({
      visibleFraction: f,
      verseFracs: region.verseFracs,
      mainTops: tops,
      mainScrollHeight: mainH,
      mainClientHeight: c.clientHeight,
      mainScrollTop: c.scrollTop,
      scrollPercentOverride,
    }))
  }, [floating, viewerWindowOpen, viewerVisibleRegion, tabState.bookId, tabState.chapter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Presenter "send to view" push — triggered by the shared top bar's presenter button
  // (TopBar.tsx) via presenterPushToken, since the scroll-position capture below depends
  // on getScrollEl()/tabState which only this panel has access to. Skips the initial
  // mount so opening a Bible tab doesn't push to an already-open viewer unprompted.
  const presenterPushToken = useAppStore((s) => s.presenterPushToken)
  const presenterPushMounted = useRef(false)
  useEffect(() => {
    if (!presenterPushMounted.current) { presenterPushMounted.current = true; return }
    if (floating) return
    const container = getScrollEl()
    if (container) {
      const max = container.scrollHeight - container.clientHeight
      setMainBibleScrollPercent(max > 0 ? container.scrollTop / max : 0, `${tabState.bookId}:${tabState.chapter}`)
    }
    const payload = computeViewerPayload()
    window.app.pushViewerContent?.(payload)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presenterPushToken])

  // Recompute on fraction/chapter/layout change, and when live-sync resumes (viewerPaused →
  // false) so the outline reappears after pausing + switching tabs. Also recomputes on
  // anything that reflows verse text in this panel WITHOUT resizing the scroll container's
  // own box (reading zoom, font size, word-replacer, idiom highlighting) — the ResizeObserver
  // below can't see those, since it only observes the container's own content-box, not a
  // descendant's internal reflow driven purely by a font-size change.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (!useAppStore.getState().viewerPaused) computePresenterBand()
    })
    return () => cancelAnimationFrame(raf)
  }, [computePresenterBand, viewerPaused, tabState.showStrongs, tabState.hiddenAnnotations, bibleFontSize, appZoom, wordReplacerEnabled, wordReplacerRules, idiomHighlightEnabled])

  // Recompute on any size change of the SCROLL CONTAINER'S OWN box — covers real window
  // resizes and panel-layout changes (e.g. opening the right panel). Does NOT catch pure
  // content reflow from a font-size change (reading zoom, bibleFontSize, word-replacer,
  // idiom highlighting) — a ResizeObserver on this element only fires when its own
  // content-box changes, not a descendant's; those are covered explicitly as deps on the
  // effect above instead.
  useEffect(() => {
    if (floating) return
    const el = getScrollEl()
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!useAppStore.getState().viewerPaused) computePresenterBand()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [floating, computePresenterBand, continuousChapterScroll]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Overlay capture (selection mirror + laser pointer) ───────────────────────
  // The presenter shows the active scripture tab's chapter; read it live to avoid stale closures.
  const currentBibleChapterRef = () => {
    const s = useAppStore.getState()
    const id = s.activeTabId['scripture']
    const t = id ? s.tabs['scripture'].find((x) => x.id === id) : null
    const bs = t?.state as BibleTabState | undefined
    return bs?.bookId ? { bookId: bs.bookId, chapter: bs.chapter } : null
  }
  const canPushOverlay = () => {
    const s = useAppStore.getState()
    return !floating && s.viewerWindowOpen && !s.viewerPaused
  }

  // Mirror the user's text selection into the presenter.
  useEffect(() => {
    if (floating) return
    function clearMirror(ref: { bookId: string; chapter: number }) {
      if (lastSelectionSentRef.current) {
        window.app.pushViewerOverlay?.({ ...ref, selection: null })
        lastSelectionSentRef.current = false
      }
    }
    function onSelChange() {
      const c = getScrollEl()
      if (!c || !canPushOverlay()) return
      const ref = currentBibleChapterRef()
      if (!ref) return
      if (!useAppStore.getState().viewerSelectionMirror) { clearMirror(ref); return }
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) { clearMirror(ref); return }
      const range = sel.getRangeAt(0)
      let inside = false
      try { inside = c.contains(range.commonAncestorContainer) || range.intersectsNode(c) } catch { inside = false }
      if (!inside) { clearMirror(ref); return } // selection moved to a note / elsewhere
      if (selectionRAFRef.current) cancelAnimationFrame(selectionRAFRef.current)
      selectionRAFRef.current = requestAnimationFrame(() => {
        const ranges = computeSelectionRanges(c, range)
        window.app.pushViewerOverlay?.({ ...ref, selection: ranges.length ? ranges : null })
        lastSelectionSentRef.current = ranges.length > 0
      })
    }
    document.addEventListener('selectionchange', onSelChange)
    return () => document.removeEventListener('selectionchange', onSelChange)
  }, [floating]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save scroll position immediately on unmount (space switch — component unmounts).
  // Guard: only save if scrollTop > 0 to avoid Strict Mode double-invoke writing 0
  // and clobbering the previously-saved valid position.
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
      if (searchTabRenameTimerRef.current) clearTimeout(searchTabRenameTimerRef.current)
      const tab = activeTabRef.current
      const el = getScrollEl()
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
      const el = getScrollEl()
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

  // Switch the active text. A switch within the SAME edition (e.g. Hermas Roberts-Donaldson
  // ↔ Charles Taylor) keeps the book/chapter/verse; a switch to a DIFFERENT edition keeps the
  // current book if the target has it, otherwise navigates to the target's first book.
  function selectPickerTranslation(tid: string) {
    if (!activeTab) return
    const tgtEdition = editionForTextId(tid)
    const curEdition = editionForTextId(textId)
    if (tgtEdition && curEdition && tgtEdition.id === curEdition.id) {
      if (tid === 'hermas' || tid === 'hermas_taylor') useAppStore.getState().setHermasTranslation(tid)
      else updateTabState('scripture', activeTab.id, { translation: tid.toUpperCase() })
      return
    }
    const mappedChapter = mapChapterOnTranslationSwitch(tabState.bookId, tabState.chapter, textId, tid)
    window.bible.getBooks(tid).then((bks) => {
      const hasBook = (bks as Book[]).some((b) => b.id === tabState.bookId)
      if (hasBook) {
        // Always reset scroll position on an edition switch — even when the chapter number
        // is unchanged (e.g. KJVA <-> LXX Genesis 3), the two editions can have a different
        // verse layout, so carrying over the old pixel offset lands on the wrong verse.
        updateTabState('scripture', activeTab.id, {
          translation: tid.toUpperCase(),
          chapter: mappedChapter,
          scrollPosition: 0,
          targetVerse: undefined,
          endVerse: undefined,
        })
      } else {
        const first = (bks as Book[])[0]
        updateTabState('scripture', activeTab.id, first
          ? { translation: tid.toUpperCase(), bookId: first.id, chapter: 1, scrollPosition: 0, targetVerse: undefined, endVerse: undefined }
          : { translation: tid.toUpperCase() })
      }
    }).catch(() => updateTabState('scripture', activeTab.id, { translation: tid.toUpperCase() }))
  }

  // Close info popover on outside click — checks both the trigger button AND the portaled
  // panel content (see infoPanelRef below), since portaling the panel to document.body means
  // it's no longer a DOM descendant of infoRef for .contains() purposes.
  useEffect(() => {
    if (!infoOpen) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (infoRef.current?.contains(t)) return
      if (infoPanelRef.current?.contains(t)) return
      setInfoOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [infoOpen])

  const currentBook = books.find((b) => b.id === tabState.bookId)
  const chapterCount = currentBook?.chapters_count ?? 50

  // Returns the active scroll container regardless of mode (normal vs continuous scroll)
  function getScrollEl(): HTMLDivElement | null {
    return continuousChapterScroll ? (continuousScrollRef.current?.getScrollEl() ?? null) : chapterViewRef.current
  }

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
        ? `Hermas ${getHermasShortLabel(tabState.bookId, tabState.chapter, hermasVariantForTextId(textId))}`
        : `${currentBook.name} ${tabState.chapter}`
    if (activeTab.title !== title) renameTab('scripture', activeTab.id, title)
    // Record navigation in history — the entry's own title gets a ":verse" suffix when a
    // specific verse was targeted (e.g. from search), distinct from the tab title (which
    // intentionally stays chapter-level).
    const historyTitle = tabState.targetVerse && !(tabState.endChapter && tabState.endChapter > tabState.chapter)
      ? `${title}:${tabState.targetVerse}`
      : title
    useAppStore.getState().addHistoryEntry({
      type: 'bible',
      title: historyTitle,
      bookId: tabState.bookId,
      chapter: tabState.chapter,
      verse: tabState.targetVerse,
      translation: textId,
    })
    // Per-tab back/forward stack (Cmd+[ / Cmd+]) — Notes/Lexicon already push
    // onto this on every real navigation; the Scripture tab never did, so
    // Cmd+[ from a Bible tab was a no-op regardless of how you got there
    // (including the now-removed "← Search: ..." pill's own back button,
    // which was the ONLY way back for that specific case).
    // translation must be UPPERCASE here (textId is lowercased for DB lookups) —
    // updateTabState's own internal auto-push (store/index.ts) already pushes a
    // nav entry for bookId/chapter changes using the uppercase `tabState.translation`
    // convention. If this push used lowercase `textId` instead, the two entries for
    // the same navigation would differ only in translation casing, defeating
    // pushTabNav's dedup check (top.translation === full.translation) and leaving a
    // spurious duplicate entry in the stack — confirmed bug: every chapter nav (most
    // visibly landing on a verse from Advanced Search) required an extra back-press
    // to skip past the duplicate before reaching the previous real entry.
    useAppStore.getState().pushTabNav(activeTab.id, {
      type: 'bible',
      title,
      bookId: tabState.bookId,
      chapter: tabState.chapter,
      translation: textId.toUpperCase(),
    })
  }, [tabState.bookId, tabState.chapter, tabState.endChapter, tabState.searchMode, currentBook, activeTab?.id, renameTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Record a verse-level history entry when a search navigates to a specific verse WITHIN
  // an already-open chapter — the effect above only re-runs on book/chapter changes, so a
  // verse-only jump (e.g. searching a different verse in the same chapter) never recorded
  // anything. Deliberately does NOT fire when targetVerse clears back to undefined (that
  // happens right after the scroll consumes it — see onTargetVerseConsumed callers), which
  // would otherwise write a spurious duplicate entry for the same chapter with no verse. When
  // a search also changes chapter, the effect above already records the correct verse (it
  // reads tabState.targetVerse directly), and the store's own last-entry dedup silently drops
  // this effect's identical follow-up write.
  const lastVerseRecordRef = useRef<{ bookId: string; chapter: number; verse: number } | null>(null)
  useEffect(() => {
    if (!activeTab || !currentBook || tabState.searchMode) return
    if (tabState.targetVerse == null) return
    const last = lastVerseRecordRef.current
    if (last && last.bookId === tabState.bookId && last.chapter === tabState.chapter && last.verse === tabState.targetVerse) return
    lastVerseRecordRef.current = { bookId: tabState.bookId, chapter: tabState.chapter, verse: tabState.targetVerse }
    const title = tabState.endChapter && tabState.endChapter > tabState.chapter
      ? `${currentBook.name} ${tabState.chapter}–${tabState.endChapter}`
      : isHermasBook(tabState.bookId)
        ? `Hermas ${getHermasShortLabel(tabState.bookId, tabState.chapter, hermasVariantForTextId(textId))}`
        : `${currentBook.name} ${tabState.chapter}`
    useAppStore.getState().addHistoryEntry({
      type: 'bible',
      title: `${title}:${tabState.targetVerse}`,
      bookId: tabState.bookId,
      chapter: tabState.chapter,
      verse: tabState.targetVerse,
      translation: textId,
    })
  }, [tabState.targetVerse, tabState.bookId, tabState.chapter, tabState.endChapter, tabState.searchMode, currentBook, activeTab?.id, textId])

  // ── Strong's scroll-anchor helpers ───────────────────────────────────────
  // Find the topmost verse whose top edge is at or below the container's visible top,
  // then record how far its top edge is from the container's top (the "offset").
  // After the layout reflows (Strong's chips add/remove height), we scroll so that
  // same verse's top edge is back at the same offset — preventing the jump.
  function captureStrongsAnchor() {
    const container = getScrollEl()
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
    const container = getScrollEl()
    if (!container) return
    // Use double-RAF to ensure the layout (new chip heights) has settled.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = container.querySelector<HTMLElement>(`[data-verse="${anchor.verseNum}"]`)
      if (!el) return
      const containerTop = container.getBoundingClientRect().top
      const elTop = el.getBoundingClientRect().top
      container.scrollTop += elTop - containerTop - anchor.offsetPx
      setFlashAnchor({ verse: anchor.verseNum, nonce: Date.now() })
    }))
  }

  // Toggling Strong's swaps the verse rows to/from an entirely different DOM structure
  // (stacked word+chip vs. plain inline text — see VerseRow.tsx), so there's no shared
  // layout to CSS-transition between. The View Transitions API sidesteps that: it
  // screenshots the before/after DOM and crossfades between them regardless of how
  // different the structure is, turning the previous instant jump into a smooth
  // ~250ms crossfade. flushSync forces the state update (and its re-render) to commit
  // synchronously inside the callback, so the "after" snapshot the browser captures is
  // the real new layout rather than a stale one taken before React re-rendered.
  function toggleStrongsForTab(tabId: string, next: boolean) {
    captureStrongsAnchor()
    const apply = () => updateTabState('scripture', tabId, { showStrongs: next })
    if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
      // A still-running transition from a rapid previous toggle would otherwise race this
      // one for the same named chapter element(s) — skip it first so only the latest wins.
      pendingStrongsTransitionRef.current?.skipTransition()
      const vt = document.startViewTransition(() => flushSync(apply))
      pendingStrongsTransitionRef.current = vt
      vt.finished.finally(() => { if (pendingStrongsTransitionRef.current === vt) pendingStrongsTransitionRef.current = null })
    } else {
      apply()
    }
  }

  // ── Cmd+G → toggle Strong's numbers ─────────────────────────────────────
  useEffect(() => {
    function onToggleStrongs() {
      const tab = activeTabRef.current
      if (!tab) return
      const state = tab.state as import('@/types').BibleTabState
      toggleStrongsForTab(tab.id, !state.showStrongs)
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
            const container = getScrollEl()
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
      : getScrollEl()
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
    if (!findBarOpen || activeSpace !== 'scripture') { setFindMatchVerseNums([]); findCenterVerseRef.current = null; return }
    const matches = findVerses(findBarQuery, !!tabState.compareMode, compareFocusedCol, findBarWordMode)
    setFindMatchVerseNums(matches)
    setFindMatchIdx(0)
    const container = tabState.compareMode ? compareColRefs.current[compareFocusedCol] : getScrollEl()
    if (matches.length > 0 && container) {
      const el = container.querySelector<HTMLElement>(`[data-verse="${matches[0]}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      presenterScrollToVerse(matches[0])
    }
  }, [findBarQuery, findBarOpen, findBarWordMode, activeSpace, tabState.bookId, tabState.chapter, tabState.compareMode, compareFocusedCol]) // eslint-disable-line react-hooks/exhaustive-deps

  // When the presenter is open, scroll it to center the same verse the find bar jumped to.
  function presenterScrollToVerse(verseNum: number) {
    const st = useAppStore.getState()
    if (floating || !st.viewerWindowOpen || st.viewerPaused) return
    const ref = currentBibleChapterRef()
    if (!ref) return
    // Suppress proportional sync briefly so only the centering command moves the presenter.
    findScrollSuppressRef.current = Date.now() + 1100
    findCenterVerseRef.current = verseNum
    window.app.pushViewerOverlay?.({ ...ref, scrollTo: { verseNum, nonce: Date.now() } })
  }

  function findPrev() {
    if (findMatchVerseNums.length === 0) return
    const prev = (findMatchIdx - 1 + findMatchVerseNums.length) % findMatchVerseNums.length
    setFindMatchIdx(prev)
    const container = tabState.compareMode ? compareColRefs.current[compareFocusedCol] : getScrollEl()
    const el = container?.querySelector<HTMLElement>(`[data-verse="${findMatchVerseNums[prev]}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    presenterScrollToVerse(findMatchVerseNums[prev])
  }

  function findNext() {
    if (findMatchVerseNums.length === 0) return
    const next = (findMatchIdx + 1) % findMatchVerseNums.length
    setFindMatchIdx(next)
    const container = tabState.compareMode ? compareColRefs.current[compareFocusedCol] : getScrollEl()
    const el = container?.querySelector<HTMLElement>(`[data-verse="${findMatchVerseNums[next]}"]`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    presenterScrollToVerse(findMatchVerseNums[next])
  }

  function makeTitle(bookId: string, chapter: number, endChapter?: number) {
    const book = books.find((b) => b.id === bookId)
    // An individual psalm is singular ("Psalm 23"), even though the book is "Psalms".
    const singular = (n: number) => bookId === 'PSA' ? `Psalm ${n}` : (book ? `${book.name} ${n}` : `${bookId} ${n}`)
    return endChapter
      ? (bookId === 'PSA' ? `Psalm ${chapter}–${endChapter}` : book ? `${book.name} ${chapter}–${endChapter}` : `${bookId} ${chapter}–${endChapter}`)
      : isHermasBook(bookId)
        ? `Hermas ${getHermasShortLabel(bookId, chapter, hermasVariantForTextId(textId))}`
        : (hasPrologueChapter(bookId) && chapter === 0)
          ? `${book ? book.name : bookId} — Prologue`
          : singular(chapter)
  }

  function navigate(bookId: string, chapter: number, endChapter?: number) {
    if (!activeTab) return
    const title = makeTitle(bookId, chapter, endChapter)
    // Clear any verse-specific right-panel filter left over from before this
    // navigation (e.g. from clicking into a verse's notes) — without this, the
    // side panel's "mentions this chapter" section stayed suppressed by its own
    // `!verseFilter` guard on every later chapter the user paged to, since nothing
    // else ever reset it on plain chapter navigation.
    setRightPanelVerseFilter(null)
    updateTabState('scripture', activeTab.id, {
      bookId, chapter, endChapter, scrollPosition: 0, targetVerse: undefined, endVerse: undefined, noteBack: null, scriptureBack: null,
      rightPanelVerseFilter: null,
    })
    renameTab('scripture', activeTab.id, title)
  }

  // Header for the "add comparison panel" picker's popover — names every panel
  // already open (tabState.compareColumns, when compare mode is already active)
  // rather than just the current chapter, so adding a THIRD+ panel reads as
  // "Compare Sirach 1, Genesis 5, and Exodus 2 with…" instead of only ever
  // naming the one panel the picker happens to be attached to.
  function describeComparePanels(): string {
    const cols = tabState.compareColumns
    const list = cols && cols.length > 0
      ? cols.map((c) => {
          const b = books.find((bk) => bk.id === c.bookId)
          return `${b?.name ?? bookName(c.bookId)} ${c.chapter}`
        })
      : currentBook ? [`${currentBook.name} ${tabState.chapter}`] : []
    if (list.length === 0) return 'Compare with…'
    if (list.length === 1) return `Compare ${list[0]} with…`
    if (list.length === 2) return `Compare ${list[0]} and ${list[1]} with…`
    return `Compare ${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]} with…`
  }

  function prevChapter() {
    if (continuousChapterScroll && !tabState.endChapter && !isHermasBook(tabState.bookId)) {
      if (tabState.chapter > 1) {
        continuousScrollRef.current?.scrollToChapter(tabState.chapter - 1)
      }
      return
    }
    if (tabState.endChapter) {
      // In multi-chapter mode, go to previous single chapter
      navigate(tabState.bookId, tabState.chapter - 1)
    } else if (isHermasBook(tabState.bookId)) {
      const prev = getHermasPrevChapter(tabState.bookId, tabState.chapter, hermasVariantForTextId(textId))
      if (prev !== null) navigate(tabState.bookId, prev)
      // else: already at first Hermas chapter, no cross-book wrap for pseudepigrapha
    } else if (tabState.chapter > 1) {
      navigate(tabState.bookId, tabState.chapter - 1)
    } else if (hasPrologueChapter(tabState.bookId) && tabState.chapter === 1) {
      // Step into the book's unnumbered chapter-0 Prologue before wrapping to the previous book.
      navigate(tabState.bookId, 0)
    } else if (tabState.chapter === 0) {
      // Already at the Prologue — nothing before it in this book, no cross-book wrap.
    } else {
      const bookIdx = books.findIndex((b) => b.id === tabState.bookId)
      if (bookIdx > 0) { const prev = books[bookIdx - 1]; navigate(prev.id, prev.chapters_count) }
    }
  }

  function nextChapter() {
    if (continuousChapterScroll && !tabState.endChapter && !isHermasBook(tabState.bookId)) {
      if (tabState.chapter < chapterCount) {
        continuousScrollRef.current?.scrollToChapter(tabState.chapter + 1)
      }
      return
    }
    if (tabState.endChapter) {
      // In multi-chapter mode, go to next single chapter after the range
      navigate(tabState.bookId, tabState.endChapter + 1)
    } else if (isHermasBook(tabState.bookId)) {
      const next = getHermasNextChapter(tabState.bookId, tabState.chapter, hermasVariantForTextId(textId))
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
    // Verse-anchored restore (KJV/LXX switch) takes priority over the raw-pixel
    // pendingScrollRef path below — anchoring by verse number tracks the same passage
    // across two texts with different word counts/wrapping far better than reusing a
    // pixel offset that was measured against the OLD text's layout, and it flashes the
    // anchor verse so the eye has an obvious landing point through the reflow.
    const verseAnchor = strongsAnchorRef.current
    if (verseAnchor) {
      strongsAnchorRef.current = null
      const container = getScrollEl()
      const el = container?.querySelector<HTMLElement>(`[data-verse="${verseAnchor.verseNum}"]`)
      if (container && el) {
        const containerTop = container.getBoundingClientRect().top
        const elTop = el.getBoundingClientRect().top
        container.scrollTop += elTop - containerTop - verseAnchor.offsetPx
        setFlashAnchor({ verse: verseAnchor.verseNum, nonce: Date.now() })
      }
      return
    }
    const pos = pendingScrollRef.current
    if (!pos || pos === 0) return
    pendingScrollRef.current = null
    // A pending targetVerse means ChapterView's own scroll-to-verse effect owns scrolling
    // for this load — jumping to the old saved scrollPosition here would fight (or, in
    // some effect-ordering cases, permanently win against) that scroll. Some navigation
    // paths that set targetVerse don't also clear scrollPosition (e.g. translation-switch-
    // with-verse-carryover, cross-ref/note/lexicon verse links), so pendingScrollRef can
    // still end up populated even when a verse jump is in flight — this is the backstop.
    if (tabStateRef.current?.targetVerse) return
    const el = getScrollEl()
    if (el) {
      el.scrollTop = pos
    }
  }, []) // refs never change identity — getScrollEl reads refs directly

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

  // Add a comparison panel at the picked book/chapter. Enters compare mode (current
  // view + picked = 2 columns) when not already comparing; otherwise appends a column.
  function addComparePanel(pickBookId: string, pickChapter: number) {
    const target = { bookId: pickBookId, chapter: pickChapter, textId: addPanelTextId ?? textId }
    setAddPanelTextId(null) // reset so the next "add panel" defaults back to the current tab's edition
    if (tabState.compareMode) {
      compareAddColRef.current?.(target)
    } else {
      pendingComparePanelRef.current = target
      if (activeTab) updateTabState('scripture', activeTab.id, { compareMode: true, compareColumns: undefined })
    }
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
  // rAF-throttled: raw mousemove can fire far faster than the display refreshes,
  // and BibleRightPanel's content (Lexicon/CrossRefs/Notes) is expensive enough
  // to re-render that driving setState off every raw event visibly stalled the
  // resize until mouseup instead of tracking the cursor live.
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  // The side panel's open/close transition (the motion.div `transition={{duration:0.18}}`
  // props below) fights this handler's own careful 1:1-cursor-tracking design: framer-motion
  // re-triggers an eased transition toward the new width on EVERY animate-prop change, which
  // includes every rAF-throttled setRightPanelWidth() call during a live drag — so instead of
  // snapping to the cursor, the panel visibly chased it through a series of interrupted
  // 180ms eases (the reported "slow to drag" laziness, and the "white bar" flash from
  // transitions overlapping/restarting mid-drag). isResizingPanel drops the transition
  // duration to 0 for exactly the span of an active drag; the eased transition still applies
  // normally to actual open/close toggles.
  const [isResizingPanel, setIsResizingPanel] = useState(false)
  function handleResizeMouseDown(e: React.MouseEvent) {
    resizeRef.current = { startX: e.clientX, startWidth: rightPanelWidth }
    setIsResizingPanel(true)
    e.preventDefault()
    let rafId: number | null = null
    let latestX = e.clientX

    function onMove(e: MouseEvent) {
      if (!resizeRef.current) return
      latestX = e.clientX
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!resizeRef.current) return
        const delta = resizeRef.current.startX - latestX
        setRightPanelWidth(Math.max(200, Math.min(520, resizeRef.current.startWidth + delta)))
      })
    }
    function onUp(e: MouseEvent) {
      if (!resizeRef.current) return
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      const delta = resizeRef.current.startX - e.clientX
      const finalWidth = Math.max(200, Math.min(520, resizeRef.current.startWidth + delta))
      setRightPanelWidth(finalWidth)
      if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelWidth: finalWidth })
      resizeRef.current = null
      setIsResizingPanel(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // Vertical resize drag handle (for bottom panel layouts) — same rAF throttling.
  const vResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  function handleVResizeMouseDown(e: React.MouseEvent) {
    vResizeRef.current = { startY: e.clientY, startHeight: rightPanelWidth }
    setIsResizingPanel(true)
    e.preventDefault()
    let rafId: number | null = null
    let latestY = e.clientY

    function onMove(e: MouseEvent) {
      if (!vResizeRef.current) return
      latestY = e.clientY
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!vResizeRef.current) return
        const delta = vResizeRef.current.startY - latestY
        setRightPanelWidth(Math.max(120, Math.min(480, vResizeRef.current.startHeight + delta)))
      })
    }
    function onUp(e: MouseEvent) {
      if (!vResizeRef.current) return
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      const delta = vResizeRef.current.startY - e.clientY
      const finalHeight = Math.max(120, Math.min(480, vResizeRef.current.startHeight + delta))
      setRightPanelWidth(finalHeight)
      if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelWidth: finalHeight })
      vResizeRef.current = null
      setIsResizingPanel(false)
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

  // Shared scroll handler — used by both the standard div and ContinuousChapterScroll.
  // IMPORTANT: this hook must be declared before the searchMode early-return below —
  // it used to sit after it, which meant this useCallback was skipped whenever
  // tabState.searchMode was true, changing the number of hooks called between
  // renders and crashing React ("Rendered more/fewer hooks than during the
  // previous render") the moment a tab switched into or out of search mode.
  const handleBibleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const container = e.currentTarget
    const scrollTop = container.scrollTop
    const tabId = activeTabRef.current?.id
    if (scrollSaveTimerRef.current) clearTimeout(scrollSaveTimerRef.current)
    scrollSaveTimerRef.current = setTimeout(() => {
      if (tabId) updateTabState('scripture', tabId, { scrollPosition: scrollTop })
    }, 150)
    const max = container.scrollHeight - container.clientHeight
    const scrollPercent = max > 0 ? scrollTop / max : 0
    setMainBibleScrollPercent(scrollPercent, `${tabStateRef.current.bookId}:${tabStateRef.current.chapter}`)
    const st = useAppStore.getState()
    if (Date.now() < findScrollSuppressRef.current) {
      findScrollSuppressRef.current = Math.max(findScrollSuppressRef.current, Date.now() + 350)
    } else if (st.viewerWindowOpen && !st.viewerPaused) {
      findCenterVerseRef.current = null
      if (viewerScrollRAFRef.current) cancelAnimationFrame(viewerScrollRAFRef.current)
      viewerScrollRAFRef.current = requestAnimationFrame(() => {
        viewerScrollRAFRef.current = null
        const base = computeViewerPayload()
        if (base.kind === 'bible') window.app.pushViewerContent?.({ ...base, scrollPercent })
      })
    }
    if (!st.viewerPaused) computePresenterBand()
  }, [updateTabState, computePresenterBand]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dedicated search tab — render ONLY ScriptureSearchView (no toolbar) ──────
  if (tabState.searchMode) {
    const isDedicatedSearchTab = activeTab?.id === 'scripture-search-dedicated'
    return (
      <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
        <ScriptureSearchView
          floating={floating}
          initialQuery={tabState.scriptureSearchQuery}
          persistedState={{
            query: tabState.scriptureSearchQuery,
            textId: tabState.searchTextId,
            wordMode: tabState.searchWordMode,
            testamentFilter: tabState.searchTestamentFilter,
            bookFilter: tabState.searchBookFilter,
            sortMode: tabState.searchSortMode,
            scrollTop: tabState.searchScrollTop,
          }}
          onStateChange={(s) => {
            if (activeTab) {
              updateTabState('scripture', activeTab.id, {
                scriptureSearchQuery: s.query,
                searchTextId: s.textId,
                searchWordMode: s.wordMode,
                searchTestamentFilter: s.testamentFilter,
                searchBookFilter: s.bookFilter,
                searchSortMode: s.sortMode,
                searchScrollTop: s.scrollTop,
              })
              // Reflect the live query in the tab's own title — this tab's title was
              // otherwise stuck at the static "Search" it was created with, giving no
              // way to tell multiple advanced-search tabs apart in the sidebar/tab bar.
              // Debounced (not renamed on literally every keystroke): a rename touches
              // `tabs`, which both the Sidebar's tab list AND its own breadcrumb button
              // subscribe to — firing it synchronously on every single character sent
              // rapid-fire re-renders through that whole subtree while typing fast,
              // which showed up as the tab bar / breadcrumb text visibly flickering
              // instead of settling. A short debounce still reads as "live" to someone
              // typing at normal speed, just without hammering a render on every key.
              const tabId = activeTab.id
              if (searchTabRenameTimerRef.current) clearTimeout(searchTabRenameTimerRef.current)
              searchTabRenameTimerRef.current = setTimeout(() => {
                const trimmedQuery = (s.query ?? '').trim()
                useAppStore.getState().renameTab('scripture', tabId, trimmedQuery ? `"${trimmedQuery}"` : 'Search')
              }, 150)
            }
          }}
          onNavigate={(bookId, chapter, verse, tid) => {
            if (!activeTab) return
            const newTranslation = tid.toUpperCase()
            const savedQuery = tabState.scriptureSearchQuery ?? ''
            const book = books.find((b) => b.id === bookId)
            const title = isHermasBook(bookId)
              ? `Hermas ${getHermasShortLabel(bookId, chapter, hermasVariantForTextId(tid))}`
              : book ? `${book.name} ${chapter}` : `${bookId} ${chapter}`
            // Record the search itself as a nav-stack entry BEFORE leaving it, so
            // Cmd+[ (navTabBack) from the verse we're about to open returns to
            // these search results (with the query restored) instead of
            // skipping straight past it to whatever was open before the search.
            if (savedQuery) {
              useAppStore.getState().pushTabNav(activeTab.id, { type: 'bible', title: `Search: "${savedQuery}"`, query: savedQuery })
            }
            // TEMPORARY DIAGNOSTIC — remove once the scroll-to-verse bug is confirmed fixed.
            console.warn('[BereanDebug] ScriptureSearchView onNavigate updateTabState', { tabId: activeTab.id, bookId, chapter, verse, newTranslation })
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
              ? `Hermas ${getHermasShortLabel(bookId, chapter, hermasVariantForTextId(tid))}`
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
      <TabHeaderPortal floating={floating}>
        {/* The "← my note" back-to-note pill (tabState.noteBack), and the
            "← Proverbs 25" / "← Search: ..." pills (tabState.scriptureBack /
            tabState.searchBack) that used to render here, were removed —
            redundant with the global TopBar nav pill (Cmd+[/Cmd+]) and the
            per-tab home button, which now correctly track "where did I come
            from" for the Scripture tab too (including search results —
            see the pushTabNav call in onNavigate below), without needing a
            second, panel-local affordance. */}
        {isCompareMode ? (
          <BookChapterPicker
            books={books}
            currentBookId={tabState.bookId}
            currentChapter={tabState.chapter}
            onNavigate={addComparePanel}
            editions={EDITIONS}
            currentTextId={addPanelTextId ?? textId}
            onSelectTranslation={setAddPanelTextId}
            triggerLabel={<PanelRightDashed size={16} />}
            triggerTitle="Add comparison panel"
            triggerClassName="flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-accent))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/10] cursor-pointer transition-colors flex-shrink-0"
            popoverHeader={describeComparePanels()}
          />
        ) : (
          <>
            {/* Prev chapter / book+chapter+edition picker / next chapter — one
                segmented pill (shared border, divider lines between segments,
                hover highlights only the segment under the cursor) instead of
                three separate floating buttons. Shared ActionPillGroup — this
                pill and SidebarTopBar's nav pill independently invented the
                same grouped-button treatment with different radii/dividers
                before being unified onto one primitive. */}
            <ActionPillGroup align="stretch">
              <button onClick={prevChapter} title="Previous chapter" className="flex items-center justify-center w-7 h-7 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
                <ChevronLeft size={17} />
              </button>
              {/* ── Unified book / chapter / edition / translation picker ──
                  The PDF library button now lives at the end of this picker's own
                  Edition row (as an icon) instead of a separate standalone toolbar
                  button next to it. */}
              <BookChapterPicker
                books={books}
                currentBookId={tabState.bookId}
                currentChapter={tabState.chapter}
                onNavigate={navigate}
                editions={EDITIONS}
                currentTextId={textId}
                onSelectTranslation={selectPickerTranslation}
                onOpenPdfLibrary={!floating && pdfFeatureEnabled ? (r) => setPdfPicker({ x: r.left, y: r.bottom + 4 }) : undefined}
                segmented
              />
              <button onClick={nextChapter} title="Next chapter" className="flex items-center justify-center w-7 h-7 text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-pointer">
                <ChevronRight size={17} />
              </button>
            </ActionPillGroup>
            {/* Add comparison panel — dashed "ghost panel" icon reads as "an empty
                column will open here", distinct from the solid picker pill. */}
            <BookChapterPicker
              books={books}
              currentBookId={tabState.bookId}
              currentChapter={tabState.chapter}
              onNavigate={addComparePanel}
              editions={EDITIONS}
              currentTextId={addPanelTextId ?? textId}
              onSelectTranslation={setAddPanelTextId}
              triggerLabel={<PanelRightDashed size={16} />}
              triggerTitle="Add comparison panel (pick a book/chapter)"
              triggerClassName="flex items-center justify-center w-8 h-8 rounded-md border border-dashed border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-accent))] hover:text-[rgb(var(--color-accent))] hover:bg-[rgb(var(--color-accent))/10] cursor-pointer transition-colors flex-shrink-0"
              popoverHeader={describeComparePanels()}
            />
            {/* Annotation info button — the panel below is portaled to document.body with
                fixed positioning (computed from the trigger's rect on open) rather than
                absolutely positioned inline: this toolbar row is portaled into TopBar.tsx's
                slot div, which has overflow-hidden, so an inline `absolute` panel here was
                being silently clipped — appearing to do nothing when clicked. */}
            {ANNOTATION_KEYS[textId] && (
              <div>
                <button
                  ref={infoRef}
                  onClick={(e) => {
                    if (!infoOpen) {
                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                      setInfoPos({ x: r.left, y: r.bottom + 4 })
                    }
                    setInfoOpen((v) => !v)
                  }}
                  title="Text annotations key"
                  className={`p-1 rounded transition-colors cursor-pointer ${infoOpen ? 'text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))]'}`}
                >
                  <Info size={13} />
                </button>
                {infoOpen && infoPos && createPortal(
                  <div
                    ref={infoPanelRef}
                    style={{ position: 'fixed', left: infoPos.x, top: infoPos.y, zIndex: 9999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                    className="w-72 bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] rounded-lg shadow-xl overflow-hidden"
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
                              {editionForTextId(textId)?.label ?? TRANSLATIONS.find(t => t.id === textId)?.label ?? textId.toUpperCase()} — Annotations
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
                  </div>,
                  document.body
                )}
              </div>
            )}
          </>
        )}

        <div className="flex-1" />
        {/* Lower-frequency actions — each already has a keyboard shortcut, so
            moving the icon into the overflow menu doesn't remove the capability,
            just the always-visible button. Picker/popover-driven controls (PDF
            library, annotation info, add-compare-panel) stay inline above
            since they open their own follow-up UI rather than firing a
            single action — the layout picker uses this menu's `render`
            escape hatch instead (see the 'layout' item), computing its own
            fixed-position anchor from the row's rect on open. */}
        {/* This trio (overflow menu, Strong's toggle, side-panel toggle) shares a tighter gap
            than the row's default gap-2 — that default (from TabHeaderPortal.tsx's wrapper,
            shared by every earlier item in this row too) read as an oversized, uneven-feeling
            gap specifically between these three small icon buttons. */}
        <div className="flex items-center gap-1">
        <HeaderOverflowMenu
          items={[
            {
              key: 'search',
              label: 'Search scripture',
              icon: <SearchIcon />,
              shortcut: '⌘/',
              onClick: () => { openSearch('current', 'verses'); closeFindBar() },
            },
            {
              key: 'compare',
              label: 'Compare translations',
              icon: <Columns2 />,
              active: tabState.compareMode,
              onClick: () => {
                if (!activeTab) return
                const turning = !tabState.compareMode
                updateTabState('scripture', activeTab.id, { compareMode: turning, ...(turning ? { compareColumns: undefined } : {}) })
                if (turning) {
                  useAppStore.getState().addHistoryEntry({
                    type: 'compare',
                    title: `Compare — ${activeTab.title}`,
                    bookId: tabState.bookId,
                    chapter: tabState.chapter,
                    translation: textId,
                  })
                }
              },
            },
            ...(!floating ? [{
              key: 'layout',
              label: 'Change layout',
              icon: <LayoutDashboard />,
              active: layoutPickerOpen,
              render: () => (
                <button
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    setLayoutPickerAnchor({ left: rect.right, top: rect.bottom + 4 })
                    setLayoutPickerOpen((v) => !v)
                  }}
                  className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                    layoutPickerOpen
                      ? 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))/8]'
                      : 'text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))]'
                  }`}
                >
                  <span className="flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5"><LayoutDashboard /></span>
                  <span className="flex-1 truncate">Change layout</span>
                </button>
              ),
            }] : []),
          ]}
        />
        {(textId === 'kjva' || textId === 'lxx') && currentBook && counterpartBookIds.has(currentBook.id) && (
          <HintTooltip label={textId === 'lxx' ? 'Switch to KJV' : 'Switch to Brenton LXX'}>
          <button
            onClick={() => {
              if (!activeTab) return
              const target = textId === 'lxx' ? 'KJVA' : 'LXX'
              // Anchor by VERSE NUMBER (not raw pixel offset) before switching — KJV and LXX
              // have different word counts and line-wrapping, so "scroll to this many pixels
              // down" in the old text can land on an unrelated passage in the new one, which
              // is what made this switch hard to follow. Anchoring by verse tracks the same
              // passage across both texts (onVersesLoaded below restores it once the new
              // verses are in the DOM, and flashes the anchor verse as a landing cue).
              captureStrongsAnchor()
              // Books like Psalms, Jeremiah, Joel, and Malachi use different chapter
              // divisions between KJV/MT and LXX numbering (e.g. KJV Ps 116 = LXX Ps
              // 114-115) — map the chapter, don't just carry the number over unchanged.
              const mappedChapter = mapChapterOnTranslationSwitch(tabState.bookId, tabState.chapter, textId, target.toLowerCase())
              updateTabState('scripture', activeTab.id, {
                translation: target,
                chapter: mappedChapter,
                targetVerse: undefined,
                endVerse: undefined,
              })
            }}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md transition-colors cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]"
          >
            <ArrowLeftRight size={14} />
            <span>{textId === 'lxx' ? 'KJV' : 'LXX'}</span>
          </button>
          </HintTooltip>
        )}
        <HintTooltip label="Toggle Strong's numbers" shortcut="⌘G">
        <button
          onClick={() => { if (!activeTab) return; toggleStrongsForTab(activeTab.id, !tabState.showStrongs) }}
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
        {/* Layout picker now lives in the overflow menu below (see 'layout'
            item) — hidden entirely in floating windows (layout is locked to
            'reading' there), same as before. */}
        {!floating && layoutPickerOpen && layoutPickerAnchor && createPortal(
          // Zero-size anchor at the trigger row's bottom-right corner —
          // LayoutPicker's own popover div positions itself with
          // `absolute top-full right-0`, which resolves against THIS
          // wrapper's box (its nearest positioned ancestor), landing the
          // picker exactly where the old inline button used to anchor it,
          // without needing to touch LayoutPicker's own internal styling.
          <div style={{ position: 'fixed', left: layoutPickerAnchor.left, top: layoutPickerAnchor.top, width: 0, height: 0 }}>
            <LayoutPicker
              current={currentLayout}
              onSelect={setLayout}
              onClose={() => setLayoutPickerOpen(false)}
              defaultLayout={defaultScriptureLayout}
              onSaveDefault={setDefaultScriptureLayout}
            />
          </div>,
          document.body
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
        {/* Pause + laser + selection + close now live in the floating PresenterControls panel.
            Zoom now lives in the overflow menu above (see 'zoom' item). */}
      </TabHeaderPortal>


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
        sourceTextId={textId}
        targetVerse={tabState.targetVerse}
        findQuery={findQuery}
        findWordMode={findWMode}
        showStrongs={tabState.showStrongs}
        onColumnFocus={(idx) => { setCompareFocusedCol(idx); setFindMatchVerseNums([]); setFindMatchIdx(0) }}
        onColumnRef={(idx, el) => { compareColRefs.current[idx] = el }}
        onStrongsClick={handleStrongsClick}
        onWordClick={handleWordClick}
        books={books}
        addColRef={compareAddColRef}
        initialAddPanel={pendingComparePanelRef.current}
        onConsumeInitialPanel={() => { pendingComparePanelRef.current = null }}
        onCollapseToSingle={(last) => {
          if (!activeTab) return
          updateTabState('scripture', activeTab.id, {
            compareMode: false, bookId: last.bookId, chapter: last.chapter,
            translation: last.textId.toUpperCase(), compareColumns: undefined,
          })
        }}
        initialColumns={tabState.compareColumns}
        onColumnsChange={(cols) => { if (activeTab) updateTabState('scripture', activeTab.id, { compareColumns: cols }) }}
      />
    ) : continuousChapterScroll && !tabState.endChapter && !isHermasBook(tabState.bookId) ? (
      <ContinuousChapterScroll
        ref={continuousScrollRef}
        bookId={tabState.bookId}
        chapter={tabState.chapter}
        totalChapters={chapterCount}
        showStrongs={tabState.showStrongs}
        textId={textId}
        targetVerse={tabState.targetVerse}
        endVerse={tabState.endVerse}
        hiddenAnnotations={tabState.hiddenAnnotations}
        findQuery={findQuery}
        findWordMode={findWMode}
        flashAnchor={flashAnchor}
        onStrongsClick={handleStrongsClick}
        onWordClick={handleWordClick}
        onChapterChange={(ch) => {
          if (!activeTab) return
          const book = books.find((b) => b.id === tabState.bookId)
          const chTitle = book ? `${book.name} ${ch}` : `${tabState.bookId} ${ch}`
          // Same reset as navigate() — continuous scroll changes tabState.chapter
          // through this callback instead, so it needs the same verse-filter clear.
          setRightPanelVerseFilter(null)
          updateTabState('scripture', activeTab.id, { chapter: ch, rightPanelVerseFilter: null })
          renameTab('scripture', activeTab.id, chTitle)
        }}
        onVersesLoaded={onVersesLoaded}
        onTargetVerseConsumed={() => { if (activeTab) updateTabState('scripture', activeTab.id, { targetVerse: undefined }) }}
        onScroll={handleBibleScroll}
        presenterBand={presenterBand}
        viewerPaused={viewerPaused}
      />
    ) : (
      <div
        ref={chapterViewRef}
        className="flex-1 overflow-y-auto relative"
        onWheel={(e) => {
          // When the chapter fits entirely (nothing to scroll), the wheel can't move the main
          // panel — so translate it into a virtual scroll that drives the presenter, which may
          // be zoomed in and unable to show everything at once.
          const c = chapterViewRef.current
          if (!c || c.scrollHeight - c.clientHeight > 0) return
          const st = useAppStore.getState()
          if (!st.viewerWindowOpen || st.viewerPaused || st.viewerBlank) return
          // Sensitivity derived from the presenter's OWN real overflow (its
          // clientHeight and how much of its content is hidden, f), not a
          // flat magic constant — a flat rate felt wildly different (often
          // far too fast) depending on how zoomed in the presenter was /
          // how little of a short chapter actually overflowed, since a
          // fixed px-per-wheel-tick has no relationship to how much
          // scrollable range there actually is to cover. This reproduces
          // the same math a real scrollbar uses: percent = deltaPx /
          // scrollableRangePx, where scrollableRangePx = clientHeight *
          // (1-f)/f. Floored so a chapter that barely overflows (f→1)
          // doesn't produce a near-infinite (instant-jump-to-end)
          // sensitivity — small floor still lets a deliberate scroll move
          // it, just not on a single wheel tick.
          const region = viewerVisibleRegion
          let sensitivity = 0.0012
          if (region && region.clientHeight && region.visibleFraction > 0 && region.visibleFraction < 1) {
            const scrollableRangePx = Math.max(40, region.clientHeight * (1 - region.visibleFraction) / region.visibleFraction)
            sensitivity = 1 / scrollableRangePx
          }
          const next = Math.max(0, Math.min(1, virtualScrollPctRef.current + e.deltaY * sensitivity))
          if (next === virtualScrollPctRef.current) return
          virtualScrollPctRef.current = next
          setMainBibleScrollPercent(next, `${tabState.bookId}:${tabState.chapter}`)
          const base = computeViewerPayload()
          if (base.kind === 'bible') window.app.pushViewerContent?.({ ...base, scrollPercent: next })
          computePresenterBand()
        }}
        onMouseMove={(e) => {
          if (!canPushOverlay() || !useAppStore.getState().viewerLaserEnabled) return
          const c = chapterViewRef.current
          if (!c) return
          const x = e.clientX, y = e.clientY
          if (laserRAFRef.current) cancelAnimationFrame(laserRAFRef.current)
          laserRAFRef.current = requestAnimationFrame(() => {
            laserRAFRef.current = null
            const ref = currentBibleChapterRef()
            if (!ref) return
            const hit = pointToLaser(c, x, y)
            if (!hit) { window.app.pushViewerOverlay?.({ ...ref, laser: null }); return }
            const { wordKey, ...laser } = hit
            // Track immediately for the first point, the same word, an ADJACENT word (normal
            // reading movement — including crossing the space into the next word), a margin, or
            // a different verse. Only a FAR in-verse jump (>1 word away) waits for a dwell, so
            // the pointer doesn't dart to distant words but glides smoothly word-to-word.
            const prev = lastLaserWordRef.current
            let farJump = false
            if (prev && prev !== wordKey) {
              const [pv, pw] = prev.split(':')
              const [nv, nw] = wordKey.split(':')
              farJump = pv === nv && pw !== 'frac' && nw !== 'frac' && Math.abs(Number(pw) - Number(nw)) > 1
            }
            if (prev === null || !farJump) {
              if (laserDwellTimerRef.current) { clearTimeout(laserDwellTimerRef.current); laserDwellTimerRef.current = null }
              pendingLaserWordRef.current = null
              lastLaserWordRef.current = wordKey
              window.app.pushViewerOverlay?.({ ...ref, laser })
              return
            }
            // Far in-verse jump → dwell briefly before committing (anti-jitter focus).
            pendingLaserRef.current = { ...ref, laser }
            if (wordKey !== pendingLaserWordRef.current) {
              pendingLaserWordRef.current = wordKey
              if (laserDwellTimerRef.current) clearTimeout(laserDwellTimerRef.current)
              laserDwellTimerRef.current = setTimeout(() => {
                laserDwellTimerRef.current = null
                const p = pendingLaserRef.current
                const w = pendingLaserWordRef.current
                pendingLaserWordRef.current = null
                if (p && w) { lastLaserWordRef.current = w; window.app.pushViewerOverlay?.({ bookId: p.bookId, chapter: p.chapter, laser: p.laser }) }
              }, 130)
            }
          })
        }}
        onMouseLeave={() => {
          if (floating || !useAppStore.getState().viewerWindowOpen) return
          if (laserDwellTimerRef.current) { clearTimeout(laserDwellTimerRef.current); laserDwellTimerRef.current = null }
          lastLaserWordRef.current = null
          pendingLaserWordRef.current = null
          const ref = currentBibleChapterRef()
          if (ref) window.app.pushViewerOverlay?.({ ...ref, laser: null })
        }}
        onScroll={handleBibleScroll}
      >
        {/* Presenter visible-region band — outlines the region of scripture currently shown on
            the presenter window. Scrolls with content (absolute inside the scroll container). */}
        {presenterBand && (
          <div
            className="absolute left-0 right-0 pointer-events-none z-[5]"
            style={{
              top: presenterBand.top,
              height: presenterBand.height,
              border: `2px solid ${viewerPaused ? 'rgba(251,191,36,0.85)' : 'rgb(var(--color-accent))'}`,
              background: viewerPaused ? 'rgba(251,191,36,0.07)' : 'rgb(var(--color-accent) / 0.06)',
              borderRadius: 6,
            }}
          >
            <span
              className="absolute top-0.5 right-1 px-1.5 text-[9px] font-bold uppercase tracking-wide rounded"
              style={{
                color: '#fff',
                background: viewerPaused ? 'rgba(251,191,36,0.95)' : 'rgb(var(--color-accent))',
              }}
            >
              {viewerPaused ? 'Presenter (paused)' : 'On presenter'}
              {/* Verse range read directly off the same verseFracs data the band's
                  geometry is built from — answers "what does the audience see"
                  in plain text, which stays legible/correct even in the rare
                  case the band's own pixel placement is a touch approximate
                  (e.g. interpolated mid-verse), since this isn't a second
                  independent measurement. */}
              {presenterBand.firstVerse != null && (
                <> · v.{presenterBand.firstVerse}{presenterBand.lastVerse != null && presenterBand.lastVerse !== presenterBand.firstVerse ? `–${presenterBand.lastVerse}` : ''}</>
              )}
            </span>
          </div>
        )}
        {tabState.endChapter && tabState.endChapter > tabState.chapter
          ? Array.from({ length: tabState.endChapter - tabState.chapter + 1 }, (_, i) => tabState.chapter + i).map((ch) => (
              <ChapterView
                key={ch}
                bookId={tabState.bookId}
                chapter={ch}
                showStrongs={tabState.showStrongs}
                textId={textId}
                targetVerse={ch === tabState.chapter ? tabState.targetVerse : undefined}
                endVerse={undefined}
                hiddenAnnotations={tabState.hiddenAnnotations}
                findQuery={findQuery}
                findWordMode={findWMode}
                onStrongsClick={handleStrongsClick}
                onWordClick={handleWordClick}
                onVersesLoaded={ch === tabState.chapter ? onVersesLoaded : undefined}
                onTargetVerseConsumed={ch === tabState.chapter ? (() => { if (activeTab) updateTabState('scripture', activeTab.id, { targetVerse: undefined }) }) : undefined}
                flashAnchor={ch === tabState.chapter ? flashAnchor : undefined}
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
                onTargetVerseConsumed={() => { if (activeTab) updateTabState('scripture', activeTab.id, { targetVerse: undefined }) }}
                flashAnchor={flashAnchor}
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
          onScrollPercent={(pct) => {
            const st = useAppStore.getState()
            if (!st.viewerWindowOpen || st.viewerPaused) return
            const base = computeViewerPayload()
            if (base.kind === 'bible') {
              window.app.pushViewerContent?.({ ...base, sidePanelScrollPercent: pct })
            }
          }}
        />
      </ErrorBoundary>
    )

    const hDivider = (
      <div
        onMouseDown={handleResizeMouseDown}
        className="group relative w-1 flex-shrink-0 cursor-col-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-transparent"
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
          <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
          <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
        </div>
      </div>
    )
    const vDivider = (
      <div
        onMouseDown={handleVResizeMouseDown}
        className="group relative h-1 flex-shrink-0 cursor-row-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-transparent"
      >
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-row gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
          <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
          <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
        </div>
      </div>
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
            <AnimatePresence initial={false}>
              {rightPanelOpen && (
                <motion.div
                  key="right-panel"
                  initial={{ width: 0 }}
                  animate={{ width: panelSize + 4 }}
                  exit={{ width: 0 }}
                  transition={{ duration: isResizingPanel ? 0 : 0.18, ease: 'easeOut' }}
                  className="flex-shrink-0 flex overflow-hidden"
                >
                  {hDivider}
                  <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl()}</div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )

      // ── Panel left ───────────────────────────────────────────────────────────
      case 'panel-left':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <AnimatePresence initial={false}>
              {rightPanelOpen && (
                <motion.div
                  key="left-panel"
                  initial={{ width: 0 }}
                  animate={{ width: panelSize + 4 }}
                  exit={{ width: 0 }}
                  transition={{ duration: isResizingPanel ? 0 : 0.18, ease: 'easeOut' }}
                  className="flex-shrink-0 flex overflow-hidden"
                >
                  <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl()}</div>
                  {hDivider}
                </motion.div>
              )}
            </AnimatePresence>
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
                <div className="flex-[3] flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg min-w-0">
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
                <div className="flex-[1.5] flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg min-w-0">
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
            <AnimatePresence initial={false}>
              {rightPanelOpen && (
                <motion.div
                  key="notes-right-panel"
                  initial={{ width: 0 }}
                  animate={{ width: panelSize + 4 }}
                  exit={{ width: 0 }}
                  transition={{ duration: isResizingPanel ? 0 : 0.18, ease: 'easeOut' }}
                  className="flex-shrink-0 flex overflow-hidden"
                >
                  {hDivider}
                  <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                    {panelEl('notes')}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )

      // ── Panel bottom (full width) ────────────────────────────────────────────
      case 'panel-bottom':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {vDivider}
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('notes')}
            </div>
          </div>
        )

      // ── Notes top ────────────────────────────────────────────────────────────
      case 'notes-top':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
                sourceTextId={textId}
                targetVerse={tabState.targetVerse}
                findQuery={findQuery}
                showStrongs={tabState.showStrongs}
                onColumnFocus={(idx) => { setCompareFocusedCol(idx); setFindMatchVerseNums([]); setFindMatchIdx(0) }}
                onColumnRef={(idx, el) => { compareColRefs.current[idx] = el }}
                onStrongsClick={handleStrongsClick}
                onWordClick={handleWordClick}
                books={books}
                addColRef={compareAddColRef}
                initialColumns={tabState.compareColumns}
                onColumnsChange={(cols) => { if (activeTab) updateTabState('scripture', activeTab.id, { compareColumns: cols }) }}
              />
            </div>
            {vDivider}
            <div style={{ height: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
            className="h-1 flex-shrink-0 cursor-row-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-transparent"
          />
        )
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            {/* Top row */}
            <div className="flex-1 flex overflow-hidden min-h-0">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
              {hDivider}
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('lexicon')}
              </div>
            </div>
            {lcVDivider}
            {/* Bottom row — height independent from right column width */}
            <div style={{ height: Math.max(120, Math.min(520, bottomPanelHeight)) }} className="flex-shrink-0 flex overflow-hidden">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 mb-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('notes')}
              </div>
              <div className="w-px bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('notes')}
            </div>
            {hDivider}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {hDivider}
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
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
            className="h-1 flex-shrink-0 cursor-row-resize hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-transparent"
          />
        )
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {sbVDivider}
            <div style={{ height: sbHeight }} className="flex-shrink-0 flex overflow-hidden">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 mb-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('notes')}
              </div>
              <div className="w-px bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('lexicon')}
              </div>
            </div>
          </div>
        )
      }
    }
  }
}
