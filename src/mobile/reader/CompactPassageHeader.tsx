import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { topCutout } from '../primitives/safeArea'

/**
 * The collapsed Scripture header (NEW-007). Scrolling down doesn't just hide the passage: it
 * becomes a compact black pill that JOINS the top cutout — on Dynamic Island iPhones the island
 * looks slightly taller with "Genesis 5 · LXX" under it; on notch iPhones the notch looks slightly
 * longer; on home-button iPhones it's a small pill under the status bar. Tapping it opens the
 * passage picker (the same thing the full title does). Hidden from VoiceOver while collapsed-out;
 * the full title stays the accessible control.
 *
 * The full passage capsule and the pill are ONE shape changing (TEST 2026-10-19 "the book chapter
 * notch and the floating book chapter should morph between each other"): while hidden, the pill
 * sits exactly where the capsule is, in the capsule's size and font (`fromRef`, measured); showing
 * it animates that shape up into the island / notch and darkens it, while the capsule itself (the
 * native glass twin, `collapseInto` = `targetRef`) shrinks along the same path and fades. Coming
 * back runs the same morph in reverse. `targetRef` is a layout-only copy of the pill at rest, so
 * the native side always knows where the pill ends up.
 */
export function CompactPassageHeader({ label, badge, visible, onOpen, fromRef, targetRef }: {
  label: string; badge?: string | null; visible: boolean; onOpen: () => void
  fromRef?: React.RefObject<HTMLElement | null>; targetRef?: React.Ref<HTMLSpanElement>
}) {
  const cutout = useMemo(() => topCutout(), [])
  useEffect(() => { document.documentElement.dataset.cutout = cutout }, [cutout])
  // The capsule's resting shape, measured while it is the one shown (the header never moves the
  // capsule: it only fades, so this is also where it is while the pill is up).
  const [from, setFrom] = useState<React.CSSProperties>({})
  useLayoutEffect(() => {
    if (visible) return
    const measure = () => {
      const el = fromRef?.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width <= 0 || r.height <= 0) return
      const next = {
        '--pill-from-top': `${Math.round(r.top)}px`, '--pill-from-h': `${Math.round(r.height)}px`,
        '--pill-from-w': `${Math.round(r.width)}px`, '--pill-from-fs': getComputedStyle(el).fontSize,
      } as React.CSSProperties
      setFrom((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [visible, label, badge, fromRef])
  const text = <span className="mobile-compact-pill-text">{label}{badge && <span className="mobile-compact-pill-badge">{badge}</span>}</span>
  return (
    <>
      {/* Keeps the status-bar band opaque while the full header is away. */}
      <div className={`mobile-compact-band${visible ? ' is-visible' : ''}`} aria-hidden />
      <button type="button" className={`mobile-compact-pill is-${cutout}${visible ? ' is-visible' : ''}`} onClick={onOpen} style={from}
        tabIndex={visible ? 0 : -1} aria-hidden={!visible} aria-label={`${label}${badge ? `, ${badge}` : ''}. Go to a passage`}>
        {text}
      </button>
      {/* The pill at rest, for measuring only (never seen, never hit, not in the accessibility tree). */}
      {targetRef && <span ref={targetRef} className={`mobile-compact-pill is-${cutout} is-measure`} aria-hidden>{text}</span>}
    </>
  )
}
