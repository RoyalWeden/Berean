import React, { useEffect, useMemo } from 'react'
import { topCutout } from '../primitives/safeArea'

/**
 * The collapsed Scripture header (NEW-007). Scrolling down doesn't just hide the passage: it
 * becomes a compact black pill that JOINS the top cutout — on Dynamic Island iPhones the island
 * looks slightly taller with "Genesis 5 · LXX" under it; on notch iPhones the notch looks slightly
 * longer; on home-button iPhones it's a small pill under the status bar. Tapping it opens the
 * passage picker (the same thing the full title does). Hidden from VoiceOver while collapsed-out;
 * the full title stays the accessible control.
 */
export function CompactPassageHeader({ label, badge, visible, onOpen }: { label: string; badge?: string | null; visible: boolean; onOpen: () => void }) {
  const cutout = useMemo(() => topCutout(), [])
  useEffect(() => { document.documentElement.dataset.cutout = cutout }, [cutout])
  return (
    <>
      {/* Keeps the status-bar band opaque while the full header is away. */}
      <div className={`mobile-compact-band${visible ? ' is-visible' : ''}`} aria-hidden />
      <button type="button" className={`mobile-compact-pill is-${cutout}${visible ? ' is-visible' : ''}`} onClick={onOpen}
        tabIndex={visible ? 0 : -1} aria-hidden={!visible} aria-label={`${label}${badge ? `, ${badge}` : ''}. Go to a passage`}>
        <span className="mobile-compact-pill-text">{label}{badge && <span className="mobile-compact-pill-badge">{badge}</span>}</span>
      </button>
    </>
  )
}
