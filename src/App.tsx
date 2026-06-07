import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import Sidebar from '@/components/shell/Sidebar'
import ActivePanel from '@/components/shell/ActivePanel'
import WindowControls from '@/components/shell/WindowControls'
import FloatingSearch from '@/components/shell/FloatingSearch'
import SettingsModal from '@/components/settings/SettingsModal'
import MarkdownReferenceModal from '@/components/notes/MarkdownReferenceModal'
import CrashReport from '@/components/shell/CrashReport'
import TabSwitcher from '@/components/shell/TabSwitcher'
import HistoryModal from '@/components/shell/HistoryModal'
import BgImportProgress from '@/components/shell/BgImportProgress'
import ImportModal from '@/components/settings/ImportModal'
import Onboarding from '@/components/shell/Onboarding'
import TasksPanel from '@/components/shell/TasksPanel'
import type { SpaceId, Tab } from '@/types'

interface SwitcherTab { spaceId: SpaceId; tabId: string; title: string; tab: Tab }

export default function App() {
  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const scriptureFontFamily = useAppStore((s) => s.scriptureFontFamily)
  const notesFontFamily = useAppStore((s) => s.notesFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const bibleLineHeight = useAppStore((s) => s.bibleLineHeight)
  const openSearch = useAppStore((s) => s.openSearch)
  const toggleSettings = useAppStore((s) => s.toggleSettings)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const createTab = useAppStore((s) => s.createTab)
  const ensureTab = useAppStore((s) => s.ensureTab)
  const openSearchTab = useAppStore((s) => s.openSearchTab)
  const openFindBar = useAppStore((s) => s.openFindBar)
  const closeFindBar = useAppStore((s) => s.closeFindBar)
  const setFindBarQuery = useAppStore((s) => s.setFindBarQuery)
  const findBarOpen = useAppStore((s) => s.findBarOpen)
  const findBarAutoOpen = useAppStore((s) => s.findBarAutoOpen)
  const findBarQuery = useAppStore((s) => s.findBarQuery)
  const activePanelId = useAppStore((s) => s.activePanelId)
  const setActivePanelId = useAppStore((s) => s.setActivePanelId)
  const closeActiveTab = useAppStore((s) => s.closeActiveTab)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const tabMRUList = useAppStore((s) => s.tabMRUList)
  const storeTabs = useAppStore((s) => s.tabs)
  const activeSpace = useAppStore((s) => s.activeSpace)
  const autoCloseTabsAfter = useAppStore((s) => s.autoCloseTabsAfter)
  const createSession = useAppStore((s) => s.createSession)
  const setBgImportProgress = useAppStore((s) => s.setBgImportProgress)
  const bumpNoteToken = useAppStore((s) => s.bumpNoteToken)
  const setESwordProgress = useAppStore((s) => s.setESwordProgress)
  const addHistoryEntry = useAppStore((s) => s.addHistoryEntry)
  const openImportModal = useAppStore((s) => s.openImportModal)
  const openImportBibleGateway = useAppStore((s) => s.openImportBibleGateway)
  const openImportESword = useAppStore((s) => s.openImportESword)

  // Global import progress listeners — always registered so state persists even when modals are closed
  useEffect(() => {
    window.bgImport.onProgress((p) => {
      setBgImportProgress({ phase: p.phase, done: p.done, total: p.total, message: p.message, reviewNotes: p.reviewNotes })
      if (p.phase === 'done') {
        bumpNoteToken()
        const m = p.message.match(/(\d+)\s+imported/)
        const count = m ? parseInt(m[1]) : p.done
        addHistoryEntry({ type: 'import', title: `BibleGateway import — ${p.message}`, importSource: 'biblegateway', importCount: count })
      }
    })
    window.eSwordImport.onProgress((p) => {
      setESwordProgress({ phase: p.phase, done: p.done, total: p.total, message: p.message, reviewNotes: p.reviewNotes })
      if (p.phase === 'done') {
        bumpNoteToken()
        const m = p.message.match(/(\d+)\s+imported/)
        const count = m ? parseInt(m[1]) : p.done
        addHistoryEntry({ type: 'import', title: `e-Sword import — ${p.message}`, importSource: 'esword', importCount: count })
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Menu bar action dispatcher — handles actions sent from the native menu
  useEffect(() => {
    window.app.onMenuAction((action, payload) => {
      const store = useAppStore.getState()
      switch (action) {
        case 'openRef':       store.openSearch('new'); break
        case 'searchTexts':   store.openSearchTab(''); break
        case 'navBack':       window.dispatchEvent(new CustomEvent('berean:navBack')); break
        case 'navForward':    window.dispatchEvent(new CustomEvent('berean:navForward')); break
        case 'prevChapter':   window.dispatchEvent(new CustomEvent('berean:prevChapter')); break
        case 'nextChapter':   window.dispatchEvent(new CustomEvent('berean:nextChapter')); break
        case 'focusRefBar':   window.dispatchEvent(new CustomEvent('berean:focusRefBar')); break
        case 'toggleStrongs': window.dispatchEvent(new CustomEvent('berean:toggleStrongs')); break
        case 'compareVerse':  window.dispatchEvent(new CustomEvent('berean:compareVerse')); break
        case 'newNote':       store.setActiveSpace('notes'); window.dispatchEvent(new CustomEvent('berean:newNote')); break
        case 'newVerseNote':  window.dispatchEvent(new CustomEvent('berean:newVerseNote')); break
        case 'openDailyNote': store.setActiveSpace('notes'); window.dispatchEvent(new CustomEvent('berean:openDailyNote')); break
        case 'toggleMarkdown':window.dispatchEvent(new CustomEvent('berean:toggleMarkdown')); break
        case 'insertTimestamp':window.dispatchEvent(new CustomEvent('berean:insertTimestamp')); break
        case 'openImport':              openImportModal(); break
        case 'openImportBibleGateway':  openImportBibleGateway(); break
        case 'openImportESword':        openImportESword(); break
        case 'openHistory':             store.openHistory(); break
        case 'toggleSidebar': store.toggleSidebar(); break
        case 'openSearchInPanel': store.openSearch('current'); break
        case 'find': {
          const pid = store.activePanelId
          if (pid === 'notes') {
            window.dispatchEvent(new CustomEvent('berean:openNotesFindBar'))
          } else if (pid === 'lexicon') {
            window.dispatchEvent(new CustomEvent('berean:openLexiconFindBar'))
          } else {
            window.dispatchEvent(new CustomEvent('berean:openFindBar'))
          }
          break
        }
        case 'switchSpace': {
          const spaceId = payload as string
          if (spaceId) store.setActiveSpace(spaceId as Parameters<typeof store.setActiveSpace>[0])
          break
        }
        case 'addTab': {
          // Called when a floating tab is returned to the main window
          const { type: tabType, state: tabState } = payload as { type: string; state: Record<string, unknown> }
          // 'notes' is the float type; 'note' is the internal TabType — handle both
          const isNoteTab = tabType === 'note' || tabType === 'notes'
          const spaceId =
            tabType === 'bible'   ? 'scripture' :
            isNoteTab             ? 'notes'     :
            tabType === 'lexicon' ? 'lexicon'   : null
          const canonicalType =
            tabType === 'bible'   ? 'bible' :
            isNoteTab             ? 'note'  :
            tabType === 'lexicon' ? 'lexicon' : tabType
          if (spaceId) {
            const noteId = tabState?.noteId as string | undefined
            store.addTab({
              id: `${canonicalType}-${Date.now()}`,
              spaceId: spaceId as import('@/types').SpaceId,
              type: canonicalType as import('@/types').TabType,
              title:
                tabType === 'bible'   ? `${tabState.bookId ?? 'GEN'} ${tabState.chapter ?? 1}` :
                isNoteTab             ? (noteId ? 'Note' : 'Notes') :
                tabType === 'lexicon' ? String(tabState.strongsNum ?? 'Lexicon') :
                tabType,
              state: tabState as unknown as import('@/types').TabState,
            })
            // For notes floating tabs: pre-queue the specific note to open
            if (isNoteTab && noteId) {
              store.requestOpenNote(noteId)
            }
          }
          break
        }
        case 'popOutTab': {
          // Pop out the currently active tab to a floating window
          const s = store
          const space = s.activeSpace
          const activeId = s.activeTabId[space]
          const tab = activeId ? s.tabs[space].find(t => t.id === activeId) : null
          if (tab) {
            const state: Record<string, string> = {}
            if (tab.state && typeof tab.state === 'object') {
              Object.entries(tab.state as unknown as Record<string, unknown>).forEach(([k, v]) => {
                if (typeof v === 'string' || typeof v === 'number') state[k] = String(v)
              })
            }
            window.app.openFloatingTab(tab.type, state)
          }
          break
        }
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openImportModal, openImportBibleGateway, openImportESword])

  // Cross-window tab sync ────────────────────────────────────────────────────
  // When tabs change in this window, broadcast to other windows.
  // When receiving a broadcast from another window, apply it (no re-broadcast).
  const applyExternalTabSync = useAppStore((s) => s.applyExternalTabSync)
  const isBroadcastingRef = useRef(false)

  useEffect(() => {
    // Listen for broadcasts from other windows
    window.app.onTabStateUpdate?.((payload) => {
      isBroadcastingRef.current = true
      applyExternalTabSync(payload as { tabs: typeof storeTabs; theme?: string; themePreset?: string })
      setTimeout(() => { isBroadcastingRef.current = false }, 0)
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Broadcast our tab state + theme to other windows whenever tabs or theme change
    if (isBroadcastingRef.current) return // skip if we're applying an external update
    const timer = setTimeout(() => {
      const payload = { tabs: storeTabs, theme, themePreset }
      window.app.broadcastTabState?.(payload)
    }, 150) // debounce
    return () => clearTimeout(timer)
  }, [storeTabs, theme, themePreset])
  // ─────────────────────────────────────────────────────────────────────────

  const closeActiveTabRef = useRef(closeActiveTab)
  useEffect(() => { closeActiveTabRef.current = closeActiveTab }, [closeActiveTab])
  // Keep activeSpace in a ref so the keydown closure always reads the latest value
  const activeSpaceRef = useRef(activeSpace)
  useEffect(() => { activeSpaceRef.current = activeSpace }, [activeSpace])

  // Keep activePanelId in a ref so Cmd+F closure routes to the correct panel
  const activePanelIdRef = useRef(activePanelId)
  useEffect(() => { activePanelIdRef.current = activePanelId }, [activePanelId])

  // Sync activePanelId when the user navigates between sidebar spaces.
  // Mouse-down on individual panels (in dual-panel layout) will override this.
  useEffect(() => {
    if (activeSpace === 'notes') setActivePanelId('notes')
    else if (activeSpace === 'lexicon') setActivePanelId('lexicon')
    else setActivePanelId('bible') // scripture / youtube / search → bible panel
  }, [activeSpace, setActivePanelId])

  // Auto-dismiss timer for find bar opened by typing (not by Cmd+F)
  const autoOpenDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const findBarOpenRef = useRef(findBarOpen)
  const findBarAutoOpenRef = useRef(findBarAutoOpen)
  const findBarQueryRef = useRef(findBarQuery)
  useEffect(() => { findBarOpenRef.current = findBarOpen }, [findBarOpen])
  useEffect(() => { findBarAutoOpenRef.current = findBarAutoOpen }, [findBarAutoOpen])
  useEffect(() => { findBarQueryRef.current = findBarQuery }, [findBarQuery])

  // ── Ctrl+Tab MRU switcher ────────────────────────────────────────────────
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [switcherIdx, setSwitcherIdx] = useState(0)
  const switcherStateRef = useRef({ open: false, idx: 0 })
  const tabMRURef = useRef(tabMRUList)
  const storeTabsRef = useRef(storeTabs)
  const setActiveTabRef = useRef(setActiveTab)

  useEffect(() => { tabMRURef.current = tabMRUList }, [tabMRUList])
  useEffect(() => { storeTabsRef.current = storeTabs }, [storeTabs])
  useEffect(() => { setActiveTabRef.current = setActiveTab }, [setActiveTab])

  function buildSwitcherTabs(): SwitcherTab[] {
    return tabMRURef.current.flatMap(({ spaceId, tabId }) => {
      const tab = storeTabsRef.current[spaceId].find(t => t.id === tabId)
      return tab ? [{ spaceId, tabId, title: tab.title, tab }] : []
    })
  }

  function updateSwitcher(open: boolean, idx: number) {
    switcherStateRef.current = { open, idx }
    setSwitcherOpen(open)
    setSwitcherIdx(idx)
  }

  // Sync line-height CSS variable
  useEffect(() => {
    const values = { compact: '1.3', comfortable: '1.75', spacious: '2.1' }
    document.documentElement.style.setProperty('--line-height-comfortable', values[bibleLineHeight])
  }, [bibleLineHeight])

  // Relay nativeTheme IPC changes into a React-friendly state so the theme
  // effect below re-runs reliably when macOS switches dark/light mode.
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')

    function applyDark(isDark: boolean) {
      setSystemIsDark((prev) => (prev === isDark ? prev : isDark))
    }

    // 1. IPC path — authoritative Electron signal from nativeTheme.on('updated')
    window.app?.onNativeThemeChanged?.((isDark) => applyDark(isDark))

    // 2. matchMedia change event — catches dev/non-Electron environments
    const mqHandler = (e: MediaQueryListEvent) => applyDark(e.matches)
    mq.addEventListener('change', mqHandler)

    // 3. Polling fallback — Electron's nativeTheme event and matchMedia 'change'
    //    can both be delayed by up to several seconds on macOS. Polling matchMedia
    //    at 250ms guarantees the theme snaps within a quarter-second of the OS change.
    let lastPoll = mq.matches
    const pollId = setInterval(() => {
      const current = mq.matches
      if (current !== lastPoll) {
        lastPoll = current
        applyDark(current)
      }
    }, 250)

    // 4. Focus sync — when the window regains focus after the user has been in
    //    System Preferences or another app, re-read immediately so the theme is
    //    already correct before any polling tick fires.
    const focusHandler = () => applyDark(mq.matches)
    window.addEventListener('focus', focusHandler)

    return () => {
      mq.removeEventListener('change', mqHandler)
      clearInterval(pollId)
      window.removeEventListener('focus', focusHandler)
    }
  }, [])

  // Sync theme class on <html>; 'system' follows the OS preference
  useEffect(() => {
    const html = document.documentElement
    // Remove any existing preset theme classes
    const allPresets = [
      'theme-neon','theme-midnight','theme-bible','theme-forest','theme-royal',
      'theme-ember','theme-ocean','theme-slate','theme-rose','theme-terminal','theme-sand','theme-obsidian',
      'theme-ivory','theme-arctic','theme-dawn',
      // Light variants of naturally-dark themes
      'theme-neon-light','theme-midnight-light','theme-obsidian-light','theme-forest-light',
      'theme-royal-light','theme-ember-light','theme-ocean-light','theme-slate-light','theme-terminal-light',
      // Dark variants of naturally-light themes
      'theme-bible-dark','theme-sand-dark','theme-rose-dark','theme-ivory-dark','theme-arctic-dark','theme-dawn-dark',
    ]
    allPresets.forEach((cls) => html.classList.remove(cls))

    // Naturally-dark presets: base class = dark variant; -light suffix = light variant
    // Naturally-light presets: base class = light variant; -dark suffix = dark variant
    const NATURALLY_DARK = new Set([
      'theme-neon','theme-midnight','theme-obsidian','theme-forest',
      'theme-royal','theme-ember','theme-ocean','theme-slate','theme-terminal',
    ])

    if (themePreset) {
      // Extract the base preset ID (strip any -dark / -light suffix)
      const baseId = themePreset.replace(/-(?:dark|light)$/, '')

      // Apply the correct variant for the given isDark boolean
      const applyPreset = (isDark: boolean) => {
        html.classList.remove('dark', 'light')
        let cls: string
        if (NATURALLY_DARK.has(baseId)) {
          // dark natural → base = dark, base-light = light
          cls = isDark ? baseId : `${baseId}-light`
        } else {
          // light natural → base = light, base-dark = dark
          cls = isDark ? `${baseId}-dark` : baseId
        }
        html.classList.add(cls)
      }

      if (theme === 'system') {
        applyPreset(systemIsDark)
      } else {
        applyPreset(theme === 'dark')
      }
    } else {
      const applyTheme = (isDark: boolean) => {
        html.classList.toggle('dark', isDark)
        html.classList.toggle('light', !isDark)
      }
      applyTheme(theme === 'system' ? systemIsDark : theme === 'dark')
    }
  }, [theme, themePreset, systemIsDark])

  // Sync per-section font families
  useEffect(() => {
    const fontMap: Record<string, string> = {
      system:     'inherit',
      serif:      'Georgia, "Times New Roman", Times, serif',
      sansserif:  'Inter, ui-sans-serif, system-ui, sans-serif',
      mono:       '"JetBrains Mono", "Fira Code", "Menlo", monospace',
      garamond:   '"EB Garamond", Garamond, Georgia, serif',
      palatino:   '"Palatino Linotype", Palatino, "Book Antiqua", serif',
      merriweather: '"Merriweather", Georgia, serif',
      lora:       '"Lora", Georgia, serif',
      crimson:    '"Crimson Text", Georgia, serif',
      sourceserif: '"Source Serif 4", Georgia, serif',
      nunito:     '"Nunito", Inter, sans-serif',
    }
    document.documentElement.style.setProperty('--font-scripture', fontMap[scriptureFontFamily] ?? 'inherit')
    document.documentElement.style.setProperty('--font-notes', fontMap[notesFontFamily] ?? 'inherit')
    // UI font — applied to body so all chrome (sidebar, settings, tabs) inherits it;
    // scripture and notes sections override it with their own vars.
    const uiFont = uiFontFamily === 'system' ? 'Inter, ui-sans-serif, system-ui, sans-serif' : (fontMap[uiFontFamily] ?? 'inherit')
    document.body.style.fontFamily = uiFont
  }, [scriptureFontFamily, notesFontFamily, uiFontFamily])

  // ── On mount: load history, settings, check onboarding, vault reconcile ──
  useEffect(() => {
    // 1. Load history from SQLite
    window.appHistory?.getAll().then((entries) => {
      useAppStore.getState().setHistory(entries)
    }).catch(() => {})

    // 2. Load settings from SQLite and hydrate the store
    window.settings?.getAll().then((all) => {
      const s = useAppStore.getState()
      if (typeof all.theme === 'string' && ['dark','light','system'].includes(all.theme as string))
        s.setTheme(all.theme as 'dark' | 'light' | 'system')
      if (typeof all.themePreset === 'string') s.setThemePreset(all.themePreset)
      if (typeof all.fontSize === 'number') s.setBibleFontSize(all.fontSize)
      if (typeof all.lineHeight === 'string') s.setBibleLineHeight(all.lineHeight as 'compact' | 'comfortable' | 'spacious')
      if (typeof all.defaultTranslation === 'string') s.setDefaultBibleTranslation(all.defaultTranslation)
      if (typeof all.scriptureFontFamily === 'string') s.setScriptureFontFamily(all.scriptureFontFamily)
      if (typeof all.notesFontFamily === 'string') s.setNotesFontFamily(all.notesFontFamily)
      if (typeof all.uiFontFamily === 'string') s.setUiFontFamily(all.uiFontFamily)
      if (typeof all.autoPiP === 'boolean') s.setAutoPiP(all.autoPiP)
      if (typeof all.noteVerseRefsEnabled === 'boolean') s.setNoteVerseRefsEnabled(all.noteVerseRefsEnabled)
      if (typeof all.noteLexiconRefsEnabled === 'boolean') s.setNoteLexiconRefsEnabled(all.noteLexiconRefsEnabled)
      if (typeof all.sidebarNewTabIconOnly === 'boolean') s.setSidebarNewTabIconOnly(all.sidebarNewTabIconOnly)
      if (typeof all.defaultScriptureLayout === 'string') s.setDefaultScriptureLayout(all.defaultScriptureLayout as import('@/types').ScriptureLayout)
      if (typeof all.noteTransformLayout === 'string') s.setNoteTransformLayout(all.noteTransformLayout as 'right' | 'bottom' | 'left')
      if (typeof all.crossRefSource === 'string') s.setCrossRefSource(all.crossRefSource as 'tske' | 'classic' | 'notes')
      if (typeof all.autoCloseTabsAfter === 'number') s.setAutoCloseTabsAfter(all.autoCloseTabsAfter)
      if (typeof all.wordReplacerEnabled === 'boolean') s.setWordReplacerEnabled(all.wordReplacerEnabled)
      if (typeof all.noteScriptureBlock === 'boolean') s.setNoteScriptureBlock(all.noteScriptureBlock)
      if (typeof all.noteScriptureBlockThreshold === 'number') s.setNoteScriptureBlockThreshold(all.noteScriptureBlockThreshold)
    }).catch(() => {})

    // 3. Check onboarding status
    window.settings?.get('onboardingCompleted').then((completed) => {
      if (completed !== true) useAppStore.getState().openOnboarding()
    }).catch(() => {})

    // 4. Vault reconcile on startup if sync is enabled
    window.settings?.get('vaultSync').then((enabled) => {
      if (enabled) window.vault?.reconcile().catch(() => {})
    }).catch(() => {})

    // 5. Subscribe to store settings changes → debounce-write to SQLite
    const DEBOUNCE = 800
    let timer: ReturnType<typeof setTimeout>
    const unsub = useAppStore.subscribe((state, prev) => {
      const changed =
        state.theme !== prev.theme ||
        state.themePreset !== prev.themePreset ||
        state.bibleFontSize !== prev.bibleFontSize ||
        state.bibleLineHeight !== prev.bibleLineHeight ||
        state.defaultBibleTranslation !== prev.defaultBibleTranslation ||
        state.scriptureFontFamily !== prev.scriptureFontFamily ||
        state.notesFontFamily !== prev.notesFontFamily ||
        state.uiFontFamily !== prev.uiFontFamily ||
        state.autoPiP !== prev.autoPiP ||
        state.noteVerseRefsEnabled !== prev.noteVerseRefsEnabled ||
        state.noteLexiconRefsEnabled !== prev.noteLexiconRefsEnabled ||
        state.sidebarNewTabIconOnly !== prev.sidebarNewTabIconOnly ||
        state.defaultScriptureLayout !== prev.defaultScriptureLayout ||
        state.noteTransformLayout !== prev.noteTransformLayout ||
        state.crossRefSource !== prev.crossRefSource ||
        state.autoCloseTabsAfter !== prev.autoCloseTabsAfter ||
        state.wordReplacerEnabled !== prev.wordReplacerEnabled ||
        state.noteScriptureBlock !== prev.noteScriptureBlock ||
        state.noteScriptureBlockThreshold !== prev.noteScriptureBlockThreshold
      if (!changed) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const s = useAppStore.getState()
        const pairs: [string, unknown][] = [
          ['theme', s.theme], ['themePreset', s.themePreset],
          ['fontSize', s.bibleFontSize], ['lineHeight', s.bibleLineHeight],
          ['defaultTranslation', s.defaultBibleTranslation],
          ['scriptureFontFamily', s.scriptureFontFamily],
          ['notesFontFamily', s.notesFontFamily], ['uiFontFamily', s.uiFontFamily],
          ['autoPiP', s.autoPiP],
          ['noteVerseRefsEnabled', s.noteVerseRefsEnabled],
          ['noteLexiconRefsEnabled', s.noteLexiconRefsEnabled],
          ['sidebarNewTabIconOnly', s.sidebarNewTabIconOnly],
          ['defaultScriptureLayout', s.defaultScriptureLayout],
          ['noteTransformLayout', s.noteTransformLayout],
          ['crossRefSource', s.crossRefSource],
          ['autoCloseTabsAfter', s.autoCloseTabsAfter],
          ['wordReplacerEnabled', s.wordReplacerEnabled],
          ['noteScriptureBlock', s.noteScriptureBlock],
          ['noteScriptureBlockThreshold', s.noteScriptureBlockThreshold],
        ]
        pairs.forEach(([k, v]) => window.settings?.set(k, v).catch(() => {}))
      }, DEBOUNCE)
    })
    return () => { clearTimeout(timer); unsub() }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Cmd+W: close active tab — exactly the same action as clicking the X on a tab.
  // Registered once on mount; uses getState() so it always reads latest store values.
  useEffect(() => {
    window.app?.onCloseTab?.(() => {
      window.dispatchEvent(new CustomEvent('berean:saveScrollBeforeTabChange'))
      const store = useAppStore.getState()
      const spaceId = store.activeSpace
      const tabId = store.activeTabId[spaceId]
      if (tabId) store.closeTab(spaceId, tabId)
    })
    // macOS app menu "Preferences…" opens the settings modal
    window.app?.onOpenSettings?.(() => useAppStore.getState().openSettings())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-close inactive tabs
  useEffect(() => {
    if (!autoCloseTabsAfter) return
    const interval = setInterval(() => {
      const store = useAppStore.getState()
      const now = Date.now()
      const spaces = ['scripture', 'notes', 'lexicon', 'youtube', 'search'] as const
      for (const spaceId of spaces) {
        const tabs = store.tabs[spaceId] ?? []
        const activeId = store.activeTabId[spaceId]
        for (const tab of tabs) {
          if (tab.id === activeId) continue  // never close the currently active tab
          if (tabs.length <= 1) continue      // keep at least one tab per space
          const key = `${spaceId}:${tab.id}`
          const lastAccessed = store.tabLastAccessed[key] ?? 0
          if (lastAccessed && now - lastAccessed > autoCloseTabsAfter) {
            store.closeTab(spaceId, tab.id)
          }
        }
      }
    }, 5 * 60 * 1000) // check every 5 minutes
    return () => clearInterval(interval)
  }, [autoCloseTabsAfter])

  // Ctrl+Tab MRU tab switcher
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey || e.key !== 'Tab') return
      e.preventDefault()
      const validTabs = buildSwitcherTabs()
      if (validTabs.length < 2) return
      const { open, idx } = switcherStateRef.current
      if (!open) {
        const startIdx = e.shiftKey ? validTabs.length - 1 : Math.min(1, validTabs.length - 1)
        updateSwitcher(true, startIdx)
      } else {
        const step = e.shiftKey ? -1 : 1
        const next = (idx + step + validTabs.length) % validTabs.length
        updateSwitcher(true, next)
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key !== 'Control' || !switcherStateRef.current.open) return
      const validTabs = buildSwitcherTabs()
      const selected = validTabs[switcherStateRef.current.idx]
      if (selected) setActiveTabRef.current(selected.spaceId, selected.tabId)
      updateSwitcher(false, 0)
    }
    function onEscapeForSwitcher(e: KeyboardEvent) {
      if (e.key === 'Escape' && switcherStateRef.current.open) updateSwitcher(false, 0)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('keydown', onEscapeForSwitcher)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('keydown', onEscapeForSwitcher)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Helpers for find-bar type-anywhere detection
  function isTypingTarget(el: Element | null): boolean {
    if (!el) return false
    const tag = el.tagName.toLowerCase()
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
    if ((el as HTMLElement).isContentEditable) return true
    // CodeMirror 6 uses a contenteditable div with class cm-content
    if (el.classList.contains('cm-content') || el.closest('.cm-content')) return true
    return false
  }

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey

      // ── Cmd+F → route find bar to the last-focused panel ───────────────
      if (cmd && !e.shiftKey && e.key.toLowerCase() === 'f') {
        const pid = activePanelIdRef.current
        // Notes & lexicon panels have their own FindBar component — route to it even
        // when focus is inside their CodeMirror editor (the editor has no native search
        // panel wired up, so relying on CodeMirror would do nothing).
        if (pid === 'notes') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('berean:openNotesFindBar'))
          return
        }
        if (pid === 'lexicon') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('berean:openLexiconFindBar'))
          return
        }
        // Bible panel (default). If focus is inside a CodeMirror editor (e.g. the
        // scripture-tab side-panel note), don't hijack Cmd+F.
        const activeEl = document.activeElement
        if (activeEl && (activeEl.classList.contains('cm-content') || activeEl.closest?.('.cm-content'))) {
          return
        }
        e.preventDefault()
        if (findBarOpenRef.current) {
          window.dispatchEvent(new CustomEvent('berean:findBarSelectAll'))
        } else {
          openFindBar(false, '')
        }
        return
      }

      if (cmd && e.key === 'w') {
        e.preventDefault()
        closeActiveTabRef.current()
      } else if (cmd && e.key === 'k') {
        e.preventDefault()
        openSearch('current')
      } else if (cmd && e.key === 't') {
        e.preventDefault()
        openSearch('new')
      } else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'l') {
        // Cmd+L always opens the main floating search bar — even on the advanced
        // scripture search tab (where it previously just focused the local input).
        e.preventDefault()
        openSearch('current')
      } else if (cmd && e.key === ',') {
        e.preventDefault()
        toggleSettings()
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        toggleSidebar()
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        ensureTab('note')
        setActiveSpace('notes')
        createTab('note')
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        openSearchTab('')
      } else if (cmd && !e.shiftKey && e.key === '/') {
        // ── Cmd+/ → open scripture floating search ──────────────────────
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('berean:openScriptureSearch'))
      } else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'g') {
        // ── Cmd+G → toggle Strong's numbers in the active scripture tab ──
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('berean:toggleStrongs'))
      } else if (cmd && !e.shiftKey && e.key.toLowerCase() === 'h') {
        // ── Cmd+H → open History (app 'hide' is remapped to ⌘⇧H) ────────
        e.preventDefault()
        useAppStore.getState().openHistory()
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('berean:togglePiP'))
      } else if (cmd && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('berean:requestTimestamp'))
      } else if (cmd && e.shiftKey && e.key === '0') {
        e.preventDefault()
        createSession()
      } else if (cmd && !e.shiftKey && e.key >= '1' && e.key <= '5') {
        const spaces = ['scripture', 'notes', 'lexicon', 'youtube', 'search'] as const
        const space = spaces[parseInt(e.key) - 1]
        if (space) {
          e.preventDefault()
          setActiveSpace(space)
        }
      } else if (!cmd && !e.ctrlKey && !e.altKey && !e.metaKey) {
        // ── Type-anywhere → auto-open find bar ───────────────────────────
        // Only trigger for printable single characters (not Enter, Escape, Tab, arrows, etc.)
        if (
          e.key.length === 1 &&
          !isTypingTarget(document.activeElement) &&
          !findBarOpenRef.current
        ) {
          const pid = activePanelIdRef.current
          if (pid === 'bible') {
            // Digit keys → go-to-verse (accumulate in BiblePanel)
            if (e.key >= '0' && e.key <= '9') {
              window.dispatchEvent(new CustomEvent('berean:verseDigit', { detail: { digit: e.key } }))
            } else {
              openFindBar(true, e.key)
              // Auto-dismiss timer for type-anywhere (bible only uses global findbar)
              if (autoOpenDismissRef.current) clearTimeout(autoOpenDismissRef.current)
              autoOpenDismissRef.current = setTimeout(() => {
                if (findBarAutoOpenRef.current) closeFindBar()
              }, 3500)
            }
          } else if (pid === 'notes') {
            window.dispatchEvent(new CustomEvent('berean:openNotesFindBar', { detail: { seedChar: e.key } }))
          } else if (pid === 'lexicon') {
            window.dispatchEvent(new CustomEvent('berean:openLexiconFindBar', { detail: { seedChar: e.key } }))
          }
        } else if (findBarOpenRef.current && findBarAutoOpenRef.current && e.key.length === 1 && !isTypingTarget(document.activeElement)) {
          // Characters typed while findbar is open but input isn't focused yet (fast typing
          // before the 20ms focus delay). Forward them into the query so nothing is lost.
          setFindBarQuery(findBarQueryRef.current + e.key)
          // Reset auto-dismiss timer
          if (autoOpenDismissRef.current) clearTimeout(autoOpenDismissRef.current)
          autoOpenDismissRef.current = setTimeout(() => {
            if (findBarAutoOpenRef.current) closeFindBar()
          }, 3500)
        } else if (findBarOpenRef.current && findBarAutoOpenRef.current && isTypingTarget(document.activeElement)) {
          // User is actively typing inside the find bar input — reset dismiss timer so it
          // doesn't close while they're still typing
          if (autoOpenDismissRef.current) clearTimeout(autoOpenDismissRef.current)
          autoOpenDismissRef.current = setTimeout(() => {
            if (findBarAutoOpenRef.current) closeFindBar()
          }, 3500)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openSearch, toggleSettings, toggleSidebar, setActiveSpace, createTab, ensureTab, openSearchTab, openFindBar, closeFindBar, createSession, setFindBarQuery])

  // Build current switcher tab list for rendering (derived from reactive store slices)
  const switcherTabs: SwitcherTab[] = tabMRUList.flatMap(({ spaceId, tabId }) => {
    const tab = storeTabs[spaceId].find(t => t.id === tabId)
    return tab ? [{ spaceId, tabId, title: tab.title, tab }] : []
  })

  const isWin = window.__berean_platform === 'win32'

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[rgb(var(--color-surface-1))]">
      {/* Windows custom title bar — drag region + native-style min/max/close */}
      {isWin && (
        <div
          className="flex-shrink-0 flex items-center justify-end h-8 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))] z-[200]"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <WindowControls />
        </div>
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden bg-[rgb(var(--color-surface-3))]">
          <ActivePanel />
        </main>
      </div>
      <FloatingSearch />
      <SettingsModal />
      <MarkdownReferenceModal />
      <CrashReport />
      {switcherOpen && (
        <TabSwitcher
          tabs={switcherTabs}
          selectedIndex={switcherIdx}
          onHoverIndex={(i) => updateSwitcher(true, i)}
          onSelectTab={(spaceId, tabId) => {
            setActiveTab(spaceId, tabId)
            updateSwitcher(false, 0)
          }}
          onClose={() => updateSwitcher(false, 0)}
        />
      )}
      <HistoryModal />
      <ImportModal />
      <BgImportProgress />
      <Onboarding />
      <TasksPanel />
    </div>
  )
}
