import {
  Heading1, Heading2, Heading3, List, ListOrdered, CheckSquare, Quote, Code, Table2, Minus, Type,
  type LucideIcon,
} from 'lucide-react'
import type { Note } from '@/types'
import type { SlashCommand } from './slashCommands'
import { CALLOUT_META } from '@/lib/noteTextBlocks'

const SLASH_ICONS: Record<string, LucideIcon> = {
  text: Type, h1: Heading1, h2: Heading2, h3: Heading3,
  bullet: List, numbered: ListOrdered, task: CheckSquare, quote: Quote,
  code: Code, table: Table2, divider: Minus,
}

// Same visual treatment as NoteEditor.tsx's strongsSuggest/verseSuggest/
// backlinkInfo popups (NoteEditor.tsx:3944-4036) — small floating cards for
// the block-suggest popups, a two-pane list+preview for the wikilink
// autocomplete popup.

export function StrongsSuggestPopup({
  num, x, y, onInsert, onDismiss,
}: { num: string; x: number; y: number; onInsert: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
      className="flex items-center gap-2 px-2.5 py-1.5 shadow-xl rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="text-[10px] font-mono font-semibold text-[rgb(var(--color-accent))]">{num}</span>
      <button
        className="text-[10px] text-[rgb(var(--color-text-primary))] hover:text-[rgb(var(--color-accent))] cursor-pointer transition-colors font-medium flex items-center gap-1"
        onMouseDown={onInsert}
      >
        Insert Strong&apos;s block
        <kbd className="font-mono text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded ml-0.5">↵</kbd>
      </button>
      <button
        className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
        onMouseDown={onDismiss}
        title="Dismiss (Esc)"
      >
        ✕
      </button>
    </div>
  )
}

export function VerseSuggestPopup({
  refText, x, y, onInsert, onDismiss,
}: { refText: string; x: number; y: number; onInsert: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
      className="flex items-center gap-2 px-2.5 py-1.5 shadow-xl rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="text-[10px] font-mono font-semibold text-[rgb(var(--color-accent))]">{refText}</span>
      <button
        className="text-[10px] text-[rgb(var(--color-text-primary))] hover:text-[rgb(var(--color-accent))] cursor-pointer transition-colors font-medium flex items-center gap-1"
        onMouseDown={onInsert}
      >
        Insert scripture block
        <kbd className="font-mono text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))] px-1 py-0.5 rounded ml-0.5">↵</kbd>
      </button>
      <button
        className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors"
        onMouseDown={onDismiss}
        title="Dismiss (Esc)"
      >
        ✕
      </button>
    </div>
  )
}

export function WikilinkPopup({
  notes, x, y, activeIdx, onHoverIdx, onInsert,
}: { notes: Note[]; x: number; y: number; activeIdx: number; onHoverIdx: (i: number) => void; onInsert: (note: Note) => void }) {
  if (notes.length === 0) return null
  const active = notes[activeIdx] ?? notes[0]
  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
      className="flex shadow-2xl border border-[rgb(var(--color-surface-4))] rounded-lg overflow-hidden"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="w-56 max-h-64 overflow-y-auto bg-[rgb(var(--color-surface-1))] py-1 flex-shrink-0">
        {notes.map((note, i) => (
          <button
            key={note.id}
            onMouseDown={() => onInsert(note)}
            onMouseEnter={() => onHoverIdx(i)}
            className={`w-full text-left px-3 py-2 text-sm cursor-pointer transition-colors flex items-center gap-2 ${
              i === activeIdx
                ? 'bg-[rgb(var(--color-accent))]/20 text-[rgb(var(--color-text-primary))] border-l-2 border-[rgb(var(--color-accent))]'
                : 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] border-l-2 border-transparent'
            }`}
          >
            <span className="truncate">{note.title || 'Untitled'}</span>
          </button>
        ))}
      </div>
      {active && (
        <div className="w-64 max-h-64 overflow-y-auto bg-[rgb(var(--color-surface-2))] border-l border-[rgb(var(--color-surface-4))] p-3 flex-shrink-0">
          <p className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))] mb-1.5 truncate">
            {active.title || 'Untitled'}
          </p>
          {active.verseRef && (
            <p className="text-[9px] text-[rgb(var(--color-accent))] mb-1.5 font-mono">{active.verseRef}</p>
          )}
          <p className="text-[10px] text-[rgb(var(--color-text-secondary))] leading-relaxed whitespace-pre-wrap line-clamp-[10] break-words">
            {(active.content || '')
              .replace(/^---[\s\S]*?---\n?/, '')
              .replace(/#{1,6}\s/g, '')
              .replace(/[*_`~]/g, '')
              .replace(/\[\[([^\]]+)\]\]/g, '$1')
              .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
              .trim()
              .slice(0, 400) || 'No content'}
          </p>
        </div>
      )}
    </div>
  )
}

export function SlashCommandPopup({
  commands, x, y, activeIdx, onHoverIdx, onSelect,
}: { commands: SlashCommand[]; x: number; y: number; activeIdx: number; onHoverIdx: (i: number) => void; onSelect: (cmd: SlashCommand) => void }) {
  if (commands.length === 0) return null
  const groups: { group: SlashCommand['group']; items: { cmd: SlashCommand; idx: number }[] }[] = []
  commands.forEach((cmd, idx) => {
    let g = groups.find((g) => g.group === cmd.group)
    if (!g) { g = { group: cmd.group, items: [] }; groups.push(g) }
    g.items.push({ cmd, idx })
  })
  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
      className="w-64 max-h-80 overflow-y-auto shadow-2xl border border-[rgb(var(--color-surface-4))] rounded-lg bg-[rgb(var(--color-surface-1))] py-1"
      onMouseDown={(e) => e.preventDefault()}
    >
      {groups.map(({ group, items }) => (
        <div key={group}>
          <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">{group}</div>
          {items.map(({ cmd, idx }) => {
            const Icon = SLASH_ICONS[cmd.id]
            const calloutEmoji = cmd.id.startsWith('callout-') ? CALLOUT_META[cmd.id.replace('callout-', '').toUpperCase()]?.icon : null
            return (
              <button
                key={cmd.id}
                onMouseDown={() => onSelect(cmd)}
                onMouseEnter={() => onHoverIdx(idx)}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2.5 border-l-2 ${
                  idx === activeIdx
                    ? 'bg-[rgb(var(--color-accent))]/15 border-l-[rgb(var(--color-accent))] text-[rgb(var(--color-text-primary))]'
                    : 'border-l-transparent text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))]'
                }`}
              >
                <span className="w-6 h-6 flex-shrink-0 rounded flex items-center justify-center bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))]">
                  {Icon ? <Icon size={13} /> : <span className="text-xs">{calloutEmoji}</span>}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-[rgb(var(--color-text-primary))]">{cmd.label}</span>
                  <span className="block truncate text-[10px] text-[rgb(var(--color-text-muted))]">{cmd.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
