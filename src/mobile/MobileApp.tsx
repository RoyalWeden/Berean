import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookMarked, Youtube, Tags, Route, Settings as SettingsIcon, History, Library, Layers, Archive, Download, ListMusic, ArrowLeft } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { applyFontFamilies } from '@/lib/fontFamilies'
import { hydrateSettingsIntoStore, persistSettingsFromStore } from '@/lib/settingsBridge'
import { installTabPersistence, applyExternalSessions } from '@/store/tabPersistenceRuntime'
import { installStudyTrailRecorder, installStudyTrailStateSync } from '@/store/studyTrailSlice'
import { storeDeepLinkTarget } from '@/lib/deepLinkTarget'
import { setIosDeepLinkTarget } from '@/platform/ios/deepLinks'
import { drainShareInbox } from '@/platform/ios/shareInbox'
import { ensureDailyNoteLocation } from '@/platform/ios/location'
import BiblePanel from '@/components/bible/BiblePanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import ErrorBoundary from '@/components/shell/ErrorBoundary'
import StudyTrailArrivalPrompt from '@/components/studyTrail/StudyTrailArrivalPrompt'
import { ActivePanelContext } from '@/components/shell/ActivePanelContext'
import { PanelChromeContext } from '@/components/shell/PanelHeader'
import { lazy, Suspense } from 'react'
const TagsGraphPanel = lazy(() => import('@/components/tags/TagsGraphPanel'))
const PDFViewer = lazy(() => import('@/components/pdf/PDFViewer'))
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { HISTORY_CATEGORIES, HISTORY_TYPE_LABEL, countByCategory, filterHistory, shouldLoadMoreHistory, type HistoryCategory } from '@/lib/historyModel'
import { SheetHost, useSheets } from './primitives/Sheet'
import { useActionSheet } from './primitives/ActionSheet'
import { NavigationStack, useNavigation } from './navigation/NavigationStack'
import { Page, ListSection, Row } from './primitives/Page'
import { TabCardsSheet } from './tabs/TabCardsSheet'
import { BottomNav } from './navigation/BottomNav'
import { useMoreRouteRequests } from './navigation/shellNav'
import { NewTabSheet } from './navigation/NewTabSheet'
import { CaretSheet } from './commands/CaretSheet'
import { caretRegistry, useCaretTopVersion, useCaretCommands } from './commands/caretRegistry'
import { staticCaretScope, type MoreRoute } from './commands/staticCommands'
import { SessionSwitcher } from './tabs/SessionSwitcher'
import { WorkspacesPage } from './tabs/WorkspacesPage'
import { ArchivePage } from './tabs/ArchivePage'
import { SESSION_ICONS } from '@/components/shell/Sidebar'
import { ReaderPage } from './reader/ReaderPage'
import { SettingsPage } from './settings/SettingsPage'
import { YouTubeSettingsPage } from './settings/YouTubeSettingsPage'
import { NotesHomePage } from './notes/NotesHomePage'
import { NoteEditorPage } from './notes/NoteEditorPage'
import { SearchPage } from './search/SearchPage'
import { AudioBar } from './audio/AudioBar'
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
  const openMore = useCallback((route: MoreRoute) => setMoreRoute(route), [])
  const closeMore = useCallback(() => setMoreRoute(null), [])
  // Any tab activation (tab cards, plus, deep link, navigation) leaves More.
  const activeKey = useAppStore((s) => `${s.activeSpace}:${s.activeTabId[s.activeSpace] ?? ''}`)
  const lastActiveKey = useRef(activeKey)
  useEffect(() => { if (activeKey !== lastActiveKey.current) { lastActiveKey.current = activeKey; setMoreRoute(null) } }, [activeKey])
  const showMore = moreRoute != null
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

  return (
    <div className="mobile-root">
      <main className="mobile-main">
        {showMore && <NavigationStack key={`more-${moreRoute}`} rootKey="more" root={<MorePage initialRoute={moreRoute} onClose={closeMore} onOpenSpace={(sp) => { useAppStore.getState().setActiveSpace(sp); closeMore() }} />} />}
        {!showMore && activeSpace !== 'youtube' && <NavigationStack key={activeSpace} rootKey={activeSpace} root={<SpaceRoot space={activeSpace} />} />}
        {(youtubeShowing || youtubeParked) && (
          <div key="youtube-space" className={youtubeParked ? 'mobile-space-parked' : 'mobile-space-live'} aria-hidden={youtubeParked || undefined}>
            <NavigationStack rootKey="youtube" root={<SpaceRoot space="youtube" />} />
          </div>
        )}
      </main>
      <AudioBar />
      {/* "Why did you jump?" pill (Study Trail, when the setting is on) — above the bottom bar. */}
      <StudyTrailArrivalPrompt bottomInset={96} />
      <BottomNav onTabs={nav.openTabs} onPlus={nav.openPlus} onCaret={nav.openCaret} caretLabel={nav.caretLabel} />
    </div>
  )
}

/** The three bottom-control surfaces (tab cards, plus, caret) + the tab / workspace action sheets
 *  that used to hang off the tab pill and grid. */
function useShellSheets({ openMore }: { openMore: (r: MoreRoute) => void }) {
  const sheets = useSheets()
  const actions = useActionSheet()
  useCaretTopVersion() // re-render when the page that owns the caret changes
  const activeSpace = useAppStore((s) => s.activeSpace)
  const activeTab = useAppStore((s) => s.tabs[s.activeSpace].find((t) => t.id === s.activeTabId[s.activeSpace]) ?? null)

  const openSessions = useCallback(() => sheets.open({ id: 'sessions', title: 'Workspaces', detents: [0.6, 0.92], render: (api) => (
    <SessionSwitcher close={api.close} onActions={(id) => {
      const s = useAppStore.getState()
      const session = s.sessions.find((x) => x.id === id)
      actions('session-actions', session?.name, [
        { id: 'rename', label: 'Rename…', onSelect: () => { const n = prompt('Workspace name', session?.name ?? ''); if (n?.trim()) s.renameSession(id, n.trim()) } },
        { id: 'icon', label: 'Icon…', onSelect: () => actions('session-icon', 'Icon', SESSION_ICONS.map((i) => ({ id: i.name, label: i.name, icon: i.Icon, onSelect: () => s.setSessionIcon(id, i.name) }))) },
        { id: 'archive-all', label: 'Archive all tabs in this workspace', onSelect: () => s.archiveAllTabs(session?.name) },
        { id: 'delete', label: 'Delete workspace', destructive: true, disabled: s.sessions.length <= 1, onSelect: () => { if (confirm(`Delete "${session?.name}" and close its tabs?`)) s.deleteSession(id) } },
      ])
    }} />
  ) }), [sheets, actions])

  const tabActions = useCallback((space: SpaceId, tabId: string) => {
    const s = useAppStore.getState()
    const t = s.tabs[space].find((x) => x.id === tabId)
    if (!t) return
    const idx = s.tabs[space].findIndex((x) => x.id === tabId)
    const others = s.sessions.filter((x) => x.id !== s.currentSessionId)
    actions('tab-actions', t.title, [
      { id: 'rename', label: 'Rename…', onSelect: () => { const n = prompt('Tab name', t.title); if (n?.trim()) s.renameTab(space, tabId, n.trim()) } },
      { id: 'duplicate', label: 'Duplicate tab', onSelect: () => { s.addTab({ ...t, id: `${t.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, state: JSON.parse(JSON.stringify(t.state)) }) } },
      { id: 'up', label: 'Move up', disabled: idx <= 0, onSelect: () => s.reorderTabs(space, idx, idx - 1) },
      { id: 'down', label: 'Move down', disabled: idx < 0 || idx >= s.tabs[space].length - 1, onSelect: () => s.reorderTabs(space, idx, idx + 1) },
      { id: 'move', label: 'Move to workspace…', disabled: others.length === 0, onSelect: () => actions('tab-move', 'Move to', others.map((x) => ({ id: x.id, label: x.name, onSelect: () => s.moveTabToSession(space, tabId, x.id) }))) },
      { id: 'archive', label: 'Archive tab', onSelect: () => s.archiveTab(space, tabId) },
      { id: 'close-others', label: 'Close other tabs of this type', onSelect: () => { for (const o of s.tabs[space]) if (o.id !== tabId && !o.isPinned) s.closeTab(space, o.id) } },
      { id: 'close', label: 'Close tab', destructive: true, onSelect: () => s.closeTab(space, tabId) },
    ])
  }, [actions])

  const openPlus = useCallback(() => sheets.open({ id: 'new-tab', detents: [0.92], render: (api) => <NewTabSheet close={api.close} openMore={(r) => openMore(r)} /> }), [sheets, openMore])
  const openTabs = useCallback(() => sheets.open({ id: 'tabs', detents: [0.62, 0.92], render: (api) => (
    <TabCardsSheet close={api.close} onOpenSessions={() => { api.close(); openSessions() }} onTabActions={tabActions}
      onNewTab={openPlus} onOpenArchive={() => { api.close(); openMore('archive') }} />
  ) }), [sheets, openSessions, tabActions, openPlus, openMore])
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
  if (space === 'search') return <ErrorBoundary label="search error"><SearchPage /></ErrorBoundary>
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
  useEffect(() => {
    if (!pendingNoteId) return
    const id = pendingNoteId
    clearPendingNote()
    nav.push(`note-${id}`, <NoteEditorPage noteId={id} onBack={nav.pop} />)
  }, [pendingNoteId, clearPendingNote, nav])
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
  const openSettings = useCallback(() => nav.push('settings', <SettingsPage onBack={nav.pop} />), [nav])
  const pdfFeatureEnabled = useAppStore((s) => s.pdfFeatureEnabled)
  const openTrail = useCallback(() => nav.push('trail', <StudyTrailPage onBack={nav.pop} onOpenSpace={onOpenSpace} />), [nav, onOpenSpace])
  // (window.app.openStudyTrailWindow() is handled by the shell — it opens More at the trail route.)
  // Opened for a specific destination (plus sheet, caret, deep link): push it straight away; Back
  // from it returns to the More list, and More's Done returns to the tab.
  useEffect(() => {
    const push: Partial<Record<MoreRoute, () => void>> = {
      settings: openSettings,
      history: () => nav.push('history', <HistoryPage onBack={nav.pop} />),
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
      { kind: 'action', id: 'history', label: 'History', icon: History, run: () => nav.push('history', <HistoryPage onBack={nav.pop} />) },
    ] }],
  }))
  return (
    <Page title="More" right={<button type="button" className="mobile-link-button" onClick={onClose}>Done</button>}>
      <ListSection title="Spaces">
        <Row leading={<BookMarked size={20} aria-hidden />} title="Lexicon" subtitle="Strong's entries, search, occurrences" chevron onClick={() => onOpenSpace('lexicon')} />
        <Row leading={<Youtube size={20} aria-hidden />} title="YouTube" subtitle="Channels, transcripts, watch positions" chevron onClick={() => onOpenSpace('youtube')} />
        <Row leading={<Download size={20} aria-hidden />} title="Transcript packs" subtitle="Download channel transcripts for offline search" chevron onClick={() => nav.push('transcripts', <TranscriptPacksPage onBack={nav.pop} />)} />
      </ListSection>
      <ListSection title="Study">
        <Row leading={<Tags size={20} aria-hidden />} title="Verse tags" subtitle="Tag manager and graph" chevron onClick={() => { useAppStore.getState().openTagsGraph(); onOpenSpace('notes') }} />
        <Row leading={<Route size={20} aria-hidden />} title="Study trail" subtitle="Sessions, map, threads, recap" chevron onClick={openTrail} />
        <Row leading={<ListMusic size={20} aria-hidden />} title="Read Aloud queue" subtitle="Queue and saved playlists" chevron onClick={() => nav.push('queue', <QueuePage onBack={nav.pop} />)} />
        <Row leading={<History size={20} aria-hidden />} title="History" chevron onClick={() => nav.push('history', <HistoryPage onBack={nav.pop} />)} />
        <Row leading={<Layers size={20} aria-hidden />} title="Workspaces" subtitle="Saved tab sets" chevron onClick={() => nav.push('workspaces', <WorkspacesPage onBack={nav.pop} />)} />
        <Row leading={<Archive size={20} aria-hidden />} title="Archived tabs" chevron onClick={() => nav.push('archive', <ArchivePage onBack={nav.pop} />)} />
        {pdfFeatureEnabled && <Row leading={<Library size={20} aria-hidden />} title="PDF library" chevron onClick={() => nav.push('pdfs', <PdfLibraryPage onBack={nav.pop} onOpen={() => onOpenSpace('scripture')} />)} />}
      </ListSection>
      <ListSection>
        <Row leading={<SettingsIcon size={20} aria-hidden />} title="Settings" chevron onClick={openSettings} />
        <Row title="Diagnostics" subtitle="Native stack self-test" chevron onClick={() => nav.push('diagnostics', <DiagnosticsPage onBack={nav.pop} />)} />
      </ListSection>
    </Page>
  )
}

function HistoryPage({ onBack }: { onBack: () => void }) {
  const history = useAppStore((s) => s.history)
  const hasMore = useAppStore((s) => s.historyHasMore)
  const loadingMore = useAppStore((s) => s.historyLoadingMore)
  const loadMore = useAppStore((s) => s.loadMoreHistory)
  const navigate = useHistoryNavigate()
  // Same categories and filter rules as the desktop History modal (src/lib/historyModel.ts, TEST-002).
  const [category, setCategory] = useState<HistoryCategory>('all')
  const [studyOnly, setStudyOnly] = useState(false)
  const rows = useMemo(() => filterHistory(history, { category, studyOnly: studyOnly && category === 'scripture' }), [history, category, studyOnly])
  const counts = useMemo(() => countByCategory(history), [history])
  useEffect(() => {
    if (category !== 'all' && shouldLoadMoreHistory(rows.length, hasMore, loadingMore)) void loadMore()
  }, [category, rows.length, hasMore, loadingMore, loadMore])
  return (
    <Page title="History" onBack={onBack} headerBelow={
      <div className="mobile-chip-row mobile-chip-row-scroll" role="tablist" aria-label="History category">
        {HISTORY_CATEGORIES.map((c) => (
          <button key={c.key} type="button" role="tab" aria-selected={category === c.key} className={`mobile-chip${category === c.key ? ' is-on' : ''}`} onClick={() => setCategory(c.key)}>
            {c.label}{c.key !== 'all' && counts[c.key] ? ` · ${counts[c.key]}` : ''}
          </button>
        ))}
        {category === 'scripture' && (
          <button type="button" className={`mobile-chip${studyOnly ? ' is-on' : ''}`} aria-pressed={studyOnly} onClick={() => setStudyOnly((v) => !v)}>Study only</button>
        )}
      </div>
    }>
      <ListSection>
        {rows.length === 0 && <div className="mobile-empty">{history.length === 0 ? 'Nothing yet.' : 'No entries in this category.'}</div>}
        {rows.slice(0, 400).map((h) => (
          <Row key={h.id} title={h.title} subtitle={`${HISTORY_TYPE_LABEL[h.type]} · ${new Date(h.timestamp).toLocaleString()}`} onClick={() => { onBack(); navigate(h) }} />
        ))}
        {hasMore && <Row title={loadingMore ? 'Loading…' : 'Load older history'} onClick={() => void loadMore()} />}
      </ListSection>
    </Page>
  )
}

function PdfLibraryPage({ onBack, onOpen }: { onBack: () => void; onOpen: () => void }) {
  const [pdfs, setPdfs] = useState<import('@/types').PdfDoc[]>([])
  useEffect(() => { window.pdf.list().then(setPdfs).catch(() => setPdfs([])) }, [])
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
    applyThemeToDocument({ theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance, customThemes])
  useEffect(() => { applyFontFamilies({ scriptureFontFamily, notesFontFamily, uiFontFamily }) }, [scriptureFontFamily, notesFontFamily, uiFontFamily])
  // Dynamic Type + accessibility switches (R082): the shell's CSS font sizes are multiplied by
  // `--m-type-scale`; VoiceOver / Bold Text / Increase Contrast become data attributes the CSS
  // and components can key on (Reduce Motion is honoured by framer's MotionConfig + CSS already).
  useEffect(() => {
    const apply = (st: { scale: number; voiceOver: boolean; boldText: boolean; increaseContrast: boolean }) => {
      const root = document.documentElement
      root.style.setProperty('--m-type-scale', String(st.scale))
      if (st.voiceOver) root.dataset.voiceover = ''; else delete root.dataset.voiceover
      if (st.boldText) root.dataset.boldText = ''; else delete root.dataset.boldText
      if (st.increaseContrast) root.dataset.contrast = 'more'; else delete root.dataset.contrast
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
      handles.push(Keyboard.addListener('keyboardWillShow', (e) => { root.style.setProperty('--m-keyboard-h', `${e.keyboardHeight}px`); root.dataset.keyboard = '' }))
      handles.push(Keyboard.addListener('keyboardWillHide', () => { root.style.setProperty('--m-keyboard-h', '0px'); delete root.dataset.keyboard }))
    } catch { /* web preview */ }
    return () => { for (const h of handles) h.then((x) => x.remove()).catch(() => {}) }
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
    const disposeSync = window.sync?.onApplied?.((entities) => {
      const s = useAppStore.getState()
      if (entities.includes('highlight')) s.bumpHighlightToken()
      if (entities.some((e) => e === 'verse_tag' || e === 'verse_tag_member' || e === 'tag_edge')) void s.refreshVerseTags()
      if (entities.some((e) => e === 'session' || e === 'tab' || e === 'archived_group')) void applyExternalSessions()
      if (entities.includes('workspace')) window.workspaces.list().then((ws) => s.setSavedWorkspaces(ws)).catch(() => {})
      if (entities.some((e) => e === 'note' || e === 'note_folder' || e === 'note_version')) s.bumpNoteToken()
    })
    return () => { disposeSettings(); disposeTabs?.(); disposeSync?.() }
  }, [])
}

export const __mobileInternals = { useMemo }
