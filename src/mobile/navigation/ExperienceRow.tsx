import React from 'react'
import { MoreHorizontal } from 'lucide-react'
import { haptic } from '../primitives/haptics'
import { EXPERIENCES, runExperience, type ExperienceId } from './experiences'
import './experiences.css'

/**
 * The compact "Go to" row of major experiences (TEST25-NAV-001): icon + name tiles. The caret's
 * field (target 'current-tab') changes THIS tab; the plus sheet ('new-tab') opens a new tab.
 * Labels are just the name ("Notes", "Settings") — what happens is said by the surface and by
 * VoiceOver ("Change this tab to Notes" / "New Notes tab").
 */
export function ExperienceRow({ items, target, onDone, onMore, label }: {
  items: ExperienceId[]
  target: 'current-tab' | 'new-tab'
  /** Runs before the destination (close the sheet). */
  onDone?: () => void
  /** Plus sheet: a trailing More tile. */
  onMore?: () => void
  label?: string
}) {
  const go = (id: ExperienceId) => { void haptic.light(); onDone?.(); runExperience(id, target) }
  return (
    <div className="m-exp-row" role="group" aria-label={label ?? (target === 'current-tab' ? 'Change this tab to' : 'New tab')}>
      {items.map((id) => {
        const e = EXPERIENCES[id]
        const spoken = target === 'current-tab' ? `Change this tab to ${e.label}` : id === 'today' ? "Today's daily note" : `New ${e.label} tab`
        return (
          <button key={id} type="button" className="m-exp-tile" onClick={() => go(id)} aria-label={spoken}>
            <e.icon size={21} aria-hidden />
            <span aria-hidden>{e.label}</span>
          </button>
        )
      })}
      {onMore && (
        <button type="button" className="m-exp-tile is-more" onClick={() => { void haptic.light(); onMore() }} aria-label="More — study trail, tags, queue, PDFs, sessions">
          <MoreHorizontal size={21} aria-hidden />
          <span aria-hidden>More</span>
        </button>
      )}
    </div>
  )
}
