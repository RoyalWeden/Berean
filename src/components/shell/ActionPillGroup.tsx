import type { ReactNode } from 'react'

/**
 * Joined capsule cluster of independent actions (back/forward/history, prev/pick/next) with
 * hairline dividers. The group carries the interactive-glass material; children are usually
 * `IconButton`s and are forced square-cornered and un-scaled on press so the capsule stays whole.
 * For mutually-exclusive selection use SegmentedControl instead.
 *
 * Every override below is `!important`: this group asserts a strict visual contract on its
 * children (flat, borderless, transparent-until-hovered, no radius of their own) regardless of
 * whatever look each child normally carries — an IconButton's own `rounded-control`/
 * `shadow-control`/`bg-*` classes have the SAME Tailwind specificity as these `[&>*]:` overrides,
 * so without `!important` the winner depends on Tailwind's internal utility generation order,
 * not on which rule is "supposed" to apply. That's exactly how this used to silently misbehave —
 * children reverted to their own rounded/shadowed look the moment a state (hover, selected)
 * added its own competing class — most visibly a chevron button's hover fill rendering as a
 * stray rounded pill inside its square segment instead of filling the segment flush.
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
      className={`action-pill-group no-drag control-glass flex ${align === 'stretch' ? 'items-stretch' : 'items-center'} rounded-control overflow-hidden flex-shrink-0 [&>*:not(:last-child)]:border-r [&>*:not(:last-child)]:border-separator [&>*]:!rounded-none [&>*]:!border-0 [&>*]:!shadow-none [&>*]:!bg-transparent [&>*:hover]:!bg-control-hover [&>*:active]:!bg-control-pressed [&>*:active]:!scale-100 ${className}`}
    >
      {children}
    </div>
  )
}
