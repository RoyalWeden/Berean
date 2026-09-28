import React from 'react'
import { ChevronLeft, type LucideIcon } from 'lucide-react'
import { useLongPress } from './useLongPress'

/**
 * A full-height page with a safe-area-aware header (title, optional back, right-side actions)
 * and a scrolling body. Every mobile page uses it, so headers line up and VoiceOver gets a
 * consistent landmark structure.
 */
export function Page({ title, onBack, backLabel, right, left, children, bodyClassName, noScroll, headerBelow, className }: {
  title?: React.ReactNode
  onBack?: () => void
  backLabel?: string
  right?: React.ReactNode
  left?: React.ReactNode
  children: React.ReactNode
  bodyClassName?: string
  /** The body manages its own scrolling (pager, editor). */
  noScroll?: boolean
  /** Extra row rendered under the title bar (search field, segmented control). */
  headerBelow?: React.ReactNode
  /** Extra classes on the page root (e.g. the reader's overlay header). */
  className?: string
}) {
  return (
    <div className={`mobile-page${className ? ` ${className}` : ''}`}>
      <header className="mobile-page-header">
        <div className="mobile-page-header-row">
          <div className="mobile-page-header-side">
            {onBack ? (
              <button type="button" className="mobile-back" onClick={onBack} aria-label={backLabel ?? 'Back'}>
                <ChevronLeft size={26} aria-hidden />
                {backLabel && <span>{backLabel}</span>}
              </button>
            ) : left}
          </div>
          <h1 className="mobile-page-title">{title}</h1>
          <div className="mobile-page-header-side is-right">{right}</div>
        </div>
        {headerBelow}
      </header>
      <div className={`mobile-page-body${noScroll ? ' is-static' : ''} ${bodyClassName ?? ''}`}>{children}</div>
    </div>
  )
}

export function IconTap({ icon: Icon, label, onClick, active, disabled, onLongPress }: { icon: LucideIcon; label: string; onClick: () => void; active?: boolean; disabled?: boolean; /** e.g. Today → the calendar (SEP27-CAL-006) */ onLongPress?: () => void }) {
  const lp = useLongPress(() => onLongPress?.())
  return (
    <button type="button" className={`mobile-icon-tap${active ? ' is-active' : ''}`} aria-label={label} aria-pressed={active} onClick={onClick} disabled={disabled}
      {...(onLongPress ? lp : {})}>
      <Icon size={22} aria-hidden />
    </button>
  )
}

export function ListSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <section className="mobile-list-section">
      {title && <h2 className="mobile-list-section-title">{title}</h2>}
      <div className="mobile-list-group">{children}</div>
    </section>
  )
}

export function Row({ title, subtitle, right, onClick, leading, chevron, destructive }: {
  title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; onClick?: () => void
  leading?: React.ReactNode; chevron?: boolean; destructive?: boolean
}) {
  const inner = (
    <>
      {leading && <span className="mobile-row-leading">{leading}</span>}
      <span className="mobile-row-text">
        <span className="mobile-row-title">{title}</span>
        {subtitle && <span className="mobile-row-subtitle">{subtitle}</span>}
      </span>
      {right && <span className="mobile-row-right">{right}</span>}
      {chevron && <span className="mobile-row-chevron" aria-hidden>›</span>}
    </>
  )
  return onClick
    ? <button type="button" className={`mobile-row${destructive ? ' is-destructive' : ''}`} onClick={onClick}>{inner}</button>
    : <div className="mobile-row">{inner}</div>
}
