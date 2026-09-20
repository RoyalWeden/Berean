import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { ChevronDown, CircleDashed } from 'lucide-react'
import { NOTE_STATUSES, noteStatusMeta } from '@/lib/noteStatus'
import type { NoteStatus } from '@/types'
import { Button, PopoverSurface, MenuItem, MenuLabel, cx } from '@/components/ui'

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
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronDown}
            iconTrailing
            title={current ? `Status: ${current.label}` : 'Set status'}
            className={open ? 'bg-surface-hover text-text-primary' : ''}
          >
            <CurrentIcon size={11} style={current ? { color: current.color } : undefined} />
            {current && <span>{current.label}</span>}
          </Button>
        ) : (
          <MenuItem
            className={cx('text-text-secondary', open && 'bg-lift-2')}
            label={<span className="flex items-center gap-2">
              <CurrentIcon size={13} style={current ? { color: current.color } : undefined} />
              <span>{current ? current.label : 'Set status'}</span>
            </span>}
            trailing={<ChevronDown size={10} className="opacity-60" />}
          />
        )}
      </Popover.Trigger>
      <PopoverSurface side="bottom" align="end" innerClassName="w-44 p-1">
        <MenuLabel>Status</MenuLabel>
        <MenuItem
          active={!value}
          onClick={() => { onChange(null); setOpen(false) }}
          label={<span className="flex items-center gap-2"><CircleDashed size={13} className="flex-shrink-0 opacity-60" /><span>No status</span></span>}
        />
        {NOTE_STATUSES.map((s) => {
          const Icon = s.icon
          return (
            <MenuItem
              key={s.id}
              active={value === s.id}
              onClick={() => { onChange(s.id); setOpen(false) }}
              label={<span className="flex items-center gap-2"><Icon size={13} className="flex-shrink-0" style={{ color: s.color }} /><span>{s.label}</span></span>}
            />
          )
        })}
      </PopoverSurface>
    </Popover.Root>
  )
}
