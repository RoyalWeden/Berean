import React from 'react'
import { Check, type LucideIcon } from 'lucide-react'
import { useSheets, type SheetApi, type SheetSubView } from './Sheet'
import { haptic } from './haptics'

export interface SheetAction {
  id: string
  label: string
  icon?: LucideIcon
  destructive?: boolean
  disabled?: boolean
  onSelect: () => void
}

/** iOS-style action list inside a bottom sheet (verse long-press, tab actions, note actions). */
export function ActionList({ title, actions, close }: { title?: string; actions: SheetAction[]; close: () => void }) {
  return (
    <div className="mobile-action-list">
      {title && <div className="mobile-action-title">{title}</div>}
      {actions.map((a) => (
        <button
          key={a.id}
          type="button"
          className={`mobile-action-row${a.destructive ? ' is-destructive' : ''}`}
          disabled={a.disabled}
          onClick={() => { void haptic.light(); close(); a.onSelect() }}
        >
          {a.icon && <a.icon size={20} aria-hidden />}
          <span>{a.label}</span>
        </button>
      ))}
    </div>
  )
}

/** The same action list as a sub-view of an ALREADY-OPEN sheet (T23-006): it replaces the sheet's
 *  content with "‹ <parent>" at the top instead of stacking a second sheet. Choosing an action
 *  closes the whole sheet unless the action sets `stay` (then it pops back). */
export function actionListView(key: string, title: string, actions: Array<SheetAction & { stay?: boolean }>): SheetSubView {
  return {
    key, title,
    render: (api) => (
      <div className="mobile-action-list">
        {actions.map((a) => (
          <button key={a.id} type="button" className={`mobile-action-row${a.destructive ? ' is-destructive' : ''}`} disabled={a.disabled}
            onClick={() => { void haptic.light(); if (a.stay) api.pop(); else api.close(); a.onSelect() }}>
            {a.icon && <a.icon size={20} aria-hidden />}
            <span>{a.label}</span>
          </button>
        ))}
      </div>
    ),
  }
}

export interface ChoiceOption { id: string; label: string; detail?: string; disabled?: boolean; style?: React.CSSProperties }

/** A single-choice list with a check on the current value — the body of choice sub-views such as
 *  All Translations. Selecting pops back to the parent view (the sheet stays open) unless
 *  `closeOnSelect`. */
export function ChoiceList({ options, value, onSelect, api, closeOnSelect }: { options: ChoiceOption[]; value: string; onSelect: (id: string) => void; api: SheetApi; closeOnSelect?: boolean }) {
  return (
    <div className="mobile-choice-list" role="radiogroup">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} disabled={o.disabled}
          className={`mobile-choice-row${o.id === value ? ' is-on' : ''}`}
          onClick={() => { void haptic.selection(); onSelect(o.id); if (closeOnSelect) api.close(); else api.pop() }}>
          <span className="mobile-choice-label" style={o.style}>{o.label}{o.detail && <small>{o.detail}</small>}</span>
          {o.id === value && <Check size={18} aria-hidden className="mobile-choice-check" />}
        </button>
      ))}
    </div>
  )
}

export function useActionSheet() {
  const sheets = useSheets()
  return (id: string, title: string | undefined, actions: SheetAction[]) => {
    const h = Math.min(0.92, 0.12 + actions.length * 0.075 + (title ? 0.05 : 0))
    sheets.open({ id, title: undefined, detents: [h], render: (api) => <ActionList title={title} actions={actions} close={api.close} /> })
  }
}

export { type LucideIcon }
export const noop: React.FC = () => null
