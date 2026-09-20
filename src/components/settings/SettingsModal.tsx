import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Sun, Moon, Monitor, Keyboard, FolderOpen, Trash2, ExternalLink, ChevronDown, ChevronRight, BookOpen, RefreshCw, Search as SearchIcon,
  Palette, NotepadText, RefreshCcw, Youtube, Database, Info, Cast, FlaskConical, Volume2, GitBranch, Tag,
} from 'lucide-react'
import { useAppStore } from '@/store'
import { LAYOUT_DEFS } from '@/components/bible/LayoutPicker'
import type { ScriptureLayout } from '@/types'
import { BULLET_STYLE_DEFS } from '@/lib/noteTextBlocks'
import { migrateAllNotes, type MigrationResult } from '@/lib/noteMigration'
import { Switch, SectionLabel, IconButton, Select, TextField, SearchField, Button, SegmentedControl, Sheet, ListRow, Slider, DisclosureRow, OptionCard, Divider } from '@/components/ui'
import ShortcutKeys from '@/components/shell/ShortcutKeys'
import SectionAnchorChips from './SectionAnchorChips'
import YtLayoutSetting from './sections/YtLayoutSetting'
import WordReplacerSection from './sections/WordReplacerSection'
import AudioSection from './sections/AudioSection'
import HistorySection from './sections/HistorySection'
import UpdatesSection from './sections/UpdatesSection'
import PrintExportSection from './sections/PrintExportSection'
import WorkspacesSection from './sections/WorkspacesSection'
import SessionsSection from './sections/SessionsSection'
import ImportSection from './sections/ImportSection'
import AboutSection from './sections/AboutSection'
import DangerSection from './sections/DangerSection'
import ExperimentalSection from './sections/ExperimentalSection'
import { NOTE_STATUSES } from '@/lib/noteStatus'
import { THEME_PRESETS } from '@/lib/themePresets'
import ThemePicker from './ThemePicker'

const FONT_FAMILY_OPTIONS = [
  { value: 'system', label: 'System default' },
  { value: 'serif', label: 'Serif (Georgia)' },
  { value: 'sansserif', label: 'Sans-serif (Inter)' },
  { value: 'mono', label: 'Monospace' },
  { value: 'garamond', label: 'EB Garamond' },
  { value: 'palatino', label: 'Palatino' },
  { value: 'merriweather', label: 'Merriweather' },
  { value: 'lora', label: 'Lora' },
  { value: 'crimson', label: 'Crimson Text' },
  { value: 'sourceserif', label: 'Source Serif 4' },
  { value: 'nunito', label: 'Nunito' },
]

function MarkdownRefButton({ onClose }: { onClose: () => void }) {
  const open = useAppStore((s) => s.openMarkdownReference)
  return (
    <Button
      variant="secondary"
      size="md"
      icon={BookOpen}
      onClick={() => { onClose(); setTimeout(open, 100) }}
      className="w-full justify-start text-accent"
    >
      Markdown reference guide
    </Button>
  )
}

const SHORTCUT_GROUPS = [
  {
    label: 'Navigation',
    shortcuts: [
      { key: '⌘1–5', action: 'Switch to space by number' },
      { key: '⌘T', action: 'New tab / floating search' },
      { key: '⌘K / ⌘L', action: 'Floating command bar' },
      { key: '⌘W', action: 'Close current tab' },
      { key: '⌘⇧S', action: 'Toggle sidebar' },
      { key: 'Esc', action: 'Close modal / dismiss popover' },
      { key: '⌘,', action: 'Open settings' },
      { key: 'Ctrl+Tab', action: 'Tab switcher (most recent first)' },
    ],
  },
  {
    label: 'Find in Page',
    shortcuts: [
      { key: '⌘F', action: 'Open find bar (find in current view)' },
      { key: '↵ / ⇧↵', action: 'Next / previous match in find bar' },
      { key: '⌘⇧F', action: 'Advanced full-text search (Search tab)' },
    ],
  },
  {
    label: 'Bible Reader',
    shortcuts: [
      { key: '⌘F', action: 'Find text in current chapter' },
      { key: '⌘/', action: 'Scripture floating search (Cmd+/)' },
      { key: 'Search icon', action: 'Scripture floating search (toolbar button)' },
      { key: 'Advanced search tab', action: 'Full scripture search tab with all text filters' },
    ],
  },
  {
    label: 'Notes',
    shortcuts: [
      { key: '⌘⇧N', action: 'New general note' },
      { key: '⌘⇧M', action: 'Toggle markdown preview' },
      { key: '⌘Z / ⌘⇧Z', action: 'Undo / Redo' },
      { key: '⌘B', action: 'Bold' },
      { key: '⌘I', action: 'Italic' },
      { key: '⌘U', action: 'Underline' },
      { key: '⌘⇧H', action: 'Highlight text (==text==)' },
      { key: '⌘F', action: 'Find text in note (Cmd+F only — no type-anywhere)' },
    ],
  },
  {
    label: 'Lexicon',
    shortcuts: [
      { key: '⌘F', action: 'Find text in lexicon entry' },
    ],
  },
  {
    label: 'YouTube',
    shortcuts: [
      { key: '⌘⇧P', action: 'Toggle Picture-in-Picture' },
      { key: '⌘⇧L', action: 'Insert timestamp into note' },
    ],
  },
  {
    label: 'Read Aloud',
    shortcuts: [
      { key: '⌘⇧R', action: 'Play / pause Read Aloud' },
    ],
  },
]

const DEFAULT_TRANSLATIONS = [
  { id: 'kjva',          label: 'KJVA — King James + Apocrypha' },
  { id: 'lxx',           label: 'LXX — Brenton Septuagint' },
  { id: 'enoch',         label: '1 Enoch — R.H. Charles' },
  { id: 'jubilees',      label: 'Jubilees — R.H. Charles' },
  { id: 'apoc_elijah',   label: 'Apocalypse of Elijah' },
  { id: 'asc_isaiah',    label: 'Ascension of Isaiah — R.H. Charles' },
  { id: 'ep_barnabas',   label: 'Epistle of Barnabas — Samuel Sharpe' },
  { id: 't12p',          label: 'Testaments of the 12 Patriarchs — R.H. Charles' },
  { id: 'recog_clement', label: 'Recognitions of Clement (Ante-Nicene Fathers)' },
  { id: 'hermas',        label: 'Shepherd of Hermas (Ante-Nicene Fathers)' },
  { id: 'gad',           label: 'Gad the Seer — Beir Bar-Ilan' },
  { id: 't_job',         label: 'Testament of Job — M.R. James (1897)' },
  { id: '1clement',      label: '1 Clement — J.B. Lightfoot' },
  { id: 'apoc_abraham',  label: 'Apocalypse of Abraham — G.H. Box (1918)' },
  { id: 't_jacob',       label: 'Testament of Jacob — W.F. Stinespring' },
  { id: '2baruch',       label: '2 Baruch — R.H. Charles-based' },
]

// Theme preset data now lives in src/lib/themePresets.ts — shared with App.tsx (which applies
// the resulting class to <html>) and ThemePicker.tsx (the dedicated full picker overlay below).

const BEREAN_SITE_URL = 'https://royalweden.github.io/Berean'





type Section = 'appearance' | 'reading' | 'notes' | 'vault' | 'youtube' | 'audio' | 'shortcuts' | 'data' | 'about' | 'viewer' | 'studyTrail' | 'experimental'

interface WatchHistoryEntry {
  videoId: string
  positionSeconds: number
  lastWatched: string
  title: string
  channelName: string
  thumbnailUrl: string
}

export default function SettingsModal() {
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  const closeSettings = useAppStore((s) => s.closeSettings)
  const settingsInitialSection = useAppStore((s) => s.settingsInitialSection)
  const lastSettingsSection = useAppStore((s) => s.lastSettingsSection)
  const setLastSettingsSection = useAppStore((s) => s.setLastSettingsSection)
  const settingsSectionScrollTop = useAppStore((s) => s.settingsSectionScrollTop)
  const setSettingsSectionScrollTop = useAppStore((s) => s.setSettingsSectionScrollTop)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const glassAppearance = useAppStore((s) => s.glassAppearance)
  const setGlassAppearance = useAppStore((s) => s.setGlassAppearance)
  const setBackgroundAnimationEnabled = useAppStore((s) => s.setBackgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const setBackgroundAnimationStyle = useAppStore((s) => s.setBackgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const setBackgroundAnimationIntensity = useAppStore((s) => s.setBackgroundAnimationIntensity)
  const scriptureFontFamily = useAppStore((s) => s.scriptureFontFamily)
  const notesFontFamily = useAppStore((s) => s.notesFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const setScriptureFontFamily = useAppStore((s) => s.setScriptureFontFamily)
  const setNotesFontFamily = useAppStore((s) => s.setNotesFontFamily)
  const setUiFontFamily = useAppStore((s) => s.setUiFontFamily)
  const autoCloseTabsAfter = useAppStore((s) => s.autoCloseTabsAfter)
  const setAutoCloseTabsAfter = useAppStore((s) => s.setAutoCloseTabsAfter)
  const bibleFontSize = useAppStore((s) => s.bibleFontSize)
  const setBibleFontSize = useAppStore((s) => s.setBibleFontSize)
  const defaultBibleTranslation = useAppStore((s) => s.defaultBibleTranslation)
  const setDefaultBibleTranslation = useAppStore((s) => s.setDefaultBibleTranslation)
  const hermasTranslation = useAppStore((s) => s.hermasTranslation)
  const setHermasTranslation = useAppStore((s) => s.setHermasTranslation)
  const bibleLineHeight = useAppStore((s) => s.bibleLineHeight)
  const setBibleLineHeight = useAppStore((s) => s.setBibleLineHeight)
  const defaultScriptureLayout = useAppStore((s) => s.defaultScriptureLayout)
  const noteTransformLayout = useAppStore((s) => s.noteTransformLayout)
  const setNoteTransformLayout = useAppStore((s) => s.setNoteTransformLayout)
  const setDefaultScriptureLayout = useAppStore((s) => s.setDefaultScriptureLayout)
  const autoPiP = useAppStore((s) => s.autoPiP)
  const setAutoPiP = useAppStore((s) => s.setAutoPiP)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const setWordReplacerEnabled = useAppStore((s) => s.setWordReplacerEnabled)
  const toggleWordReplacerRule = useAppStore((s) => s.toggleWordReplacerRule)
  const studyTrailAskChapterJumpReason = useAppStore((s) => s.studyTrailAskChapterJumpReason)
  const setStudyTrailAskChapterJumpReason = useAppStore((s) => s.setStudyTrailAskChapterJumpReason)
  const noteVerseRefsEnabled = useAppStore((s) => s.noteVerseRefsEnabled)
  const noteLexiconRefsEnabled = useAppStore((s) => s.noteLexiconRefsEnabled)
  const setNoteVerseRefsEnabled = useAppStore((s) => s.setNoteVerseRefsEnabled)
  const setNoteLexiconRefsEnabled = useAppStore((s) => s.setNoteLexiconRefsEnabled)
  const noteScriptureBlock = useAppStore((s) => s.noteScriptureBlock)
  const setNoteScriptureBlock = useAppStore((s) => s.setNoteScriptureBlock)
  const sidePanelScriptureBlock = useAppStore((s) => s.sidePanelScriptureBlock)
  const setSidePanelScriptureBlock = useAppStore((s) => s.setSidePanelScriptureBlock)
  const autoEmDash = useAppStore((s) => s.autoEmDash)
  const setAutoEmDash = useAppStore((s) => s.setAutoEmDash)
  const noteScriptureBlockThreshold = useAppStore((s) => s.noteScriptureBlockThreshold)
  const setNoteScriptureBlockThreshold = useAppStore((s) => s.setNoteScriptureBlockThreshold)
  const noteVerseBlockSuggest = useAppStore((s) => s.noteVerseBlockSuggest)
  const setNoteVerseBlockSuggest = useAppStore((s) => s.setNoteVerseBlockSuggest)
  const noteStrongsBlockSuggest = useAppStore((s) => s.noteStrongsBlockSuggest)
  const setNoteStrongsBlockSuggest = useAppStore((s) => s.setNoteStrongsBlockSuggest)
  const floatingSearchDensity = useAppStore((s) => s.floatingSearchDensity)
  const setFloatingSearchDensity = useAppStore((s) => s.setFloatingSearchDensity)
  const defaultNoteEditorMode = useAppStore((s) => s.defaultNoteEditorMode)
  const setDefaultNoteEditorMode = useAppStore((s) => s.setDefaultNoteEditorMode)
  const confirmNoteDelete = useAppStore((s) => s.confirmNoteDelete)
  const setConfirmNoteDelete = useAppStore((s) => s.setConfirmNoteDelete)
  const [migrationState, setMigrationState] = useState<
    | { phase: 'idle' }
    | { phase: 'confirming' }
    | { phase: 'running'; done: number; total: number }
    | { phase: 'done'; result: MigrationResult }
  >({ phase: 'idle' })
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  const setShowVerseNumbers = useAppStore((s) => s.setShowVerseNumbers)
  const showRedLetters = useAppStore((s) => s.showRedLetters)
  const setShowRedLetters = useAppStore((s) => s.setShowRedLetters)
  const continuousChapterScroll = useAppStore((s) => s.continuousChapterScroll)
  const setContinuousChapterScroll = useAppStore((s) => s.setContinuousChapterScroll)
  const continuousDailyScroll = useAppStore((s) => s.continuousDailyScroll)
  const setContinuousDailyScroll = useAppStore((s) => s.setContinuousDailyScroll)
  const autoCopyOnHighlight = useAppStore((s) => s.autoCopyOnHighlight)
  const setAutoCopyOnHighlight = useAppStore((s) => s.setAutoCopyOnHighlight)
  const noteSpellCheck = useAppStore((s) => s.noteSpellCheck)
  const setNoteSpellCheck = useAppStore((s) => s.setNoteSpellCheck)
  const noteHeadingDivider = useAppStore((s) => s.noteHeadingDivider)
  const setNoteHeadingDivider = useAppStore((s) => s.setNoteHeadingDivider)
  const noteBulletStyle = useAppStore((s) => s.noteBulletStyle)
  const setNoteBulletStyle = useAppStore((s) => s.setNoteBulletStyle)
  const idiomHighlightEnabled = useAppStore((s) => s.idiomHighlightEnabled)
  const setIdiomHighlightEnabled = useAppStore((s) => s.setIdiomHighlightEnabled)
  const idiomHoverPreviewEnabled = useAppStore((s) => s.idiomHoverPreviewEnabled)
  const setIdiomHoverPreviewEnabled = useAppStore((s) => s.setIdiomHoverPreviewEnabled)
  const swipePanelGestureEnabled = useAppStore((s) => s.swipePanelGestureEnabled)
  const setSwipePanelGestureEnabled = useAppStore((s) => s.setSwipePanelGestureEnabled)
  const viewerFontScale = useAppStore((s) => s.viewerFontScale)
  const setViewerFontScale = useAppStore((s) => s.setViewerFontScale)
  const viewerTheme = useAppStore((s) => s.viewerTheme)
  const setViewerTheme = useAppStore((s) => s.setViewerTheme)

  const [section, setSection] = useState<Section>(() => (lastSettingsSection as Section) || 'appearance')
  const [settingsSearch, setSettingsSearch] = useState('')
  // previewVariant: which palette to show in the preset swatches
  // follows base theme (dark/light) and can be toggled independently
  const [themePickerOpen, setThemePickerOpen] = useState(false)
  const [previewVariant, setPreviewVariant] = useState<'dark' | 'light'>(
    theme === 'light' ? 'light' : 'dark'
  )

  // Scroll position within the content pane, saved per-section so switching sections (or
  // reopening Settings entirely) restores where the user was instead of resetting to the top.
  //
  // Deliberately NOT debounced (an earlier version of this debounced the store write 150ms,
  // matching the flush-on-unmount pattern used elsewhere for scroll persistence — e.g.
  // SearchTab.tsx/ScriptureSearchView.tsx). That pattern relies on a real component unmount to
  // flush the last pending write, which works there because switching tabs actually unmounts
  // those components. Settings is different: Dialog.Content (Radix) has no forceMount/exit
  // animation, so it unmounts SYNCHRONOUSLY the instant settingsOpen flips false — by the time
  // any effect cleanup could run to flush a pending debounce, settingsContentRef.current may
  // already be null. Closing Settings can also be triggered from entirely different code paths
  // that never touch this component's local state at all (⌘, in App.tsx, a button in
  // AboutSection.tsx), so a locally-scoped "flush on close" handler can't cover every case
  // either. Writing straight through on every scroll event sidesteps the whole problem: this
  // only touches an in-memory zustand slice (cheap — the actually-expensive localStorage write
  // is separately debounced by debouncedLocalStorage, see src/lib/debouncedStorage.ts), so
  // there's no real cost to keeping it always current instead of batched.
  const settingsContentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!settingsOpen) return
    const el = settingsContentRef.current
    if (!el) return
    requestAnimationFrame(() => { el.scrollTop = settingsSectionScrollTop[section] ?? 0 })
  }, [settingsOpen, section]) // eslint-disable-line react-hooks/exhaustive-deps

  // Manual navigation (sidebar click, search jump) — unlike the deep-link effect below, this
  // also remembers the section so the next generic "open Settings" (gear icon, ⌘,) reopens here.
  function changeSection(next: Section) {
    setSection(next)
    setLastSettingsSection(next)
  }

  // When settings opens, jump to the requested initial section (e.g. 'import'). Also covers the
  // generic-open case: openSettings() sets settingsInitialSection to lastSettingsSection itself,
  // so this effect is what actually lands there on every open, not just deep links.
  useEffect(() => {
    if (settingsOpen && settingsInitialSection) {
      setSection(settingsInitialSection as Section)
      setLastSettingsSection(settingsInitialSection)
    }
  }, [settingsOpen, settingsInitialSection]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keep previewVariant in sync when base theme changes (not system)
  useEffect(() => {
    if (theme !== 'system') setPreviewVariant(theme === 'light' ? 'light' : 'dark')
  }, [theme])

  const [vaultSync, setVaultSync] = useState(false)
  const [vaultPath, setVaultPath] = useState('')
  const [defaultNoteStatus, setDefaultNoteStatus] = useState('none')
  const [exportingAll, setExportingAll] = useState(false)
  const [exportResult, setExportResult] = useState<{ notes?: number; highlights?: number; history?: number; pdfs?: number } | null>(null)
  const [importingAll, setImportingAll] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; notes?: number; highlights?: number; noteFolders?: number; pdfs?: number; reason?: string } | null>(null)
  const [watchHistory, setWatchHistory] = useState<WatchHistoryEntry[]>([])
  const [showYTSignIn, setShowYTSignIn] = useState(false)
  const [ytSignedOut, setYtSignedOut] = useState(false)
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(new Set())
  const [blockAdvancedOpen, setBlockAdvancedOpen] = useState(false)
  const [importAdvancedOpen, setImportAdvancedOpen] = useState(false)

  useEffect(() => {
    if (!settingsOpen) return
    window.settings.getAll().then((all) => {
      if (all.vaultSync != null) setVaultSync(Boolean(all.vaultSync))
      if (all.vaultPath) setVaultPath(all.vaultPath as string)
      if (all.defaultNoteStatus) setDefaultNoteStatus(all.defaultNoteStatus as string)
    }).catch(() => {})
  }, [settingsOpen])

  async function saveDefaultNoteStatus(value: string) {
    setDefaultNoteStatus(value)
    await window.settings.set('defaultNoteStatus', value)
  }

  useEffect(() => {
    if (section === 'youtube') {
      window.youtube.getWatchHistory().then((history) => {
        setWatchHistory(history)
        // Default all months to collapsed on first load
        const monthKeys = new Set<string>()
        for (const entry of history) {
          const d = new Date(entry.lastWatched)
          if (!isNaN(d.getTime())) {
            monthKeys.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
          }
        }
        setCollapsedMonths(monthKeys)
      }).catch(() => {})
    }
  }, [section])

  const handleRemoveFromHistory = useCallback(async (videoId: string) => {
    await window.youtube.removeFromHistory(videoId).catch(() => {})
    setWatchHistory((prev) => prev.filter((h) => h.videoId !== videoId))
    window.dispatchEvent(new CustomEvent('berean:watchHistoryChanged'))
  }, [])

  const handleClearHistory = useCallback(async () => {
    await window.youtube.clearWatchHistory().catch(() => {})
    setWatchHistory([])
    window.dispatchEvent(new CustomEvent('berean:watchHistoryChanged'))
  }, [])

  const handleJumpToVideo = useCallback((videoId: string) => {
    useAppStore.getState().setActiveSpace('youtube')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('berean:openYouTubeVideo', { detail: { videoId } }))
    }, 150)
    closeSettings()
  }, [closeSettings])

  async function saveTranslation(id: string) {
    setDefaultBibleTranslation(id)
    await window.settings.set('defaultTranslation', id)
  }

  async function saveFontSize(size: number) {
    setBibleFontSize(size)
    await window.settings.set('fontSize', size)
  }

  async function toggleVaultSync(enabled: boolean) {
    setVaultSync(enabled)
    await window.settings.set('vaultSync', enabled)
    // Fixed safety-net export interval, not user-configurable — see
    // AUTO_EXPORT_INTERVAL_MINUTES in electron/ipc/vault.ts.
    await window.vault.setAutoExport(enabled ? 5 : 0)
    if (enabled) {
      window.vault.watchVault().catch(() => {})
      useAppStore.getState().bumpVaultSyncToken()
    } else {
      // Otherwise the polling chokidar watcher started by watchVault() above keeps running
      // in the main process for the rest of the app's life, even with sync switched off.
      window.vault.unwatchVault().catch(() => {})
    }
  }

  async function saveVaultPath(path: string) {
    setVaultPath(path)
    await window.settings.set('vaultPath', path)
    if (!path) return
    // If the vault already has exported data, auto-import it so reinstalls or
    // machine migrations pick up where the user left off.
    const hasData = await window.vault.hasData().catch(() => false)
    if (!hasData) return
    setImportingAll(true)
    setImportResult(null)
    try {
      const res = await window.vault.importAll()
      setImportResult(res)
      if (res.tabState) {
        try { localStorage.setItem('berean-app-state', res.tabState) } catch { /* ignore */ }
      }
      setTimeout(() => setImportResult(null), 10000)
    } finally {
      setImportingAll(false)
    }
  }

  // Reorganized from the previous 15 flat sections down to 9 — fewer top-level
  // categories, related settings grouped together (e.g. History/Workspaces/Import/
  // Danger are all "manage your data" concerns, so they live under one Data page
  // with subheadings rather than 4 separate nav items).
  const NAV: { id: Section; label: string; icon: typeof Palette; keywords?: string[] }[] = [
    { id: 'appearance', label: 'Appearance', icon: Palette,   keywords: ['theme', 'font', 'color', 'dark', 'light', 'preset', 'typography', 'ui'] },
    { id: 'reading',    label: 'Reading',    icon: BookOpen,  keywords: ['strongs', 'inline', 'verse', 'zoom', 'layout', 'line height', 'scripture', 'bible', 'translation', 'red letter', 'hermas'] },
    { id: 'notes',      label: 'Notes',      icon: NotepadText,  keywords: ['markdown', 'editor', 'em dash', 'divider', 'bullet', 'spell', 'autocomplete', 'print', 'export', 'pdf', 'margin', 'daily', 'tags', 'verse tags'] },
    { id: 'vault',      label: 'Sync',       icon: RefreshCcw, keywords: ['sync', 'vault', 'obsidian', 'octarine', 'icloud', 'folder', 'path', 'markdown'] },
    { id: 'youtube',    label: 'YouTube',    icon: Youtube,   keywords: ['video', 'pip', 'picture in picture', 'channel', 'allowlist', 'transcript', 'captions', 'layout'] },
    { id: 'audio',      label: 'Audio',      icon: Volume2,   keywords: ['audio', 'read aloud', 'tts', 'text to speech', 'voice', 'speak', 'speech', 'listen', 'narration'] },
    { id: 'shortcuts',  label: 'Shortcuts',  icon: Keyboard,  keywords: ['keyboard', 'key', 'shortcut', 'hotkey', 'cmd', 'ctrl'] },
    { id: 'data',       label: 'Data',       icon: Database,  keywords: ['import', 'esword', 'biblegateway', 'migrate', 'history', 'workspace', 'saved', 'reset', 'clear', 'delete', 'wipe', 'factory', 'danger'] },
    { id: 'about',      label: 'About & Updates', icon: Info, keywords: ['about', 'version', 'license', 'update', 'beta', 'stable', 'auto-update'] },
    { id: 'viewer',     label: 'Viewer Window', icon: Cast,   keywords: ['viewer', 'presentation', 'broadcast', 'external', 'screen', 'font scale'] },
    { id: 'studyTrail', label: 'Study Trail', icon: GitBranch, keywords: ['study trail', 'trail', 'session', 'map', 'navigation history', 'jump', 'reason', 'why did you jump'] },
    { id: 'experimental', label: 'Experimental', icon: FlaskConical, keywords: ['experimental', 'beta', 'pdf', 'opt-in', 'feature flag', 'pull to change chapter', 'rubber band', 'overscroll', 'pull navigation'] },
  ]

  // Filter nav items by settings search query
  const filteredNav = settingsSearch.trim()
    ? NAV.filter((n) => {
        const q = settingsSearch.trim().toLowerCase()
        return (
          n.label.toLowerCase().includes(q) ||
          (n.keywords ?? []).some((k) => k.toLowerCase().includes(q))
        )
      })
    : NAV

  // The currently-active preset object — used by both the Theme summary card and the ambient-
  // animation section below (to detect when the active theme carries its own curated
  // `animationStyle`, which locks that section's toggle on).
  const activePreset = THEME_PRESETS.find((p) =>
    themePreset === p.id || themePreset === `${p.id}-dark` || themePreset === `${p.id}-light`
  ) ?? THEME_PRESETS[0]
  const curatedAnimationActive = !!activePreset.animationStyle

  const nav = (
    <>
      {/* Search bar */}
      <div className="px-1.5 py-1.5 border-b border-separator">
        <SearchField
          size="sm"
          value={settingsSearch}
          onValueChange={(v) => {
            setSettingsSearch(v)
            // Auto-navigate when exactly one section matches
            const q = v.trim().toLowerCase()
            if (q) {
              const matches = NAV.filter((n) =>
                n.label.toLowerCase().includes(q) ||
                (n.keywords ?? []).some((k) => k.toLowerCase().includes(q))
              )
              if (matches.length === 1) {
                changeSection(matches[0].id)
                useAppStore.getState().bumpSettingsNavToken()
              }
            }
          }}
          placeholder="Search…"
          wrapperClassName="w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-1.5 space-y-px w-36">
      {filteredNav.length === 0
        ? <p className="px-2 py-2 text-caption2 text-text-muted">No matches</p>
        : filteredNav.map((n) => (
        <ListRow
          key={n.id}
          dense
          leading={<n.icon size={13} className="flex-shrink-0" />}
          title={n.label}
          current={section === n.id}
          onClick={() => { changeSection(n.id); useAppStore.getState().bumpSettingsNavToken(); setSettingsSearch('') }}
        />
      ))}
      </div>
    </>
  )

  return (
    // modal={false} while ThemePicker is open: Radix's modal Dialog installs a scroll-lock
    // (react-remove-scroll) plus an aria-hidden/inert sweep (the `aria-hidden` package's
    // hideOthers, which uses a MutationObserver so it also catches nodes appended AFTER the
    // dialog opens) over every OTHER top-level document.body child — which is exactly what
    // ThemePicker is, since it has to portal straight to document.body itself (nesting inside
    // Dialog.Content would break its own position:fixed full-viewport coverage, as
    // Dialog.Content is translate()'d for centering). That combination is what made the
    // picker's own scroll wheel silently do nothing even after ThemePicker.tsx's onWheel
    // workaround — inert also blocks the wheel event from ever reaching that handler, not
    // just the browser's native scroll. Dropping `modal` for exactly this window disables both
    // mechanisms; ThemePicker is a full-screen backdrop-blurred overlay on top regardless, so
    // there's no visible difference in the modal behavior Settings loses in the meantime.
    <Sheet
      open={settingsOpen}
      onOpenChange={(open) => !open && closeSettings()}
      modal={!themePickerOpen}
      // While ThemePicker is open, every click inside it is technically "outside" the sheet
      // (it's a separate document.body portal, not a Radix Portal) — Radix's default
      // outside-interaction handling would otherwise read that as a request to close Settings
      // itself out from under the picker. Suppressed only for this window.
      onPointerDownOutside={(e) => { if (themePickerOpen) e.preventDefault() }}
      onInteractOutside={(e) => { if (themePickerOpen) e.preventDefault() }}
      size="xl"
      layout="split"
      sidebar={nav}
      title="Settings"
    >
            {/* Content */}
            <div
              ref={settingsContentRef}
              // Written straight through, no debounce/throttle — see the comment on
              // settingsContentRef above for why anything deferred risks never landing at all.
              onScroll={(e) => setSettingsSectionScrollTop(section, e.currentTarget.scrollTop)}
              // No `pt` here on purpose: a `padding-top` on a scroll container offsets any
              // `position: sticky; top: 0` child DOWN by that amount (leaving a band of
              // empty container above it as you scroll) — that was the "gap above the
              // sub-section bar". Top spacing is now owned by SectionAnchorChips itself
              // (the bar's own `pt`, or the spacer it renders when there's no bar).
              className="settings-content px-6 pb-6 space-y-6"
            >
              <SectionAnchorChips scrollRef={settingsContentRef} sectionKey={section} />
              {section === 'appearance' && (
                <>
                  {/* Color mode: Dark / Light / System — controls all themes including presets */}
                  <div data-anchor="Color mode">
                    <p className="text-subhead font-medium text-text-primary mb-1">Color mode</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Controls dark or light for all themes and preset palettes</p>
                    <SegmentedControl
                      size="md"
                      value={theme}
                      onChange={setTheme}
                      aria-label="Color mode"
                      options={[
                        { value: 'system', label: 'System', icon: Monitor },
                        { value: 'dark', label: 'Dark', icon: Moon },
                        { value: 'light', label: 'Light', icon: Sun },
                      ]}
                    />
                  </div>

                  {/* Preset themes — the full 37-theme picker is its own dedicated overlay
                      (ThemePicker.tsx), opened from the "Browse all themes" button below. This
                      section just shows what's currently active plus quick access, rather than
                      cramming every swatch into the Settings modal itself. `activePreset` is
                      reused below by the ambient-animation section too, to detect when the
                      active theme carries its own curated animation. */}
                  <div data-anchor="Theme">
                    <p className="text-subhead font-medium text-text-primary mb-1">Theme</p>
                    <p className="s-desc text-caption text-text-muted mb-3">
                      {theme === 'system' ? 'Previews show dark/light split — system picks automatically' : `Showing ${previewVariant} variants`}
                    </p>
                    {(() => {
                      const isSystemAccent = themePreset === 'system-accent'
                      const accent = isSystemAccent ? (systemAccentColor ?? THEME_PRESETS[0].dark.accent) : null
                      const swatchColors = theme === 'system' ? null : (previewVariant === 'dark' ? activePreset.dark : activePreset.light)
                      const bg = swatchColors?.bg ?? activePreset.dark.bg
                      const label = isSystemAccent ? 'System' : activePreset.label
                      return (
                        <ListRow
                          className="control-glass rounded-card"
                          buttonClassName="min-h-12 px-3"
                          onClick={() => setThemePickerOpen(true)}
                          leading={
                            <div className="w-14 h-10 rounded-md overflow-hidden relative flex-shrink-0 border border-border">
                              {theme === 'system' && !isSystemAccent ? (
                                <div className="absolute inset-0" style={{
                                  background: `linear-gradient(135deg, rgb(${activePreset.dark.bg}) 50%, rgb(${activePreset.light.bg}) 50%)`
                                }} />
                              ) : (
                                <div className="absolute inset-0" style={{ background: `rgb(${bg})` }} />
                              )}
                              <div className="absolute inset-y-0 left-0 w-2.5" style={{ background: `rgb(${accent ?? swatchColors?.accent ?? activePreset.dark.accent})` }} />
                            </div>
                          }
                          title={label}
                          subtitle="37 themes — click to browse & preview"
                          trailing={<Palette size={16} className="text-text-muted flex-shrink-0" />}
                          trailingAlways
                        />
                      )
                    })()}
                  </div>

                  {/* Glass appearance — Berean's version of macOS 27's system transparency slider.
                      Scales every translucent material's opacity (menus, popovers, side panel,
                      sheets) via --glass-alpha-mult; see docs/design-system.md → Materials. */}
                  <div data-anchor="Glass" className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-subhead font-medium text-text-primary">Glass appearance</p>
                      <p className="text-caption text-text-muted leading-snug">How much shows through menus, panels and sheets.</p>
                    </div>
                    <SegmentedControl
                      size="sm"
                      value={glassAppearance}
                      onChange={setGlassAppearance}
                      aria-label="Glass appearance"
                      options={[
                        { value: 'clear', label: 'Clear' },
                        { value: 'regular', label: 'Regular' },
                        { value: 'tinted', label: 'Tinted' },
                      ]}
                    />
                  </div>

                  {/* Ambient background animation — a handful of themes (see ThemePicker.tsx's
                      "Animated" filter) carry their own curated animation always; this is the
                      separate "any theme" switch. Style "Auto" defers to that theme's own
                      curated style where it has one (else Drift); picking a specific style here
                      also overrides a curated theme's own style, so an explicit choice always
                      wins. Intensity is 3 named presets, not a raw slider — every style is kept
                      non-distracting at every tier, they just differ in HOW non-distracting.
                      While the active theme is one with its own curated animation, the switch
                      shows ON and is locked — that theme is animating regardless of this
                      setting, so an interactive-but-ineffective toggle would be misleading (and
                      turning it "off" here can't actually stop that theme's own animation
                      anyway). It unlocks again the moment a different theme is selected, back to
                      whatever this was set to before — nothing here gets overwritten by the
                      lock, only visually overridden while it's in effect. */}
                  <div data-anchor="Background">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-subhead font-medium text-text-primary">Ambient background animation</p>
                      <Switch
                        checked={backgroundAnimationEnabled || curatedAnimationActive}
                        onCheckedChange={() => setBackgroundAnimationEnabled(!backgroundAnimationEnabled)}
                        disabled={curatedAnimationActive}
                      />
                    </div>
                    <p className="s-desc text-caption text-text-muted mb-3">
                      {curatedAnimationActive
                        ? `${activePreset.label} has its own animation, so this is on and locked — switch to a different theme to change it.`
                        : 'A few themes always have one; this lets any theme get a subtle motion effect using its own accent color.'}
                    </p>
                    {(backgroundAnimationEnabled || curatedAnimationActive) && (
                      <div className="space-y-3 pl-0.5">
                        <div>
                          <p className="text-caption text-text-secondary mb-1.5">Style</p>
                          {/* Locked to Auto while the active theme has its own curated style — that
                              style is its signature look and isn't swappable (App.tsx's effective-
                              style computation ignores this setting entirely in that case, so an
                              interactive-but-ineffective button here would be misleading). */}
                          <SegmentedControl
                            size="md"
                            value={curatedAnimationActive ? 'auto' : backgroundAnimationStyle}
                            onChange={setBackgroundAnimationStyle}
                            disabled={curatedAnimationActive}
                            aria-label="Animation style"
                            options={(['auto', 'drift', 'pulse', 'shimmer', 'particles', 'flicker'] as const).map((s) => ({ value: s, label: s.charAt(0).toUpperCase() + s.slice(1) }))}
                          />
                        </div>
                        <div>
                          <p className="text-caption text-text-secondary mb-1.5">Intensity</p>
                          <SegmentedControl
                            size="md"
                            fill
                            value={backgroundAnimationIntensity}
                            onChange={setBackgroundAnimationIntensity}
                            aria-label="Animation intensity"
                            options={(['subtle', 'noticeable', 'bold'] as const).map((i) => ({ value: i, label: i.charAt(0).toUpperCase() + i.slice(1) }))}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Font family per section */}
                  <div data-anchor="Fonts">
                    <p className="text-subhead font-medium text-text-primary mb-1">Section fonts</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Choose typefaces independently for each area</p>
                    <div className="space-y-3">
                      {([
                        ['UI chrome', uiFontFamily, setUiFontFamily],
                        ['Scripture', scriptureFontFamily, setScriptureFontFamily],
                        ['Notes', notesFontFamily, setNotesFontFamily],
                      ] as [string, string, (v: string) => void][]).map(([label, value, setter]) => (
                        <div key={label} className="flex items-center gap-3">
                          <span className="s-desc text-caption text-text-muted w-20 flex-shrink-0">{label}</span>
                          <Select
                            value={value}
                            onChange={setter}
                            className="flex-1"
                            options={FONT_FAMILY_OPTIONS}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {section === 'reading' && (
                <>
                  <div data-anchor="Translation">
                    <p className="text-subhead font-medium text-text-primary mb-1">Default translation</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Used when opening a new Bible tab</p>
                    <Select
                      size="md"
                      value={defaultBibleTranslation}
                      onChange={saveTranslation}
                      className="w-full"
                      options={DEFAULT_TRANSLATIONS.map((t) => ({ value: t.id, label: t.label }))}
                    />
                  </div>

                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Shepherd of Hermas translation</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Which translation to show for the Visions, Mandates, and Similitudes. Taylor uses finer verse divisions and includes Similitude 7; it is a best-effort OCR ingest still being proofread.</p>
                    <Select
                      size="md"
                      value={hermasTranslation}
                      onChange={setHermasTranslation}
                      className="w-full"
                      options={[
                        { value: 'hermas', label: 'Roberts-Donaldson (Ante-Nicene Fathers)' },
                        { value: 'hermas_taylor', label: 'Charles Taylor (1903)' },
                      ]}
                    />
                  </div>

                  <div data-anchor="Layout">
                    <p className="text-subhead font-medium text-text-primary mb-1">Default scripture layout</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Starting layout for new scripture tabs — can be overridden per-tab using the layout button in the tab toolbar</p>
                    <Select
                      size="md"
                      value={defaultScriptureLayout}
                      onChange={(v) => setDefaultScriptureLayout(v as ScriptureLayout)}
                      className="w-full"
                      options={LAYOUT_DEFS.map((def) => ({ value: def.id, label: `${def.label} — ${def.description}` }))}
                    />
                  </div>

                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Open note alongside scripture</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Where the note appears when using the "Open alongside scripture" button in the notes toolbar</p>
                    <SegmentedControl
                      size="md"
                      value={noteTransformLayout}
                      onChange={setNoteTransformLayout}
                      aria-label="Open note alongside scripture"
                      options={[
                        { value: 'right', label: 'Right panel' },
                        { value: 'left', label: 'Left panel' },
                        { value: 'bottom', label: 'Bottom' },
                      ]}
                    />
                  </div>

                  <div data-anchor="Text & size">
                    <p className="text-subhead font-medium text-text-primary mb-1">Line height</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Spacing between verse lines</p>
                    <SegmentedControl
                      size="md"
                      value={bibleLineHeight}
                      onChange={setBibleLineHeight}
                      aria-label="Line height"
                      options={(['compact', 'comfortable', 'spacious'] as const).map((h) => ({ value: h, label: h.charAt(0).toUpperCase() + h.slice(1) }))}
                    />
                  </div>

                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Floating search density</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Controls how many results are visible before scrolling — compact shows fewer lines, spacious shows more context</p>
                    <SegmentedControl
                      size="md"
                      value={floatingSearchDensity}
                      onChange={setFloatingSearchDensity}
                      aria-label="Floating search density"
                      options={(['compact', 'comfortable', 'spacious'] as const).map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) }))}
                    />
                  </div>

                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Bible text size</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Font size for verse text (px)</p>
                    <Slider
                      min={12}
                      max={22}
                      step={1}
                      value={bibleFontSize}
                      onValueChange={saveFontSize}
                      readout={`${bibleFontSize}`}
                      aria-label="Bible text size"
                    />
                  </div>

                  {/* Auto-close tabs */}
                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Auto-close inactive tabs</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Automatically close tabs that haven't been visited for the selected period</p>
                    <SegmentedControl
                      value={String(autoCloseTabsAfter)}
                      onChange={(v) => setAutoCloseTabsAfter(Number(v))}
                      aria-label="Auto-close inactive tabs"
                      options={([
                        [0, 'Never'],
                        [60 * 60 * 1000, '1 hour'],
                        [6 * 60 * 60 * 1000, '6 hours'],
                        [24 * 60 * 60 * 1000, '1 day'],
                        [3 * 24 * 60 * 60 * 1000, '3 days'],
                        [7 * 24 * 60 * 60 * 1000, '1 week'],
                        [30 * 24 * 60 * 60 * 1000, '1 month'],
                      ] as const).map(([ms, label]) => ({ value: String(ms), label }))}
                    />
                  </div>

                  {/* ── Show verse numbers ── */}
                  <div data-anchor="Verse display" className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Show verse numbers</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Display verse numbers in the reading panel</p>
                    </div>
                    <Switch checked={showVerseNumbers} onCheckedChange={() => setShowVerseNumbers(!showVerseNumbers)} />
                  </div>

                  {/* ── Red letters ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Red letter text</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Highlight words of Yeshua in the KJVA text (requires tagged source)</p>
                    </div>
                    <Switch checked={showRedLetters} onCheckedChange={() => setShowRedLetters(!showRedLetters)} />
                  </div>

                  {/* ── Continuous chapter scroll ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Continuous chapter scroll</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Load the next and previous chapters automatically as you scroll, with chapter heading dividers</p>
                    </div>
                    <Switch checked={continuousChapterScroll} onCheckedChange={() => setContinuousChapterScroll(!continuousChapterScroll)} />
                  </div>

                  {/* ── Word replacer (divine-name restoration etc.) — affects how
                       scripture text displays, so it lives here rather than Notes ── */}
                  <div data-anchor="Word replacer" className="pt-2 border-t border-separator">
                    <SectionLabel className="mb-3">Word replacer</SectionLabel>
                    <WordReplacerSection
                      enabled={wordReplacerEnabled}
                      rules={wordReplacerRules}
                      onToggleEnabled={setWordReplacerEnabled}
                      onToggleRule={toggleWordReplacerRule}
                    />
                  </div>
                </>
              )}

              {section === 'notes' && (
                <div className="space-y-5">
                  <p className="s-desc text-caption text-text-muted -mt-2">
                    Control how Berean auto-detects references while you write notes.
                  </p>

                  {/* Verse tags */}
                  <div data-anchor="Verse tags" className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Verse tags</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        Group verses or whole chapters under named tags. Reference a tag in a note with <code>#name</code>; filter the Advanced Scripture Search by tag.
                      </p>
                    </div>
                    <Button
                      variant="secondary"
                      icon={Tag}
                      onClick={() => { useAppStore.getState().openTagsGraph(); useAppStore.getState().closeSettings() }}
                      className="flex-shrink-0"
                    >
                      Manage tags
                    </Button>
                  </div>

                  {/* Verse refs toggle */}
                  <div data-anchor="Reference detection" className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Auto-detect verse references</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        Highlight and make clickable any Bible reference typed in a note (e.g. Genesis 1:1). Clicking navigates the Scripture panel.
                      </p>
                    </div>
                    <Switch checked={noteVerseRefsEnabled} onCheckedChange={() => setNoteVerseRefsEnabled(!noteVerseRefsEnabled)} />
                  </div>

                  {/* Lexicon refs toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Auto-detect lexicon references</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        Highlight and make clickable any Strong's number typed in a note (e.g. H7225 or G3056). Clicking opens the lexicon entry.
                      </p>
                    </div>
                    <Switch checked={noteLexiconRefsEnabled} onCheckedChange={() => setNoteLexiconRefsEnabled(!noteLexiconRefsEnabled)} />
                  </div>

                  {/* Auto em dash toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Auto em dash</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        Typing two hyphens (--) converts them into an em dash (—) automatically.
                      </p>
                    </div>
                    <Switch checked={autoEmDash} onCheckedChange={() => setAutoEmDash(!autoEmDash)} />
                  </div>

                  {/* Scripture block auto-format toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Auto-format verse blocks</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        When a verse reference is followed by its text, it is displayed as a styled scripture block (left border, bold reference) — but the text stays plain, so copying it gives back the original text only. Works for multi-line blocks (reference line + numbered verses) and single-line verses (e.g. <span className="font-mono text-caption2">1 John 2:4 He that saith…</span>). A bare reference alone is not affected.
                      </p>
                    </div>
                    <Switch checked={noteScriptureBlock} onCheckedChange={() => setNoteScriptureBlock(!noteScriptureBlock)} />
                  </div>

                  {/* Default status for new notes */}
                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Default status for new notes</p>
                    <p className="s-desc text-caption text-text-muted mb-3">
                      Most notes aren't expected to need a status — leave this as "No status" unless you want every new note pre-tagged.
                    </p>
                    <Select
                      size="md"
                      value={defaultNoteStatus}
                      onChange={saveDefaultNoteStatus}
                      className="w-full"
                      options={[
                        { value: 'none', label: 'No status' },
                        ...NOTE_STATUSES.map((s) => ({ value: s.id, label: s.label })),
                      ]}
                    />
                  </div>

                  {/* Strong's block suggestion — was previously tucked inside the collapsed
                      "Advanced" details block below, where it was easy to miss entirely
                      (reported: "I don't see the setting to turn off the suggestions for
                      verse and strongs things in notes"). This is the actual toggle for
                      that popup, just labeled around what it offers (expanding into a
                      block) rather than "suggestion popup" — promoted up to sit with the
                      other everyday, always-visible toggles instead. */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Strong's block suggestion</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Show a popup when you type a Strong's number (H1234 / G5678) offering to expand it into a full lexicon block.</p>
                    </div>
                    <Switch checked={noteStrongsBlockSuggest} onCheckedChange={() => setNoteStrongsBlockSuggest(!noteStrongsBlockSuggest)} />
                  </div>

                  {/* Verse block suggestion — same promotion, same reason */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Verse block suggestion</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Show a popup when you type a verse reference (e.g. Gen 1:1) offering to expand it into a scripture block.</p>
                    </div>
                    <Switch checked={noteVerseBlockSuggest} onCheckedChange={() => setNoteVerseBlockSuggest(!noteVerseBlockSuggest)} />
                  </div>

                  <Divider />
                  <div>
                    <SectionLabel className="mb-1.5">Suppressing a suggestion</SectionLabel>
                    <p className="text-footnote text-text-secondary leading-relaxed">
                      To suppress auto-detection for a specific piece of text, select it in the editor and press <ShortcutKeys keys="⌘⇧R" className="align-middle" /> or click the <span className="font-mono">↗︎̵</span> button in the selection toolbar. Suppression is per-session — retyping the text removes it.
                    </p>
                  </div>

                  {/* ── Advanced: fine-tuning knobs for the block-suggestion system,
                       tucked away rather than sitting flat alongside everyday toggles ── */}
                  <div>
                    <DisclosureRow open={blockAdvancedOpen} title="Advanced" onClick={() => setBlockAdvancedOpen((v) => !v)} />
                    {blockAdvancedOpen && (
                    <div className="mt-3 space-y-4 pl-4 border-l border-separator">
                      {/* Side-panel note editor: verse/Strong's block SUGGESTION popups (independent) */}
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-subhead font-medium text-text-primary">Suggest verse &amp; Strong's blocks in side panel</p>
                          <p className="s-desc text-caption text-text-muted mt-0.5">
                            In the scripture tab's side-panel note editor, show the popups that offer to turn a typed reference (e.g. Gen 1:1) or Strong's number into a block. Blocks already in the note still format either way.
                          </p>
                        </div>
                        <Switch checked={sidePanelScriptureBlock} onCheckedChange={() => setSidePanelScriptureBlock(!sidePanelScriptureBlock)} />
                      </div>

                      {/* Verse-text match threshold slider — only when auto-format is on */}
                      {noteScriptureBlock && (
                        <div className="pl-1">
                          <p className="text-caption font-medium text-text-secondary mb-1">Verse-text match sensitivity</p>
                          <Slider
                            min={50}
                            max={100}
                            step={5}
                            value={Math.round(noteScriptureBlockThreshold * 100)}
                            onValueChange={(v) => setNoteScriptureBlockThreshold(v / 100)}
                            readout={`${Math.round(noteScriptureBlockThreshold * 100)}%`}
                            aria-label="Verse-text match sensitivity"
                          />
                          <p className="text-caption text-text-muted mt-1 leading-relaxed">
                            A line only formats when at least this percent of the actual verse text is present. Higher = stricter. This prevents formatting a line where you're just commenting on a verse (e.g. <span className="font-mono text-caption2">Genesis 5:4 my thoughts here</span>).
                          </p>
                        </div>
                      )}
                    </div>
                    )}
                  </div>

                  {/* Markdown reference guide */}
                  <div data-anchor="Editor">
                    <p className="text-subhead font-medium text-text-primary mb-1">Markdown reference</p>
                    <p className="s-desc text-caption text-text-muted mb-2">
                      A full guide to note formatting, verse references, wikilinks, and all supported book names.
                    </p>
                    <MarkdownRefButton onClose={closeSettings} />
                  </div>

                  {/* ── Bullet list style ── */}
                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Bullet list style</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Symbol used at each indent level in unordered lists</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {Object.entries(BULLET_STYLE_DEFS).map(([id, def]) => (
                        <OptionCard
                          key={id}
                          selected={noteBulletStyle === id}
                          onClick={() => setNoteBulletStyle(id)}
                          title={def.label}
                          description={
                            <span className="flex items-center gap-3 font-mono text-caption text-text-secondary">
                              {def.symbols.slice(0, 3).map((sym, i) => (
                                <span key={i} className="flex items-center gap-1">
                                  <span className="text-text-muted text-micro" style={{ marginLeft: `${i * 10}px` }}>{sym}</span>
                                  <span className="text-text-quaternary text-micro">item</span>
                                </span>
                              ))}
                            </span>
                          }
                        />
                      ))}
                    </div>
                  </div>

                  {/* ── Heading divider lines ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Heading divider lines</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Show a subtle separator line below each heading. Also affects how sections collapse — the divider marks where each section ends.</p>
                    </div>
                    <Switch checked={noteHeadingDivider} onCheckedChange={() => setNoteHeadingDivider(!noteHeadingDivider)} />
                  </div>

                  {/* ── Spell check in notes ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Spell check</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Underline misspelled words in the notes editor</p>
                    </div>
                    <Switch checked={noteSpellCheck} onCheckedChange={() => setNoteSpellCheck(!noteSpellCheck)} />
                  </div>

                  {/* ── Auto-copy on highlight ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Copy verse on highlight</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Automatically copy the verse text to clipboard when a highlight color is applied</p>
                    </div>
                    <Switch checked={autoCopyOnHighlight} onCheckedChange={() => setAutoCopyOnHighlight(!autoCopyOnHighlight)} />
                  </div>

                  {/* ── Default editor mode ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-subhead font-medium text-text-primary">Default editor mode</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Starting view when opening a note — Edit is editable, View is read-only</p>
                    </div>
                    <SegmentedControl
                      value={defaultNoteEditorMode}
                      onChange={setDefaultNoteEditorMode}
                      aria-label="Default editor mode"
                      className="flex-shrink-0"
                      options={[
                        { value: 'edit', label: 'Edit' },
                        { value: 'view', label: 'View' },
                      ]}
                    />
                  </div>

                  {/* ── Confirm before deleting notes ── */}
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Confirm before deleting notes</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">Show a prompt when deleting a note that has content</p>
                    </div>
                    <Switch checked={confirmNoteDelete} onCheckedChange={() => setConfirmNoteDelete(!confirmNoteDelete)} />
                  </div>

                  {/* ── Normalize note formatting (post-ProseMirror-migration) ── */}
                  <div className="pt-2 border-t border-separator">
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-subhead font-medium text-text-primary">Normalize note formatting</p>
                        <p className="s-desc text-caption text-text-muted mt-0.5">
                          Notes written under the old editor may render slightly differently now (line breaks, table spacing, list style).
                          This re-saves every note through the new editor once so they all look consistent — the original content of any
                          changed note is kept in Version History first.
                        </p>
                      </div>
                      {migrationState.phase === 'idle' && (
                        <Button variant="secondary" onClick={() => setMigrationState({ phase: 'confirming' })} className="flex-shrink-0">
                          Normalize all notes
                        </Button>
                      )}
                    </div>

                    {migrationState.phase === 'confirming' && (
                      <div className="mt-2 flex items-center justify-end gap-2">
                        <span className="text-caption text-text-muted">Re-save every note now? (originals are kept in Version History)</span>
                        <Button variant="ghost" onClick={() => setMigrationState({ phase: 'idle' })}>Cancel</Button>
                        <Button
                          variant="primary"
                          onClick={async () => {
                            setMigrationState({ phase: 'running', done: 0, total: 0 })
                            const result = await migrateAllNotes((p) => setMigrationState({ phase: 'running', done: p.done, total: p.total }))
                            setMigrationState({ phase: 'done', result })
                          }}
                        >
                          Normalize now
                        </Button>
                      </div>
                    )}

                    {migrationState.phase === 'running' && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-control bg-lift-2 overflow-hidden">
                          <div
                            className="h-full bg-accent transition-[width]"
                            style={{ width: migrationState.total > 0 ? `${(migrationState.done / migrationState.total) * 100}%` : '2%' }}
                          />
                        </div>
                        <p className="text-caption2 text-text-muted mt-1">
                          {migrationState.total > 0 ? `${migrationState.done} / ${migrationState.total} notes checked…` : 'Starting…'}
                        </p>
                      </div>
                    )}

                    {migrationState.phase === 'done' && (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-caption text-text-secondary">
                          {migrationState.result.changed} note{migrationState.result.changed === 1 ? '' : 's'} updated,{' '}
                          {migrationState.result.unchanged} already fine
                          {migrationState.result.failed > 0 ? `, ${migrationState.result.failed} failed (unchanged, safe to retry)` : ''}.
                        </p>
                        <Button variant="ghost" onClick={() => setMigrationState({ phase: 'idle' })} className="flex-shrink-0">Dismiss</Button>
                      </div>
                    )}
                  </div>

                  {/* ── Daily notes ── */}
                  <div data-anchor="Daily notes" className="pt-2 border-t border-separator">
                    <SectionLabel className="mb-3">Daily notes</SectionLabel>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-subhead font-medium text-text-primary">Continuous daily notes scroll</p>
                        <p className="s-desc text-caption text-text-muted mt-0.5">In the Daily filter view, scroll through consecutive days as a journal with date dividers — click any day to open it for editing</p>
                      </div>
                      <Switch checked={continuousDailyScroll} onCheckedChange={() => setContinuousDailyScroll(!continuousDailyScroll)} />
                    </div>
                  </div>

                  {/* ── Print & export defaults — co-located since it's the same
                       "notes output" concern; per-note overrides still live in the
                       print-preview modal itself. ── */}
                  <div data-anchor="Print & export" className="pt-2 border-t border-separator">
                    <SectionLabel className="mb-3">Print &amp; export defaults</SectionLabel>
                    <PrintExportSection />
                  </div>

                  {/* ── Idiom notes ── */}
                  <div data-anchor="Idiom notes" className="pt-2 border-t border-separator">
                    <SectionLabel className="mb-3">Idiom notes</SectionLabel>

                    <div className="flex items-center justify-between gap-4 mb-3">
                      <div>
                        <p className="text-subhead font-medium text-text-primary">Highlight idiom words in verse text</p>
                        <p className="s-desc text-caption text-text-muted mt-0.5">Underline words in verse text that match a term in your idiom notes</p>
                      </div>
                      <Switch checked={idiomHighlightEnabled} onCheckedChange={() => setIdiomHighlightEnabled(!idiomHighlightEnabled)} />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-subhead font-medium text-text-primary">Show hover tooltip for idiom words</p>
                        <p className="s-desc text-caption text-text-muted mt-0.5">Display the term and its meaning when hovering an underlined idiom word</p>
                      </div>
                      <Switch checked={idiomHoverPreviewEnabled} onCheckedChange={() => setIdiomHoverPreviewEnabled(!idiomHoverPreviewEnabled)} />
                    </div>
                  </div>

                  {/* ── Panel gestures ── */}
                  <div data-anchor="Panel gestures" className="pt-2 border-t border-separator">
                    <SectionLabel className="mb-3">Panel gestures</SectionLabel>

                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-subhead font-medium text-text-primary">Two-finger swipe to open/close side panel</p>
                        <p className="s-desc text-caption text-text-muted mt-0.5">Swipe left/right with two fingers on the trackpad, anywhere over the Scripture reading area, to open or close the right side panel</p>
                      </div>
                      <Switch checked={swipePanelGestureEnabled} onCheckedChange={() => setSwipePanelGestureEnabled(!swipePanelGestureEnabled)} />
                    </div>
                  </div>

                </div>
              )}

              {section === 'vault' && (
                <>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Markdown vault sync</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        Write notes to a local Markdown folder and keep them in sync automatically — your edits save immediately, and changes made externally (Obsidian, Octarine, Logseq, iA Writer, or any Markdown app) are picked up live.
                      </p>
                    </div>
                    <Switch checked={vaultSync} onCheckedChange={() => toggleVaultSync(!vaultSync)} />
                  </div>

                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Vault folder</p>
                    <p className="s-desc text-caption text-text-muted mb-2">
                      Choose the root folder where Berean will read and write <span className="font-mono">.md</span> files
                    </p>
                    <div className="flex gap-2 items-center">
                      <TextField
                        type="text"
                        value={vaultPath}
                        onChange={(e) => setVaultPath(e.target.value)}
                        onBlur={(e) => saveVaultPath(e.target.value)}
                        placeholder="/path/to/your/notes-folder"
                        wrapperClassName="flex-1"
                      />
                      <IconButton
                        icon={FolderOpen}
                        label="Browse for vault folder"
                        onClick={async () => {
                          const picked = await window.app.openFolderDialog()
                          if (picked) { setVaultPath(picked); saveVaultPath(picked) }
                        }}
                        className="flex-shrink-0"
                      />
                    </div>
                    {vaultPath && (
                      <p className="text-caption2 text-text-muted mt-1.5">
                        Notes saved under <span className="font-mono">{vaultPath}/berean-notes/</span>
                      </p>
                    )}
                  </div>

                  {/* Status + one combined manual sync action — replaces the old separate
                      export/import/reconcile buttons for routine use. */}
                  {vaultSync && vaultPath && <VaultSyncStatus />}

                  {/* Advanced: raw export/import, for first-time migration or troubleshooting.
                      Collapsed by default — not part of the routine sync flow. */}
                  {vaultPath && (
                    <div>
                      <DisclosureRow open={importAdvancedOpen} title="Advanced" onClick={() => setImportAdvancedOpen((v) => !v)} />
                      {importAdvancedOpen && (
                      <div className="mt-3 space-y-3 pl-4 border-l border-separator">
                        <div className="flex gap-2 flex-wrap items-start">
                          <div>
                            <p data-anchor="Export" className="text-subhead font-medium text-text-primary mb-1">Export now</p>
                            <div className="flex items-center gap-3 flex-wrap">
                              <Button
                                variant="secondary"
                                selected
                                loading={exportingAll}
                                onClick={async () => {
                                  setExportingAll(true)
                                  setExportResult(null)
                                  try {
                                    const res = await window.vault.exportAll()
                                    if (res.success) {
                                      setExportResult({ notes: res.notes, highlights: res.highlights, history: res.history, pdfs: res.pdfs })
                                      setTimeout(() => setExportResult(null), 8000)
                                    }
                                  } finally {
                                    setExportingAll(false)
                                  }
                                }}
                                disabled={exportingAll}
                              >
                                {exportingAll ? 'Exporting…' : 'Export all data now'}
                              </Button>
                              {exportResult && (
                                <p className="text-caption2 text-success">
                                  ✓ {exportResult.notes} notes · {exportResult.highlights} highlights · {exportResult.history} history entries · {exportResult.pdfs} PDFs
                                </p>
                              )}
                            </div>
                          </div>
                          <div>
                            <p data-anchor="Import" className="text-subhead font-medium text-text-primary mb-1">Import from vault</p>
                            <div className="flex items-center gap-3 flex-wrap">
                              <Button
                                variant="secondary"
                                loading={importingAll}
                                onClick={async () => {
                                  setImportingAll(true)
                                  setImportResult(null)
                                  try {
                                    const res = await window.vault.importAll()
                                    setImportResult(res)
                                    if (res.tabState) {
                                      try { localStorage.setItem('berean-app-state', res.tabState) } catch { /* ignore */ }
                                    }
                                    setTimeout(() => setImportResult(null), 10000)
                                  } finally {
                                    setImportingAll(false)
                                  }
                                }}
                                disabled={importingAll}
                              >
                                {importingAll ? 'Importing…' : 'Restore from vault'}
                              </Button>
                              {importResult && (
                                <p className={`text-caption2 ${importResult.success ? 'text-success' : 'text-destructive'}`}>
                                  {importResult.success
                                    ? `✓ ${importResult.notes} notes · ${importResult.highlights} highlights · ${importResult.noteFolders} folders · ${importResult.pdfs} PDFs`
                                    : `Failed: ${importResult.reason}`}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                        {importingAll && (
                          <p className="text-caption2 text-text-muted">Importing from vault — vault data takes precedent over local data…</p>
                        )}
                      </div>
                      )}
                    </div>
                  )}

                  <Divider />
                  <div>
                    <SectionLabel className="mb-1.5">How vault sync works</SectionLabel>
                    <p className="text-footnote text-text-secondary leading-relaxed">
                      All data is always stored in Berean's internal database. The vault folder is a backup destination — Berean writes files there as you edit, watches for external changes, and periodically re-exports everything as a safety net. Vault data is never deleted when the app is uninstalled — to restore after a reinstall or on a new machine, just point to the same vault folder; it imports automatically when data is found.
                    </p>
                  </div>
                </>
              )}

              {section === 'youtube' && (
                <>
                  {/* Default YouTube layout */}
                  <div data-anchor="Layout">
                    <p className="text-subhead font-medium text-text-primary mb-1">Default layout</p>
                    <p className="s-desc text-caption text-text-muted mb-3">Starting layout when a YouTube tab opens a video</p>
                    <YtLayoutSetting />
                  </div>

                  {/* Auto PiP */}
                  <div data-anchor="Picture-in-Picture" className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Auto Picture-in-Picture</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        Float the video in PiP automatically when switching away from the YouTube space
                      </p>
                    </div>
                    <Switch checked={autoPiP} onCheckedChange={() => setAutoPiP(!autoPiP)} />
                  </div>

                  {/* Watch History */}
                  <div data-anchor="Watch history">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-subhead font-medium text-text-primary">Watch history</p>
                      {watchHistory.length > 0 && (
                        <Button variant="ghost" size="sm" onClick={handleClearHistory} className="text-text-muted hover:text-destructive">
                          Clear all
                        </Button>
                      )}
                    </div>
                    <p className="s-desc text-caption text-text-muted mb-3">
                      Videos you've watched and where you left off.
                    </p>
                    {watchHistory.length === 0 ? (
                      <p className="s-desc text-caption text-text-muted italic">No watch history yet.</p>
                    ) : (() => {
                      // Group by month then day
                      const byMonth: Record<string, Record<string, typeof watchHistory>> = {}
                      for (const entry of watchHistory) {
                        const d = new Date(entry.lastWatched)
                        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                        const dayKey = `${monthKey}-${String(d.getDate()).padStart(2, '0')}`
                        if (!byMonth[monthKey]) byMonth[monthKey] = {}
                        if (!byMonth[monthKey][dayKey]) byMonth[monthKey][dayKey] = []
                        byMonth[monthKey][dayKey].push(entry)
                      }
                      const monthKeys = Object.keys(byMonth).sort().reverse()
                      return (
                        <div className="space-y-1">
                          {monthKeys.map((monthKey) => {
                            const [y, m] = monthKey.split('-')
                            const monthLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleString('default', { month: 'long', year: 'numeric' })
                            const monthCollapsed = collapsedMonths.has(monthKey)
                            const toggleMonth = () => setCollapsedMonths((prev) => {
                              const next = new Set(prev)
                              next.has(monthKey) ? next.delete(monthKey) : next.add(monthKey)
                              return next
                            })
                            const dayKeys = Object.keys(byMonth[monthKey]).sort().reverse()
                            return (
                              <div key={monthKey}>
                                <DisclosureRow open={!monthCollapsed} title={monthLabel} onClick={toggleMonth} />
                                {!monthCollapsed && (
                                  <div className="space-y-1 mt-0.5 ml-1">
                                    {dayKeys.map((dayKey) => {
                                      const [dy, dm, dd] = dayKey.split('-')
                                      const dayLabel = new Date(Number(dy), Number(dm) - 1, Number(dd)).toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })
                                      const dayCollapsed = collapsedDays.has(dayKey)
                                      const toggleDay = () => setCollapsedDays((prev) => {
                                        const next = new Set(prev)
                                        next.has(dayKey) ? next.delete(dayKey) : next.add(dayKey)
                                        return next
                                      })
                                      return (
                                        <div key={dayKey}>
                                          <DisclosureRow open={!dayCollapsed} title={dayLabel} onClick={toggleDay} indent={12} />
                                          {!dayCollapsed && (
                                            <div className="space-y-1 mt-0.5 ml-1">
                                              {byMonth[monthKey][dayKey].map((entry) => {
                                                const mins = Math.floor(entry.positionSeconds / 60)
                                                const secs = Math.floor(entry.positionSeconds % 60)
                                                const pos = `${mins}:${String(secs).padStart(2, '0')}`
                                                return (
                                                  <ListRow
                                                    key={entry.videoId}
                                                    className="control-glass rounded-card"
                                                    onClick={() => handleJumpToVideo(entry.videoId)}
                                                    leading={entry.thumbnailUrl && (
                                                      <img
                                                        src={entry.thumbnailUrl}
                                                        alt=""
                                                        className="w-14 h-9 object-cover rounded flex-shrink-0 bg-surface-4"
                                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                                                      />
                                                    )}
                                                    title={entry.title || entry.videoId}
                                                    titleClassName="line-clamp-1"
                                                    subtitle={`${entry.channelName} · Watched to ${pos}`}
                                                    trailing={
                                                      <>
                                                        <IconButton icon={ExternalLink} label="Jump to video" size={20} onClick={(e) => { e.stopPropagation(); handleJumpToVideo(entry.videoId) }} />
                                                        <IconButton icon={Trash2} label="Remove from history" size={20} danger onClick={(e) => { e.stopPropagation(); handleRemoveFromHistory(entry.videoId) }} />
                                                      </>
                                                    }
                                                  />
                                                )
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      )
                                    })}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>

                  {/* YouTube Account / Sign In */}
                  <div>
                    <p data-anchor="Account" className="text-subhead font-medium text-text-primary mb-1">YouTube account</p>
                    <p className="s-desc text-caption text-text-muted mb-3">
                      Sign in to YouTube to sync your subscriptions, history, and watch-later list across sessions.
                      Your login is stored in the app's persistent YouTube session and shared with the YouTube tab.
                    </p>
                    {showYTSignIn ? (
                      <>
                        <div className="rounded-card overflow-hidden border border-border mb-2 h-[380px]">
                          <webview
                            src="https://accounts.google.com/ServiceLogin?service=youtube"
                            partition="persist:youtube"
                            style={{ width: '100%', height: '100%', display: 'flex' }}
                          />
                        </div>
                        <Button variant="ghost" size="sm" onClick={() => setShowYTSignIn(false)}>Close</Button>
                      </>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => { setShowYTSignIn(true); setYtSignedOut(false) }}>
                          Sign into YouTube
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={async () => {
                            await window.app.youTubeSignOut?.()
                            setShowYTSignIn(false)
                            setYtSignedOut(true)
                          }}
                        >
                          Sign out
                        </Button>
                        {ytSignedOut && (
                          <span className="s-desc text-caption text-text-muted">Session cleared.</span>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}

              {section === 'audio' && <AudioSection />}

              {section === 'shortcuts' && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Keyboard size={14} className="text-text-muted" />
                    <p className="text-subhead font-medium text-text-primary">Keyboard shortcuts</p>
                  </div>
                  <div className="space-y-4">
                    {SHORTCUT_GROUPS.map((group) => (
                      <div key={group.label}>
                        <SectionLabel className="mb-1.5">{group.label}</SectionLabel>
                        <div className="space-y-0.5">
                          {group.shortcuts.map((s) => (
                            <div key={s.key} className="flex items-center justify-between py-1.5 border-b border-separator">
                              <span className="text-footnote text-text-secondary">{s.action}</span>
                              <ShortcutKeys keys={s.key} />
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {section === 'viewer' && (
                <div className="flex flex-col gap-6">
                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Viewer window</p>
                    <p className="s-desc text-caption text-text-muted mb-0">
                      Open a second window to display Bible text on an external monitor or projector. Toggle with <ShortcutKeys keys="⌘⇧B" className="align-middle" />.
                    </p>
                  </div>

                  <div className="flex flex-col gap-4">
                    <SectionLabel>Font scale</SectionLabel>
                    <SegmentedControl
                      size="md"
                      value={String(viewerFontScale)}
                      onChange={(v) => setViewerFontScale(Number(v))}
                      aria-label="Font scale"
                      options={[1.0, 1.25, 1.5, 1.75, 2.0].map((scale) => ({ value: String(scale), label: `${Math.round(scale * 100)}%` }))}
                    />
                  </div>

                  <div className="flex flex-col gap-4">
                    <SectionLabel>Theme override</SectionLabel>
                    <SegmentedControl
                      size="md"
                      value={viewerTheme}
                      onChange={setViewerTheme}
                      aria-label="Theme override"
                      options={(['system', 'light', 'dark'] as const).map((t) => ({ value: t, label: t === 'system' ? 'Follow app' : t.charAt(0).toUpperCase() + t.slice(1) }))}
                    />
                  </div>
                </div>
              )}

              {section === 'studyTrail' && (
                <div className="flex flex-col gap-6">
                  <div>
                    <p className="text-subhead font-medium text-text-primary mb-1">Study Trail</p>
                    <p className="s-desc text-caption text-text-muted mb-0">
                      A separate window that passively maps your navigation between chapters, cross-references,
                      and word studies — sessions, the map/review views, and pause/rename/delete all live in that
                      window itself, opened from the sidebar rail.
                    </p>
                    <Button variant="secondary" icon={ExternalLink} onClick={() => window.app.openStudyTrailWindow?.()} className="mt-3">
                      Open Study Trail window
                    </Button>
                  </div>

                  <div className="flex items-center justify-between gap-4 pt-2 border-t border-separator">
                    <div>
                      <p className="text-subhead font-medium text-text-primary">Ask why you jumped chapters</p>
                      <p className="s-desc text-caption text-text-muted mt-0.5">
                        When you jump to a chapter Study Trail isn't already confident about the reason for
                        (a search result, a manual book/chapter pick, a tab switch — not a cross-reference or
                        word lookup, which already have a known reason), a small dismissible prompt appears
                        right here in the main window asking why, with optional verse-tying on both ends.
                        Off by default. Also toggleable from the Study Trail window's own title bar.
                      </p>
                    </div>
                    <Switch checked={studyTrailAskChapterJumpReason} onCheckedChange={() => setStudyTrailAskChapterJumpReason(!studyTrailAskChapterJumpReason)} />
                  </div>
                </div>
              )}

              {/* "Manage your data" hub — merges what were 4 separate nav items
                  (Import, History, Workspaces, Danger) into one page. Danger-zone
                  actions stay visually distinct at the bottom rather than living
                  at equal footing with routine settings in their own nav entry. */}
              {section === 'data' && (
                <div className="space-y-6">
                  <div>
                    <SectionLabel className="mb-3">Import</SectionLabel>
                    <ImportSection />
                  </div>
                  <div className="pt-4 border-t border-separator">
                    <SectionLabel className="mb-3">Navigation &amp; app history</SectionLabel>
                    <HistorySection />
                  </div>
                  <div className="pt-4 border-t border-separator">
                    <SectionLabel className="mb-3">Workspaces</SectionLabel>
                    <WorkspacesSection />
                  </div>
                  <div className="pt-4 border-t border-separator">
                    <SessionsSection />
                  </div>
                  <div className="pt-4 border-t border-separator">
                    <DangerSection />
                  </div>
                </div>
              )}

              {/* Merges the two small About/Updates nav items into one page. */}
              {section === 'about' && (
                <div className="space-y-6">
                  <AboutSection />
                  <div className="pt-4 border-t border-separator">
                    <SectionLabel className="mb-3">Updates</SectionLabel>
                    <UpdatesSection />
                  </div>
                </div>
              )}

              {section === 'experimental' && (
                <div className="space-y-6">
                  <p className="s-desc text-caption text-text-muted">
                    Opt-in features that are off by default — usually because of a known cost or
                    rough edge, not because they&apos;re unfinished.
                  </p>
                  <ExperimentalSection />
                </div>
              )}
            </div>
      {themePickerOpen && (
        <ThemePicker
          onClose={() => setThemePickerOpen(false)}
          theme={theme}
          previewVariant={previewVariant}
          setPreviewVariant={setPreviewVariant}
        />
      )}
    </Sheet>
  )
}

// ── Vault reconcile ───────────────────────────────────────────────────────────

// Replaces the old separate export / import / reconcile buttons for routine use:
// one status line + one "Sync now" action that reconciles inbound changes and
// exports outbound changes in a single step. Manual per-direction control still
// exists, just tucked behind the "Advanced" disclosure above.
function VaultSyncStatus() {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null)

  async function syncNow() {
    setStatus('running')
    try {
      const [reconcileRes, exportRes] = await Promise.all([
        window.vault.reconcile(),
        window.vault.exportAll(),
      ])
      if (reconcileRes.success && exportRes.success) {
        setLastSyncedAt(Date.now())
        setStatus('done')
        setTimeout(() => setStatus('idle'), 4000)
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        variant="secondary"
        icon={RefreshCw}
        loading={status === 'running'}
        onClick={syncNow}
        disabled={status === 'running'}
      >
        {status === 'running' ? 'Syncing…' : 'Sync now'}
      </Button>
      {status === 'idle' && !lastSyncedAt && (
        <p className="s-desc text-caption text-text-muted">Syncing automatically</p>
      )}
      {status === 'done' && (
        <p className="text-caption text-success">✓ Synced just now</p>
      )}
      {status === 'error' && (
        <p className="text-caption text-destructive">Sync failed — check vault path</p>
      )}
    </div>
  )
}

// ── Workspaces ────────────────────────────────────────────────────────────────









