import React, { useEffect, useMemo, useState } from 'react'
import { BookMarked, Youtube, Tags, Route, Settings as SettingsIcon, History, Library, Layers, Archive, Download } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { applyFontFamilies } from '@/lib/fontFamilies'
import { hydrateSettingsIntoStore, persistSettingsFromStore } from '@/lib/settingsBridge'
import { installTabPersistence, applyExternalSessions } from '@/store/tabPersistenceRuntime'
import { storeDeepLinkTarget } from '@/lib/deepLinkTarget'
import { setIosDeepLinkTarget } from '@/platform/ios/deepLinks'
import { drainShareInbox } from '@/platform/ios/shareInbox'
import BiblePanel from '@/components/bible/BiblePanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import ErrorBoundary from '@/components/shell/ErrorBoundary'
import { ActivePanelContext } from '@/components/shell/ActivePanelContext'
import { lazy, Suspense } from 'react'
const TagsGraphPanel = lazy(() => import('@/components/tags/TagsGraphPanel'))
const PDFViewer = lazy(() => import('@/components/pdf/PDFViewer'))
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { SheetHost, useSheets } from './primitives/Sheet'
import { useActionSheet } from './primitives/ActionSheet'
import { NavigationStack, useNavigation } from './navigation/NavigationStack'
import { Page, ListSection, Row } from './primitives/Page'
import { SpaceBar, destinationForSpace, type MobileDestination } from './tabs/SpaceBar'
import { TabPill } from './tabs/TabPill'
import { TabGrid } from './tabs/TabGrid'
import { SessionSwitcher } from './tabs/SessionSwitcher'
import { WorkspacesPage } from './tabs/WorkspacesPage'
import { ArchivePage } from './tabs/ArchivePage'
import { SESSION_ICONS } from '@/components/shell/Sidebar'
import { ReaderPage } from './reader/ReaderPage'
import { SettingsPage } from './settings/SettingsPage'
import { NotesHomePage } from './notes/NotesHomePage'
import { NoteEditorPage } from './notes/NoteEditorPage'
import { SearchPage } from './search/SearchPage'
import { AudioBar } from './audio/AudioBar'
import { TranscriptPacksPage } from './youtube/TranscriptPacksPage'
import { useTTSPlayback } from '@/hooks/useTTSPlayback'
import { Keyboard } from '@capacitor/keyboard'
import './mobile.css'

/**
 * iPhone shell root (Phase 10, R070–R072, R076, R079–R081). The same zustand store, the same
 * services behind `window.*`, the same tabs/sessions — presented as: a per-space navigation
 * stack, a bottom space bar, the Arc-style tab pill, and bottom sheets. Desktop panels that have
 * no mobile page yet are hosted inside a page (their content is what matters; their chrome is
 * replaced phase by phase — see docs/mobile/feature-matrix.md).
 */
export default function MobileApp() {
  useAppearance()
  useBoot()
  useTTSPlayback()   // Read Aloud engine driver — the same hook App.tsx mounts
  return (
    <SheetHost>
      <Shell />
    </SheetHost>
  )
}

function Shell() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const destination: MobileDestination = destinationForSpace(activeSpace)
  const onSelect = (d: MobileDestination) => {
    if (d === 'more') { setMoreVisible(true); return }
    setMoreVisible(false)
    setActiveSpace(d)
  }
  const [moreVisible, setMoreVisible] = useState(false)
  // The More page shows only when explicitly opened; a More-hosted space (Lexicon, YouTube)
  // renders its own root while the bar keeps "More" highlighted.
  const showMore = moreVisible
  useEffect(() => { setIosDeepLinkTarget({ ...storeDeepLinkTarget, openShareInbox: () => { void drainShareInbox() } }); return () => setIosDeepLinkTarget(null) }, [])

  // The YouTube space stays mounted (parked, hidden) while a video tab is open and another space
  // is showing, so the native player keeps playing — the phone's counterpart of desktop auto-PiP
  // — and "Insert timestamp" from a note can ask the player for its position. Unmounting it
  // would close the player (TouchYouTubePlayer's cleanup).
  const ytVideoOpen = useAppStore((s) => { const t = s.tabs.youtube.find((x) => x.id === s.activeTabId.youtube) ?? s.tabs.youtube[0]; return !!(t?.state as { videoId?: string | null } | undefined)?.videoId })
  const youtubeShowing = !showMore && activeSpace === 'youtube'
  const youtubeParked = !youtubeShowing && ytVideoOpen

  return (
    <div className="mobile-root">
      <main className="mobile-main">
        {showMore && <NavigationStack rootKey="more" root={<MorePage onOpenSpace={(sp) => { setActiveSpace(sp); setMoreVisible(false) }} />} />}
        {!showMore && activeSpace !== 'youtube' && <NavigationStack key={activeSpace} rootKey={activeSpace} root={<SpaceRoot space={activeSpace} />} />}
        {(youtubeShowing || youtubeParked) && (
          <div key="youtube-space" className={youtubeParked ? 'mobile-space-parked' : 'mobile-space-live'} aria-hidden={youtubeParked || undefined}>
            <NavigationStack rootKey="youtube" root={<SpaceRoot space="youtube" />} />
          </div>
        )}
      </main>
      <AudioBar />
      {!showMore && <SpaceTabRow space={activeSpace} />}
      <SpaceBar current={showMore ? 'more' : destination} onSelect={onSelect} />
    </div>
  )
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
  if (active?.type === 'tags') return <ActivePanelContext.Provider value="tags"><div className="mobile-hosted-panel"><Suspense fallback={null}><TagsGraphPanel /></Suspense></div></ActivePanelContext.Provider>
  return <NotesHomePage dailyRequest={dailyRequest} />
}

function TabPage({ tab }: { tab: Tab }) {
  if (tab.spaceId === 'scripture' && tab.type === 'bible') return <ReaderPage tab={tab} />
  // Interim hosts (documented in feature-matrix.md): the desktop panel's content, full width.
  // ActivePanelContext tells the hosted panel it IS the visible one (desktop's ActivePanel
  // keeps several mounted and hides the rest; here exactly one is mounted).
  const inner =
    tab.spaceId === 'scripture' && tab.type === 'pdf' ? <Suspense fallback={null}><PDFViewer /></Suspense> :
    tab.spaceId === 'scripture' ? <BiblePanel floating /> :
    tab.spaceId === 'lexicon' ? <LexiconPanel floating /> :
    <YouTubeTab floating />
  return <ActivePanelContext.Provider value={tab.type}><div className="mobile-hosted-panel">{inner}</div></ActivePanelContext.Provider>
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

function SpaceTabRow({ space }: { space: SpaceId }) {
  const sheets = useSheets()
  const actions = useActionSheet()
  const createTab = useAppStore((s) => s.createTab)
  const kind = space === 'scripture' ? 'bible' : space === 'notes' ? 'note' : space === 'lexicon' ? 'lexicon' : space === 'youtube' ? 'youtube' : 'search'
  const openSessions = () => sheets.open({ id: 'sessions', title: 'Workspaces', detents: [0.6, 0.92], render: (api) => (
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
  ) })
  const openGrid = () => sheets.open({ id: 'tabs', title: undefined, detents: [0.7, 0.92], render: (api) => (
    <TabGrid space={space} close={api.close} onOpenSessions={() => { api.close(); openSessions() }} onTabActions={(tabId) => {
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
        { id: 'move', label: 'Move to workspace…', disabled: others.length === 0, onSelect: () => actions('tab-move', 'Move to', others.map((x) => ({ id: x.id, label: `${x.icon ? '' : ''}${x.name}`, onSelect: () => s.moveTabToSession(space, tabId, x.id) }))) },
        { id: 'archive', label: 'Archive tab', onSelect: () => s.archiveTab(space, tabId) },
        { id: 'close-others', label: 'Close other tabs', onSelect: () => { for (const o of s.tabs[space]) if (o.id !== tabId && !o.isPinned) s.closeTab(space, o.id) } },
        { id: 'close', label: 'Close tab', destructive: true, onSelect: () => s.closeTab(space, tabId) },
      ])
    }} />
  ) })
  return <TabPill space={space} onOpenGrid={openGrid} onNewTab={() => createTab(kind)} />
}

function MorePage({ onOpenSpace }: { onOpenSpace: (space: SpaceId) => void }) {
  const nav = useNavigation()
  const openSettings = () => nav.push('settings', <SettingsPage onBack={nav.pop} />)
  return (
    <Page title="More">
      <ListSection title="Spaces">
        <Row leading={<BookMarked size={20} aria-hidden />} title="Lexicon" subtitle="Strong's entries, search, occurrences" chevron onClick={() => onOpenSpace('lexicon')} />
        <Row leading={<Youtube size={20} aria-hidden />} title="YouTube" subtitle="Channels, transcripts, watch positions" chevron onClick={() => onOpenSpace('youtube')} />
        <Row leading={<Download size={20} aria-hidden />} title="Transcript packs" subtitle="Download channel transcripts for offline search" chevron onClick={() => nav.push('transcripts', <TranscriptPacksPage onBack={nav.pop} />)} />
      </ListSection>
      <ListSection title="Study">
        <Row leading={<Tags size={20} aria-hidden />} title="Verse tags" subtitle="Tag manager and graph" chevron onClick={() => { useAppStore.getState().openTagsGraph(); onOpenSpace('notes') }} />
        <Row leading={<Route size={20} aria-hidden />} title="Study trail" subtitle="Sessions, map, recap — phone page in a later phase; data already syncs" />
        <Row leading={<History size={20} aria-hidden />} title="History" chevron onClick={() => nav.push('history', <HistoryPage onBack={nav.pop} />)} />
        <Row leading={<Layers size={20} aria-hidden />} title="Workspaces" subtitle="Saved tab sets" chevron onClick={() => nav.push('workspaces', <WorkspacesPage onBack={nav.pop} />)} />
        <Row leading={<Archive size={20} aria-hidden />} title="Archived tabs" chevron onClick={() => nav.push('archive', <ArchivePage onBack={nav.pop} />)} />
        <Row leading={<Library size={20} aria-hidden />} title="PDF library" chevron onClick={() => nav.push('pdfs', <PdfLibraryPage onBack={nav.pop} onOpen={() => onOpenSpace('scripture')} />)} />
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
  const navigate = useHistoryNavigate()
  return (
    <Page title="History" onBack={onBack}>
      <ListSection>
        {history.length === 0 && <div className="mobile-empty">Nothing yet.</div>}
        {history.slice(0, 200).map((h) => (
          <Row key={h.id} title={h.title} subtitle={`${h.type} · ${new Date(h.timestamp).toLocaleString()}`} onClick={() => { onBack(); navigate(h) }} />
        ))}
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
  useEffect(() => {
    applyThemeToDocument({ theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity, glassAppearance])
  useEffect(() => { applyFontFamilies({ scriptureFontFamily, notesFontFamily, uiFontFamily }) }, [scriptureFontFamily, notesFontFamily, uiFontFamily])
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
