import React, { useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Segmented / Stepper / Toggle live here (a leaf module, no imports from SettingsPage.tsx) so
 * every settings sub-page can import them without a circular dependency back through
 * SettingsPage.tsx. SettingsPage.tsx re-exports all three so `mobile/reader/ReaderOptionsSheet.tsx`
 * (outside Lane A's ownership) keeps working unchanged against its existing
 * `from '../settings/SettingsPage'` import.
 */
/** iOS segmented control. `full`: one unified control across the available width, every segment
 *  an equal, fully tappable share (SEP27-XREF-001 — e.g. TSK/e · Classic · My Notes). */
export function Segmented({ value, options, onChange, full, label }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void; full?: boolean; label?: string }) {
  return (
    <div className={`mobile-segmented${full ? ' is-full' : ''}`} role="radiogroup" aria-label={label}>
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'is-on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div className="mobile-stepper">
      <button type="button" aria-label="Smaller" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span aria-live="polite">{value}{label ? ` ${label}` : ''}</span>
      <button type="button" aria-label="Larger" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`mobile-toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="mobile-toggle-knob" />
    </button>
  )
}

/** Collapsed-by-default "Advanced" section — mirrors desktop's DisclosureRow for the fine-tuning
 *  knobs that don't belong flat alongside everyday toggles (see SettingsModal.tsx's own
 *  `blockAdvancedOpen`). */
export function Disclosure({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button type="button" className={`settings-disclosure${open ? ' is-open' : ''}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {title}
        <ChevronDown size={16} aria-hidden />
      </button>
      {open && <div className="settings-advanced-body">{children}</div>}
    </div>
  )
}

/** A small numeric stepper with a non-integer step (Stepper in SettingsPage.tsx is int-only —
 *  used for TTS rate/0.25 and the auto-advance pause/0.5). */
export function RateStepper({ value, min, max, step, format, onChange }: {
  value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  return (
    <div className="settings-rate-row">
      <button type="button" aria-label="Decrease" disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
      <span aria-live="polite">{format(value)}</span>
      <button type="button" aria-label="Increase" disabled={value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
    </div>
  )
}

export interface DangerAction {
  id: string
  title: string
  description: string
  buttonLabel: string
  onConfirm: () => Promise<void> | void
}

/** Danger-zone action, phone-appropriate: a native confirm() sheet instead of desktop's
 *  type-the-word text field (typing "biblegateway" on a software keyboard to unlock a button is
 *  awkward on a phone; a confirm() alert is the same "can't happen by accident" guarantee with a
 *  single thumb-friendly tap). Bound to the same store/window calls as DangerSection.tsx. */
export function DangerActionCard({ action }: { action: DangerAction }) {
  const [status, setStatus] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const handle = async () => {
    if (status === 'busy') return
    if (!confirm(`${action.title}\n\n${action.description}\n\nThis cannot be undone.`)) return
    setStatus('busy')
    try {
      await action.onConfirm()
      setStatus('done')
      setTimeout(() => setStatus('idle'), 2500)
    } catch {
      setStatus('error')
      setTimeout(() => setStatus('idle'), 2500)
    }
  }
  return (
    <div className="settings-danger-card">
      <div className="settings-danger-head">
        <p className="settings-danger-title">{action.title}</p>
        <p className="settings-danger-desc">{action.description}</p>
      </div>
      <div className="settings-danger-action">
        <span className="mobile-row-subtitle">{status === 'done' ? 'Done ✓' : status === 'error' ? 'Something went wrong' : ''}</span>
        <button type="button" className="settings-danger-btn" disabled={status === 'busy'} onClick={() => { void handle() }}>
          {status === 'busy' ? 'Working…' : action.buttonLabel}
        </button>
      </div>
    </div>
  )
}
