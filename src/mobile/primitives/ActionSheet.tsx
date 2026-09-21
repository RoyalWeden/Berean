import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { useSheets } from './Sheet'
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

export function useActionSheet() {
  const sheets = useSheets()
  return (id: string, title: string | undefined, actions: SheetAction[]) => {
    const h = Math.min(0.92, 0.12 + actions.length * 0.075 + (title ? 0.05 : 0))
    sheets.open({ id, title: undefined, detents: [h], render: (api) => <ActionList title={title} actions={actions} close={api.close} /> })
  }
}

export { type LucideIcon }
export const noop: React.FC = () => null
