/**
 * FloatingShell — renders when the window was opened via "Pop Out Tab"
 * (URL contains ?float=1). Shows a single panel with no visible title bar;
 * the window uses hiddenInset so traffic lights are inset at (12,14).
 * A transparent absolute drag overlay lets the window be dragged.
 */
import { useMemo, useEffect, useState, lazy, Suspense } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import BiblePanel from '@/components/bible/BiblePanel'
import NotesPanel from '@/components/notes/NotesPanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import SearchTab from '@/components/search/SearchTab'
import PDFViewer from '@/components/pdf/PDFViewer'
import { useAppStore } from '@/store'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { Button } from '@/components/ui'

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
        const update: Record<string, unknown> = {
          scrollPosition: 0,
          targetVerse: undefined,
          endVerse: undefined,
        }
        if (params.bookId)     update.bookId     = params.bookId
        if (params.chapter)    update.chapter    = parseInt(params.chapter, 10) || 1
        if (params.targetVerse) update.targetVerse = parseInt(params.targetVerse, 10) || undefined
        if (params.endVerse)    update.endVerse   = parseInt(params.endVerse, 10) || undefined
        if (params.translation) update.translation = params.translation
        if (params.showStrongs !== undefined) update.showStrongs = params.showStrongs === 'true'
        // Ensure the right panel is hidden in the float window
        if (params.rightPanelOpen !== undefined) update.rightPanelOpen = params.rightPanelOpen === 'true'
        store.updateTabState('scripture', activeId, update)
      }
    }

    // If this float window is for a specific note, pre-queue it
    if (params.type === 'notes' && params.noteId) {
      requestOpenNote(params.noteId)
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
  useEffect(() => {
    applyThemeToDocument({
      theme, themePreset, systemIsDark, systemAccentColor,
      backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance,
    })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance])

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

  // ── Put back: return the CURRENT state of the tab (not the initial URL params) ──
  function putBack() {
    let returnState: Record<string, unknown> = {}

    if (params.type === 'bible') {
      // Read the current navigation state so the put-back restores wherever the user navigated to
      const store = useAppStore.getState()
      const activeId = store.activeTabId['scripture']
      const activeTab = activeId ? store.tabs['scripture'].find(t => t.id === activeId) : null
      if (activeTab?.state) {
        Object.entries(activeTab.state as unknown as Record<string, unknown>).forEach(([k, v]) => {
          if (v !== undefined) returnState[k] = v
        })
      } else {
        // Fallback: use the original URL params
        Object.entries(params).forEach(([k, v]) => {
          if (k !== 'type' && v !== undefined) returnState[k] = v
        })
      }
      // Restore the right panel if it was open before the tab was floated
      if (params._rightPanelWasOpen === 'true') {
        returnState.rightPanelOpen = true
      }
      // Strip internal float flags so they don't leak into the restored tab state
      delete returnState._rightPanelWasOpen
    } else {
      Object.entries(params).forEach(([k, v]) => {
        if (k !== 'type' && v !== undefined) returnState[k] = v
      })
    }

    window.app.returnFloatTab?.({ type: params.type, state: returnState })
  }

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

      {/* Panel fills the window — its own toolbar is the only chrome visible */}
      <div className="flex-1 overflow-hidden" data-float="true">
        {params.type === 'bible'   && <BiblePanel floating />}
        {params.type === 'notes'   && <NotesPanel floating />}
        {params.type === 'lexicon' && <LexiconPanel floating />}
        {params.type === 'youtube' && <Suspense fallback={null}><YouTubeTab floating /></Suspense>}
        {params.type === 'search'  && <SearchTab floating />}
        {params.type === 'pdf'     && <PDFViewer floating />}
        {!['bible', 'notes', 'lexicon', 'youtube', 'search', 'pdf'].includes(params.type) && (
          <div className="flex items-center justify-center h-full text-text-muted text-subhead">
            Float view for <strong className="ml-1">{params.type}</strong> coming soon.
          </div>
        )}
      </div>

      {/* "Put back" button — bottom-right, away from traffic lights and toolbar */}
      <div className="absolute bottom-4 right-4 z-raised">
        <Button variant="secondary" size="sm" icon={PanelLeftOpen} onClick={putBack} tooltip="Return tab to main window" className="shadow-2">
          Put back
        </Button>
      </div>
    </div>
  )
}
