import { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Layers, PanelRight, PanelRightDashed, Check, Columns2, Info, Eye, EyeOff, ArrowLeftRight, ArrowLeft, Search as SearchIcon, LayoutDashboard, Monitor, Link2 } from 'lucide-react'
import { createPortal, flushSync } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import PdfPicker from '@/components/pdf/PdfPicker'
import { useAppStore } from '@/store'
import { recordLexiconConnection, recordTranslationSwitch } from '@/store/studyTrailSlice'
import { recordNavigation, type NavOrigin } from '@/lib/verseNavigation'
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
import { computeViewerPayload, setMainBibleScrollPercent, clearMainBibleScrollPercent, clearLastBibleVerse } from '@/hooks/useViewerSync'
import { useSwipePanelGesture } from '@/hooks/useSwipePanelGesture'
import { computePresenterBand as computeBandGeometry, measureContentHeight, presenterScrollSensitivity, shallowEqualNumberRecord } from '@/lib/presenterBand'
import { scrollVerseIntoView, VERSE_JUMP_ANIMATED_START, VERSE_JUMP_ANIMATED_CENTER } from '@/lib/scrollToVerse'
import { computeSelectionRanges, pointToLaser } from '@/lib/presenterOverlay'
import type { Book, BibleTabState, ScriptureLayout } from '@/types'

// Mirrors BibleRightPanel.tsx's own (locally-scoped, unexported) PanelTab type.
type PanelTab = 'notes' | 'lexicon' | 'crossrefs'
const ALL_PANEL_TABS: PanelTab[] = ['notes', 'lexicon', 'crossrefs']
import type { ViewerVisibleRegion } from '@/types/electron'

import { ANNOTATION_KEYS, TRANSLATIONS, EDITIONS, editionForTextId } from '@/lib/bibleTexts'
import { bookName, normalizeBookName } from '@/lib/parseRef'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import { isHermasBook, getHermasChapterLabel, getHermasShortLabel, hermasVariantForTextId } from '@/lib/hermasMap'
import { hasPrologueChapter } from '@/lib/prologueBooks'
import { getPrevChapterRef, getNextChapterRef } from '@/lib/bibleNav'

// Module-level cache of getBooks() results per textId, shared across every BiblePanel
// instance/remount. ActivePanel.tsx fully unmounts/remounts BiblePanel on every tab switch, so
// without this `books` reset to [] on each switch and only repopulated one render-pass later via
// the effect below (an async IPC round trip) — visible as a real flash/flicker in the book/
// chapter picker (a missing `currentBook` degrades several conditional badges, and
// `chapterCount`'s arbitrary 50-chapter fallback briefly feeds the wrong total into
// ContinuousChapterScroll for any book that isn't ~50 chapters, shifting the scroll layout once
// corrected). Lazy-initializing `books` from this cache makes a switch back to an
// already-visited translation correct on the very first render, matching the same
// fixed-this-session pattern used for NotesPanel's continuousDailyDate / LexiconPanel's
// savedSearch.
const booksCache = new Map<string, Book[]>()

// scriptureLayout presets that dock a resizable panel at the actual BOTTOM of the screen (as
// opposed to a side panel, or a panel with no open/close/resize concept at all) — used to keep
// fixed-position overlays like the verse-digit-jump pill (below) from landing on top of that
// panel's own controls. Kept as a Set at module scope rather than inlined at each use site so
// the two places that need "is this a bottom-panel layout" (today: just the digit overlay, but
// see Phase 2's plan to extend animation to these same layouts) can't drift apart.
const BOTTOM_PANEL_HEIGHT_LAYOUTS = new Set<ScriptureLayout>(['panel-bottom', 'notes-bottom', 'compare-notes', 'split-bottom'])

export default function BiblePanel({ floating = false }: { floating?: boolean }) {
  // Narrowed to this panel's own space — subscribing to the whole `tabs` record (all 5 spaces)
  // meant a tab-state write in ANY space (scroll position, panel resize, YouTube layout, etc.)
  // re-rendered this component too, since the store replaces the whole record's reference on
  // every per-space write. `tabs.scripture`'s own reference only changes when scripture's own
  // array actually changes, so this only re-renders on writes that are actually relevant here.
  const tabs = useAppStore((s) => s.tabs.scripture)
  const activeTabId = useAppStore((s) => s.activeTabId.scripture)
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
  // Whether the floating Read Aloud player is currently showing (it's global — shown for ANY
  // playing chapter, not just this tab's) — used to reserve extra bottom scroll room so the
  // player's card doesn't sit on top of the last verse with no way to scroll past it.
  const audioPlaybackActive = useAppStore((s) => s.audioPlayback != null)
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
  // Last region actually applied — lets onViewerVisibleRegion below skip redundant reports.
  const lastViewerRegionRef = useRef<ViewerVisibleRegion | null>(null)
  const [presenterBand, setPresenterBand] = useState<{ top: number; height: number; firstVerse: number | null; lastVerse: number | null } | null>(null)
  // Bounded retry when a recompute lands in the transient window right after a tab switch where
  // the new chapter's verses aren't in the DOM yet — measuring then gives an empty result, and
  // nulling the band on that would hide the outline until the next real scroll event ("shows for
  // a second then goes away until I scroll"). Instead we keep the current band and try again a
  // few frames later. Reset to 0 on any successful measurement.
  const bandRetryRef = useRef(0)
  const bandRetryRafRef = useRef(0)
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
  // Fires ~180ms after the LAST scroll event, regardless of suppression state — the fix for a
  // confirmed bug (found via a dedicated investigation of "presenter shows a stale verse range
  // after a targetVerse jump + manual scroll"): findScrollSuppressRef.current re-extends itself
  // on EVERY scroll tick that lands while still suppressed (see the "else" branch below), so a
  // continuous scroll gesture right after a jump — normal reading behavior — can push the
  // suppression deadline forward every tick and never let it expire while still moving. The
  // tick where the user actually STOPS (their true final resting scrollTop) is then itself
  // swallowed by the still-active suppression window, and since no further scroll event ever
  // fires, that true final position is NEVER cached or pushed — leaving the presenter/outline
  // permanently mirroring a stale mid-jump position. This timer independently detects "scrolling
  // has settled" and forces one authoritative sync from the real current DOM state, bypassing
  // suppression entirely, so the true final position always eventually gets through.
  const scrollSettleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // The verse the presenter is currently centered on via a find-bar jump (null when the
  // presenter is mirroring the main panel proportionally). While set, the outline band is
  // computed from this verse's centered position instead of the main panel's scroll percent.
  const findCenterVerseRef = useRef<number | null>(null)
  // Virtual scroll percent driving the presenter — either purely from the wheel, when the
  // main panel's content fits entirely (no real scroll to mirror), or normalized from the
  // main panel's OWN scrollTop deltas otherwise (see handleBibleScroll below). In both cases
  // this is the single "shared p" value actually applied to the presenter and used to draw
  // the outline band, so the two can never disagree about where the presenter is scrolled to.
  const virtualScrollPctRef = useRef(0)
  // Debug-only: remembers the last pushed (percent, chapterKey) pair so handleBibleScroll can
  // flag a suspiciously large jump between consecutive pushes for the SAME chapter — the
  // "jumping near the beginning/end of a chapter" symptom should show up here as a
  // [PD SUSPICIOUS JUMP] line with the exact before/after values and what triggered the push.
  const lastPushedDebugRef = useRef<{ percent: number; chapterKey: string } | null>(null)
  // The main panel's own scrollTop as of the last handleBibleScroll event, used to derive a
  // physical px delta each event rather than a fresh ratio-to-own-range every time (see
  // handleBibleScroll). Kept in sync with virtualScrollPctRef by every place that resets or
  // jumps that percent (chapter change, scroll-position restore, presenter push) so a
  // discontinuous jump never gets treated as a continuous scroll delta.
  const lastMainScrollTopRef = useRef(0)

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
  // Set right before leaving search mode via onNavigate below. ScriptureSearchView's own
  // unmount-cleanup effect flushes one last onStateChange call (to save scroll position) as
  // it unmounts, which would otherwise re-arm searchTabRenameTimerRef with the stale search
  // query and stomp the chapter title onNavigate just set. This flag tells that one flush to
  // skip the rename (the scroll-position part of the flush still runs normally).
  const justNavigatedAwayFromSearchRef = useRef(false)
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
  // Whether 2+ visible compare columns currently share the same bookId+chapter —
  // reported live by CompareView (recomputed as columns/chapters change), so the
  // toggle button below can gray itself out without a separate disable action.
  const [compareSyncEligible, setCompareSyncEligible] = useState(false)
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
  const [books, setBooks] = useState<Book[]>(() => booksCache.get(textId) ?? [])
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
  const [rightPanelExpandAll, setRightPanelExpandAll] = useState(() => tabState.rightPanelExpandAll ?? false)

  // ── Second side-panel slot ("slot B") — a tab popped out of slot A via right-click/drag.
  // Fully independent BibleRightPanel instance below, so it mirrors every one of slot A's
  // "which X is open" fields above, not just its own panel type. null slotB = not shown.
  //
  // rightPanelSlotBTabs is the SET of tab types currently assigned to slot B (empty = slot B
  // doesn't exist) — slot B can hold more than one tab, switchable via its own strip, exactly
  // like slot A (per explicit direction: dragging an additional tab into an already-popped-out
  // panel should give it two tabs, and dragging the last remaining tab in should collapse back
  // to a single panel). rightPanelSlotB is slot B's currently-ACTIVE tab within that set (must
  // be a member of rightPanelSlotBTabs, or null when the set is empty) — kept as a separate
  // field from the set itself since "which of B's own tabs is showing" and "which tabs does B
  // own" are independent facts. Migrates the OLD single-tab persisted format (before this
  // change, rightPanelSlotB was the only field and always held exactly one type) by treating
  // it as a one-element set.
  const [rightPanelSlotBTabs, setRightPanelSlotBTabs] = useState<PanelTab[]>(() =>
    tabState.rightPanelSlotBTabs ?? (tabState.rightPanelSlotB ? [tabState.rightPanelSlotB] : [])
  )
  const [rightPanelSlotB, setRightPanelSlotB] = useState<'notes' | 'lexicon' | 'crossrefs' | null>(() => tabState.rightPanelSlotB ?? null)
  const [rightPanelNoteIdB, setRightPanelNoteIdB] = useState<string | null>(() => tabState.rightPanelNoteIdB ?? null)
  const lastNoteCursorRefB = useRef<number | null>(tabState.rightPanelNoteCursorB ?? null)
  const [rightPanelLexiconEntryB, setRightPanelLexiconEntryB] = useState<string | null>(() => tabState.rightPanelLexiconEntryB ?? null)
  const [rightPanelVerseFilterB, setRightPanelVerseFilterB] = useState<string | null>(() => tabState.rightPanelVerseFilterB ?? null)
  const [rightPanelExpandAllB, setRightPanelExpandAllB] = useState(() => tabState.rightPanelExpandAllB ?? false)
  // Slot A's last-active type before it got popped out to slot B, so popping out slot A's
  // CURRENTLY active tab has something sensible to fall back to instead of leaving slot A
  // pointed at the tab that just left it.
  const lastRightPanelTabRef = useRef<'notes' | 'lexicon' | 'crossrefs'>(rightPanelTab)

  // ── Reset mount-scoped local state when the ACTIVE TAB itself changes ────────────────────
  // ActivePanel.tsx now keys every scripture tab under the SAME 'panel:bible' DOM key (matching
  // notes' own long-standing pattern) instead of `tab.id` — switching scripture tabs used to
  // fully unmount+remount this whole component just to show different content: tearing down
  // every VerseRow/StrongsInline in the outgoing chapter (~8-11k elements for a page like Psalm
  // 119) and re-issuing 3 fresh IPC fetches, real measurable cost on every single tab switch.
  // Most of this component already re-derives correctly on a tab switch without any extra work
  // (activeTabId/tabState are read live from the store every render, not captured once at
  // mount), but the `useState(() => tabState.X)` LAZY initializers above only ever run ONCE per
  // mount — without a real remount they'd keep showing the PREVIOUS tab's right-panel open/
  // width/content state until the user happened to touch it. Reset directly in the render body
  // (not a useEffect) — the same "adjust state during render when a dependency changed" pattern
  // NotesPanel.tsx already uses for its own analogous notesTabId problem
  // (prevNotesTabIdForGuardRef) — so the correct tab's state is already in place for THIS
  // render's paint, with no one-frame flash of the outgoing tab's leftover state.
  const prevBibleTabIdForResetRef = useRef(activeTabId)
  if (prevBibleTabIdForResetRef.current !== activeTabId) {
    prevBibleTabIdForResetRef.current = activeTabId
    setRightPanelOpen(tabState.rightPanelOpen ?? false)
    setRightPanelWidth(tabState.rightPanelWidth ?? 280)
    setBottomPanelHeight(tabState.bottomPanelHeight ?? 240)
    setRightPanelTab(tabState.rightPanelTab ?? 'notes')
    setRightPanelNoteId(tabState.rightPanelNoteId ?? null)
    setRightPanelLexiconEntry(tabState.rightPanelLexiconEntry ?? null)
    setRightPanelVerseFilter(tabState.rightPanelVerseFilter ?? null)
    setRightPanelExpandAll(tabState.rightPanelExpandAll ?? false)
    setRightPanelSlotBTabs(tabState.rightPanelSlotBTabs ?? (tabState.rightPanelSlotB ? [tabState.rightPanelSlotB] : []))
    setRightPanelSlotB(tabState.rightPanelSlotB ?? null)
    setRightPanelNoteIdB(tabState.rightPanelNoteIdB ?? null)
    setRightPanelLexiconEntryB(tabState.rightPanelLexiconEntryB ?? null)
    setRightPanelVerseFilterB(tabState.rightPanelVerseFilterB ?? null)
    setRightPanelExpandAllB(tabState.rightPanelExpandAllB ?? false)
    lastNoteCursorRef.current = tabState.rightPanelNoteCursor ?? null
    lastNoteCursorRefB.current = tabState.rightPanelNoteCursorB ?? null
    lastRightPanelTabRef.current = tabState.rightPanelTab ?? 'notes'
    // Purely transient UI (popover open/closed, temporary picker positions, in-progress
    // gestures) that a real remount would always have started fresh — none of this is
    // meaningful once we're looking at an entirely different tab's content.
    setPdfPicker(null)
    setInfoOpen(false)
    setInfoPos(null)
    setLayoutPickerOpen(false)
    setLayoutPickerAnchor(null)
    setAddPanelTextId(null)
    setFlashAnchor(null)
    setCompareFocusedCol(0)
    setCompareSyncEligible(false)
    // Find-bar match list self-heals (its own effect depends on tabState.bookId/chapter), but
    // the INDEX into it doesn't — without this, find-next/prev could start from a leftover index
    // from the previous tab's match count and jump to the wrong occurrence on the first click.
    setFindMatchIdx(0)
    // Compare-mode column DOM refs — CompareView repopulates these on its own re-render, but
    // clear them here too so a read in the brief window before that happens can't see a stale
    // ref from a compare tab with a different column count.
    compareColRefs.current = []
    // Presenter outline band: the region-mismatch guard inside computePresenterBand already
    // protects against drawing a stale band for the wrong book/chapter, but clearing these
    // outright avoids even a one-frame flash of the outgoing tab's band before that guard (or
    // the fresh requestViewerVisibleRegion() effect a few lines down) catches up.
    setViewerVisibleRegion(null)
    setPresenterBand(null)
    lastViewerRegionRef.current = null
    bandRetryRef.current = 0
    cancelAnimationFrame(bandRetryRafRef.current)
    findCenterVerseRef.current = null
    findScrollSuppressRef.current = 0
    virtualScrollPctRef.current = 0
    lastMainScrollTopRef.current = 0
  }

  useEffect(() => {
    // Use refs so the async callback always reads the latest tab state, not a stale closure.
    // This prevents the redirect-to-first-book firing erroneously when both translation
    // and bookId are updated together (e.g. navigating to "HER 1:1" from a note).
    window.bible.getBooks(textId).then((rawBooks) => {
      const newBooks = rawBooks.map((b) => ({ ...b, name: normalizeBookName(b.name) }))
      booksCache.set(textId, newBooks)
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
    // A translation switch that also remaps the chapter number (selectPickerTranslation,
    // e.g. LXX/KJV Psalms numbering) changes tabState.chapter, which fires this same effect
    // — but captureStrongsAnchor() already ran before that switch, and onVersesLoaded is
    // about to restore that exact anchor once the new chapter's data lands. Snapping to 0
    // here first would only produce a visible "flash to verse 1, then jump back down" —
    // precisely the "should just flip, not scroll from verse one" behavior this guard
    // avoids. Skip the reset entirely and let the pending anchor own this load instead.
    if (strongsAnchorRef.current) return
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
      const freshChapterKey = `${tabState.bookId}:${tabState.chapter}`
      setMainBibleScrollPercent(0, freshChapterKey)
      clearLastBibleVerse(freshChapterKey)
    }
    virtualScrollPctRef.current = 0
    lastMainScrollTopRef.current = 0
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
    if (savedPos === 0) {
      // Landing on this tab already at (or with no saved) scroll position — unlike the
      // non-continuous reset effect above, this path never fires a native scroll event to
      // refresh useViewerSync.ts's lastBibleScrollPercent/lastScrollChapterKey cache, so it can
      // stay stale for whatever chapter was last ACTIVELY scrolled elsewhere. computeViewerPayload
      // then reports scrollPercent as undefined for this (legitimately top-of-chapter) tab, and
      // the presenter falls back to centering on a stale bs.verse/lastBibleVerse instead —
      // confirmed root cause of "main shows top of chapter, presenter shows mid-chapter verses".
      const freshChapterKey = `${tabState.bookId}:${tabState.chapter}`
      setMainBibleScrollPercent(0, freshChapterKey)
      clearLastBibleVerse(freshChapterKey)
      virtualScrollPctRef.current = 0
      return
    }
    pendingScrollRef.current = savedPos
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSpace, activeTabId, continuousChapterScroll])

  // Cancel any pending debounced scroll save when the tab changes — and also when the
  // chapter/book changes within the same tab. Without the latter, a scroll-triggered save
  // queued just before navigate() (e.g. nextChapter/prevChapter fired within 150ms of the
  // last scroll) still lands afterward with the OLD chapter's scrollTop, clobbering the
  // scrollPosition:0 that navigate() had just written for the NEW chapter — so the next
  // time this tab is restored, the new chapter opens at the previous chapter's offset.
  // The actual save now happens via berean:saveScrollBeforeTabChange (fired synchronously
  // from the Sidebar before activateTab, so the DOM still holds the old position).
  useEffect(() => {
    return () => {
      if (scrollSaveTimerRef.current) {
        clearTimeout(scrollSaveTimerRef.current)
        scrollSaveTimerRef.current = null
      }
    }
  }, [activeTabId, tabState.bookId, tabState.chapter]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // The viewer's own scroll-driven report can fire once per rAF while it's mid-scroll
      // (see ViewerBiblePage.tsx's reportVisible doc comment) even though its measured
      // fraction/verseFracs are usually identical frame-to-frame once settled. Skip the
      // state update — and everything downstream of it (computePresenterBand's own
      // getBoundingClientRect() pass + a BiblePanel re-render) — when nothing changed.
      const last = lastViewerRegionRef.current
      if (last && last.bookId === r.bookId && last.chapter === r.chapter
        && last.visibleFraction === r.visibleFraction && last.clientHeight === r.clientHeight
        && shallowEqualNumberRecord(last.verseFracs, r.verseFracs)) {
        return
      }
      lastViewerRegionRef.current = r
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
    // Transient post-tab-switch window: region is valid for THIS chapter but the chapter's
    // verse nodes haven't mounted yet. Don't null the band on this — hold what's there and
    // retry, so the outline doesn't blink out until the next manual scroll.
    if (Object.keys(tops).length === 0 || contentBottom <= 0) {
      if (bandRetryRef.current < 12) {
        bandRetryRef.current += 1
        cancelAnimationFrame(bandRetryRafRef.current)
        bandRetryRafRef.current = requestAnimationFrame(() => computePresenterBandRef.current())
        return
      }
      setPresenterBand(null)
      return
    }
    bandRetryRef.current = 0
    // Use content height (last verse bottom), matching the presenter's reporting, so the band
    // doesn't extend into the empty space below the last verse on short chapters. Shared
    // measureContentHeight helper (not a locally re-typed "+ 4") so this can't independently
    // drift from ViewerBiblePage.tsx's own copy of the same measurement.
    const mainH = measureContentHeight(c.scrollHeight, contentBottom)

    // The band is drawn INSIDE this same window, directly on top of this panel's own real
    // content — so it must track this panel's own true, un-smoothed scroll ratio
    // (c.scrollTop / denom), not the sensitivity-normalized virtualScrollPctRef used to drive
    // the PRESENTER's felt scroll speed. Those two percents only agree at the exact top/bottom
    // of a real scroll range; in between, virtualScrollPctRef intentionally moves slower or
    // faster than this panel's own scrollTop whenever the presenter's own scrollable range
    // differs from this panel's (see presenterScrollSensitivity's doc comment) — using it here
    // made the band visibly lag behind (or run ahead of) wherever the user had actually
    // scrolled to in THIS panel, up to drifting off the rendered content entirely on longer
    // chapters. Only fall back to the virtual accumulator when this panel has no native scroll
    // range of its own to derive a ratio from (a short chapter driven purely by the wheel-
    // virtual-scroll path below) — that's the one case with no real mainScrollTop/denom ratio
    // to track in the first place.
    const bandDenom = mainH - c.clientHeight
    let scrollPercentOverride: number | undefined = bandDenom <= 0 ? virtualScrollPctRef.current : undefined
    // When a find-bar jump has centered a verse in the presenter, the presenter is NOT
    // mirroring the main panel proportionally — so derive the scroll percent from where that
    // verse sits, centered, in the presenter's content (otherwise the band lands mid-verse).
    const fv = findCenterVerseRef.current
    if (fv != null && f < 1) {
      const vf = region.verseFracs[fv]
      if (vf != null) scrollPercentOverride = Math.max(0, Math.min(1, (vf - f / 2) / (1 - f)))
    }
    const band = computeBandGeometry({
      visibleFraction: f,
      verseFracs: region.verseFracs,
      mainTops: tops,
      mainScrollHeight: mainH,
      mainClientHeight: c.clientHeight,
      mainScrollTop: c.scrollTop,
      scrollPercentOverride,
    })
    setPresenterBand(band)

    // Debug logging for the "outline shows different verses than the presenter" report —
    // compare this against the [PresenterDebug viewer] log ViewerBiblePage.tsx emits for the
    // same tick (set window.__bereanPresenterDebug = true in BOTH windows' devtools console).
    // Logs: what THIS window received as the presenter's own reported region (region.bookId/
    // chapter/visibleFraction — ground truth as of the presenter's last report), what the band
    // geometry computed from it (band.firstVerse/lastVerse — what the outline claims), and
    // what's ACTUALLY on-screen in the presenter's own verseFracs at the computed scroll
    // percent, independently re-derived here as a cross-check.
    if (window.__bereanPresenterDebug) {
      console.log('[PresenterDebug band]', {
        regionBookId: region.bookId, regionChapter: region.chapter, regionVisibleFraction: region.visibleFraction,
        mainScrollPercentUsed: scrollPercentOverride !== undefined ? scrollPercentOverride : (bandDenom > 0 ? c.scrollTop / bandDenom : 0),
        bandFirstVerse: band?.firstVerse, bandLastVerse: band?.lastVerse,
        bandTop: band?.top, bandHeight: band?.height,
      })
    }
  }, [floating, viewerWindowOpen, viewerVisibleRegion, tabState.bookId, tabState.chapter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Latest computePresenterBand, readable from callbacks (like clearTargetVerse below) that
  // must NOT take it as a dependency — computePresenterBand's identity changes on every
  // viewerVisibleRegion update, and those callbacks are handed to memo(ChapterView) as props
  // whose stable identity is what lets that memo actually bail out (see the comment above
  // clearTargetVerse's definition).
  const computePresenterBandRef = useRef(computePresenterBand)
  computePresenterBandRef.current = computePresenterBand

  // Presenter "send to view" push — triggered by the shared top bar's presenter button
  // (TopBar.tsx) via presenterPushToken, since the scroll-position capture below depends
  // on getScrollEl()/tabState which only this panel has access to. Skips the initial
  // mount so opening a Bible tab doesn't push to an already-open viewer unprompted.
  const presenterPushToken = useAppStore((s) => s.presenterPushToken)
  // Tracks the last SEEN token, not a "have I run before" boolean — see NotesPanel.tsx's
  // identical fix (lastSeenNotesHomeTokenRef) for why a boolean-ref "skip the first call"
  // guard is unsafe under React 18 StrictMode's dev-only double-invoke of a genuine mount's
  // effects: the boolean survives the replay unchanged, so the SECOND of the two invocations
  // sees it already consumed and fires anyway, pushing to the presenter view on every fresh
  // mount of this panel even though presenterPushToken never actually changed.
  const lastSeenPresenterPushTokenRef = useRef(presenterPushToken)
  useEffect(() => {
    if (presenterPushToken === lastSeenPresenterPushTokenRef.current) return
    lastSeenPresenterPushTokenRef.current = presenterPushToken
    if (floating) return
    const container = getScrollEl()
    if (container) {
      // measureContentHeight (content-bottom-clamped), not raw scrollHeight — matches every
      // other place that measures this panel's scrollable range (computePresenterBand,
      // ViewerBiblePage.tsx's own reportVisible). Using raw scrollHeight here made this one
      // explicit "send to view" push compute a systematically smaller percent than the rest of
      // the pipeline for a short chapter with trailing empty space below the last verse.
      const cTop = container.getBoundingClientRect().top
      let contentBottom = 0
      for (const node of Array.from(container.querySelectorAll('[data-verse]'))) {
        const r = (node as HTMLElement).getBoundingClientRect()
        const bottom = r.bottom - cTop + container.scrollTop
        if (bottom > contentBottom) contentBottom = bottom
      }
      const contentHeight = measureContentHeight(container.scrollHeight, contentBottom)
      const max = contentHeight - container.clientHeight
      const percent = max > 0 ? container.scrollTop / max : 0
      setMainBibleScrollPercent(percent, `${tabState.bookId}:${tabState.chapter}`)
      // This is an explicit absolute re-sync (not a physical scroll gesture), so resync the
      // handleBibleScroll accumulator straight to this accurate ratio too — otherwise the
      // next real scroll would resume its sensitivity-normalized delta from a stale baseline.
      virtualScrollPctRef.current = percent
      lastMainScrollTopRef.current = container.scrollTop
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
    // Double-rAF: a font-size-driven reflow (zoom/bibleFontSize/etc.) isn't guaranteed to be
    // reflected in getBoundingClientRect() within a single frame, so remeasuring one rAF after
    // the change can read stale verse-top positions — worse the smaller each verse is on screen
    // (i.e. at lower zoom, where more/shorter verses fit the viewport and the same stale-pixel
    // error is a larger fraction of a verse's height). Waiting an extra frame lets layout settle
    // before computePresenterBand() measures.
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        if (!useAppStore.getState().viewerPaused) computePresenterBand()
      })
    })
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2) }
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

  // Keep the presenter band (the "outline" showing what's live on the Presenter screen) from
  // scrolling fully out of view when the USER manually scrolls the main window away from it —
  // per direct ask: "postpone the vertical scrolling of the chapter and only scroll the outline
  // down so that the outline never gets out of the viewable area." Only ever engages once the
  // band and the current view are far enough apart that a plain scroll would actually hide it
  // entirely (a short chapter where everything's already on screen never triggers this) — and
  // only caps how far a manual scroll can go in the direction that would hide it further; it
  // never resists scrolling BACK toward the band. band.top/height are in the same CONTENT-space
  // coordinates as scrollTop (see computePresenterBand above) and only change when the
  // presenter's own visible region changes — they stay put while the user scrolls THIS window,
  // so reading presenterBand from React state here (rather than re-measuring) is safe, not stale.
  useEffect(() => {
    if (floating || !viewerWindowOpen || viewerPaused || !presenterBand) return
    const el = getScrollEl()
    if (!el) return
    const MIN_VISIBLE_PX = 24
    function clampToKeepBandVisible() {
      const band = presenterBand
      if (!band || !el) return
      const bandTop = band.top, bandBottom = band.top + band.height
      const viewTop = el.scrollTop, viewBottom = viewTop + el.clientHeight
      if (bandTop > viewBottom) {
        // Scrolled UP past the band (band now below the visible area) — cap how far up.
        el.scrollTop = Math.max(0, bandTop - el.clientHeight + MIN_VISIBLE_PX)
      } else if (bandBottom < viewTop) {
        // Scrolled DOWN past the band (band now above the visible area) — cap how far down.
        el.scrollTop = Math.min(el.scrollHeight - el.clientHeight, bandBottom - MIN_VISIBLE_PX)
      }
    }
    el.addEventListener('scroll', clampToKeepBandVisible, { passive: true })
    return () => el.removeEventListener('scroll', clampToKeepBandVisible)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floating, viewerWindowOpen, viewerPaused, presenterBand, continuousChapterScroll])

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
    recordTranslationSwitch(tid)
    // Capture the currently top-visible verse before ANY edition switch below (same
    // mechanism the Strong's toggle uses — see captureStrongsAnchor's comment) so the
    // translation change can restore roughly the same reading position instead of always
    // snapping to the top of the chapter. Restored by the effect keyed on
    // tabState.translation further down, once the new edition's data has loaded.
    captureStrongsAnchor()
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
        // scrollPosition is deliberately left alone here (not forced to 0) — the anchor
        // restore above handles repositioning for the common case (same/similar verse
        // layout); if the anchor verse genuinely doesn't exist in the new edition,
        // restoreStrongsAnchor's querySelector simply finds nothing and no-ops, which
        // safely leaves the scroll wherever the reflow naturally landed rather than
        // forcing a jump to the top for editions whose verse layout actually DOES differ.
        updateTabState('scripture', activeTab.id, {
          translation: tid.toUpperCase(),
          chapter: mappedChapter,
          targetVerse: undefined,
          endVerse: undefined,
        })
      } else {
        const first = (bks as Book[])[0]
        updateTabState('scripture', activeTab.id, first
          ? { translation: tid.toUpperCase(), bookId: first.id, chapter: 1, targetVerse: undefined, endVerse: undefined }
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
    // Search-mode tabs get their title from ScriptureSearchView's own debounced
    // onStateChange (below) instead of here — that one knows the live query and
    // renders it as the title (e.g. `"seven"`). Forcing a synchronous rename to
    // the literal string "Search" here as well raced against that debounce:
    // switching to an existing search tab with a saved query briefly flashed
    // "Search" before the real query-based title landed ~150ms later.
    if (tabState.searchMode) return
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

  // Compare mode's own title, kept in sync with the columns themselves — the effect above
  // only reacts to tabState.bookId/chapter, which stay frozen at whatever they were the
  // moment compare mode was entered (CompareView.tsx owns its own per-column book/chapter
  // state independently in tabState.compareColumns). Without this, the tab title froze at
  // "Compare — <original chapter>" forever, never reflecting later column navigation
  // (next/prev chapter, translation switch, or the reference-bar picker in any column).
  useEffect(() => {
    if (!activeTab || !tabState.compareMode) return
    const cols = tabState.compareColumns
    const refs = cols && cols.length > 0
      ? cols.map((c) => {
          const b = books.find((bk) => bk.id === c.bookId)
          return `${b?.name ?? bookName(c.bookId)} ${c.chapter}`
        })
      : currentBook ? [`${currentBook.name} ${tabState.chapter}`] : []
    // No "Compare — " prefix — the tab's own icon already signals it's a compare tab.
    // Same book+chapter across every column (just different translations, e.g. KJV vs LXX
    // side by side): show the reference once, followed by each column's translation. Different
    // book/chapter per column: show each column's own reference instead, no translation labels.
    let title: string
    const uniqRefs = [...new Set(refs)]
    if (uniqRefs.length === 1 && cols && cols.length > 0) {
      title = `${uniqRefs[0]} ${cols.map((c) => c.textId.toUpperCase()).join(' / ')}`
    } else {
      title = uniqRefs.length > 0 ? uniqRefs.join(' / ') : 'Compare'
    }
    if (activeTab.title !== title) renameTab('scripture', activeTab.id, title)
  }, [tabState.compareMode, tabState.compareColumns, books, currentBook, activeTab?.id, activeTab?.title, tabState.chapter, renameTab])

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
    // If the user has an active text selection inside this chapter, anchor on the
    // selection's own on-screen position instead of just "whichever verse happens to sit
    // at the very top" — a selection is very often mid-verse or mid-chapter, well below the
    // container's top edge, so anchoring on the topmost verse could land the flip's
    // corrective scroll far from where the user was actually looking/selecting. The
    // selection itself isn't restored (the underlying text nodes are regenerated by the
    // reflow either way) — only its screen position is, same mechanism as the verse anchor.
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0)
      const startNode = range.startContainer
      const startEl = startNode.nodeType === Node.ELEMENT_NODE ? (startNode as Element) : startNode.parentElement
      const verseEl = startEl?.closest<HTMLElement>('[data-verse]')
      if (verseEl && container.contains(verseEl)) {
        const rect = range.getBoundingClientRect()
        // A collapsed-looking rect (0-width/height, can happen for some range shapes) has
        // nothing useful to anchor on — fall through to the topmost-visible-verse path below.
        if (rect.width > 0 || rect.height > 0) {
          strongsAnchorRef.current = {
            verseNum: parseInt(verseEl.dataset.verse ?? '0', 10),
            offsetPx: rect.top - containerTop,
          }
          return
        }
      }
    }
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
    const el = container.querySelector<HTMLElement>(`[data-verse="${anchor.verseNum}"]`)
    if (!el) return
    const containerTop = container.getBoundingClientRect().top
    const elTop = el.getBoundingClientRect().top
    container.scrollTop += elTop - containerTop - anchor.offsetPx
    setFlashAnchor({ verse: anchor.verseNum, nonce: Date.now() })
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
    // View Transitions capture/animate the named element as a plain snapshot image,
    // rendered in a top-layer overlay that ignores the scroll container's own overflow
    // clipping — while scrolled to the very top of the chapter that's harmless (the tall
    // content div's top edge IS the visible viewport's top edge), but scrolled DOWN even a
    // little, that same un-clipped snapshot's natural on-screen position extends up past
    // the visible reading area and can paint over ShellHeader's top bar for the ~100ms the
    // transition runs. Skipping the transition outright whenever scrolled — falling back to
    // an instant, non-animated update — is what actually avoids that, not any amount of CSS
    // clipping (tried and reverted; it clipped view transitions elsewhere in the app too).
    const scrolledToTop = (getScrollEl()?.scrollTop ?? 0) < 2
    if (scrolledToTop && typeof document !== 'undefined' && typeof document.startViewTransition === 'function') {
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

  // Restore scroll anchor after the Strong's layout reflow settles. useLayoutEffect (not
  // useEffect) so this runs synchronously right after the DOM update, before the browser
  // paints — a plain useEffect runs post-paint, which meant the reflowed (un-anchored) layout
  // was visible for one real frame before the double-rAF correction landed on top of it,
  // reading as a "lost my place" jump on every toggle that wasn't scrolled to the very top
  // (the only case that gets a View Transition crossfade instead — see toggleStrongsForTab).
  // A layout effect's DOM reads are already post-layout, so no rAF wait is needed here either.
  useLayoutEffect(() => {
    restoreStrongsAnchor()
  }, [tabState.showStrongs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Type-anywhere digit → go to verse ────────────────────────────────────
  // Accumulate typed digits and navigate after a short pause.
  const [verseDigitAccum, setVerseDigitAccum] = useState('')
  const verseDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Declared after prevBibleTabIdForResetRef's block above (can't add these two there without a
  // "used before declaration" error), so reset them separately here — still via useLayoutEffect
  // (not useEffect) so it fires before paint, same "no flash of stale state" guarantee. Before
  // BiblePanel stayed mounted across tab switches, a real remount's effect cleanup would cancel
  // any in-flight digit accumulation for free; without this, typing a couple of digits then
  // switching tabs within the 1s window fired the jump ~1s later against the NEW tab instead.
  useLayoutEffect(() => {
    setVerseDigitAccum('')
    if (verseDigitTimerRef.current) { clearTimeout(verseDigitTimerRef.current); verseDigitTimerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

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
                scrollVerseIntoView(el, VERSE_JUMP_ANIMATED_START)
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
    // Self-heals persisted state saved from before this feature's various fixes — a tab's saved
    // state can still have slot A's active tab ALSO present in slot B's set (from the
    // single-tab-per-slot model's fallback bug, or the earlier locked-single-tab model), or
    // slot B owning every single tab type (leaving slot A with nothing, an invalid state this
    // multi-tab-per-slot model must never produce going forward but could still be restoring
    // from before that was true). A code fix alone doesn't repair state that was already
    // corrupted before it shipped — this repairs it the next time the tab is opened, not just
    // prevents new cases. Also migrates the OLD single-tab persisted format (rightPanelSlotB
    // was the only field, always exactly one type) into the new rightPanelSlotBTabs set.
    if ('rightPanelSlotBTabs' in tabState || 'rightPanelSlotB' in tabState) {
      let restoredSlotBTabs = tabState.rightPanelSlotBTabs ?? (tabState.rightPanelSlotB ? [tabState.rightPanelSlotB] : [])
      let restoredTabA = tabState.rightPanelTab ?? rightPanelTab
      if (restoredSlotBTabs.length >= ALL_PANEL_TABS.length) {
        restoredSlotBTabs = []
      } else if (restoredSlotBTabs.includes(restoredTabA)) {
        const remaining = ALL_PANEL_TABS.filter((t) => !restoredSlotBTabs.includes(t))
        restoredTabA = remaining[0] ?? 'notes'
      }
      const restoredSlotB = restoredSlotBTabs.length === 0
        ? null
        : (tabState.rightPanelSlotB && restoredSlotBTabs.includes(tabState.rightPanelSlotB) ? tabState.rightPanelSlotB : restoredSlotBTabs[0])
      setRightPanelTab(restoredTabA)
      setRightPanelSlotBTabs(restoredSlotBTabs)
      setRightPanelSlotB(restoredSlotB)
      if (activeTab) {
        updateTabState('scripture', activeTab.id, {
          rightPanelTab: restoredTabA, rightPanelSlotBTabs: restoredSlotBTabs, rightPanelSlotB: restoredSlotB,
        })
      }
    }
    if (tabState.rightPanelNoteIdB !== undefined) setRightPanelNoteIdB(tabState.rightPanelNoteIdB ?? null)
    if (tabState.rightPanelLexiconEntryB !== undefined) setRightPanelLexiconEntryB(tabState.rightPanelLexiconEntryB ?? null)
    if (tabState.rightPanelExpandAll !== undefined) setRightPanelExpandAll(tabState.rightPanelExpandAll)
    if (tabState.rightPanelExpandAllB !== undefined) setRightPanelExpandAllB(tabState.rightPanelExpandAllB)
  }, [tabState.rightPanelOpen, tabState.rightPanelTab, tabState.rightPanelNoteId, tabState.rightPanelLexiconEntry, tabState.rightPanelSlotB, tabState.rightPanelNoteIdB, tabState.rightPanelLexiconEntryB, tabState.rightPanelExpandAll, tabState.rightPanelExpandAllB, activeTab?.id]) // eslint-disable-line react-hooks/exhaustive-deps

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
      scrollVerseIntoView(el, VERSE_JUMP_ANIMATED_CENTER)
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

  function navigate(bookId: string, chapter: number, endChapter?: number, origin: NavOrigin = { kind: 'book-chapter-picker' }) {
    if (!activeTab) return
    const title = makeTitle(bookId, chapter, endChapter)
    // Clear any verse-specific right-panel filter left over from before this
    // navigation (e.g. from clicking into a verse's notes) — without this, the
    // side panel's "mentions this chapter" section stayed suppressed by its own
    // `!verseFilter` guard on every later chapter the user paged to, since nothing
    // else ever reset it on plain chapter navigation.
    setRightPanelVerseFilter(null)
    const priorBookId = tabState.bookId, priorChapter = tabState.chapter, priorVerse = tabState.targetVerse
    updateTabState('scripture', activeTab.id, {
      bookId, chapter, endChapter, scrollPosition: 0, targetVerse: undefined, endVerse: undefined, noteBack: null, scriptureBack: null,
      rightPanelVerseFilter: null,
    })
    renameTab('scripture', activeTab.id, title)
    recordNavigation({ bookId: priorBookId, chapter: priorChapter, verse: priorVerse }, { bookId, chapter }, origin)
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
    const ref = getPrevChapterRef(books, tabState.bookId, tabState.chapter, textId, { endChapter: tabState.endChapter })
    if (ref) navigate(ref.bookId, ref.chapter, undefined, { kind: 'sequential-nav' })
  }

  function nextChapter() {
    if (continuousChapterScroll && !tabState.endChapter && !isHermasBook(tabState.bookId)) {
      if (tabState.chapter < chapterCount) {
        continuousScrollRef.current?.scrollToChapter(tabState.chapter + 1)
      }
      return
    }
    const ref = getNextChapterRef(books, tabState.bookId, tabState.chapter, chapterCount, textId, { endChapter: tabState.endChapter })
    if (ref) navigate(ref.bookId, ref.chapter, undefined, { kind: 'sequential-nav' })
  }

  function toggleRightPanel() {
    const next = !rightPanelOpen
    setRightPanelOpen(next)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelOpen: next })
  }

  function handleRightPanelTabChange(tab: 'notes' | 'lexicon' | 'crossrefs') {
    lastRightPanelTabRef.current = rightPanelTab
    setRightPanelTab(tab)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelTab: tab })
  }

  function handleRightPanelTabChangeB(tab: 'notes' | 'lexicon' | 'crossrefs') {
    setRightPanelSlotB(tab)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelSlotB: tab })
  }

  function handleRightPanelNoteChangeB(noteId: string | null) {
    setRightPanelNoteIdB(noteId)
    lastNoteCursorRefB.current = null
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelNoteIdB: noteId, rightPanelNoteCursorB: null })
  }

  function handleRightPanelNoteCursorChangeB(pos: number) {
    lastNoteCursorRefB.current = pos
  }

  function handleRightPanelLexiconChangeB(entry: string | null) {
    setRightPanelLexiconEntryB(entry)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelLexiconEntryB: entry })
  }

  function handleRightPanelVerseFilterChangeB(filter: string | null) {
    setRightPanelVerseFilterB(filter)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelVerseFilterB: filter })
  }

  function handleRightPanelExpandAllChange(next: boolean) {
    setRightPanelExpandAll(next)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelExpandAll: next })
  }

  function handleRightPanelExpandAllChangeB(next: boolean) {
    setRightPanelExpandAllB(next)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelExpandAllB: next })
  }

  // Move a tab INTO slot B — whether B doesn't exist yet (a fresh pop-out) or already holds
  // one or two other tabs (dragging an ADDITIONAL tab in, per explicit direction: "if i drag
  // an additional tab to the popped out sidepanel, then that popped out sidepanel should have
  // now two tabs"). Both are the same operation: add to the set.
  function moveToSlotB(tab: PanelTab) {
    if (rightPanelSlotBTabs.includes(tab)) return
    const newSlotBTabs = [...rightPanelSlotBTabs, tab]
    if (newSlotBTabs.length >= ALL_PANEL_TABS.length) {
      // Every tab now lives in slot B — nothing left for slot A to show on its own. Per
      // explicit direction ("if i drag the last tab into the popped out sidepanel, then the
      // sidepanel should just go back to default"): collapse back to a single panel, with
      // slot A taking over this tab and slot B closing — slot A's available set naturally
      // reverts to all three once rightPanelSlotBTabs is empty again.
      setRightPanelSlotBTabs([])
      setRightPanelSlotB(null)
      setRightPanelTab(tab)
      if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelSlotBTabs: [], rightPanelSlotB: null, rightPanelTab: tab })
      return
    }
    setRightPanelSlotBTabs(newSlotBTabs)
    setRightPanelSlotB(tab)
    let newTabA = rightPanelTab
    if (rightPanelTab === tab) {
      // Slot A's own active tab just left — fall back to whatever remains in ITS set. If slot
      // A had never been switched away from that type before (lastRightPanelTabRef still
      // equals it too), fall back to any other of the types still left to A rather than the
      // literal string 'notes' — otherwise popping "notes" itself out (the default tab) could
      // fall back to a type that's ALSO just been claimed by slot B, defeating the fallback.
      const remaining = ALL_PANEL_TABS.filter((t) => !newSlotBTabs.includes(t))
      newTabA = (lastRightPanelTabRef.current !== tab && remaining.includes(lastRightPanelTabRef.current))
        ? lastRightPanelTabRef.current
        : remaining[0]
      setRightPanelTab(newTabA)
    }
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelSlotBTabs: newSlotBTabs, rightPanelSlotB: tab, rightPanelTab: newTabA })
  }

  // Move a tab OUT of slot B, back into slot A. If that was slot B's last remaining tab, slot
  // B closes entirely; otherwise slot B keeps its other tab(s) and just needs a new active one
  // if the one that left was the one showing.
  function moveToSlotA(tab: PanelTab) {
    lastRightPanelTabRef.current = rightPanelTab
    const newSlotBTabs = rightPanelSlotBTabs.filter((t) => t !== tab)
    setRightPanelTab(tab)
    setRightPanelSlotBTabs(newSlotBTabs)
    const newSlotB = newSlotBTabs.length === 0 ? null : (rightPanelSlotB === tab ? newSlotBTabs[0] : rightPanelSlotB)
    setRightPanelSlotB(newSlotB)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelTab: tab, rightPanelSlotBTabs: newSlotBTabs, rightPanelSlotB: newSlotB })
  }

  function closeSlotB() {
    setRightPanelSlotBTabs([])
    setRightPanelSlotB(null)
    if (activeTab) updateTabState('scripture', activeTab.id, { rightPanelSlotBTabs: [], rightPanelSlotB: null })
  }

  // Single entry point for BOTH the tab-strip context menu and drag-and-drop, called with the
  // explicit TARGET slot rather than requiring the caller to know which underlying function
  // handles which direction — passed identically to both slot A and slot B's BibleRightPanel
  // instances (see panelEl below), so `onDrop`'s "whichever instance's strip received the drop"
  // dispatch is always calling something real, never a prop that was conditionally undefined
  // on that particular instance (the actual bug behind drag-and-drop silently doing nothing).
  function moveTab(tab: PanelTab, toSlot: 'A' | 'B') {
    if (toSlot === 'B') moveToSlotB(tab)
    else moveToSlotA(tab)
  }

  // Closing slot A while slot B is open would otherwise leave slot A empty and slot B
  // populated — an inconsistent state a fixed two-slot layout can't represent. Promote slot
  // B's currently-active tab into slot A's place instead (mirroring YouTube's closePanelA/
  // closePanelB pattern) — if slot B held more than one tab, the others simply become
  // available again in the single surviving panel, same as closing slot B directly would do.
  function closeSlotA() {
    if (rightPanelSlotB) {
      moveToSlotA(rightPanelSlotB)
    } else {
      toggleRightPanel()
    }
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
        // This is a discontinuous jump, not a physical scroll gesture — resync
        // handleBibleScroll's sensitivity-based accumulator straight to the accurate ratio at
        // this new position so the next real scroll doesn't smooth its delta in from a stale
        // pre-jump baseline (see handleBibleScroll's own comment on this pattern).
        const newMax = container.scrollHeight - container.clientHeight
        virtualScrollPctRef.current = newMax > 0 ? container.scrollTop / newMax : 0
        lastMainScrollTopRef.current = container.scrollTop
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
      // Same resync as the verse-anchor branch above — this is a saved-position restore,
      // not a physical scroll gesture.
      const newMax = el.scrollHeight - el.clientHeight
      virtualScrollPctRef.current = newMax > 0 ? pos / newMax : 0
      lastMainScrollTopRef.current = pos
    }
  }, []) // refs never change identity — getScrollEl reads refs directly

  // Clears targetVerse AND its companion search-highlight fields together — leaving the
  // latter behind after the former is consumed would highlight a stale term the next time
  // targetVerse is set from somewhere that doesn't also pass a highlight (e.g. a plain
  // cross-ref/note verse link).
  // The three handlers below are the props BiblePanel hands to `memo(ChapterView)`.
  // They are wrapped in useCallback and keyed on the active tab's ID (never the tab
  // OBJECT, whose identity is replaced by every updateTabState call) so their identity
  // survives an ordinary BiblePanel re-render. As plain function declarations they were
  // recreated on every render, which made ChapterView's memo() comparison fail every
  // single time — so toggling the side panel re-rendered the entire chapter subtree
  // before React could paint anything, including the toggle button's own highlight.
  // With stable identities the memo actually bails out and the toggle commits cheaply.
  const memoTabId = activeTab?.id

  const clearTargetVerse = useCallback(() => {
    if (!memoTabId) return
    // Mirror presenterScrollToVerse's other half of this pair: the presenter (when open) centers
    // on this same verse via its own `verse` payload prop (ViewerBiblePage.tsx, block: 'center'),
    // so it is NOT mirroring the main window's scroll proportion right now. Tell
    // computePresenterBand which verse to anchor on instead — without this the outline band
    // either doesn't move (verse was already on-screen, so no scroll event ever fired to trigger
    // a recompute) or lands using a stale proportional guess.
    const jumpedVerse = tabStateRef.current.targetVerse
    if (jumpedVerse != null) findCenterVerseRef.current = jumpedVerse
    updateTabState('scripture', memoTabId, {
      targetVerse: undefined, targetVerseQuery: undefined, targetVerseWordMode: undefined,
      targetVerseStrongsWords: undefined, targetVerseStrongsExtraWords: undefined,
    })
    // A verse-jump just finished scrolling. If the target verse was already on-screen in the
    // main window, scrollIntoView was a no-op and no native `scroll` event fired to refresh
    // the viewer's cached scroll percent — invalidate it so the presenter/viewer window (if
    // open) falls back to centering on the jumped-to verse instead of reusing a stale percent.
    if (tabStateRef.current.bookId) {
      clearMainBibleScrollPercent(`${tabStateRef.current.bookId}:${tabStateRef.current.chapter}`)
    }
    // The scrollIntoView call just above (in ChapterView) intentionally pins the target verse
    // to the TOP of the main window — correct there, but the resulting native `scroll` event
    // fires handleBibleScroll asynchronously afterward, which would otherwise push that same
    // top-pinned proportion to the viewer/presenter and override its own centered
    // (`block: 'center'`) placement of the verse. Briefly suppress that proportional push —
    // same mechanism the find bar already uses via presenterScrollToVerse — so the presenter
    // keeps the target verse centered in context instead of pinned to its edge.
    findScrollSuppressRef.current = Date.now() + 700
    // If the jumped-to verse was already on screen, the scrollIntoView above was a no-op, so no
    // native `scroll` event fires and nothing else would trigger a band recompute for this jump.
    // Force one directly (the target verse's DOM position is already settled — this callback
    // fires after ChapterView's own scroll-to-verse effect has run).
    if (!useAppStore.getState().viewerPaused) computePresenterBandRef.current()
  }, [memoTabId, updateTabState])

  const handleStrongsClick = useCallback((strongsNum: string, verseNum?: number) => {
    // No side panel in floating windows — skip opening it
    if (!floating) {
      setRightPanelLexiconEntry(strongsNum)
      setRightPanelTab('lexicon')
      setRightPanelOpen(true)
      if (memoTabId) updateTabState('scripture', memoTabId, { rightPanelLexiconEntry: strongsNum, rightPanelTab: 'lexicon', rightPanelOpen: true })
    }
    // Track in history with chain parent = most recent history entry
    const recentId = useAppStore.getState().history[0]?.id
    useAppStore.getState().addHistoryEntry({
      type: 'strongs-click',
      title: strongsNum,
      strongsNum,
      parentId: recentId,
    })
    // verseNum — the specific verse this Strong's number was clicked from — was previously
    // never threaded through this whole callback chain (StrongsInline -> VerseRow ->
    // ChapterView -> here), even though every level already renders one verse at a time and
    // had it in scope. Confirmed root cause of "clicked strongs from 2 peter 3 and it didn't
    // track the verse I clicked that from."
    recordLexiconConnection(strongsNum, 'click', verseNum)
  }, [floating, memoTabId, updateTabState])

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

  const handleWordClick = useCallback((word: string) => {
    if (floating) return  // no side panel in float windows
    setRightPanelTab('lexicon')
    setRightPanelOpen(true)
    if (memoTabId) updateTabState('scripture', memoTabId, { rightPanelTab: 'lexicon', rightPanelOpen: true })
    requestLexiconSearch(word)
  }, [floating, memoTabId, updateTabState, requestLexiconSearch])

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

  // Vertical resize drag handle (for panel-bottom/notes-bottom/notes-top/compare-notes) — same
  // rAF throttling as the horizontal one above. Was writing into rightPanelWidth (the SIDE
  // panel's own width state) despite being labeled/positioned as a height drag — dragging this
  // divider silently changed what width the side panel would use if the layout was later
  // switched to 'standard'. Now writes bottomPanelHeight, the same field
  // handleLCVResizeMouseDown/split-bottom's divider already correctly uses, with the same clamp
  // range (120-520, matching split-bottom's own sbHeight) instead of the horizontal drag's
  // 200-520 width range.
  const vResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  function handleVResizeMouseDown(e: React.MouseEvent) {
    vResizeRef.current = { startY: e.clientY, startHeight: bottomPanelHeight }
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
        setBottomPanelHeight(Math.max(120, Math.min(520, vResizeRef.current.startHeight + delta)))
      })
    }
    function onUp(e: MouseEvent) {
      if (!vResizeRef.current) return
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      const delta = vResizeRef.current.startY - e.clientY
      const finalHeight = Math.max(120, Math.min(520, vResizeRef.current.startHeight + delta))
      setBottomPanelHeight(finalHeight)
      if (activeTab) updateTabState('scripture', activeTab.id, { bottomPanelHeight: finalHeight })
      vResizeRef.current = null
      setIsResizingPanel(false)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Two-finger trackpad swipe to collapse/expand the right side panel ────────
  // Rebuilt from scratch as a standalone hook (src/hooks/useSwipePanelGesture.ts) after
  // the previous inline version turned out clunky — see that file for the full design
  // writeup. `dragFrac` mirrors the old `restFrac` (0 = open, 1 = closed, null = not
  // dragging); `isDragging` drives the same `isResizingPanel` transition-suppression flag
  // the manual mouse-drag resize handle above also uses, so both features keep sharing it.
  const swipeGestureEnabled = useAppStore((s) => s.swipePanelGestureEnabled)
  const { panelAreaRef, dragFrac: restFrac, isDragging: swipeDragging } = useSwipePanelGesture({
    enabled: swipeGestureEnabled,
    isOpen: rightPanelOpen,
    onCommit: useCallback((open: boolean) => {
      setRightPanelOpen(open)
      const curTab = useAppStore.getState().tabs.scripture.find((t) => t.id === useAppStore.getState().activeTabId.scripture)
      if (curTab) updateTabState('scripture', curTab.id, { rightPanelOpen: open })
    }, [updateTabState]),
  })
  useEffect(() => { setIsResizingPanel(swipeDragging) }, [swipeDragging])

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
    // In Continuous Chapter Scroll mode, `container` is the WHOLE multi-chapter scroll region
    // (loaded chapters + height-preserving placeholder spacers for evicted ones spanning the
    // entire book) — using its raw scrollHeight/scrollTop here computed "how far scrolled
    // through the ENTIRE BOOK", not "how far through the CURRENT chapter" the presenter is
    // actually showing. Since there's almost always much more book left below the current
    // chapter, that percent stayed pinned near 0 for every chapter except the literal last one
    // in the book — reported as "the presenter doesn't get to the bottom of the scripture."
    // Fix: measure against the CURRENT chapter's own wrapper element (data-chapter, set by
    // ContinuousChapterScroll.tsx) instead of the shared container when it's found, falling
    // back to the container's own bounds otherwise (the plain non-continuous single-chapter
    // div, where container IS the chapter).
    const chapterHeadingEl = continuousChapterScroll
      ? (container.querySelector(`[data-chapter="${tabStateRef.current.chapter}"]`) as HTMLElement | null)
      : null
    const chapterWrapperEl = (chapterHeadingEl?.parentElement as HTMLElement | null) ?? (continuousChapterScroll ? null : container)
    let effScrollTop = scrollTop
    let max = container.scrollHeight - container.clientHeight
    if (continuousChapterScroll && chapterWrapperEl) {
      const cRect = container.getBoundingClientRect()
      const wRect = chapterWrapperEl.getBoundingClientRect()
      const chapterTop = wRect.top - cRect.top + scrollTop
      effScrollTop = Math.max(0, scrollTop - chapterTop)
      max = chapterWrapperEl.offsetHeight - container.clientHeight
      if (window.__bereanPresenterDebug) {
        console.log('[PresenterDebug continuous-chapter-bounds]', {
          chapter: tabStateRef.current.chapter, chapterTop, chapterHeight: chapterWrapperEl.offsetHeight,
          rawScrollTop: scrollTop, effScrollTop, max,
        })
      }
    }
    // Ground truth: what verses are ACTUALLY on-screen in the MAIN window right now, measured
    // directly from the viewport (not derived from any percent/fraction math) — the single most
    // useful line for comparing against the presenter's own [PD ...] logs at the same moment.
    // Scoped to chapterWrapperEl (this chapter's own subtree) in continuous mode so a verse
    // number collision with an adjacent, partially-visible chapter can't pollute the range.
    if (window.__bereanPresenterDebug) {
      const scope = chapterWrapperEl ?? container
      const cRectForVerses = container.getBoundingClientRect()
      let onScreenFirst: number | null = null, onScreenLast: number | null = null
      for (const node of Array.from(scope.querySelectorAll('[data-verse]'))) {
        const elx = node as HTMLElement
        const n = Number(elx.dataset.verse)
        if (!Number.isFinite(n)) continue
        const r = elx.getBoundingClientRect()
        const top = r.top - cRectForVerses.top, bottom = r.bottom - cRectForVerses.top
        if (bottom > 0 && top < container.clientHeight) {
          if (onScreenFirst === null || n < onScreenFirst) onScreenFirst = n
          if (onScreenLast === null || n > onScreenLast) onScreenLast = n
        }
      }
      console.log('[PD main GROUND TRUTH]', {
        bookId: tabStateRef.current.bookId, chapter: tabStateRef.current.chapter,
        rawScrollTop: scrollTop, scrollHeight: container.scrollHeight, clientHeight: container.clientHeight,
        onScreenVerses: [onScreenFirst, onScreenLast], continuousChapterScroll,
      })
    }
    const st = useAppStore.getState()
    let scrollPercent: number
    if (Date.now() < findScrollSuppressRef.current) {
      // A verse-jump (find bar or targetVerse navigation) just scrolled this container
      // programmatically — this scroll event is that jump's own side effect, not a real user
      // scroll. Resync the accumulator straight to the accurate ratio (bypassing the
      // sensitivity-based delta smoothing below, which is only meant for genuine physical
      // scroll gestures) so a later real scroll resumes from wherever the main panel actually
      // sits, not from wherever the jump's own scroll events happened to accumulate to.
      // Don't record it as the "last known" percent either: caching it here would leave the
      // presenter's stale-vs-fresh check (in computeViewerPayload) with a poisoned value for
      // this chapter that a later, unrelated push could pick up and wrongly reuse.
      scrollPercent = max > 0 ? effScrollTop / max : 0
      virtualScrollPctRef.current = scrollPercent
      lastMainScrollTopRef.current = scrollTop
      findScrollSuppressRef.current = Math.max(findScrollSuppressRef.current, Date.now() + 350)
    } else {
      // THE actual percent pushed to the presenter — this used to run the physical scrollTop
      // delta through a "sensitivity" normalization against the PRESENTER's own (often
      // different) scrollable range, accumulating onto virtualScrollPctRef tick by tick instead
      // of just reading the true position. That accumulation DRIFTS: confirmed via logging
      // (see the [PD SUSPICIOUS JUMP at settle] investigation) that after continuous scrolling
      // through a single chapter, the accumulated value can end up roughly HALF the true
      // scrollTop/max ratio at the exact same physical position — nothing except hitting an
      // exact 0/1 endpoint, or the scroll-settle timer, ever re-anchored it to reality in
      // between. Since computePresenterBand (the outline drawn in THIS window) already uses the
      // panel's own true ratio directly, that drift is exactly why the outline tracked
      // correctly while the actual presenter window (fed this now-wrong value) didn't — "the
      // presenter isn't aligned with the outline" was two different numbers being computed for
      // the same physical scroll position. Fixed: always use the true ratio directly, the same
      // math the endpoint-snapping already used at 0/1, extended to every point in between —
      // matching computePresenterBand and the scroll-settle timer's math exactly, so there's
      // only ever ONE definition of "where this panel is scrolled to."
      lastMainScrollTopRef.current = scrollTop
      scrollPercent = max <= 0 ? 0 : Math.max(0, Math.min(1, effScrollTop / max))
      virtualScrollPctRef.current = scrollPercent
      setMainBibleScrollPercent(scrollPercent, `${tabStateRef.current.bookId}:${tabStateRef.current.chapter}`)
    }
    if (Date.now() >= findScrollSuppressRef.current && st.viewerWindowOpen && !st.viewerPaused) {
      findCenterVerseRef.current = null
      if (viewerScrollRAFRef.current) cancelAnimationFrame(viewerScrollRAFRef.current)
      viewerScrollRAFRef.current = requestAnimationFrame(() => {
        viewerScrollRAFRef.current = null
        const base = computeViewerPayload()
        if (base.kind === 'bible') {
          const pushChapterKey = `${base.bookId}:${base.chapter}`
          if (window.__bereanPresenterDebug) {
            const prev = lastPushedDebugRef.current
            const isJump = prev && prev.chapterKey === pushChapterKey && Math.abs(scrollPercent - prev.percent) > 0.15
            console.log('[PD main scroll→push]', {
              rawScrollTop: scrollTop, effScrollTop, max, DECIDED_scrollPercent: scrollPercent,
              baseVerseFromPayload: base.verse, baseBookId: base.bookId, baseChapter: base.chapter,
              prevPushedPercent: prev?.percent, prevPushedChapterKey: prev?.chapterKey,
            })
            if (isJump) {
              console.warn('[PD SUSPICIOUS JUMP]', {
                from: prev!.percent, to: scrollPercent, chapterKey: pushChapterKey,
                suppressed: Date.now() < findScrollSuppressRef.current, continuousChapterScroll,
              })
            }
          }
          lastPushedDebugRef.current = { percent: scrollPercent, chapterKey: pushChapterKey }
          window.app.pushViewerContent?.({ ...base, scrollPercent })
        }
        // Coalesced into the same rAF as the push above (was previously unthrottled,
        // running its own getBoundingClientRect() pass over every verse on every raw
        // scroll event even when the push right above it was already rAF-throttled).
        if (!useAppStore.getState().viewerPaused) computePresenterBand()
      })
    } else if (!st.viewerPaused) {
      // Viewer window closed, or this scroll is a suppressed programmatic jump — no rAF
      // batching needed since computePresenterBand() itself no-ops cheaply when the viewer
      // isn't open, but still run it synchronously here so a non-viewer scroll doesn't skip
      // clearing a stale band.
      computePresenterBand()
    }
    // Schedule (or re-schedule) the "scroll has settled" fallback — see scrollSettleTimerRef's
    // own doc comment for the bug this closes. Every scroll tick pushes the deadline out; only
    // once ticks actually stop arriving does this fire, at which point it forces one final,
    // UNSUPPRESSED sync from the live DOM's true current position. 450ms, not a shorter value —
    // trackpad momentum/inertial scrolling naturally decelerates into gaps between events that
    // can exceed 150-200ms well before the motion has actually stopped; firing this "final,
    // authoritative" sync mid-momentum (reported as a NEW jump right after the original settle
    // fix shipped) forces a real but not-yet-final position, which a moment later gets
    // corrected by the next momentum tick — two real but different positions applied close
    // together reads as a visible jump on the presenter. 450ms comfortably clears normal
    // momentum-scroll gaps while still being far shorter than a person deliberately scrolling
    // again.
    if (scrollSettleTimerRef.current) clearTimeout(scrollSettleTimerRef.current)
    scrollSettleTimerRef.current = setTimeout(() => {
      scrollSettleTimerRef.current = null
      const el = getScrollEl()
      if (!el) return
      const settledScrollTop = el.scrollTop
      const settledHeadingEl = continuousChapterScroll
        ? (el.querySelector(`[data-chapter="${tabStateRef.current.chapter}"]`) as HTMLElement | null)
        : null
      const settledWrapperEl = (settledHeadingEl?.parentElement as HTMLElement | null) ?? (continuousChapterScroll ? null : el)
      let settledEff = settledScrollTop
      let settledMax = el.scrollHeight - el.clientHeight
      if (continuousChapterScroll && settledWrapperEl) {
        const cRect = el.getBoundingClientRect()
        const wRect = settledWrapperEl.getBoundingClientRect()
        const chapterTop = wRect.top - cRect.top + settledScrollTop
        settledEff = Math.max(0, settledScrollTop - chapterTop)
        settledMax = settledWrapperEl.offsetHeight - el.clientHeight
      }
      const settledPercent = settledMax <= 0 ? 0 : settledEff <= 0 ? 0 : settledEff >= settledMax ? 1 : settledEff / settledMax
      virtualScrollPctRef.current = settledPercent
      lastMainScrollTopRef.current = settledScrollTop
      // Force-expire any lingering suppression — this settle sync IS the authoritative final
      // word on where the panel actually rests, superseding whatever jump/find-bar centering
      // was suppressing proportional pushes until now.
      findScrollSuppressRef.current = 0
      setMainBibleScrollPercent(settledPercent, `${tabStateRef.current.bookId}:${tabStateRef.current.chapter}`)
      const settledChapterKey = `${tabStateRef.current.bookId}:${tabStateRef.current.chapter}`
      if (window.__bereanPresenterDebug) {
        const prev = lastPushedDebugRef.current
        const isJump = prev && prev.chapterKey === settledChapterKey && Math.abs(settledPercent - prev.percent) > 0.15
        console.log('[PD scroll-settled]', {
          bookId: tabStateRef.current.bookId, chapter: tabStateRef.current.chapter,
          settledScrollTop, settledEff, settledMax, settledPercent,
          prevPushedPercent: prev?.percent, prevPushedChapterKey: prev?.chapterKey,
        })
        if (isJump) {
          console.warn('[PD SUSPICIOUS JUMP at settle]', { from: prev!.percent, to: settledPercent, chapterKey: settledChapterKey })
        }
      }
      lastPushedDebugRef.current = { percent: settledPercent, chapterKey: settledChapterKey }
      const st2 = useAppStore.getState()
      if (!st2.viewerWindowOpen || st2.viewerPaused) return
      findCenterVerseRef.current = null
      const base = computeViewerPayload()
      if (base.kind === 'bible') window.app.pushViewerContent?.({ ...base, scrollPercent: settledPercent })
      computePresenterBand()
    }, 450)
  }, [updateTabState, computePresenterBand]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dedicated search tab — render ONLY ScriptureSearchView (no toolbar) ──────
  if (tabState.searchMode) {
    const isDedicatedSearchTab = activeTab?.id === 'scripture-search-dedicated'
    return (
      <div className="flex flex-col h-full bg-[rgb(var(--color-surface-3))]">
        <ScriptureSearchView
          // BiblePanel itself is a single persistent instance shared across every 'bible' tab
          // (no key on <BiblePanel/> in ActivePanel.tsx — it resets its OWN state manually on
          // tab switch instead of remounting). ScriptureSearchView doesn't do that: its query/
          // filters/sort are plain useState seeded from initialQuery/persistedState only once,
          // at mount. Without a key here, switching from one Advanced Search tab to ANOTHER
          // (both searchMode tabs, so this branch stays rendered the whole time) never remounts
          // it — it just keeps showing whichever tab's query happened to be there first. Keying
          // on the tab id forces a real remount on tab switch, so each Advanced Search tab
          // starts from its own persisted state again.
          key={activeTab?.id}
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
              // If this call is the unmount-flush firing right after onNavigate already set
              // the correct chapter title, don't re-arm the rename — see the ref's comment.
              if (justNavigatedAwayFromSearchRef.current) {
                justNavigatedAwayFromSearchRef.current = false
              } else {
                searchTabRenameTimerRef.current = setTimeout(() => {
                  // ScriptureSearchView can also unmount because the user switched the active
                  // scripture tab away from this one entirely (click, keyboard nav, Cmd+L
                  // landing elsewhere) — that path never touches justNavigatedAwayFromSearchRef,
                  // since it's not a "click a result" navigation. Its own unmount-flush still
                  // fires this onStateChange with stale (pre-switch) state, which would
                  // otherwise restomp whatever title the newly-active tab just picked up. Guard
                  // against that generically: only rename if tabId is still the active tab.
                  if (useAppStore.getState().activeTabId.scripture !== tabId) return
                  // Also bail if this tab is no longer in search mode at all — e.g. a Cmd+L
                  // reference jump (FloatingSearch) navigated this same tab straight to a
                  // chapter and already set its title ("Jeremiah 4"). ScriptureSearchView's
                  // unmount-flush still fires this with the stale query, which would otherwise
                  // rename the tab back to `"shall call"` ~150ms later.
                  const liveTab = useAppStore.getState().tabs.scripture.find((t) => t.id === tabId)
                  if (!liveTab || !(liveTab.state as { searchMode?: boolean }).searchMode) return
                  const trimmedQuery = (s.query ?? '').trim()
                  useAppStore.getState().renameTab('scripture', tabId, trimmedQuery ? `"${trimmedQuery}"` : 'Search')
                }, 150)
              }
            }
          }}
          onNavigate={(bookId, chapter, verse, tid, highlight) => {
            if (!activeTab) return
            // Cancel any pending debounced query-title rename (see onStateChange above) —
            // otherwise it can still fire ~150ms after this handler runs and silently
            // overwrite the reference title we're about to set back to the search query.
            if (searchTabRenameTimerRef.current) {
              clearTimeout(searchTabRenameTimerRef.current)
              searchTabRenameTimerRef.current = null
            }
            // ScriptureSearchView is about to unmount (searchMode flips to false below) and
            // will flush one last onStateChange call — tell it to skip re-arming the rename.
            justNavigatedAwayFromSearchRef.current = true
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
            // Navigate within this tab (search → reader), preserving search state for back button
            updateTabState('scripture', activeTab.id, {
              translation: newTranslation, bookId, chapter, targetVerse: verse,
              // Carries what matched (searched word/phrase or Strong's word indices) so the
              // landed verse can highlight it, not just flash — see ChapterView's scroll-to-
              // verse effect and VerseRow's targetVerseStrongsWords handling.
              targetVerseQuery: highlight?.query,
              targetVerseWordMode: highlight?.wordMode,
              targetVerseStrongsWords: highlight?.strongsWords,
              targetVerseStrongsExtraWords: highlight?.strongsExtraWords,
              scrollPosition: 0, searchMode: false, noteBack: null,
              searchBack: savedQuery ? { query: savedQuery } : null,
            })
            renameTab('scripture', activeTab.id, title)
            // This is Advanced Scripture Search's own "click a result" action (distinct from
            // FloatingSearch/SearchTab, already wired) — was never recorded at all.
            recordNavigation(
              { bookId: tabState.bookId, chapter: tabState.chapter },
              { bookId, chapter, verse },
              { kind: 'search-result', query: savedQuery },
            )
          }}
          onOpenInNewTab={(bookId, chapter, verse, tid) => {
            const book = books.find((b) => b.id === bookId)
            const title = isHermasBook(bookId)
              ? `Hermas ${getHermasShortLabel(bookId, chapter, hermasVariantForTextId(tid))}`
              : book ? `${book.name} ${chapter}` : `${bookId} ${chapter}`
            addTab({ id: `bible-${Date.now()}`, spaceId: 'scripture', type: 'bible', title,
              state: { translation: tid.toUpperCase(), bookId, chapter, targetVerse: verse, scrollPosition: 0, showStrongs: false } })
            recordNavigation({}, { bookId, chapter, verse }, { kind: 'search-result', query: tabState.scriptureSearchQuery ?? '' })
          }}
          onOpenInFloating={(bookId, chapter, verse) => {
            window.app.openFloatingTab('bible', { bookId, chapter: String(chapter), targetVerse: String(verse) })
            recordNavigation({}, { bookId, chapter, verse }, { kind: 'search-result', query: tabState.scriptureSearchQuery ?? '' })
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
      className="relative flex flex-col h-full bg-[rgb(var(--color-surface-3))]"
      onMouseDown={() => setActivePanelId('bible')}
    >
      {/* Reference bar. Floating only: pulled OUT of normal flex flow (`absolute`, layered via
          z-20) instead of sitting in its own row above the content — a "Pop Out Tab" window has
          no shared canvas competing for space, so the header can overlay the scripture text
          scrolling behind/under it (same idea as the presenter/viewer window, where the display
          has no chrome blocking its own content at all) rather than pushing that text down into
          a smaller area below a bar. `renderContentArea()` below needs no matching change: with
          the header removed from flow, it's the flex-col's only remaining child, so it already
          stretches to fill the FULL height on its own — this is safe in docked mode too (adding
          `relative` to the root is a no-op there since TabHeaderPortal doesn't render PanelHeader
          at all when not floating, portaling into ShellHeader's slot elsewhere instead — see
          TabHeaderPortal.tsx). */}
      <TabHeaderPortal floating={floating} className={floating ? 'absolute top-0 left-0 right-0 z-20' : ''}>
        {/* The "← Proverbs 25" / "← Search: ..." pills (tabState.scriptureBack /
            tabState.searchBack) that used to render here were removed —
            redundant with the global TopBar nav pill (Cmd+[/Cmd+]) and the
            per-tab home button, which now correctly track "where did I come
            from" for the Scripture tab too (including search results —
            see the pushTabNav call in onNavigate below), without needing a
            second, panel-local affordance.
            "← back to note" (tabState.noteBack) is different: Cmd+[/pushTabNav's stack is
            single-typed per tab (a Bible tab's own stack can only ever hold scripture-position
            entries), so it structurally can't carry "this tab came from note X" the way it
            carries ordinary chapter history. Restored as an explicit pill instead, matching
            how LexiconPanel already solves the exact same problem for its own tab. */}
        {tabState.noteBack && (
          <button
            onClick={() => {
              if (!tabState.noteBack) return
              requestOpenNote(tabState.noteBack.noteId)
              ensureTab('note')
              if (activeTab) updateTabState('scripture', activeTab.id, { noteBack: null })
            }}
            title={`Back to "${tabState.noteBack.title}"`}
            className="flex items-center gap-1 text-xs text-[rgb(var(--color-accent))] hover:underline cursor-pointer flex-shrink-0 max-w-[120px]"
          >
            <ArrowLeft size={11} className="flex-shrink-0" />
            <span className="truncate">{tabState.noteBack.title}</span>
          </button>
        )}
        {isCompareMode ? (
          <>
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
            {/* Sync scroll — only meaningful once 2+ columns share the same chapter (a
                different translation of the same passage); grays out otherwise rather
                than disappearing, so it's discoverable before the precondition is met. */}
            <HintTooltip label={compareSyncEligible ? (tabState.compareSyncScroll ? 'Stop syncing scroll' : 'Sync scroll across matching chapters') : 'Sync scroll (needs 2+ columns on the same chapter)'}>
              <button
                onClick={() => { if (activeTab) updateTabState('scripture', activeTab.id, { compareSyncScroll: !tabState.compareSyncScroll }) }}
                disabled={!compareSyncEligible}
                className={`flex items-center justify-center w-8 h-8 rounded-md transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default ${
                  tabState.compareSyncScroll
                    ? 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
                    : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]'
                }`}
              >
                <Link2 size={15} />
              </button>
            </HintTooltip>
          </>
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

      {/* Verse digit overlay — shown while accumulating a type-anywhere verse number.
          `bottom-16` (64px) was unconditional regardless of layout — in a bottom-panel layout
          (panel-bottom/notes-bottom/compare-notes use `rightPanelWidth` clamped as their height,
          split-bottom uses `bottomPanelHeight`; see BOTTOM_PANEL_HEIGHT_LAYOUTS below) that
          panel can be up to 600px tall, well past this overlay's fixed 64px offset — sitting the
          pill right on top of the panel's own controls. Raise it above the panel when one is
          actually docked at the bottom of the screen. */}
      {verseDigitAccum && (
        <div
          className="fixed left-1/2 -translate-x-1/2 z-[200] px-4 py-2 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-2xl flex items-center gap-2 pointer-events-none select-none"
          style={{
            bottom: BOTTOM_PANEL_HEIGHT_LAYOUTS.has(currentLayout)
              ? (currentLayout === 'split-bottom'
                  ? Math.max(120, Math.min(520, bottomPanelHeight))
                  : Math.max(160, Math.min(600, rightPanelWidth))) + 24
              : 64,
          }}
        >
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
        // CompareView has its own substantial mount-scoped state (per-column data, scroll
        // positions, etc.) that hasn't been audited/made tab-aware the way ChapterView just was
        // — rather than risk the same class of stale-content bug with an unaudited surface,
        // force a clean remount specifically for compare-mode tabs on switch. Compare mode is a
        // deliberately-chosen, less frequent view than plain scripture reading, so this doesn't
        // reintroduce the everyday-tab-switch cost the BiblePanel remount fix targeted.
        key={activeTabId}
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
        syncScrollEnabled={!!tabState.compareSyncScroll}
        onSyncEligibleChange={setCompareSyncEligible}
      />
    ) : continuousChapterScroll && !tabState.endChapter && !isHermasBook(tabState.bookId) ? (
      <ContinuousChapterScroll
        // Same reasoning as CompareView's key above: ContinuousChapterScroll owns its own
        // substantial windowing state (firstCh/lastCh/visibleCh, IntersectionObserver-driven
        // heading tracking) that hasn't been individually audited/made tab-aware the way
        // ChapterView just was. Force a clean remount on tab switch for correctness rather than
        // risk the same stale-content bug in an unaudited surface — continuous scroll is an
        // opt-in reading preference, not every scripture tab switch, so this doesn't reintroduce
        // the everyday cost the BiblePanel remount fix targeted.
        key={activeTabId}
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
          const priorChapter = tabState.chapter
          updateTabState('scripture', activeTab.id, { chapter: ch, rightPanelVerseFilter: null })
          renameTab('scripture', activeTab.id, chTitle)
          recordNavigation({ bookId: tabState.bookId, chapter: priorChapter }, { bookId: tabState.bookId, chapter: ch }, { kind: 'sequential-nav' })
        }}
        onVersesLoaded={onVersesLoaded}
        onTargetVerseConsumed={clearTargetVerse}
        onScroll={handleBibleScroll}
        presenterBand={presenterBand}
        viewerPaused={viewerPaused}
      />
    ) : (
      <div
        ref={chapterViewRef}
        className={`flex-1 overflow-y-auto relative ${audioPlaybackActive ? 'pb-24' : ''}`}
        onWheel={(e) => {
          // When the chapter fits entirely (nothing to scroll), the wheel can't move the main
          // panel — so translate it into a virtual scroll that drives the presenter, which may
          // be zoomed in and unable to show everything at once.
          const c = chapterViewRef.current
          if (!c || c.scrollHeight - c.clientHeight > 0) return
          const st = useAppStore.getState()
          if (!st.viewerWindowOpen || st.viewerPaused || st.viewerBlank) return
          // Sensitivity derived from the presenter's OWN real overflow (its clientHeight and
          // how much of its content is hidden) — see presenterScrollSensitivity's doc comment
          // for the full derivation (a flat magic constant felt wildly different depending on
          // how zoomed in the presenter was / how little of a short chapter overflowed, since
          // a fixed px-per-wheel-tick has no relationship to how much scrollable range there
          // actually is to cover). Shared with handleBibleScroll's own normalization above,
          // which applies the identical math to real (nonzero) native scroll deltas instead
          // of wheel deltas.
          const region = viewerVisibleRegion
          const sensitivity = presenterScrollSensitivity(region?.clientHeight, region?.visibleFraction)
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
                targetVerseQuery={ch === tabState.chapter ? tabState.targetVerseQuery : undefined}
                targetVerseWordMode={ch === tabState.chapter ? tabState.targetVerseWordMode : undefined}
                targetVerseStrongsWords={ch === tabState.chapter ? tabState.targetVerseStrongsWords : undefined}
                targetVerseStrongsExtraWords={ch === tabState.chapter ? tabState.targetVerseStrongsExtraWords : undefined}
                endVerse={undefined}
                hiddenAnnotations={tabState.hiddenAnnotations}
                findQuery={findQuery}
                findWordMode={findWMode}
                onStrongsClick={handleStrongsClick}
                onWordClick={handleWordClick}
                onVersesLoaded={ch === tabState.chapter ? onVersesLoaded : undefined}
                onTargetVerseConsumed={ch === tabState.chapter ? clearTargetVerse : undefined}
                flashAnchor={ch === tabState.chapter ? flashAnchor : undefined}
                tabId={activeTabId}
              />
            ))
          : (
              <ChapterView
                // Without a key here, this instance survives chapter navigation (only
                // tabState.chapter changes), so React reuses the same VerseRow fibers by
                // verse_num across chapters — exposing stale-closure bugs like VerseRow's
                // handleVerseMouseUp (useCallback([]) capturing the FIRST-mounted verse.text
                // forever). The sibling ChapterView instances above (line ~2888) and inside
                // ContinuousChapterScroll.tsx already key by book+chapter; this was the one
                // path that didn't, since it's the "plain single chapter" case.
                key={`${tabState.bookId}-${tabState.chapter}`}
                bookId={tabState.bookId}
                chapter={tabState.chapter}
                showStrongs={tabState.showStrongs}
                textId={textId}
                targetVerse={tabState.targetVerse}
                targetVerseQuery={tabState.targetVerseQuery}
                targetVerseWordMode={tabState.targetVerseWordMode}
                targetVerseStrongsWords={tabState.targetVerseStrongsWords}
                targetVerseStrongsExtraWords={tabState.targetVerseStrongsExtraWords}
                endVerse={tabState.endVerse}
                hiddenAnnotations={tabState.hiddenAnnotations}
                findQuery={findQuery}
                findWordMode={findWMode}
                onStrongsClick={handleStrongsClick}
                onWordClick={handleWordClick}
                onVersesLoaded={onVersesLoaded}
                onTargetVerseConsumed={clearTargetVerse}
                flashAnchor={flashAnchor}
                tabId={activeTabId}
              />
            )
        }
      </div>
    )

    // Must match BibleRightPanel.tsx's own (locally-scoped) PANEL_TAB_DRAG_MIME constant.
    const POP_OUT_DRAG_MIME = 'application/x-berean-panel-tab'
    // Catch-all drop target covering the whole panel area (both slots + the scripture pane) —
    // dropping a dragged side-panel tab onto slot B's own strip/label already works via its
    // own onDrop, but that only exists once slot B is already open; dropping "outside" (the
    // scripture pane, or anywhere else in this area) previously relied on onDragEnd's
    // dropEffect==='none' check, which only fires once Chromium's native drag-cancel "snap
    // back" animation finishes — a real, noticeable delay (confirmed: reported "slight delay
    // when i drag out the side panel tab"). This fires on `drop`, immediately at mouseup, no
    // animation involved — BibleRightPanel.tsx's own onDrop handlers call stopPropagation so a
    // drop THEY already handled never also reaches this one.
    function handlePanelAreaDragOver(e: React.DragEvent) {
      if (e.dataTransfer.types.includes(POP_OUT_DRAG_MIME)) e.preventDefault()
    }
    function handlePanelAreaDrop(e: React.DragEvent) {
      const raw = e.dataTransfer.getData(POP_OUT_DRAG_MIME)
      if (!raw) return
      const { tab, slotId: fromSlot } = JSON.parse(raw) as { tab: 'notes' | 'lexicon' | 'crossrefs'; slotId: 'A' | 'B' }
      if (fromSlot === 'A' && !rightPanelSlotB) moveTab(tab, 'B')
      else if (fromSlot === 'B') moveTab(tab, 'A')
    }

    // Shared right panel (tabs UI). `slot` picks which of the two independent side-panel
    // slots this instance renders — slot B only ever exists when rightPanelSlotBTabs is
    // non-empty (see moveToSlotB/moveToSlotA/closeSlotB above). Only slot A's scroll feeds the
    // companion viewer-window mirror below — with two slots there's no single meaningful scroll percent
    // to show there, so slot B's is deliberately left unmirrored rather than picking one
    // arbitrarily or fighting over the same field.
    const panelEl = (slot: 'A' | 'B', forcedTab?: 'notes' | 'lexicon' | 'crossrefs') => (
      <ErrorBoundary label="Right panel error">
        <BibleRightPanel
          slotId={slot}
          bookId={tabState.bookId}
          chapter={tabState.chapter}
          activeTab={slot === 'A' ? rightPanelTab : (rightPanelSlotB ?? 'notes')}
          onTabChange={slot === 'A' ? handleRightPanelTabChange : handleRightPanelTabChangeB}
          openNoteId={slot === 'A' ? rightPanelNoteId : rightPanelNoteIdB}
          onNoteChange={slot === 'A' ? handleRightPanelNoteChange : handleRightPanelNoteChangeB}
          initialNoteCursor={slot === 'A' ? tabState.rightPanelNoteCursor : tabState.rightPanelNoteCursorB}
          autoFocusNote={slot === 'A' && tabState.rightPanelNoteFocused === true}
          onNoteCursorChange={slot === 'A' ? handleRightPanelNoteCursorChange : handleRightPanelNoteCursorChangeB}
          openLexiconEntry={slot === 'A' ? rightPanelLexiconEntry : rightPanelLexiconEntryB}
          onLexiconEntryChange={slot === 'A' ? handleRightPanelLexiconChange : handleRightPanelLexiconChangeB}
          verseFilter={slot === 'A' ? rightPanelVerseFilter : rightPanelVerseFilterB}
          onVerseFilterChange={slot === 'A' ? handleRightPanelVerseFilterChange : handleRightPanelVerseFilterChangeB}
          expandAllNotes={slot === 'A' ? rightPanelExpandAll : rightPanelExpandAllB}
          onExpandAllNotesChange={slot === 'A' ? handleRightPanelExpandAllChange : handleRightPanelExpandAllChangeB}
          forcedTab={forcedTab}
          otherSlotTabs={!forcedTab ? (slot === 'A' ? rightPanelSlotBTabs : ALL_PANEL_TABS.filter((t) => !rightPanelSlotBTabs.includes(t))) : undefined}
          onMoveTab={!forcedTab ? moveTab : undefined}
          // Popping a tab out of slot A is only offered when doing so wouldn't leave slot A
          // with nothing left to show — slot B has no equivalent restriction on its own side
          // (merging its last tab back always closes slot B, a valid end state).
          canPopOut={slot === 'A' && !forcedTab && (ALL_PANEL_TABS.length - rightPanelSlotBTabs.length) > 1}
          onCloseSlotB={slot === 'B' ? closeSlotB : undefined}
          onCloseSlotA={slot === 'A' ? closeSlotA : undefined}
          initialScrollTop={slot === 'A' ? tabState.rightPanelScrollTop : tabState.rightPanelScrollTopB}
          onScrollTopChange={(top) => {
            if (activeTab) updateTabState('scripture', activeTab.id, slot === 'A' ? { rightPanelScrollTop: top } : { rightPanelScrollTopB: top })
          }}
          onScrollPercent={slot === 'A' ? (pct) => {
            const st = useAppStore.getState()
            if (!st.viewerWindowOpen || st.viewerPaused) return
            const base = computeViewerPayload()
            if (base.kind === 'bible') {
              window.app.pushViewerContent?.({ ...base, sidePanelScrollPercent: pct })
            }
          } : undefined}
        />
      </ErrorBoundary>
    )

    const hDivider = (
      // Widened from the original 4px (`w-1` below) to a 14px hit-area — the two-
      // finger-swipe gesture itself listens on the much larger panelAreaRef below,
      // not here, but the wider strip is still a nicer mouse-drag-resize target.
      <div className="group relative w-3.5 flex-shrink-0 flex justify-center cursor-col-resize">
        <div
          onMouseDown={handleResizeMouseDown}
          className="w-1 h-full hover:bg-[rgb(var(--color-accent))/40] transition-colors bg-transparent"
        >
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
            <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
            <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
            <span className="w-0.5 h-0.5 rounded-full bg-[rgb(var(--color-text-muted))]" />
          </div>
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
    // Purely rightPanelWidth — the two-finger swipe (see the wheel listener above)
    // never touches this. The panel's WIDTH stays constant through an entire swipe
    // gesture; only its `x` translate (see restFrac, wired into the 'standard'
    // case's motion.div below) tracks the gesture. Shared by every layout case
    // below since panelSize is computed once here, not per-case.
    const panelSize = Math.max(160, Math.min(600, rightPanelWidth))
    // For the bottom-docked panel layouts below (panel-bottom/notes-bottom/notes-top/
    // compare-notes) — was using `panelSize` (derived from rightPanelWidth) as a HEIGHT purely
    // because it happened to produce a visually reasonable number, while the divider that
    // actually resizes it (handleVResizeMouseDown, wired to vDivider below) was ALSO mistakenly
    // writing into rightPanelWidth. That meant dragging this divider in e.g. notes-bottom
    // silently changed what width the SIDE panel would use if the user later switched to
    // 'standard' layout. Both now consistently use bottomPanelHeight — the field
    // handleLCVResizeMouseDown/split-bottom's own divider already correctly used — same clamp
    // range split-bottom's sbHeight already established.
    const bottomPanelSize = Math.max(120, Math.min(520, bottomPanelHeight))

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
      // The panel FLOATS over the scripture pane (position: absolute) rather than sharing
      // the row as a flex sibling — a flex sibling shrinks scriptureView's available width
      // the instant the panel opens, which reads as the whole reading pane visibly shifting/
      // shrinking left. Overlaying keeps the scripture pane's own width (and therefore its
      // text layout/scroll position) completely undisturbed by the panel opening or resizing;
      // the panel's own shadow-lg is what now actually does its job, floating on top instead
      // of just decorating a box that was already sharing the row.
      case 'standard':
      default:
        return (
          // ref={panelAreaRef} — the two-finger-swipe wheel listener covers this whole
          // area (not just a thin strip): any horizontal swipe anywhere over it, in
          // either open or closed state, drives the gesture (see onSwipeWheelRef's
          // own comment). Only wired up for this 'standard' layout — the one case
          // whose container is a simple position:absolute area a listener can cover
          // without disturbing the flex-based layouts every other case relies on.
          <div ref={panelAreaRef} className="flex-1 relative overflow-hidden min-h-0" onDragOver={handlePanelAreaDragOver} onDrop={handlePanelAreaDrop}>
            <div className="absolute inset-0 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            <AnimatePresence initial={false}>
              {(rightPanelOpen || restFrac !== null) && (
                <motion.div
                  key="right-panel"
                  initial={{ x: '100%' }}
                  // Live-tracks the swipe's REST position (0% = fully open, 100% =
                  // fully closed) while a gesture session is active; otherwise the
                  // normal open position. Width is NEVER part of this — panelSize/the
                  // wrapper's own `width` style below stays fixed at rightPanelWidth
                  // throughout, so the panel only ever slides horizontally, never
                  // resizes, matching the click-driven open/close animation this
                  // reuses (initial/exit at x:'100%' below).
                  animate={{ x: restFrac !== null ? `${restFrac * 100}%` : 0 }}
                  exit={{ x: '100%' }}
                  // duration:0 during an active drag is deliberate — see useSwipePanelGesture.ts's
                  // file-level comment for why any tween here causes a "stuck on reversal" feel.
                  transition={{ duration: isResizingPanel ? 0 : 0.18, ease: 'easeOut' }}
                  // rounded-shell-lg on ALL corners (not just the right side, where the panel
                  // itself sits) — this wrapper's overflow-hidden clips to a perfectly SQUARE
                  // box by default, which cut the inner panel's shadow-2xl off in a hard
                  // right-angle wherever it should have curved around the panel's own
                  // rounded-shell-lg corners (reported as "the shadow isn't rounded," bottom-left
                  // specifically — the shadow spreads left+down from that corner into the
                  // hDivider strip on the wrapper's LEFT edge, which `rounded-r-shell-lg` alone
                  // left square). Rounding every corner of the clip region, not just the two on
                  // the panel's own side, is what actually closes that gap.
                  className="absolute top-0 right-0 h-full flex overflow-hidden z-20 rounded-shell-lg"
                  // +14 for hDivider (widened from 4px to 14px for the two-finger-swipe hit
                  // area — see hDivider's own comment), +6 for the panel's own mr-1.5 (see the 'standard' case's
                  // OLD comment, same reasoning still applies), +6 more (gap-1.5) when slot B is
                  // open — each slot is now its own separately-chromed box (see below) with a
                  // real gap between them, rather than one shared box with an internal divider
                  // line, so the real visual gap needs to be counted into this wrapper's width
                  // too or it gets silently clipped.
                  style={{ width: (rightPanelSlotB ? panelSize * 2 + 6 : panelSize) + 14 + 6 }}
                >
                  {hDivider}
                  {/* Each slot is its own separately-chromed box (border/shadow/rounded), with a
                      real gap-1.5 between them when both are open — a shared box with only a
                      1px internal divider line read as "not visually separate at all" against
                      the shared background. overflow-hidden still lives on an INNER div per box,
                      off the same element as the border/shadow — combining overflow:hidden +
                      rounded corners + box-shadow on ONE element is a WebKit/Chromium compositing
                      gotcha where the shadow renders clipped to the element's square bounding box
                      instead of its own rounded corners. shadow-lg (not shadow-2xl) — this panel
                      floats via `position: absolute` directly over live scripture text rather
                      than beside a neutral page background like the other layout cases, so
                      shadow-2xl's much heavier/darker spread read as an unnatural dark bleed
                      across the text underneath. */}
                  <div style={{ width: rightPanelSlotB ? panelSize * 2 + 6 : panelSize }} className="flex-shrink-0 flex gap-1.5 my-1.5 mr-1.5">
                    {/* Slot B (popped out) renders BEFORE slot A — the popped-out panel always
                        sits on the left of the original, per explicit direction. */}
                    {rightPanelSlotB && (
                      <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                        <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg">{panelEl('B')}</div>
                      </div>
                    )}
                    <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                      <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg">{panelEl('A')}</div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )

      // ── Panel left ───────────────────────────────────────────────────────────
      case 'panel-left':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0" onDragOver={handlePanelAreaDragOver} onDrop={handlePanelAreaDrop}>
            <AnimatePresence initial={false}>
              {rightPanelOpen && (
                <motion.div
                  key="left-panel"
                  initial={{ width: 0 }}
                  // See the 'standard' case's comment — same fix, margin now on the left,
                  // +6 more (gap-1.5) when slot B is open — see the 'standard' case's comment
                  // on why each slot is now its own separately-chromed box.
                  animate={{ width: (rightPanelSlotB ? panelSize * 2 + 6 : panelSize) + 14 + 6 }}
                  exit={{ width: 0 }}
                  transition={{ duration: isResizingPanel ? 0 : 0.18, ease: 'easeOut' }}
                  // rounded-shell-lg (all corners) — see the 'standard' case's shadow-clipping
                  // comment; the previous right-only-corners attempt still left the OTHER two
                  // corners' shadow spread square-clipped by this wrapper.
                  className="flex-shrink-0 flex overflow-hidden rounded-shell-lg"
                >
                  {/* Each slot is its own separately-chromed box with a real gap-1.5 between
                      them — see the 'standard' case's comment. overflow-hidden on the inner div
                      of each box (same-element overflow+radius+shadow compositing bug). */}
                  <div style={{ width: rightPanelSlotB ? panelSize * 2 + 6 : panelSize }} className="flex-shrink-0 flex gap-1.5 my-1.5 ml-1.5">
                    {/* Slot B (popped out) renders BEFORE slot A — always on the left. */}
                    {rightPanelSlotB && (
                      <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                        <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg">{panelEl('B')}</div>
                      </div>
                    )}
                    <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                      <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg">{panelEl('A')}</div>
                    </div>
                  </div>
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
          <div className="flex-1 flex overflow-hidden min-h-0" onDragOver={handlePanelAreaDragOver} onDrop={handlePanelAreaDrop}>
            <div className="flex-[2] overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {rightPanelOpen && (
              <>
                {hDivider}
                <div className="flex-[3] flex gap-1.5 my-1.5 mr-1.5 min-w-0">
                  {rightPanelSlotB && (
                    <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl('B')}</div>
                  )}
                  <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl('A')}</div>
                </div>
              </>
            )}
          </div>
        )

      // ── Scripture wide (65/35) ───────────────────────────────────────────────
      case 'scripture-wide':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0" onDragOver={handlePanelAreaDragOver} onDrop={handlePanelAreaDrop}>
            <div className="flex-[3] overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {rightPanelOpen && (
              <>
                {hDivider}
                <div className="flex-[1.5] flex gap-1.5 my-1.5 mr-1.5 min-w-0">
                  {rightPanelSlotB && (
                    <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl('B')}</div>
                  )}
                  <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl('A')}</div>
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
                  // See the 'standard' case's comment — same clipped-margin fix.
                  animate={{ width: panelSize + 14 + 6 }}
                  exit={{ width: 0 }}
                  transition={{ duration: isResizingPanel ? 0 : 0.18, ease: 'easeOut' }}
                  // rounded-shell-lg (all corners) — see the 'standard' case's shadow-clipping
                  // comment; the previous right-only-corners attempt still left the OTHER two
                  // corners' shadow spread square-clipped by this wrapper.
                  className="flex-shrink-0 flex overflow-hidden rounded-shell-lg"
                >
                  {hDivider}
                  {/* overflow-hidden on the inner div — see the 'standard' case's comment
                      (same-element overflow+radius+shadow compositing bug). */}
                  <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                    <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg">{panelEl('A', 'notes')}</div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )

      // ── Panel bottom (full width) ────────────────────────────────────────────
      case 'panel-bottom':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0" onDragOver={handlePanelAreaDragOver} onDrop={handlePanelAreaDrop}>
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {vDivider}
            <div style={{ height: bottomPanelSize }} className="flex-shrink-0 flex gap-1.5 mx-1.5">
              {rightPanelSlotB && (
                <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl('B')}</div>
              )}
              <div className="flex-1 flex flex-col overflow-hidden rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">{panelEl('A')}</div>
            </div>
          </div>
        )

      // ── Notes bottom (full width, notes only) ────────────────────────────────
      case 'notes-bottom':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {vDivider}
            <div style={{ height: bottomPanelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('A', 'notes')}
            </div>
          </div>
        )

      // ── Notes top ────────────────────────────────────────────────────────────
      case 'notes-top':
        return (
          <div className="flex-1 flex flex-col overflow-hidden min-h-0">
            <div style={{ height: bottomPanelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('A', 'notes')}
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
                key={activeTabId}
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
                syncScrollEnabled={!!tabState.compareSyncScroll}
                onSyncEligibleChange={setCompareSyncEligible}
              />
            </div>
            {vDivider}
            <div style={{ height: bottomPanelSize }} className="flex-shrink-0 flex flex-col overflow-hidden mx-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('A', 'notes')}
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
                {panelEl('A', 'lexicon')}
              </div>
              <div className="flex-1 overflow-hidden flex flex-col min-h-0">
                {panelEl('A', 'crossrefs')}
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
                {panelEl('A', 'lexicon')}
              </div>
            </div>
            {lcVDivider}
            {/* Bottom row — height independent from right column width */}
            <div style={{ height: Math.max(120, Math.min(520, bottomPanelHeight)) }} className="flex-shrink-0 flex overflow-hidden">
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 mb-1.5 ml-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('A', 'notes')}
              </div>
              <div className="w-px bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('A', 'crossrefs')}
              </div>
            </div>
          </div>
        )
      }

      // ── Commentary: Wide notes left | Scripture right ─────────────────────────
      case 'commentary':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 ml-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('A', 'notes')}
            </div>
            {hDivider}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
          </div>
        )

      // ── Triple column: Notes | Scripture | Lexicon ────────────────────────────
      case 'triple-col':
        return (
          <div className="flex-1 flex overflow-hidden min-h-0">
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 ml-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('A', 'notes')}
            </div>
            {hDivider}
            <div className="flex-1 overflow-hidden flex flex-col min-h-0">{scriptureView}</div>
            {hDivider}
            <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
              {panelEl('A', 'lexicon')}
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
              <div className="flex-1 overflow-hidden flex flex-col min-h-0 mb-1.5 ml-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('A', 'notes')}
              </div>
              <div className="w-px bg-[rgb(var(--color-surface-4))] flex-shrink-0" />
              <div style={{ width: panelSize }} className="flex-shrink-0 flex flex-col overflow-hidden my-1.5 mr-1.5 rounded-shell-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-lg">
                {panelEl('A', 'lexicon')}
              </div>
            </div>
          </div>
        )
      }
    }
  }
}
