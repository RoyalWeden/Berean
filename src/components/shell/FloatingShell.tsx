/**
 * FloatingShell — renders when the window was opened via "Pop Out Tab"
 * (URL contains ?float=1). Shows a single panel with no visible title bar;
 * the window uses hiddenInset so traffic lights are inset at (12,14).
 * A transparent absolute drag overlay lets the window be dragged.
 */
import { useMemo, useEffect, useRef, useState, lazy, Suspense } from 'react'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import SearchTab from '@/components/search/SearchTab'
import PDFViewer from '@/components/pdf/PDFViewer'
import { useAppStore } from '@/store'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { flushPendingSaves } from '@/lib/pendingSaves'
import { decodeFloatingParam } from '@/lib/floatingTab'
import { bookName } from '@/lib/parseRef'
import { FloatingWindowContext, FLOATABLE_TAB_SPACES, canFloatTabType, type FloatingWindowApi } from './floatingWindow'

// Lazy so the heavy YouTube webview code isn't pulled into the initial bundle
// via this floating-window entry point (see ActivePanel.tsx for the same split).
const YouTubeTab = lazy(() => import('@/components/youtube/YouTubeTab'))


interface FloatParams {
  type: string
  bookId?: string
  chapter?: string
  noteId?: string
  strongsNum?: string
  spaceId?: string
  [key: string]: string | undefined
}

function readFloatParams(): FloatParams {
  const p = new URLSearchParams(window.location.search)
  // Start with the type and absorb ALL query params so putBack can reconstruct
  // the full original tab state (e.g. translation, showStrongs, scrollPosition…).
  const params: FloatParams = { type: p.get('type') ?? 'bible' }
  p.forEach((value, key) => { params[key] = value })
  return params
}

/** The tab this window is showing: its space's active tab — or, when a panel opened its entry
 *  without activating a tab (the lexicon does), the space's most recent tab. */
function currentTabIn(st: ReturnType<typeof useAppStore.getState>, space: (typeof FLOATABLE_TAB_SPACES)[keyof typeof FLOATABLE_TAB_SPACES]) {
  const list = st.tabs[space] ?? []
  return list.find((t) => t.id === st.activeTabId[space]) ?? list[list.length - 1] ?? null
}

export default function FloatingShell() {
  const params = useMemo(readFloatParams, [])
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const glassAppearance = useAppStore((s) => s.glassAppearance)
  const requestOpenNote = useAppStore((s) => s.requestOpenNote)

  // Search: the window gets its own search tab holding the query it was opened with — created
  // BEFORE the first render (a lazy state initializer), because SearchTab reads its query once,
  // when it mounts. The floating store starts with no tabs, so the query used to be dropped.
  useState(() => {
    if (params.type !== 'search') return null
    useAppStore.getState().addTab({
      id: `search-float-${Date.now()}`, spaceId: 'search', type: 'search',
      title: params.query ? `Search: "${params.query}"` : 'Search',
      state: { query: params.query ?? '', results: [] } as unknown as import('@/types').TabState,
    })
    return null
  })

  // ── On mount: apply the right-clicked tab's params to the active scripture tab ──
  // The Zustand store loads from localStorage (which has the main window's state),
  // so the "active" scripture tab may be different from the one the user popped out.
  // Override it here so BiblePanel immediately shows the correct book/chapter.
  useEffect(() => {
    if (params.type === 'bible') {
      let store = useAppStore.getState()
      // A floating window is an independent window: it starts with no active Scripture tab (tab
      // state is never hydrated or persisted here — the active tab per space moved to the
      // device-local SQLite mirror, which only the main window installs). Without a tab to
      // apply the params to, every floating Scripture window opened at Genesis 1 whatever
      // passage was requested (found verifying TEST-013). Give this window its own tab first;
      // nothing here is persisted, so the main window's tabs are untouched.
      if (!store.activeTabId['scripture'] || !store.tabs['scripture'].some(t => t.id === store.activeTabId['scripture'])) {
        store.createTab('bible')
        store = useAppStore.getState()
      }
      const activeId = store.activeTabId['scripture']
      const exists = activeId && store.tabs['scripture'].some(t => t.id === activeId)
      if (activeId && exists) {
        // Every field of the tab it was opened from (decoded from the URL) — not just the passage:
        // an Advanced Scripture Search tab (searchMode, its query, filters and sort) opens as that
        // search, the same as any other tab type (TEST 2026-10-11).
        const update: Record<string, unknown> = {
          scrollPosition: 0,
          targetVerse: undefined,
          endVerse: undefined,
        }
        for (const [k, v] of Object.entries(params)) {
          if (k === 'type' || k === 'float' || k === '_rightPanelWasOpen' || v === undefined) continue
          const value = decodeFloatingParam(k, v)
          if (value !== undefined) update[k] = value
        }
        if (update.chapter == null) update.chapter = 1
        store.updateTabState('scripture', activeId, update)
      }
    }

    // If this float window is for a specific note, pre-queue it
    if (params.type === 'notes' && params.noteId) {
      requestOpenNote(params.noteId)
    }

    // PDF: open the document (and page) this window was opened for.
    if (params.type === 'pdf' && params.pdfId) {
      useAppStore.getState().openPdf(params.pdfId, params.title ?? 'PDF', params.page ? parseInt(params.page, 10) || undefined : undefined)
    }

    // If this float window is for a lexicon entry, pre-queue it
    if (params.type === 'lexicon' && params.strongsNum) {
      useAppStore.getState().openLexiconEntry(params.strongsNum)
    }

    // If this float window is for a YouTube video, dispatch event so YouTubeTab navigates to it
    if (params.type === 'youtube' && params.videoId) {
      // Small delay so YouTubeTab has time to mount and register its event listener
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('berean:openYouTubeVideo', {
          detail: { videoId: params.videoId, startTime: params.startTime ? parseFloat(params.startTime) : 0 },
        }))
      }, 300)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Theme: apply the full preset + dark/light + animation logic (same shared
  //    applyThemeToDocument App.tsx and ViewerApp.tsx use) ──────────────────────
  // Also listen for cross-window broadcasts so theme/animation changes in the main window
  // propagate here (only that portion — we ignore tab changes, see below).
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  const customThemes = useAppStore((s) => s.customThemes)
  useEffect(() => {
    applyThemeToDocument({
      theme, themePreset, systemIsDark, systemAccentColor,
      backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes,
    })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes])

  useEffect(() => {
    // Listen for theme broadcasts from the main window.
    // IMPORTANT: only update theme/themePreset/animation — never overwrite tabs, because the
    // broadcast contains the main window's tab list which would clobber the float's
    // own scripture state (the tab state override applied on mount).
    window.app.onTabStateUpdate?.((payload) => {
      const p = payload as {
        theme?: string; themePreset?: string
        backgroundAnimationEnabled?: boolean; backgroundAnimationStyle?: string; backgroundAnimationIntensity?: string; glassAppearance?: string
      }
      const update: Record<string, unknown> = {}
      if (p.theme !== undefined) update.theme = p.theme
      if (p.themePreset !== undefined) update.themePreset = p.themePreset
      if (p.backgroundAnimationEnabled !== undefined) update.backgroundAnimationEnabled = p.backgroundAnimationEnabled
      if (p.backgroundAnimationStyle !== undefined) update.backgroundAnimationStyle = p.backgroundAnimationStyle
      if (p.backgroundAnimationIntensity !== undefined) update.backgroundAnimationIntensity = p.backgroundAnimationIntensity
      if (p.glassAppearance !== undefined) update.glassAppearance = p.glassAppearance
      if (Object.keys(update).length) useAppStore.setState(update)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Window title — the content's own identity, for the macOS Window menu, Mission Control and
  //    the title-bar hover (the pop-out used to be "Berean" whatever it showed). ──
  const windowTitle = useAppStore((st) => {
    if (!canFloatTabType(params.type)) return 'Berean'
    const space = FLOATABLE_TAB_SPACES[params.type]
    const tab = currentTabIn(st, space)
    if (params.type === 'bible') {
      const ts = tab?.state as { bookId?: string; chapter?: number; searchMode?: boolean; scriptureSearchQuery?: string } | undefined
      if (ts?.searchMode) return ts.scriptureSearchQuery?.trim() ? `Search: “${ts.scriptureSearchQuery.trim()}”` : 'Scripture Search'
      return ts?.bookId ? `${bookName(ts.bookId)} ${ts.chapter ?? ''}`.trim() : 'Scripture'
    }
    return tab?.title || ({ notes: 'Note', note: 'Note', lexicon: 'Lexicon', youtube: 'YouTube', search: 'Search', pdf: 'PDF' } as Record<string, string>)[params.type] || 'Berean'
  })
  const [reportedTitle, setReportedTitle] = useState<string | null>(null)
  const reportedStateRef = useRef<Record<string, unknown> | null>(null)
  useEffect(() => { document.title = reportedTitle || windowTitle }, [windowTitle, reportedTitle])

  // Closing the window (⌘W / the red button) writes any pending edit first — the IPC write is
  // handed to the main process synchronously, so it lands even though this renderer is going.
  useEffect(() => {
    const onUnload = () => { void flushPendingSaves() }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [])

  // ── Return to the main window: the CURRENT state of the tab (not the initial URL params), after
  //    pending edits are written — never a stale copy, never a lost keystroke. ──
  async function putBack() {
    await flushPendingSaves()
    let returnState: Record<string, unknown> = {}
    const store = useAppStore.getState()
    const space = canFloatTabType(params.type) ? FLOATABLE_TAB_SPACES[params.type] : null
    const activeTab = space ? currentTabIn(store, space) : null

    if (params.type === 'notes' || params.type === 'note') {
      // The note currently open in this window (it may have navigated to another one).
      const noteId = (reportedStateRef.current?.noteId as string | undefined) ?? params.noteId
      if (noteId) returnState.noteId = noteId
    } else if (params.type === 'lexicon' && reportedStateRef.current?.strongsNum) {
      // The entry this window is showing (LexiconPanel reports it; it isn't kept in a tab here).
      returnState.strongsNum = reportedStateRef.current.strongsNum
    } else if (activeTab?.state) {
      Object.entries(activeTab.state as unknown as Record<string, unknown>).forEach(([k, v]) => {
        if (v !== undefined && v !== null && typeof v !== 'function') returnState[k] = v
      })
      if (params.type === 'search') delete returnState.results
    } else {
      Object.entries(params).forEach(([k, v]) => {
        if (k !== 'type' && v !== undefined) returnState[k] = v
      })
    }
    if (params.type === 'bible') {
      // Restore the right panel if it was open before the tab was floated
      if (params._rightPanelWasOpen === 'true') returnState.rightPanelOpen = true
      delete returnState._rightPanelWasOpen
    }
    if (params.type === 'pdf' && !returnState.pdfId && params.pdfId) returnState.pdfId = params.pdfId

    // The window's title names the tab it becomes (App.tsx strips this key from the tab state).
    returnState.__tabTitle = document.title
    window.app.returnFloatTab?.({ type: params.type, state: returnState })
  }
  const floatingApi = useMemo<FloatingWindowApi>(() => ({
    returnToMain: () => { void putBack() },
    reportCurrent: (state, title) => { reportedStateRef.current = state; setReportedTitle(title ?? null) },
  }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [])

  return (
    // hiddenInset mode: traffic lights sit at (12,14). The BiblePanel's own toolbar
    // already handles content, but we overlay a drag region for window movement.
    <div className="relative flex flex-col h-screen bg-surface-1 overflow-hidden">
      {/* Drag handle — Mac only. On Windows the OS title bar owns the top area;
          the hiddenInset traffic-light zone does not exist so the overlay would
          create a dead zone. The app's own toolbar handles dragging on Mac. */}
      {window.__berean_platform !== 'win32' && (
        <div
          className="absolute top-0 left-0 z-raised pointer-events-none"
          style={{ height: 40, width: 76, WebkitAppRegion: 'drag' } as React.CSSProperties}
        />
      )}

      {/* Panel fills the window — its own title bar (PanelHeader, with the shared Return control)
          is the only chrome. */}
      <FloatingWindowContext.Provider value={floatingApi}>
      <div className="flex-1 overflow-hidden" data-float="true">
        {params.type === 'bible'   && <BiblePanel floating />}
        {params.type === 'notes'   && <NotesPanel floating />}
        {params.type === 'lexicon' && <LexiconPanel floating />}
        {params.type === 'youtube' && <Suspense fallback={null}><YouTubeTab floating /></Suspense>}
        {params.type === 'search'  && <SearchTab floating />}
        {params.type === 'pdf'     && <PDFViewer floating />}
        {!['bible', 'notes', 'lexicon', 'youtube', 'search', 'pdf'].includes(params.type) && (
          <div className="flex items-center justify-center h-full text-text-muted text-subhead">
            This kind of tab can’t open in its own window.
          </div>
        )}
      </div>

      </FloatingWindowContext.Provider>
    </div>
  )
}
