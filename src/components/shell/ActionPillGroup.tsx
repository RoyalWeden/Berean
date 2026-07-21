import type { ReactNode } from 'react'

/**
 * Shared "joined action pill" wrapper — bordered, rounded, with a hairline divider between
 * children (all but the last). SidebarTopBar.tsx's back/forward/history nav and BiblePanel.tsx's
 * chapter-nav prev/pick/next each independently invented their own version of this (different
 * radius, different divider mechanism) before being unified onto this one. For grouping
 * independent actions — not mutually-exclusive selection, which is HeaderSegmentedToggle.tsx's job.
 */
interface Props {
  children: ReactNode
  className?: string
  // A real prop, not a className string to override `items-center` with — Tailwind utility
  // classes at equal specificity resolve by stylesheet generation order, not by position in a
  // className string, so appending "items-stretch" after this component's own "items-center"
  // would NOT reliably win without something like tailwind-merge (not used in this codebase).
  align?: 'center' | 'stretch'
}

export default function ActionPillGroup({ children, className = '', align = 'center' }: Props) {
  return (
    <div
      className={`no-drag flex ${align === 'stretch' ? 'items-stretch' : 'items-center'} rounded-shell border border-[rgb(var(--color-surface-4))] overflow-hidden flex-shrink-0 [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-[rgb(var(--color-surface-4))] ${className}`}
    >
      {children}
    </div>
  )
}
