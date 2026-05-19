import { X, BookOpen, FileText, BookMarked, Youtube, Search } from 'lucide-react'
import type { Tab, SpaceId, TabType } from '@/types'

const TAB_ICONS: Record<TabType, React.ComponentType<{ size?: number; className?: string }>> = {
  bible: BookOpen,
  note: FileText,
  lexicon: BookMarked,
  youtube: Youtube,
  search: Search
}

interface TabBarProps {
  tabs: Tab[]
  activeTabId: string | null
  spaceId: SpaceId
  onTabClick: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

export default function TabBar({ tabs, activeTabId, onTabClick, onTabClose }: TabBarProps) {
  if (tabs.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-[rgb(var(--color-text-muted))]">
        No open tabs
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {tabs.map((tab) => {
        const Icon = TAB_ICONS[tab.type]
        const isActive = tab.id === activeTabId

        return (
          <div
            key={tab.id}
            className={`
              group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm
              cursor-default select-none transition-colors duration-100
              ${isActive
                ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
              }
            `}
          >
            <button
              onClick={() => onTabClick(tab.id)}
              className="flex items-center gap-2 flex-1 min-w-0 text-left"
            >
              <Icon size={14} className="flex-shrink-0 opacity-60" />
              <span className="truncate text-xs">{tab.title}</span>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onTabClose(tab.id)
              }}
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 rounded p-0.5
                hover:bg-[rgb(var(--color-surface-4))] transition-opacity"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
