import React, { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronLeft, type LucideIcon } from 'lucide-react'
import { useLongPress } from './useLongPress'
import { haptic } from './haptics'

/**
 * A full-height page with a safe-area-aware header (title, optional back, right-side actions)
 * and a scrolling body. Every mobile page uses it, so headers line up and VoiceOver gets a
 * consistent landmark structure.
 *
 * Header chrome (TEST 2026-09-29, "Apple Notes, but for Bible study"):
 *  - `bar` (default): in-flow material bar.
 *  - `glass`: the bar floats OVER the body as translucent material and the body scrolls beneath
 *    it (Notes home, lists) — the body is padded by the measured header height.
 *  - `floating`: no bar at all, only floating glass controls over the content (note editor).
 * Back is always a floating glass circle with a chevron (never a text link); `backLabel` is its
 * accessible name.
 */
export type PageHeaderChrome = 'bar' | 'glass' | 'floating'

// Pages currently showing a back button. While any is mounted, global leading controls (the
// tab-type grid) step aside so Back owns the leading edge, as in every iOS navigation bar.
let backPages = 0
const backListeners = new Set<() => void>()
function setBackPages(delta: number) { backPages += delta; backListeners.forEach((l) => l()) }
export function useAnyPageHasBack(): boolean {
  return useSyncExternalStore((l) => { backListeners.add(l); return () => { backListeners.delete(l) } }, () => backPages > 0, () => false)
}

export function Page({ title, onBack, backLabel, right, left, children, bodyClassName, noScroll, headerBelow, className, header: headerProp, bodyRef }: {
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
  header?: PageHeaderChrome
  /** The scrolling body element (e.g. for scroll-driven title reveal). */
  bodyRef?: React.Ref<HTMLDivElement>
}) {
  const hasBack = !!onBack
  useLayoutEffect(() => { if (!hasBack) return; setBackPages(1); return () => setBackPages(-1) }, [hasBack])

  // Default (TEST 2026-10-03 Apple-style pass): every page that scrolls gets the translucent overlay
  // bar (content scrolls under it, like iOS Settings / Notes); a page that manages its own scrolling
  // keeps the in-flow bar so nothing renders beneath it.
  const header: PageHeaderChrome = headerProp ?? (noScroll ? 'bar' : 'glass')
  const headerRef = useRef<HTMLElement | null>(null)
  const [headerH, setHeaderH] = useState(0)
  const overlay = header !== 'bar'
  // An overlaid header's real height (safe area + row + headerBelow + Dynamic Type) pads the body,
  // so the first content row starts below it and scrolls under it. Measured, never assumed.
  useLayoutEffect(() => {
    const el = headerRef.current
    if (!overlay || !el) return
    const measure = () => setHeaderH(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [overlay])
  const style = overlay ? ({ '--m-page-header-h': `${headerH}px` } as React.CSSProperties) : undefined
  return (
    <div className={`mobile-page${overlay ? ` has-overlay-header is-header-${header}` : ''}${className ? ` ${className}` : ''}`} style={style}>
      <header ref={headerRef} className="mobile-page-header">
        <div className="mobile-page-header-row">
          <div className="mobile-page-header-side">
            {onBack ? <BackButton onClick={onBack} label={backLabel} /> : left}
          </div>
          <h1 className="mobile-page-title">{title}</h1>
          <div className="mobile-page-header-side is-right">{right}</div>
        </div>
        {headerBelow}
      </header>
      <div ref={bodyRef} className={`mobile-page-body${noScroll ? ' is-static' : ''} ${bodyClassName ?? ''}`}>{children}</div>
    </div>
  )
}

/** The one back control: a floating translucent circle with a chevron (iOS 26). Used by pages,
 *  sheets and pickers so every back looks and behaves the same. */
export function BackButton({ onClick, label, className }: { onClick: () => void; label?: string; className?: string }) {
  return (
    <button type="button" className={`mobile-back${className ? ` ${className}` : ''}`} onClick={() => { void haptic.navigate(); onClick() }} aria-label={label ? `Back to ${label}` : 'Back'}>
      <ChevronLeft size={24} strokeWidth={2.25} aria-hidden />
    </button>
  )
}

/** Joined header controls: ONE glass capsule holding several IconTaps (share · more, undo · redo).
 *  A single control is a circle; never wrap a lone IconTap in a group. */
export function IconGroup({ children, label }: { children: React.ReactNode; label?: string }) {
  return <span className="mobile-icon-group" role="group" aria-label={label}>{children}</span>
}

export function IconTap({ icon: Icon, label, onClick, active, disabled, onLongPress }: { icon: LucideIcon; label: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; active?: boolean; disabled?: boolean; /** e.g. Today → the calendar (SEP27-CAL-006) */ onLongPress?: () => void }) {
  const lp = useLongPress(() => onLongPress?.())
  return (
    <button type="button" className={`mobile-icon-tap${active ? ' is-active' : ''}`} aria-label={label} aria-pressed={active} onClick={(e) => { void haptic.tap(); onClick(e) }} disabled={disabled}
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
