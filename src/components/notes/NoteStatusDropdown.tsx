import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { Check, ChevronDown, CircleDashed } from 'lucide-react'
import { NOTE_STATUSES, noteStatusMeta } from '@/lib/noteStatus'
import type { NoteStatus } from '@/types'

// Status picker for a single note — used both in the note editor header (while writing) and
// as a section inside NoteContextMenu (right-click from the list), per the user's request for
// both entry points. `value` is undefined/null for "no status" (the default for new notes).
export default function NoteStatusDropdown({
  value, onChange, compact = false,
}: {
  value: NoteStatus | null | undefined
  onChange: (v: NoteStatus | null) => void
  /** Icon-only trigger (editor header) vs a labeled row (context menu). */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const current = noteStatusMeta(value)
  const CurrentIcon = current?.icon ?? CircleDashed

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        {compact ? (
          <button
            title={current ? `Status: ${current.label}` : 'Set status'}
            className={`flex items-center gap-1 px-1.5 py-1 rounded-shell text-[10px] font-medium transition-colors cursor-pointer flex-shrink-0 ${
              open
                ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
                : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-secondary))]'
            }`}
          >
            <CurrentIcon size={11} style={current ? { color: current.color } : undefined} />
            {current && <span>{current.label}</span>}
            <ChevronDown size={9} className="opacity-60" />
          </button>
        ) : (
          <button className="w-full flex items-center gap-2 rounded-shell px-2 py-1.5 cursor-pointer text-left hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">
            <CurrentIcon size={13} style={current ? { color: current.color } : undefined} />
            <span className="flex-1 text-xs">{current ? current.label : 'Set status'}</span>
            <ChevronDown size={10} className="opacity-60" />
          </button>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50 w-44 rounded-shell-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl p-1"
        >
          <div className="text-[10px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide px-2 pt-1 pb-1.5">Status</div>
          <button
            onClick={() => { onChange(null); setOpen(false) }}
            className={`w-full flex items-center gap-2 rounded-shell px-2 py-1.5 cursor-pointer text-left
              ${!value
                ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                : 'hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]'
              }`}
          >
            <CircleDashed size={13} className="flex-shrink-0 opacity-60" />
            <span className="flex-1 text-xs">No status</span>
            {!value && <Check size={11} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
          </button>
          {NOTE_STATUSES.map((s) => {
            const Icon = s.icon
            return (
              <button
                key={s.id}
                onClick={() => { onChange(s.id); setOpen(false) }}
                className={`w-full flex items-center gap-2 rounded-shell px-2 py-1.5 cursor-pointer text-left
                  ${value === s.id
                    ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                    : 'hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]'
                  }`}
              >
                <Icon size={13} className="flex-shrink-0" style={{ color: s.color }} />
                <span className="flex-1 text-xs">{s.label}</span>
                {value === s.id && <Check size={11} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
              </button>
            )
          })}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
