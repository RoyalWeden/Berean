import * as Popover from '@radix-ui/react-popover'
import { useState } from 'react'
import { Type, Check, ChevronDown } from 'lucide-react'

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
        <button
          title="Note look while typing"
          className={`flex items-center gap-1 px-1.5 py-1 rounded-shell text-[10px] font-medium transition-colors cursor-pointer flex-shrink-0 ${
            open
              ? 'bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]'
              : 'text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-secondary))]'
          }`}
        >
          <Type size={11} />
          <ChevronDown size={9} className="opacity-60" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className="z-50 w-40 rounded-shell-lg bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl p-1"
        >
          <div className="text-[10px] text-[rgb(var(--color-text-muted))] uppercase tracking-wide px-2 pt-1 pb-1.5">Note look</div>
          {NOTE_LOOKS.map((look) => (
            <button
              key={look.value}
              onClick={() => { onChange(look.value); setOpen(false) }}
              className={`w-full flex items-center gap-2 rounded-shell px-2 py-1.5 cursor-pointer text-left
                ${look.value === current.value
                  ? 'bg-[rgb(var(--color-accent))/15] text-[rgb(var(--color-accent))]'
                  : 'hover:bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]'
                }`}
            >
              <span className="flex-1 text-xs" style={{ fontFamily: look.sample }}>{look.label}</span>
              {look.value === current.value && <Check size={11} className="flex-shrink-0 text-[rgb(var(--color-accent))]" />}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
