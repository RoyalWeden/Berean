import React from 'react'
import { BookOpen, NotebookPen, Search, LayoutGrid, type LucideIcon } from 'lucide-react'
import { useAppStore } from '@/store'
import type { SpaceId } from '@/types'
import { haptic } from '../primitives/haptics'

/**
 * Bottom space bar (R070/R081): the desktop sidebar's five spaces become four thumb-reachable
 * destinations — Scripture, Notes, Search, and "More" (Lexicon, YouTube, Tags, Study Trail,
 * Settings live one tap deeper). Same `activeSpace` / tab model as desktop.
 */
export type MobileDestination = 'scripture' | 'notes' | 'search' | 'more'

export function SpaceBar({ current, onSelect }: { current: MobileDestination; onSelect: (d: MobileDestination) => void }) {
  const items: Array<{ id: MobileDestination; label: string; icon: LucideIcon }> = [
    { id: 'scripture', label: 'Scripture', icon: BookOpen },
    { id: 'notes', label: 'Notes', icon: NotebookPen },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'more', label: 'More', icon: LayoutGrid },
  ]
  return (
    <nav className="mobile-space-bar" aria-label="Spaces">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          className={`mobile-space-item${current === it.id ? ' is-active' : ''}`}
          aria-current={current === it.id ? 'page' : undefined}
          onClick={() => { if (current !== it.id) void haptic.selection(); onSelect(it.id) }}
        >
          <it.icon size={24} strokeWidth={current === it.id ? 2.4 : 1.8} aria-hidden />
          <span>{it.label}</span>
        </button>
      ))}
    </nav>
  )
}

/** Maps a store space to the bar destination that hosts it. */
export function destinationForSpace(space: SpaceId): MobileDestination {
  return space === 'scripture' ? 'scripture' : space === 'notes' ? 'notes' : space === 'search' ? 'search' : 'more'
}

export function useActiveSpace(): SpaceId { return useAppStore((s) => s.activeSpace) }
