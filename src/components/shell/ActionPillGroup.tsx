import type { ReactNode } from 'react'

/**
 * Shared "joined action pill" wrapper — a capsule cluster with hairline dividers between
 * children (all but the last). SidebarTopBar.tsx's back/forward/history nav and BiblePanel.tsx's
 * chapter-nav prev/pick/next each independently invented their own version of this (different
 * radius, different divider mechanism) before being unified onto this one. For grouping
 * independent actions — not mutually-exclusive selection, which is SegmentedControl's job.
 * Children are typically `IconButton`s with `className="rounded-none"` so the capsule is the
 * group's, not each button's.
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
      // action-pill-group: a stable marker PanelHeader.tsx's floating-header CSS (global.css)
      // targets directly, rather than guessing at this component's Tailwind utility classes —
      // see that rule's own comment for why it needs to single this component out specifically.
      className={`action-pill-group no-drag flex ${align === 'stretch' ? 'items-stretch' : 'items-center'} rounded-control border border-border bg-surface-4/25 overflow-hidden flex-shrink-0 [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-separator [&>*]:rounded-none ${className}`}
    >
      {children}
    </div>
  )
}
