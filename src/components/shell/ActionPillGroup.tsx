import type { ReactNode } from 'react'

/**
 * Joined capsule cluster of independent actions (back/forward/history, prev/pick/next) with
 * hairline dividers. The group carries the interactive-glass material; children are usually
 * `IconButton`s and are forced square-cornered and un-scaled on press so the capsule stays whole.
 * For mutually-exclusive selection use SegmentedControl instead.
 */
interface Props {
  children: ReactNode
  className?: string
  align?: 'center' | 'stretch'
}

export default function ActionPillGroup({ children, className = '', align = 'center' }: Props) {
  return (
    <div
      // action-pill-group: a stable marker some CSS targets directly (see global.css history).
      className={`action-pill-group no-drag control-glass flex ${align === 'stretch' ? 'items-stretch' : 'items-center'} rounded-control overflow-hidden flex-shrink-0 [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-separator [&>*]:rounded-none [&>*]:border-0 [&>*]:shadow-none [&>*]:bg-transparent [&>*:hover]:bg-control-hover [&>*:active]:bg-control-pressed [&>*:active]:scale-100 ${className}`}
    >
      {children}
    </div>
  )
}
