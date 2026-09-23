import React, { useReducer } from 'react'
import { ChevronRight } from 'lucide-react'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { Segmented, Stepper, Toggle } from '../settings/SettingsControls'
import type { CaretCommand, CaretScope } from './caretRegistry'

/**
 * The caret sheet (TEST-033/034): the commands of whatever is on screen, structured as
 *   heading (what it acts on) → a row of large TILES for the most frequent actions (Arc-style,
 *   S2 screenshot) → titled GROUPS of rows with inline controls (toggles, steppers, segmented).
 * Rows that open something close the caret; inline controls keep it open so several reading
 * settings can be adjusted in one go. No low detent (brief §16).
 */
export function CaretSheet({ scope, api }: { scope: () => CaretScope; api: SheetApi }) {
  // Inline controls mutate the store; re-read the scope after each so values stay current.
  const [, bump] = useReducer((n: number) => n + 1, 0)
  const s = scope()
  const act = (c: Extract<CaretCommand, { kind: 'action' }>) => () => {
    if (c.disabled) return
    void haptic.light()
    if (!c.keepOpen) api.close()
    c.run()
    if (c.keepOpen) bump()
  }
  return (
    <div className="mobile-caret">
      <div className="mobile-caret-head">
        <div className="mobile-caret-title">{s.title}</div>
        {s.subtitle && <div className="mobile-caret-subtitle">{s.subtitle}</div>}
      </div>
      {s.sections.map((sec) => sec.style === 'tiles' ? (
        <div key={sec.id} className="mobile-caret-tiles" role="group" aria-label={sec.title ?? 'Quick actions'}>
          {sec.commands.map((c) => {
            const Icon = c.icon
            if (c.kind === 'toggle') {
              return (
                <button key={c.id} type="button" className={`mobile-caret-tile${c.value ? ' is-on' : ''}`} aria-pressed={c.value}
                  onClick={() => { void haptic.selection(); c.set(!c.value); bump() }}>
                  {Icon && <Icon size={22} aria-hidden />}<span>{c.label}</span>
                </button>
              )
            }
            if (c.kind !== 'action') return null
            return (
              <button key={c.id} type="button" className="mobile-caret-tile" disabled={c.disabled} onClick={act(c)}>
                {Icon && <Icon size={22} aria-hidden />}<span>{c.label}</span>{c.detail && <small>{c.detail}</small>}
              </button>
            )
          })}
        </div>
      ) : (
        <section key={sec.id} className="mobile-caret-group" aria-label={sec.title}>
          {sec.title && <h3 className="mobile-caret-group-title">{sec.title}</h3>}
          <div className="mobile-caret-group-body">
            {sec.commands.map((c) => <CaretRow key={c.id} c={c} onAction={act} onChanged={bump} />)}
          </div>
        </section>
      ))}
    </div>
  )
}

function CaretRow({ c, onAction, onChanged }: { c: CaretCommand; onAction: (c: Extract<CaretCommand, { kind: 'action' }>) => () => void; onChanged: () => void }) {
  const Icon = c.icon
  const lead = Icon ? <Icon size={20} aria-hidden className="mobile-caret-row-icon" /> : null
  if (c.kind === 'action') {
    return (
      <button type="button" className={`mobile-caret-row${c.destructive ? ' is-destructive' : ''}`} disabled={c.disabled} onClick={onAction(c)}>
        {lead}<span className="mobile-caret-row-label">{c.label}{c.detail && <small>{c.detail}</small>}</span>
        {!c.keepOpen && <ChevronRight size={16} aria-hidden className="mobile-caret-row-chevron" />}
      </button>
    )
  }
  if (c.kind === 'toggle') {
    return (
      <div className="mobile-caret-row">
        {lead}<span className="mobile-caret-row-label">{c.label}{c.detail && <small>{c.detail}</small>}</span>
        <Toggle checked={c.value} onChange={(v) => { c.set(v); onChanged() }} label={c.label} />
      </div>
    )
  }
  if (c.kind === 'stepper') {
    return (
      <div className="mobile-caret-row">
        {lead}<span className="mobile-caret-row-label">{c.label}</span>
        <Stepper value={c.value} min={c.min} max={c.max} label={c.unit} onChange={(v) => { c.set(v); onChanged() }} />
      </div>
    )
  }
  return (
    <div className="mobile-caret-row is-stacked">
      <span className="mobile-caret-row-label">{lead}{c.label}</span>
      <Segmented value={c.value} options={c.options} onChange={(v) => { c.set(v); onChanged() }} />
    </div>
  )
}
