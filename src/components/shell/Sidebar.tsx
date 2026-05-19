import { BookOpen, FileText, BookMarked, Youtube, Search, Settings, ChevronLeft, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import TabBar from './TabBar'
import type { SpaceId } from '@/types'

const SPACES: { id: SpaceId; label: string; icon: React.ComponentType<{ size?: number; className?: string }> }[] = [
  { id: 'scripture', label: 'Scripture', icon: BookOpen },
  { id: 'notes', label: 'Notes', icon: FileText },
  { id: 'lexicon', label: 'Lexicon', icon: BookMarked },
  { id: 'youtube', label: 'YouTube', icon: Youtube },
  { id: 'search', label: 'Search', icon: Search }
]

export default function Sidebar() {
  const activeSpace = useAppStore((s) => s.activeSpace)
  const tabs = useAppStore((s) => s.tabs)
  const activeTabId = useAppStore((s) => s.activeTabId)
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)
  const setActiveSpace = useAppStore((s) => s.setActiveSpace)
  const setActiveTab = useAppStore((s) => s.setActiveTab)
  const closeTab = useAppStore((s) => s.closeTab)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const openSettings = useAppStore((s) => s.openSettings)

  return (
    <aside
      className={`
        flex flex-col flex-shrink-0 h-full
        bg-[rgb(var(--color-surface-2))]
        border-r border-[rgb(var(--color-surface-4))]
        transition-all duration-200 ease-in-out
        ${sidebarCollapsed ? 'w-14' : 'w-56'}
      `}
    >
      {/* macOS traffic light spacer */}
      <div className="h-9 app-drag-region flex-shrink-0" />

      {/* Space icons */}
      <nav className="flex flex-col gap-1 px-2 flex-shrink-0">
        {SPACES.map(({ id, label, icon: Icon }) => {
          const isActive = activeSpace === id
          return (
            <button
              key={id}
              onClick={() => setActiveSpace(id)}
              title={sidebarCollapsed ? label : undefined}
              className={`
                no-drag flex items-center gap-3 rounded-lg px-2 py-2 text-sm font-medium
                transition-colors duration-100 cursor-default select-none w-full text-left
                ${isActive
                  ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                  : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))]'
                }
              `}
            >
              <Icon size={18} className="flex-shrink-0" />
              {!sidebarCollapsed && <span className="truncate">{label}</span>}
            </button>
          )
        })}
      </nav>

      {/* Divider */}
      {!sidebarCollapsed && (
        <div className="mx-3 my-2 h-px bg-[rgb(var(--color-surface-4))]" />
      )}

      {/* Tab list for active space */}
      {!sidebarCollapsed && (
        <div className="flex-1 overflow-y-auto min-h-0">
          <TabBar
            tabs={tabs[activeSpace]}
            activeTabId={activeTabId[activeSpace]}
            spaceId={activeSpace}
            onTabClick={(tabId) => setActiveTab(activeSpace, tabId)}
            onTabClose={(tabId) => closeTab(activeSpace, tabId)}
          />
        </div>
      )}

      {/* Bottom actions */}
      <div className="flex flex-col gap-1 px-2 py-2 flex-shrink-0 border-t border-[rgb(var(--color-surface-4))]">
        <button
          onClick={openSettings}
          title="Settings"
          className="no-drag flex items-center gap-3 rounded-lg px-2 py-2 text-sm
            text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-4))]
            hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-default select-none"
        >
          <Settings size={18} className="flex-shrink-0" />
          {!sidebarCollapsed && <span>Settings</span>}
        </button>

        <button
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="no-drag flex items-center gap-3 rounded-lg px-2 py-2 text-sm
            text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))]
            hover:text-[rgb(var(--color-text-primary))] transition-colors cursor-default select-none"
        >
          {sidebarCollapsed ? <ChevronRight size={18} className="flex-shrink-0" /> : <ChevronLeft size={18} className="flex-shrink-0" />}
          {!sidebarCollapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
