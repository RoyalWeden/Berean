import React, { useEffect, useMemo, useState } from 'react'
import { BookMarked, Youtube, Tags, Route, Settings as SettingsIcon, History, Library } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId, Tab } from '@/types'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { applyFontFamilies } from '@/lib/fontFamilies'
import { hydrateSettingsIntoStore, persistSettingsFromStore } from '@/lib/settingsBridge'
import { installTabPersistence, applyExternalSessions } from '@/store/tabPersistenceRuntime'
import { storeDeepLinkTarget } from '@/lib/deepLinkTarget'
import { setIosDeepLinkTarget } from '@/platform/ios/deepLinks'
import BiblePanel from '@/components/bible/BiblePanel'
import LexiconPanel from '@/components/lexicon/LexiconPanel'
import YouTubeTab from '@/components/youtube/YouTubeTab'
import SearchTab from '@/components/search/SearchTab'
import ErrorBoundary from '@/components/shell/ErrorBoundary'
import { useHistoryNavigate } from '@/components/shell/HistoryModal'
import { SheetHost, useSheets } from './primitives/Sheet'
import { useActionSheet } from './primitives/ActionSheet'
import { NavigationStack, useNavigation } from './navigation/NavigationStack'
import { Page, ListSection, Row } from './primitives/Page'
import { SpaceBar, destinationForSpace, type MobileDestination } from './tabs/SpaceBar'
import { TabPill } from './tabs/TabPill'
import { TabGrid } from './tabs/TabGrid'
import { SessionSwitcher } from './tabs/SessionSwitcher'
import { ReaderPage } from './reader/ReaderPage'
import { SettingsPage } from './settings/SettingsPage'
import { NotesHomePage } from './notes/NotesHomePage'
import { NoteEditorPage } from './notes/NoteEditorPage'
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
  return (
    <SheetHost>
      <Shell />
    </SheetHost>
  )
}

function Shell() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const [moreSpace, setMoreSpace] = useState<SpaceId | 'more'>('more')
  const destination: MobileDestination = destinationForSpace(activeSpace)
  const onSelect = (d: MobileDestination) => {
    if (d === 'more') { setMoreSpace('more'); setActiveSpace(moreSpace === 'more' ? activeSpace : moreSpace); setMoreVisible(true); return }
    setMoreVisible(false)
    setActiveSpace(d)
  }
  const [moreVisible, setMoreVisible] = useState(false)
  const showMore = destination === 'more' || moreVisible
  useEffect(() => { setIosDeepLinkTarget(storeDeepLinkTarget); return () => setIosDeepLinkTarget(null) }, [])

  return (
    <div className="mobile-root">
      <main className="mobile-main">
        {showMore
          ? <NavigationStack rootKey="more" root={<MorePage onOpenSpace={(sp) => { setMoreSpace(sp); setActiveSpace(sp); setMoreVisible(false) }} />} />
          : <NavigationStack key={activeSpace} rootKey={activeSpace} root={<SpaceRoot space={activeSpace} />} />}
      </main>
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
  if (!active) return <EmptySpace space={space} />
  return <ErrorBoundary label={`${space} error`}><TabPage tab={active} /></ErrorBoundary>
}

/** Notes space: native home page; a `requestOpenNote` from anywhere (verse sheet, history, deep
 *  link, wikilink) pushes the editor for that note. */
function NotesSpace() {
  const nav = useNavigation()
  const pendingNoteId = useAppStore((s) => s.pendingNoteId)
  const clearPendingNote = useAppStore((s) => s.clearPendingNote)
  useEffect(() => {
    if (!pendingNoteId) return
    const id = pendingNoteId
    clearPendingNote()
    nav.push(`note-${id}`, <NoteEditorPage noteId={id} onBack={nav.pop} />)
  }, [pendingNoteId, clearPendingNote, nav])
  return <NotesHomePage />
}

function TabPage({ tab }: { tab: Tab }) {
  if (tab.spaceId === 'scripture' && tab.type === 'bible') return <ReaderPage tab={tab} />
  // Interim hosts (documented in feature-matrix.md): the desktop panel's content, full width.
  const inner =
    tab.spaceId === 'scripture' ? <BiblePanel floating /> :
    tab.spaceId === 'lexicon' ? <LexiconPanel floating /> :
    tab.spaceId === 'youtube' ? <YouTubeTab floating /> :
    <SearchTab floating />
  return <div className="mobile-hosted-panel">{inner}</div>
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
        { id: 'delete', label: 'Delete workspace', destructive: true, disabled: s.sessions.length <= 1, onSelect: () => { if (confirm(`Delete "${session?.name}" and close its tabs?`)) s.deleteSession(id) } },
      ])
    }} />
  ) })
  const openGrid = () => sheets.open({ id: 'tabs', title: undefined, detents: [0.7, 0.92], render: (api) => (
    <TabGrid space={space} close={api.close} onOpenSessions={() => { api.close(); openSessions() }} onTabActions={(tabId) => {
      const s = useAppStore.getState()
      const t = s.tabs[space].find((x) => x.id === tabId)
      if (!t) return
      actions('tab-actions', t.title, [
        { id: 'rename', label: 'Rename…', onSelect: () => { const n = prompt('Tab name', t.title); if (n?.trim()) s.renameTab(space, tabId, n.trim()) } },
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
      </ListSection>
      <ListSection title="Study">
        <Row leading={<Tags size={20} aria-hidden />} title="Verse tags" subtitle="Tag manager and graph" chevron onClick={() => { useAppStore.getState().openTagsGraph(); onOpenSpace('notes') }} />
        <Row leading={<Route size={20} aria-hidden />} title="Study trail" subtitle="Sessions, map, recap — phone page in a later phase; data already syncs" />
        <Row leading={<History size={20} aria-hidden />} title="History" chevron onClick={() => nav.push('history', <HistoryPage onBack={nav.pop} />)} />
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

/** Boot: settings hydration + persistence, tab persistence (SQLite mirror), history, sync refresh. */
function useBoot() {
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
