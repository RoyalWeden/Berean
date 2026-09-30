import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { applySyncInvalidation } from '@/lib/syncInvalidation'
import { wireSyncUi } from '@/lib/syncUi'
import { HistoryPage } from './history/HistoryPage'
import { Tags, Route, Settings as SettingsIcon, History, Library, Layers, Archive, Download, ListMusic, ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { applyMobileAppearance } from './settings/scriptureTheme'
import { applyFontFamilies } from '@/lib/fontFamilies'
import { hydrateSettingsIntoStore, persistSettingsFromStore } from '@/lib/settingsBridge'
import { installTabPersistence } from '@/store/tabPersistenceRuntime'
import { installStudyTrailRecorder, installStudyTrailStateSync } from '@/store/studyTrailSlice'
import { storeDeepLinkTarget } from '@/lib/deepLinkTarget'
import { setIosDeepLinkTarget } from '@/platform/ios/deepLinks'
import { drainShareInbox } from '@/platform/ios/shareInbox'
import { ensureDailyNoteLocation } from '@/platform/ios/location'
import BiblePanel from '@/components/bible/BiblePanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import ErrorBoundary from '@/components/shell/ErrorBoundary'
import { ActivePanelContext } from '@/components/shell/ActivePanelContext'
import { PanelChromeContext } from '@/components/shell/PanelHeader'
import { useChromeState } from './navigation/chromeState'
import { lazy, Suspense } from 'react'
const TagsGraphPanel = lazy(() => import('@/components/tags/TagsGraphPanel'))
const PDFViewer = lazy(() => import('@/components/pdf/PDFViewer'))
import { SheetHost, useSheets } from './primitives/Sheet'
import { NavigationStack, useNavigation } from './navigation/NavigationStack'
import { Page, ListSection, Row } from './primitives/Page'
import { TabCardsSheet } from './tabs/TabCardsSheet'
import { BottomNav } from './navigation/BottomNav'
import { useMoreRouteRequests } from './navigation/shellNav'
import { NewTabSheet } from './navigation/NewTabSheet'
import { TabTypeSwitcher } from './navigation/TabTypeSwitcher'
import { CaretSheet } from './commands/CaretSheet'
import { caretRegistry, useCaretTopVersion, useCaretCommands } from './commands/caretRegistry'
import { staticCaretScope, type MoreRoute } from './commands/staticCommands'
import { WorkspacesPage } from './tabs/WorkspacesPage'
import { ArchivePage } from './tabs/ArchivePage'
import { ReaderPage } from './reader/ReaderPage'
import { SettingsPage } from './settings/SettingsPage'
import { YouTubeSettingsPage } from './settings/YouTubeSettingsPage'
import { NotesHomePage } from './notes/NotesHomePage'
import { pushNotesListHistory, currentNotesListState } from './notes/notesHistory'
import { NoteEditorPage } from './notes/NoteEditorPage'
import { CalendarTabPage } from './calendar/CalendarTabPage'
import { SearchPage } from './search/SearchPage'
import { AudioBar } from './audio/AudioBar'
import { useChromeScrollCollapse } from './primitives/useChromeScrollCollapse'
import { TranscriptPacksPage } from './youtube/TranscriptPacksPage'
import { StudyTrailPage, useOpenStudyTrailPageEvent } from './trail'
import { ComparePage } from './reader/ComparePage'
import { OnboardingFlow, useOnboardingGate } from './onboarding'
import { useTTSPlayback } from '@/hooks/useTTSPlayback'
import { useBibleLineHeight } from '@/hooks/useBibleLineHeight'
import VerseDragIndicator from '@/components/bible/VerseDragIndicator'
import { useQueueAutosave } from '@/hooks/useQueueAutosave'
import { QueuePage } from './audio/QueuePage'
import { Keyboard } from '@capacitor/keyboard'
import { installKeyboardDismiss } from './primitives/keyboardDismiss'
import { BereanA11y } from '@/platform/ios/plugins'
import './mobile.css'

/**
 * iPhone shell root (Phase 10, R070–R072, R076, R079–R081). The same zustand store, the same
 * services behind `window.*`, the same tabs/sessions — presented as: a per-space navigation
 * stack, three bottom controls (tab cards · plus · caret — docs/mobile/mobile-navigation.md), and bottom sheets. Desktop panels that have
 * no mobile page yet are hosted inside a page (their content is what matters; their chrome is
 * replaced phase by phase — see docs/mobile/feature-matrix.md).
 */
export default function MobileApp() {
  useAppearance()
  useBibleLineHeight() // Reading → Line height (TEST-024), same hook as desktop
  useBoot()
  useTTSPlayback()   // Read Aloud engine driver — the same hook App.tsx mounts
  useQueueAutosave() // queue ↔ its source playlist, as desktop
  const onboarding = useOnboardingGate()   // first launch / About → Replay walkthrough (R086)
  return (
    <SheetHost>
      <Shell />
      {onboarding && <OnboardingFlow />}
    </SheetHost>
  )
}

function Shell() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  // More (and its sub-pages) — reached from the plus sheet, the caret and deep links now that the
  // bottom space bar is gone (TEST-030). `null` = the active tab is showing.
  const [moreRoute, setMoreRoute] = useState<MoreRoute | null>(null)
  // History and Settings are TABS (persistent, content-rich — NEW-001): any request for them
  // (plus sheet, caret, deep link, More) opens or focuses that tab instead of sliding a page over
  // the current tab. Utilities (study trail, queue, PDF library, sessions, archive…) stay under More.
  const openMore = useCallback((route: MoreRoute) => {
    if (route === 'history' || route === 'settings') { setMoreRoute(null); useAppStore.getState().ensureTab(route); return }
    setMoreRoute(route)
  }, [])
  const closeMore = useCallback(() => setMoreRoute(null), [])
  // Any tab activation (tab cards, plus, deep link, navigation) leaves More.
  const activeKey = useAppStore((s) => `${s.activeSpace}:${s.activeTabId[s.activeSpace] ?? ''}`)
  const lastActiveKey = useRef(activeKey)
  useEffect(() => { if (activeKey !== lastActiveKey.current) { lastActiveKey.current = activeKey; setMoreRoute(null) } }, [activeKey])
  const showMore = moreRoute != null
  const activeTabIdOf = useAppStore((s) => s.activeTabId[s.activeSpace] ?? '')
  useMoreRouteRequests(openMore)
  // window.app.openStudyTrailWindow() (note embeds, deep links, the reader's caret) opens the Study
  // trail page wherever the user is — not only while More happens to be mounted.
  const openTrailRoute = useCallback(() => setMoreRoute((r) => (r === 'trail' ? r : 'trail')), [])
  useOpenStudyTrailPageEvent(openTrailRoute)
  useEffect(() => { setIosDeepLinkTarget({ ...storeDeepLinkTarget, openShareInbox: () => { void drainShareInbox() } }); return () => setIosDeepLinkTarget(null) }, [])

  // The YouTube space stays mounted (parked, hidden) while a video tab is open and another space
  // is showing, so the native player keeps playing — the phone's counterpart of desktop auto-PiP
  // — and "Insert timestamp" from a note can ask the player for its position. Unmounting it
  // would close the player (TouchYouTubePlayer's cleanup).
  const ytVideoOpen = useAppStore((s) => { const t = s.tabs.youtube.find((x) => x.id === s.activeTabId.youtube) ?? s.tabs.youtube[0]; return !!(t?.state as { videoId?: string | null } | undefined)?.videoId })
  const youtubeShowing = !showMore && activeSpace === 'youtube'
  const youtubeParked = !youtubeShowing && ytVideoOpen
  const nav = useShellSheets({ openMore })
  const chrome = useChromeState()
  // The bottom controls float over every tab (SEP25); their measured height (--m-nav-h) is the
  // room every scroller leaves at its end (readerChrome.css). Only Scripture views collapse them.
  const rootRef = useRef<HTMLDivElement>(null)
  // Every page's scroll collapses the bottom controls too (TEST25-NAV-010); Scripture views drive
  // their own chrome.
  const mainRef = useRef<HTMLElement>(null)
  useChromeScrollCollapse(mainRef, `${showMore ? 'more' : activeSpace}:${activeTabIdOf}`)
  useEffect(() => {
    const root = rootRef.current
    const bar = root?.querySelector('.mobile-bottom-nav') as HTMLElement | null
    if (!root || !bar || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => root.style.setProperty('--m-nav-h', `${bar.offsetHeight}px`))
    ro.observe(bar)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={rootRef} className={`mobile-root has-overlay-nav${chrome.overlay && !showMore ? ' has-scripture-chrome' : ''}${(chrome.overlay ? chrome.collapsed : chrome.pageCollapsed) && !showMore ? ' is-nav-collapsed' : ''}`}>
      <main className="mobile-main" ref={mainRef}>
        {showMore && <NavigationStack key={`more-${moreRoute}`} rootKey="more" root={<MorePage initialRoute={moreRoute} onClose={closeMore} onOpenSpace={(sp) => { useAppStore.getState().setActiveSpace(sp); closeMore() }} />} />}
        {/* One navigation stack per TAB (not per space): every tab — two Search tabs, two Notes
            tabs — keeps its own page and state (T23-009). */}
        {!showMore && activeSpace !== 'youtube' && <NavigationStack key={`${activeSpace}:${activeTabIdOf}`} rootKey={activeSpace} root={<SpaceRoot space={activeSpace} />} />}
        {(youtubeShowing || youtubeParked) && (
          <div key="youtube-space" className={youtubeParked ? 'mobile-space-parked' : 'mobile-space-live'} aria-hidden={youtubeParked || undefined}>
            <NavigationStack rootKey="youtube" root={<SpaceRoot space="youtube" />} />
          </div>
        )}
      </main>
      <AudioBar />
      <TabTypeSwitcher hidden={showMore} />
      {/* No Study Trail "Why'd you go to …?" prompt on the phone (SEP24-003): trail stops are still
          recorded; reasons are added from the Study trail page. The Mac keeps its prompt. */}
      <BottomNav onTabs={nav.openTabs} onPlus={nav.openPlus} onCaret={nav.openCaret} caretLabel={nav.caretLabel} />
    </div>
  )
}

/** The three bottom-control surfaces (tab cards, plus, caret) + the tab / workspace action sheets
 *  that used to hang off the tab pill and grid. */
function useShellSheets({ openMore }: { openMore: (r: MoreRoute) => void }) {
  const sheets = useSheets()
  useCaretTopVersion() // re-render when the page that owns the caret changes
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTab = useAppStore((s) => s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace]) ?? null)

  const openPlus = useCallback(() => sheets.open({ id: 'new-tab', detents: [0.92], render: (api) => <NewTabSheet api={api} openMore={(r) => openMore(r)} /> }), [sheets, openMore])
  // Tab cards: workspaces, tab actions and New tab all open INSIDE this sheet ("‹ Tabs", T23-012).
  const openTabs = useCallback(() => sheets.open({ id: 'tabs', title: undefined, rootTitle: 'Tabs', detents: [0.62, 0.92], render: (api) => (
    <TabCardsSheet api={api} openMore={(r) => openMore(r as MoreRoute)} />
  ) }), [sheets, openMore])
  const scopeFor = useCallback(() => caretRegistry.top() ?? (() => staticCaretScope(useAppStore.getState().activeSpace, (() => { const s = useAppStore.getState(); return s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace]) ?? null })(), { openMore })), [openMore])
  const openCaret = useCallback(() => {
    const scope = scopeFor()
    let rootTitle: string | undefined
    try { const sc = scope(); rootTitle = sc.backTitle ?? sc.title } catch { rootTitle = undefined }
    sheets.open({ id: 'caret', rootTitle, detents: [0.62, 0.92], render: (api) => <CaretSheet scope={scope} api={api} /> })
  }, [sheets, scopeFor])
  const caretTitle = (() => { try { return scopeFor()().title } catch { return activeTab?.title ?? activeSpace } })()
  return { openTabs, openPlus, openCaret, caretLabel: `Actions for ${caretTitle}` }
}

/** The active tab of a space, rendered by the page that knows its type. */
function SpaceRoot({ space }: { space: SpaceId }) {
  const tabs = useAppStore((s) => s.tabs[space])
  const activeId = useAppStore((s) => s.activeTabId[space])
  const ensureTab = useAppStore((s) => s.ensureTab)
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0] ?? null
  useEffect(() => { if (!active && space === 'scripture') ensureTab('bible') }, [active, space, ensureTab])
  if (space === 'notes') return <ErrorBoundary label="notes error"><NotesSpace /></ErrorBoundary>
  // The search space holds Search tabs and the dedicated History / Settings tabs (T23-009).
  if (space === 'search') {
    if (!active) return <EmptySpace space={space} />
    if (active.type === 'history') return <ErrorBoundary label="history error"><HistoryPage tab={active} /></ErrorBoundary>
    if (active.type === 'settings') return <ErrorBoundary label="settings error"><SettingsPage tab={active} /></ErrorBoundary>
    return <ErrorBoundary label="search error"><SearchPage tab={active} /></ErrorBoundary>
  }
  if (!active) return <EmptySpace space={space} />
  return <ErrorBoundary label={`${space} error`}><TabPage tab={active} /></ErrorBoundary>
}

let lastHandledDailyToken = 0

/** Notes space: native home page; a `requestOpenNote` from anywhere (verse sheet, history, deep
 *  link, wikilink) pushes the editor for that note. */
function NotesSpace() {
  const nav = useNavigation()
  const pendingNoteId = useAppStore((s) => s.pendingNoteId)
  const clearPendingNote = useAppStore((s) => s.clearPendingNote)
  const tabs = useAppStore((s) => s.tabs.notes)
  const activeId = useAppStore((s) => s.activeTabId.notes)
  const active = tabs.find((t) => t.id === activeId)
  // Each Notes TAB remembers the note it shows (tab state noteId, as on desktop), so switching
  // between Notes tabs reopens that tab's note (T23-009), and its tab card can preview it.
  // History (SEP25): the tab's per-tab history is THE navigation model — the list and each note
  // are its destinations. One editor page at most (a newly opened note REPLACES the shown one),
  // so the page stack can never drift from the history; ‹ › in the caret walk the history.
  const openEditor = useCallback((id: string) => {
    const s = useAppStore.getState()
    const tid = s.activeTabId.notes
    if (tid) {
      const restoring = s.isNavJumping
      // The first note opened from the list: record the list itself as the step before it.
      if (!restoring && !(s.tabNavStacks[tid]?.stack.length)) pushNotesListHistory(tid, currentNotesListState(tid))
      s.updateTabState('notes', tid, { noteId: id, isNew: false })
      // Not when the tab's current step already IS this note (e.g. a type change to it — a calendar day).
      const cur = s.tabNavStacks[tid]
      const atThisNote = !!cur && cur.idx >= 0 && cur.stack[cur.idx]?.noteId === id
      if (!restoring && !atThisNote) s.pushTabNav(tid, { type: 'note', title: 'Note', noteId: id })
      if (!restoring) void window.notes.getNote(id).then((n) => { if (n?.title) useAppStore.getState().retitleTabNav(tid, { noteId: id }, n.title) }).catch(() => {})
    }
    const page = <NoteEditorPage key={id} noteId={id} onBack={() => nav.pop()} />
    if (nav.depth > 0) nav.replaceTop(`note-${id}`, page)
    else nav.push(`note-${id}`, page)
  }, [nav])
  // Leaving the editor by its back button or the edge swipe is a navigation step too: back to the
  // list (recorded, so › returns to the note).
  const depth = nav.depth
  const prevDepth = useRef(depth)
  useEffect(() => {
    const was = prevDepth.current
    prevDepth.current = depth
    if (!(was > 0 && depth === 0)) return
    const s = useAppStore.getState()
    const tid = s.activeTabId.notes
    const t = tid ? s.tabs.notes.find((x) => x.id === tid) : undefined
    if (!tid || !(t?.state as { noteId?: string | null } | undefined)?.noteId) return
    s.updateTabState('notes', tid, { noteId: null })
    pushNotesListHistory(tid, currentNotesListState(tid))
  }, [depth])
  // Back to a list step (caret ‹) returns this Notes tab to its home list.
  const notesHomeToken = useAppStore((s) => s.notesHomeToken)
  const homeTokenSeen = useRef(notesHomeToken)
  useEffect(() => {
    if (notesHomeToken === homeTokenSeen.current) return
    homeTokenSeen.current = notesHomeToken
    const s = useAppStore.getState()
    const tid = s.activeTabId.notes
    if (tid) s.updateTabState('notes', tid, { noteId: null })
    nav.popToRoot()
  }, [notesHomeToken, nav])
  const restored = useRef(false)
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const noteId = active?.type === 'note' ? (active.state as { noteId?: string | null }).noteId : null
    if (noteId && !useAppStore.getState().pendingNoteId) openEditor(noteId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!pendingNoteId) return
    // A note never opens over the tags graph (TEST25-NOTES-008): switch to a Notes tab first (or
    // make one) and let that tab's page — mounted fresh for it — consume the request.
    const s0 = useAppStore.getState()
    const cur = s0.tabs.notes.find((t) => t.id === s0.activeTabId.notes)
    if (cur?.type === 'tags' || cur?.type === 'calendar') {
      const other = s0.tabs.notes.find((t) => t.type === 'note')
      if (other) s0.setActiveTab('notes', other.id); else s0.createTab('note')
      return
    }
    const id = pendingNoteId
    clearPendingNote()
    openEditor(id)
  }, [pendingNoteId, clearPendingNote, openEditor])
  // Daily note requests (sidebar button on desktop, ⌘⇧D, `berean://daily`): make sure the notes
  // home is the visible page (not the hosted tags graph), then let it open/create today's note.
  const dailyToken = useAppStore((s) => s.dailyNoteRequestToken)
  const [dailyRequest, setDailyRequest] = useState(0)
  useEffect(() => {
    // Module-level "last handled" so a request made while another space was showing (the
    // action switches to Notes, mounting this component afterwards) is still picked up.
    if (dailyToken === lastHandledDailyToken) return
    lastHandledDailyToken = dailyToken
    const s = useAppStore.getState()
    const cur = s.tabs.notes.find((t) => t.id === s.activeTabId.notes)
    if (cur?.type === 'tags') {
      const other = s.tabs.notes.find((t) => t.type !== 'tags')
      if (other) s.setActiveTab('notes', other.id); else s.createTab('note')
    }
    nav.popToRoot()
    setDailyRequest((n) => n + 1)
  }, [dailyToken, nav])
  // The tags graph lives in the notes space as a 'tags' tab; it is hosted until its phone page lands.
  if (active?.type === 'tags') return <HostedPanel type="tags"><Suspense fallback={null}><TagsGraphPanel /></Suspense></HostedPanel>
  if (active?.type === 'calendar') return <CalendarTabPage tab={active} />
  return <NotesHomePage dailyRequest={dailyRequest} />
}

function TabPage({ tab }: { tab: Tab }) {
  if (tab.spaceId === 'scripture' && tab.type === 'bible') {
    return (tab.state as { compareMode?: boolean }).compareMode ? <ComparePage tab={tab} /> : <ReaderPage tab={tab} />
  }
  // Interim hosts (documented in feature-matrix.md): the desktop panel's content, full width.
  // ActivePanelContext tells the hosted panel it IS the visible one (desktop's ActivePanel
  // keeps several mounted and hides the rest; here exactly one is mounted).
  const inner =
    tab.spaceId === 'scripture' && tab.type === 'pdf' ? <Suspense fallback={null}><PDFViewer /></Suspense> :
    tab.spaceId === 'scripture' ? <BiblePanel floating /> :
    tab.spaceId === 'lexicon' ? <LexiconPanel floating /> :
    <YouTubeTab floating />
  return <HostedPanel type={tab.type}>{inner}</HostedPanel>
}

/** The one host for desktop panels shown full-screen on the phone: tells the panel it is the
 *  visible one (ActivePanelContext) and to use phone header chrome (PanelChromeContext) — one
 *  shared layer for the safe area and header metrics of every hosted tab (T23-001/002). */
function HostedPanel({ type, children }: { type: Tab['type']; children: React.ReactNode }) {
  return (
    <PanelChromeContext.Provider value="phone">
      <ActivePanelContext.Provider value={type}><div className="mobile-hosted-panel">{children}</div></ActivePanelContext.Provider>
    </PanelChromeContext.Provider>
  )
}

function EmptySpace({ space }: { space: SpaceId }) {
  const createTab = useAppStore((s) => s.createTab)
  const kind = space === 'scripture' ? 'bible' : space === 'notes' ? 'note' : space === 'lexicon' ? 'lexicon' : space === 'youtube' ? 'youtube' : 'search'
  return (
    <Page title={space[0].toUpperCase() + space.slice(1)}>
      <div className="mobile-empty">
        <p>No open tabs.</p>
        <button type="button" className="mobile-button is-primary" onClick={() => createTab(kind)}>New {kind} tab</button>
      </div>
    </Page>
  )
}

function MorePage({ onOpenSpace, initialRoute, onClose }: { onOpenSpace: (space: SpaceId) => void; initialRoute: MoreRoute | null; onClose: () => void }) {
  const nav = useNavigation()
  // Settings / History open their tabs (see Shell's openMore) — More only lists them.
  const openSettings = useCallback(() => { onClose(); useAppStore.getState().ensureTab('settings') }, [onClose])
  const openHistory = useCallback(() => { onClose(); useAppStore.getState().ensureTab('history') }, [onClose])
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
  const openTrail = useCallback(() => nav.push('trail', <StudyTrailPage onBack={nav.pop} onOpenSpace={onOpenSpace} />), [nav, onOpenSpace])
  // (window.app.openStudyTrailWindow() is handled by the shell — it opens More at the trail route.)
  // Opened for a specific destination (plus sheet, caret, deep link): push it straight away; Back
  // from it returns to the More list, and More's Done returns to the tab.
  useEffect(() => {
    const push: Partial<Record<MoreRoute, () => void>> = {
      settings: openSettings,
      history: openHistory,
      workspaces: () => nav.push('workspaces', <WorkspacesPage onBack={nav.pop} />),
      archive: () => nav.push('archive', <ArchivePage onBack={nav.pop} />),
      transcripts: () => nav.push('transcripts', <TranscriptPacksPage onBack={nav.pop} />),
      'youtube-settings': () => nav.push('settings-youtube', <YouTubeSettingsPage onBack={nav.pop} />),
      trail: openTrail,
      queue: () => nav.push('queue', <QueuePage onBack={nav.pop} />),
      pdfs: () => nav.push('pdfs', <PdfLibraryPage onBack={nav.pop} onOpen={() => onOpenSpace('scripture')} />),
    }
    if (initialRoute && initialRoute !== 'more') push[initialRoute]?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // The caret on More: its navigation, not a copy of the list below (brief §28 "More / Settings").
  useCaretCommands(() => ({
    title: 'More',
    sections: [{ id: 'more', commands: [
      { kind: 'action', id: 'back', label: 'Back to the current tab', icon: ArrowLeft, run: onClose },
      { kind: 'action', id: 'settings', label: 'Settings', icon: SettingsIcon, run: openSettings },
      { kind: 'action', id: 'history', label: 'History', icon: History, run: openHistory },
    ] }],
  }))
  return (
    <Page title="More" right={<button type="button" className="mobile-link-button" onClick={onClose}>Done</button>}>
      {/* Lexicon and YouTube are tabs — opened from the plus (New Tab) sheet, Strong's numbers and
          search results — so More no longer duplicates them as "spaces" (T23-031). */}
      <ListSection title="Study">
        <Row leading={<Tags size={20} aria-hidden />} title="Verse tags" subtitle="Tag manager and graph" chevron onClick={() => { useAppStore.getState().openTagsGraph(); onOpenSpace('notes') }} />
        <Row leading={<Route size={20} aria-hidden />} title="Study trail" subtitle="Sessions, map, threads, recap" chevron onClick={openTrail} />
        <Row leading={<ListMusic size={20} aria-hidden />} title="Read Aloud queue" subtitle="Queue and saved playlists" chevron onClick={() => nav.push('queue', <QueuePage onBack={nav.pop} />)} />
        <Row leading={<History size={20} aria-hidden />} title="History" chevron onClick={openHistory} />
        <Row leading={<Layers size={20} aria-hidden />} title="Sessions" subtitle="Switch, rename, saved sessions" chevron onClick={() => nav.push('workspaces', <WorkspacesPage onBack={nav.pop} />)} />
        <Row leading={<Archive size={20} aria-hidden />} title="Archived tabs" chevron onClick={() => nav.push('archive', <ArchivePage onBack={nav.pop} />)} />
        <Row leading={<Download size={20} aria-hidden />} title="Transcript packs" subtitle="Download channel transcripts for offline search" chevron onClick={() => nav.push('transcripts', <TranscriptPacksPage onBack={nav.pop} />)} />
        {pdfFeatureEnabled && <Row leading={<Library size={20} aria-hidden />} title="PDF library" chevron onClick={() => nav.push('pdfs', <PdfLibraryPage onBack={nav.pop} onOpen={() => onOpenSpace('scripture')} />)} />}
      </ListSection>
      <ListSection>
        <Row leading={<SettingsIcon size={20} aria-hidden />} title="Settings" chevron onClick={openSettings} />
        <Row title="Diagnostics" subtitle="Native stack self-test" chevron onClick={() => nav.push('diagnostics', <DiagnosticsPage onBack={nav.pop} />)} />
      </ListSection>
    </Page>
  )
}

/** History — a page under More, or a dedicated History tab whose filter is kept in the tab (T23-009). */

function PdfLibraryPage({ onBack, onOpen }: { onBack: () => void; onOpen: () => void }) {
  const [pdfs, setPdfs] = useState<import('@/types').PdfDoc[]>([])
  const pdfsEpoch = useAppStore((s) => s.dataEpochs.pdfs)
  useEffect(() => { window.pdf.list().then(setPdfs).catch(() => setPdfs([])) }, [pdfsEpoch])
  const openPdf = useAppStore((s) => s.openPdf)
  return (
    <Page title="PDF library" onBack={onBack}>
      <ListSection>
        {pdfs.length === 0 && <div className="mobile-empty">No PDFs. Import on your Mac — the metadata syncs; the file is attached when you import it here (Files import arrives with the PDF phase).</div>}
        {pdfs.map((p) => (
          <Row key={p.id} title={p.title} subtitle={`${p.pageCount ? `${p.pageCount} pages · ` : ''}${(p.fileSize / 1024 / 1024).toFixed(1)} MB${p.fileMissing ? ' · file not on this device' : ''}`} chevron onClick={() => { openPdf(p.id, p.title); onOpen() }} />
        ))}
      </ListSection>
    </Page>
  )
}

function DiagnosticsPage({ onBack }: { onBack: () => void }) {
  const [Boot, setBoot] = useState<React.ComponentType | null>(null)
  useEffect(() => { import('@/platform/ios/IosBoot').then((m) => setBoot(() => m.IosBoot)).catch(() => {}) }, [])
  return <Page title="Diagnostics" onBack={onBack}>{Boot ? <Boot /> : <div className="mobile-empty">Loading…</div>}</Page>
}

/** Theme + fonts on <html>, following iOS light/dark (R079). */
function useAppearance() {
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const glassAppearance = useAppStore((s) => s.glassAppearance)
  const scriptureFontFamily = useAppStore((s) => s.scriptureFontFamily)
  const notesFontFamily = useAppStore((s) => s.notesFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const h = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  const customThemes = useAppStore((s) => s.customThemes)
  useEffect(() => {
    // Presets colour Scripture only (SEP25); the app keeps its Light / Dark palette.
    applyMobileAppearance({ theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes])
  useEffect(() => { applyFontFamilies({ scriptureFontFamily, notesFontFamily, uiFontFamily }) }, [scriptureFontFamily, notesFontFamily, uiFontFamily])
  // Dynamic Type + accessibility switches (R082): the shell's CSS font sizes are multiplied by
  // `--m-type-scale`; VoiceOver / Bold Text / Increase Contrast become data attributes the CSS
  // and components can key on (Reduce Motion is honoured by framer's MotionConfig + CSS already).
  useEffect(() => {
    const apply = (st: { scale: number; voiceOver: boolean; boldText: boolean; increaseContrast: boolean; reduceTransparency?: boolean }) => {
      const root = document.documentElement
      root.style.setProperty('--m-type-scale', String(st.scale))
      if (st.voiceOver) root.dataset.voiceover = ''; else delete root.dataset.voiceover
      if (st.boldText) root.dataset.boldText = ''; else delete root.dataset.boldText
      if (st.increaseContrast) root.dataset.contrast = 'more'; else delete root.dataset.contrast
      // Reduce Transparency → the glass materials become opaque surfaces (ios-design-system.md).
      if (st.reduceTransparency) root.dataset.reduceTransparency = ''; else delete root.dataset.reduceTransparency
    }
    BereanA11y.getState().then(apply).catch(() => {})
    const h = BereanA11y.addListener('change', apply)
    return () => { h.then((x) => x.remove()).catch(() => {}) }
  }, [])
}

/** Boot: settings hydration + persistence, tab persistence (SQLite mirror), history, sync refresh, keyboard. */
function useBoot() {
  useEffect(() => {
    // Software keyboard (R083): expose its height so the shell's bottom bars and the editor
    // toolbar sit above it (capacitor.config.ts keeps the WebView itself unresized).
    const root = document.documentElement
    const handles: Array<Promise<{ remove: () => Promise<void> }>> = []
    try {
      // `berean:keyboard` lets anchored menus re-measure (primitives/anchoredMenu.ts).
      handles.push(Keyboard.addListener('keyboardWillShow', (e) => { root.style.setProperty('--m-keyboard-h', `${e.keyboardHeight}px`); root.dataset.keyboard = ''; window.dispatchEvent(new Event('berean:keyboard')) }))
      handles.push(Keyboard.addListener('keyboardWillHide', () => { root.style.setProperty('--m-keyboard-h', '0px'); delete root.dataset.keyboard; window.dispatchEvent(new Event('berean:keyboard')) }))
    } catch { /* web preview */ }
    // Keyboard dismissal (on drag / swipe down / inert tap) — one shell-wide behaviour.
    const disposeDismiss = installKeyboardDismiss(document.body)
    return () => { disposeDismiss(); for (const h of handles) h.then((x) => x.remove()).catch(() => {}) }
  }, [])
  useEffect(() => {
    window.settings?.getAll().then((all) => hydrateSettingsIntoStore(all)).catch(() => {})
    window.appHistory?.getAll().then((entries) => useAppStore.getState().setHistory(entries)).catch(() => {})
    const disposeSettings = persistSettingsFromStore()
    const disposeTabs = installTabPersistence()
    // Sunrise day boundary for daily notes: refresh the cached fix silently when access was
    // already granted; the first prompt happens when a daily note is opened (location.ts).
    void ensureDailyNoteLocation({ prompt: false })
    // Study Trail recording (R042): the same recorder desktop installs in App.tsx — every
    // navigateToVerse() (reader, search, deep links) becomes a trail stop.
    installStudyTrailRecorder(); installStudyTrailStateSync()
    // Power / thermal signal (R103) → store.resourceMode, same consumer as desktop App.tsx.
    window.app?.getResourceMode?.().then((mode) => useAppStore.getState().setResourceMode(mode)).catch(() => {})
    window.app?.onResourceModeChanged?.((mode) => useAppStore.getState().setResourceMode(mode))
    // Remote changes applied by the sync engine → the shared invalidation map (DATA-SYNC-009).
    wireSyncUi()   // the shared iCloud status store (Settings row, iCloud page, progress) — DATA-UX-001
    const disposeSync = window.sync?.onApplied?.((entities) => applySyncInvalidation(entities))
    return () => { disposeSettings(); disposeTabs?.(); disposeSync?.() }
  }, [])
}

export const __mobileInternals = { useMemo }
