import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { BibleTabState, NoteTabState, LexiconTabState } from '@/types'
import type { ViewerPayload, ViewerSidePanel } from '@/types/viewer'

// Last known proportional scroll position of the main Bible panel (0–1). Updated by
// BiblePanel on scroll; read here so a full re-sync (e.g. on initial viewer open) carries
// the current scroll position rather than snapping the viewer back to the top.
let lastBibleScrollPercent = 0
let lastScrollChapterKey = ''
/** Record the main panel's scroll percent, tagged with the chapter it belongs to, so a stale
 *  value is never applied to a different chapter (which caused a jump-to-bottom on tab switch). */
export function setMainBibleScrollPercent(p: number, chapterKey = '') {
  lastBibleScrollPercent = p
  lastScrollChapterKey = chapterKey
}

/** Invalidate the cached scroll percent for a chapter right after a verse-jump (search
 *  navigation, cross-ref jump, etc.) completes. scrollIntoView is a no-op when the target
 *  verse is already on-screen, so no native `scroll` event fires to refresh the cached
 *  percent via setMainBibleScrollPercent — without this, computeViewerPayload() would keep
 *  reusing the stale pre-jump percent (same chapterKey) and the presenter/viewer window
 *  would never scroll to the newly jumped-to verse. Forcing chapterKey to a value that can't
 *  match makes computeViewerPayload() fall back to verse-centering via `verse` instead. */
export function clearMainBibleScrollPercent(chapterKey: string) {
  if (lastScrollChapterKey === chapterKey) lastScrollChapterKey = ''
}

// Last verse the main panel actually centered on for a given chapter. A one-shot targetVerse
// jump (search navigation, cross-ref jump, etc.) gets consumed and cleared back to undefined by
// ChapterView right after it scrolls — if that clearing tab-state update reaches the store
// around the same tick as the jump's own update, computeViewerPayload() below could read
// bs.verse ?? bs.targetVerse as undefined for the chapter the presenter is meant to center on,
// landing it at the top instead. Retaining the last real verse per chapter (mirroring the
// lastBibleScrollPercent/lastScrollChapterKey pattern above) means an undefined verse for the
// SAME chapter falls back to the one that was actually just navigated to.
let lastBibleVerse: number | undefined
let lastVerseChapterKey = ''
export function setLastBibleVerse(v: number | undefined, chapterKey = '') {
  if (v === undefined) return
  lastBibleVerse = v
  lastVerseChapterKey = chapterKey
}

/** Compute what the viewer should show based on current app state. */
export function computeViewerPayload(): ViewerPayload {
  const s = useAppStore.getState()
  // Blank output → present the idle "awaiting navigation" screen.
  if (s.viewerBlank) return { kind: 'idle' }
  const activeSpace = s.activeSpace
  const activeId = s.activeTabId[activeSpace]
  if (!activeId) return { kind: 'idle' }
  const tab = s.tabs[activeSpace]?.find(t => t.id === activeId)
  if (!tab) return { kind: 'idle' }

  if (tab.type === 'bible') {
    const bs = tab.state as BibleTabState
    if (!bs.bookId) return { kind: 'idle' }
    const textId = (bs.translation ?? 'kjva').toLowerCase()
    let sidePanel: ViewerSidePanel | undefined
    if (bs.rightPanelOpen) {
      if (bs.rightPanelTab === 'notes' && bs.rightPanelNoteId) {
        sidePanel = { type: 'note', noteId: bs.rightPanelNoteId }
      } else if (bs.rightPanelTab === 'lexicon' && bs.rightPanelLexiconEntry) {
        sidePanel = { type: 'lexicon', strongsId: bs.rightPanelLexiconEntry }
      } else if (bs.rightPanelTab === 'crossrefs') {
        const activeVerse = bs.rightPanelVerseFilter
          ? (parseInt(bs.rightPanelVerseFilter.split('.')[2] ?? '0', 10) || undefined)
          : undefined
        sidePanel = { type: 'crossrefs', bookId: bs.bookId, chapter: bs.chapter, source: s.crossRefSource, activeVerse }
      }
    }
    // Only carry the scroll percent if it was recorded for THIS chapter; otherwise omit it so
    // the presenter doesn't apply a stale percent (e.g. a previous tab's near-bottom position).
    const chapterKey = `${bs.bookId}:${bs.chapter}`
    const scrollPercent = lastScrollChapterKey === chapterKey ? lastBibleScrollPercent : undefined
    // Fall back to targetVerse when verse isn't set — search-navigation (and other
    // one-shot scroll-to-verse jumps) only ever sets targetVerse, not verse. Without
    // this fallback, the viewer would have no verse to center on for a search-nav even
    // once BiblePanel.tsx stops forcing scrollPercent to 0 for that case (see there).
    // Further fall back to lastBibleVerse for this same chapter if BOTH verse and targetVerse
    // are undefined — covers the moment right after ChapterView consumes and clears a one-shot
    // targetVerse jump (see lastBibleVerse's own comment above).
    const verse = bs.verse ?? bs.targetVerse ?? (lastVerseChapterKey === chapterKey ? lastBibleVerse : undefined)
    if (bs.verse !== undefined) setLastBibleVerse(bs.verse, chapterKey)
    else if (bs.targetVerse !== undefined) setLastBibleVerse(bs.targetVerse, chapterKey)
    return { kind: 'bible', bookId: bs.bookId, chapter: bs.chapter, verse, textId, sidePanel, scrollPercent }
  }

  if (tab.type === 'note') {
    const ns = tab.state as NoteTabState
    if (ns.noteId) return { kind: 'note', noteId: ns.noteId }
    return { kind: 'idle' }
  }

  if (tab.type === 'lexicon') {
    const ls = tab.state as LexiconTabState
    if (ls.strongsNum) return { kind: 'lexicon', strongsId: ls.strongsNum }
    return { kind: 'idle' }
  }

  return { kind: 'idle' }
}

/** Collect the display/format settings the viewer needs to render content identically. */
function collectViewerSettings() {
  const s = useAppStore.getState()
  return {
    wordReplacerEnabled: s.wordReplacerEnabled,
    wordReplacerRules: s.wordReplacerRules,
    noteScriptureBlock: s.noteScriptureBlock,
    noteScriptureBlockThreshold: s.noteScriptureBlockThreshold,
    idiomHighlightEnabled: s.idiomHighlightEnabled,
    idiomCache: s.idiomCache,
    theme: s.theme,
    themePreset: s.themePreset,
    crossRefSource: s.crossRefSource,
    viewerSidePanelEnabled: s.viewerSidePanelEnabled,
    // Data-change tokens — bumped when notes/highlights change so the viewer refetches.
    noteChangeToken: s.noteChangeToken,
    highlightChangeToken: s.highlightChangeToken,
  }
}

/** Push display/format settings to the viewer (so word replacer, note blocks, theme match). */
export function pushViewerSettingsToViewer() {
  const s = useAppStore.getState()
  if (!s.viewerWindowOpen) return
  window.app.pushViewerSettings?.(collectViewerSettings())
}

/** Push the current viewer payload if the viewer is open. */
function activeScriptureTabState(s: ReturnType<typeof useAppStore.getState>): BibleTabState | undefined {
  if (s.activeSpace !== 'scripture') return undefined
  const id = s.activeTabId['scripture']
  const t = id ? s.tabs['scripture'].find((x) => x.id === id) : null
  return t?.state as BibleTabState | undefined
}

export function pushCurrentToViewer() {
  const s = useAppStore.getState()
  if (!s.viewerWindowOpen || s.viewerPaused) return
  const activeBible = activeScriptureTabState(s)
  // Advanced search open → don't switch the presenter until the user exits.
  if (activeBible?.searchMode) return
  // Compare mode → the columns live in CompareView's local state, so ask it to push the
  // compare payload (we can't build it from store state here).
  if (activeBible?.compareMode) { window.dispatchEvent(new CustomEvent('berean:requestComparePush')); return }
  const payload = computeViewerPayload()
  window.app.pushViewerContent?.(payload)
}

/** Hook that auto-syncs the viewer whenever active tab/space/state changes. */
export function useViewerSync() {
  const viewerWindowOpen = useAppStore((s) => s.viewerWindowOpen)
  const viewerPaused = useAppStore((s) => s.viewerPaused)
  const viewerBlank = useAppStore((s) => s.viewerBlank)
  const setViewerWindowOpen = useAppStore((s) => s.setViewerWindowOpen)
  const storeTabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const activeSpace = useAppStore((s) => s.activeSpace)
  // Settings the viewer needs to mirror rendering (word replacer, note blocks, theme…)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const noteScriptureBlock = useAppStore((s) => s.noteScriptureBlock)
  const noteScriptureBlockThreshold = useAppStore((s) => s.noteScriptureBlockThreshold)
  const idiomHighlightEnabled = useAppStore((s) => s.idiomHighlightEnabled)
  const idiomCache = useAppStore((s) => s.idiomCache)
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const crossRefSource = useAppStore((s) => s.crossRefSource)
  const viewerSidePanelEnabled = useAppStore((s) => s.viewerSidePanelEnabled)
  const noteChangeToken = useAppStore((s) => s.noteChangeToken)
  const highlightChangeToken = useAppStore((s) => s.highlightChangeToken)

  // Listen for viewer-ready signal (fired by viewer React app after registering onContent)
  useEffect(() => {
    window.app.onViewerReady?.(() => {
      pushViewerSettingsToViewer()
      pushCurrentToViewer()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-push settings to the viewer whenever any mirrored setting changes
  useEffect(() => {
    if (!viewerWindowOpen) return
    pushViewerSettingsToViewer()
  }, [viewerWindowOpen, wordReplacerEnabled, wordReplacerRules, noteScriptureBlock,
      noteScriptureBlockThreshold, idiomHighlightEnabled, idiomCache, theme, themePreset, crossRefSource,
      viewerSidePanelEnabled, noteChangeToken, highlightChangeToken])

  // Listen for viewer window closed
  useEffect(() => {
    window.app.onViewerWindowClosed?.(() => setViewerWindowOpen(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-sync whenever tabs/active space changes (skipped while paused). Re-runs when
  // viewerPaused flips back to false so the viewer immediately catches up to current state.
  // crossRefSource is included so switching the cross-ref tab (TSKe / Classic / My Notes)
  // re-pushes the side-panel payload to the presenter.
  useEffect(() => {
    if (!viewerWindowOpen || viewerPaused) return
    pushCurrentToViewer()
  // Deliberately broad dep list — any tab state change should trigger a sync check
  }, [viewerWindowOpen, viewerPaused, viewerBlank, storeTabs, activeTabId, activeSpace, crossRefSource])
}
