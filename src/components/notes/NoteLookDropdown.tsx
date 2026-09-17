import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { Type, ChevronDown } from 'lucide-react'
import { Button, PopoverSurface, MenuItem, MenuLabel } from '@/components/ui'

export interface NoteLook {
  value: string
  label: string
  sample: string // shown in the trigger + list, previews the look's own font
}

// Curated "looks" for the note editor while typing — see pmEditor.css's
// .pm-look-* rules for what each actually changes (font/line-height/spacing).
// Kept short and named (not a raw font list — that's the fuller picker
// already in Settings → Display) since this is meant as a quick, occasional
// pick next to the Edit/View toggle, not a settings deep-dive.
export const NOTE_LOOKS: NoteLook[] = [
  { value: 'default',     label: 'Default',     sample: 'ui-sans-serif' },
  { value: 'manuscript',  label: 'Manuscript',  sample: 'Georgia, serif' },
  { value: 'typewriter',  label: 'Typewriter',  sample: 'ui-monospace' },
  { value: 'compact',     label: 'Compact',     sample: 'ui-sans-serif' },
]

export default function NoteLookDropdown({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = NOTE_LOOKS.find((l) => l.value === value) ?? NOTE_LOOKS[0]

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          size="sm"
          icon={ChevronDown}
          iconTrailing
          title="Note look while typing"
          className={open ? 'bg-surface-hover text-text-primary' : ''}
        >
          <Type size={11} />
        </Button>
      </Popover.Trigger>
      <PopoverSurface side="bottom" align="end" innerClassName="w-40 p-1">
        <MenuLabel>Note look</MenuLabel>
        {NOTE_LOOKS.map((look) => (
          <MenuItem
            key={look.value}
            active={look.value === current.value}
            onClick={() => { onChange(look.value); setOpen(false) }}
            label={<span style={{ fontFamily: look.sample }}>{look.label}</span>}
          />
        ))}
      </PopoverSurface>
    </Popover.Root>
  )
}
