import { useAppStore } from '@/store'
import { navigateToVerse } from '@/lib/verseNavigation'
import { handleDeepLink, type DeepLinkTarget } from '@/lib/deepLinks'
import { parseWorkspaceState } from '@/lib/workspaceSnapshot'

/**
 * The desktop renderer's implementation of `DeepLinkTarget` over the zustand store — the same
 * actions the UI itself uses, so a deep link lands exactly where a click would. The iPhone shell
 * supplies its own target (Phase 10) and shares the parser.
 */
export const storeDeepLinkTarget: DeepLinkTarget = {
  openVerse: (r) => {
    const s = useAppStore.getState()
    s.setActiveSpace('scripture')
    navigateToVerse({ bookId: r.bookId, chapter: r.chapter, verse: r.verse, endVerse: r.endVerse ?? null, origin: { kind: 'other', label: 'deep-link' } })
    if (r.play) {
      const textId = (r.textId ?? useAppStore.getState().defaultBibleTranslation ?? 'kjva').toLowerCase()
      useAppStore.getState().startPlaybackFrom(r.bookId, r.chapter, r.verse ?? 1, textId, r.endVerse ?? null)
    }
  },
  openNote: (noteId) => {
    const s = useAppStore.getState()
    s.setActiveSpace('notes')
    s.requestOpenNote(noteId)
  },
  openLexicon: (strongsNum) => useAppStore.getState().openLexiconEntry(strongsNum),
  openVideo: (videoId, startTime) => useAppStore.getState().openYouTubeVideo(videoId, startTime ?? 0),
  openPdf: async (pdfId, page) => {
    const doc = await window.pdf.get(pdfId).catch(() => null)
    useAppStore.getState().openPdf(pdfId, doc?.title ?? 'PDF', page)
  },
  openSearch: (query) => useAppStore.getState().openSearchTab(query),
  openTrail: (trailSessionId) => { void window.app?.openStudyTrailWindow?.(trailSessionId) },
  openDaily: () => { useAppStore.getState().requestDailyNote() },
  openSession: (sessionId) => {
    const s = useAppStore.getState()
    if (s.sessions.some((x) => x.id === sessionId)) s.switchSession(sessionId)
  },
  openWorkspace: (name) => {
    const s = useAppStore.getState()
    const open = (list: Array<{ id: string; name: string }>) => {
      const ws = list.find((w) => w.name.toLowerCase() === name.toLowerCase()) ?? list.find((w) => w.name.toLowerCase().includes(name.toLowerCase()))
      if (!ws) return
      window.workspaces.load(ws.id).then((full) => { if (full) s.openWorkspaceSession({ id: full.id, name: full.name }, parseWorkspaceState(full.state_json)) }).catch(() => {})
    }
    if (s.savedWorkspaces.length) open(s.savedWorkspaces)
    else window.workspaces.list().then((list) => { s.setSavedWorkspaces(list); open(list) }).catch(() => {})
  },
}

/** Convenience for click handlers: routes a Berean link, returns false for anything else. */
export function openDeepLink(href: string): boolean {
  return handleDeepLink(href, storeDeepLinkTarget)
}
