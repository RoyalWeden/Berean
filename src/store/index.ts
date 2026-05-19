import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
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
  updateTabState: (spaceId: SpaceId, tabId: string, newState: Partial<TabState>) => void
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
    (set, get) => ({
      activeSpace: 'scripture' as SpaceId,
      tabs: DEFAULT_TABS,
      activeTabId: DEFAULT_ACTIVE_TAB,
      panelLayout: DEFAULT_PANEL_LAYOUT,
      sidebarCollapsed: false,
      searchOpen: false,
      settingsOpen: false,
      theme: 'dark' as const,

      setActiveSpace: (space) => set({ activeSpace: space }),

      addTab: (tab) => {
        const state = get()
        const existing = state.tabs[tab.spaceId].find((t) => t.id === tab.id)
        if (existing) {
          set({ activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id }, activeSpace: tab.spaceId })
        } else {
          set({
            tabs: { ...state.tabs, [tab.spaceId]: [...state.tabs[tab.spaceId], tab] },
            activeTabId: { ...state.activeTabId, [tab.spaceId]: tab.id },
            activeSpace: tab.spaceId
          })
        }
      },

      closeTab: (spaceId, tabId) => {
        const state = get()
        const tabs = state.tabs[spaceId]
        const idx = tabs.findIndex((t) => t.id === tabId)
        if (idx === -1) return
        const newTabs = tabs.filter((t) => t.id !== tabId)
        const newActiveId =
          state.activeTabId[spaceId] === tabId
            ? newTabs[Math.max(0, idx - 1)]?.id ?? null
            : state.activeTabId[spaceId]
        set({
          tabs: { ...state.tabs, [spaceId]: newTabs },
          activeTabId: { ...state.activeTabId, [spaceId]: newActiveId }
        })
      },

      setActiveTab: (spaceId, tabId) => {
        const state = get()
        set({ activeTabId: { ...state.activeTabId, [spaceId]: tabId }, activeSpace: spaceId })
      },

      updateTabState: (spaceId, tabId, newState) => {
        const state = get()
        const tabs = state.tabs[spaceId].map((t) =>
          t.id === tabId ? { ...t, state: { ...t.state, ...newState } } : t
        )
        set({ tabs: { ...state.tabs, [spaceId]: tabs } })
      },

      updatePanelLayout: (layout) => set({ panelLayout: layout }),

      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

      openSearch: () => set({ searchOpen: true }),
      closeSearch: () => set({ searchOpen: false }),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),

      setTheme: (theme) => set({ theme })
    }),
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
