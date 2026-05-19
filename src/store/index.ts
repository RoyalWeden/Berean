import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { immer } from 'zustand/middleware/immer'
import type { SpaceId, Tab, TabState, MosaicKey } from '@/types'
import type { MosaicNode } from 'react-mosaic-component'

export interface AppState {
  // Navigation
  activeSpace: SpaceId
  tabs: Record<SpaceId, Tab[]>
  activeTabId: Record<SpaceId, string | null>

  // Panel layout
  panelLayout: MosaicNode<MosaicKey> | null
  sidebarCollapsed: boolean

  // UI modals
  searchOpen: boolean
  settingsOpen: boolean

  // Theme
  theme: 'dark' | 'light'

  // Actions
  setActiveSpace: (space: SpaceId) => void
  addTab: (tab: Tab) => void
  closeTab: (spaceId: SpaceId, tabId: string) => void
  setActiveTab: (spaceId: SpaceId, tabId: string) => void
  updateTabState: (spaceId: SpaceId, tabId: string, state: Partial<TabState>) => void
  updatePanelLayout: (layout: MosaicNode<MosaicKey> | null) => void
  toggleSidebar: () => void
  openSearch: () => void
  closeSearch: () => void
  openSettings: () => void
  closeSettings: () => void
  setTheme: (theme: 'dark' | 'light') => void
}

const DEFAULT_TABS: Record<SpaceId, Tab[]> = {
  scripture: [
    {
      id: 'bible-gen-1',
      spaceId: 'scripture',
      type: 'bible',
      title: 'Genesis 1',
      state: {
        bookId: 'GEN',
        chapter: 1,
        translation: 'KJV',
        showStrongs: false,
        scrollPosition: 0
      }
    }
  ],
  notes: [],
  lexicon: [],
  youtube: [],
  search: []
}

const DEFAULT_ACTIVE_TAB: Record<SpaceId, string | null> = {
  scripture: 'bible-gen-1',
  notes: null,
  lexicon: null,
  youtube: null,
  search: null
}

const DEFAULT_PANEL_LAYOUT: MosaicNode<MosaicKey> = {
  direction: 'row',
  first: 'bible-panel',
  second: 'notes-panel',
  splitPercentage: 58
}

export const useAppStore = create<AppState>()(
  persist(
    immer((set) => ({
      activeSpace: 'scripture',
      tabs: DEFAULT_TABS,
      activeTabId: DEFAULT_ACTIVE_TAB,
      panelLayout: DEFAULT_PANEL_LAYOUT,
      sidebarCollapsed: false,
      searchOpen: false,
      settingsOpen: false,
      theme: 'dark',

      setActiveSpace: (space) =>
        set((state) => {
          state.activeSpace = space
        }),

      addTab: (tab) =>
        set((state) => {
          const existing = state.tabs[tab.spaceId].find((t) => t.id === tab.id)
          if (!existing) {
            state.tabs[tab.spaceId].push(tab)
          }
          state.activeTabId[tab.spaceId] = tab.id
          state.activeSpace = tab.spaceId
        }),

      closeTab: (spaceId, tabId) =>
        set((state) => {
          const tabs = state.tabs[spaceId]
          const idx = tabs.findIndex((t) => t.id === tabId)
          if (idx === -1) return
          tabs.splice(idx, 1)
          if (state.activeTabId[spaceId] === tabId) {
            state.activeTabId[spaceId] = tabs[Math.max(0, idx - 1)]?.id ?? null
          }
        }),

      setActiveTab: (spaceId, tabId) =>
        set((state) => {
          state.activeTabId[spaceId] = tabId
          state.activeSpace = spaceId
        }),

      updateTabState: (spaceId, tabId, newState) =>
        set((state) => {
          const tab = state.tabs[spaceId].find((t) => t.id === tabId)
          if (tab) {
            Object.assign(tab.state, newState)
          }
        }),

      updatePanelLayout: (layout) =>
        set((state) => {
          state.panelLayout = layout
        }),

      toggleSidebar: () =>
        set((state) => {
          state.sidebarCollapsed = !state.sidebarCollapsed
        }),

      openSearch: () =>
        set((state) => {
          state.searchOpen = true
        }),

      closeSearch: () =>
        set((state) => {
          state.searchOpen = false
        }),

      openSettings: () =>
        set((state) => {
          state.settingsOpen = true
        }),

      closeSettings: () =>
        set((state) => {
          state.settingsOpen = false
        }),

      setTheme: (theme) =>
        set((state) => {
          state.theme = theme
        })
    })),
    {
      name: 'berean-app-state',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeSpace: state.activeSpace,
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        panelLayout: state.panelLayout,
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme
      })
    }
  )
)
