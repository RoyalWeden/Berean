import { useState, useEffect } from 'react'
import type { Note, Book } from '@/types'
import type { SlashCommand } from './slashCommands'
import { BLOCK_TYPE_META } from '@/lib/blockTypeIcons'
import { formatDottedVerseRef } from '@/lib/parseRef'
import ShortcutKeys from '@/components/shell/ShortcutKeys'
import { Select, Button, SectionLabel } from '@/components/ui'

// Slash-command icons come straight from the shared block-type config, which is keyed
// by the same ids SLASH_COMMANDS uses — so there is no local icon map to fall out of
// date any more. This replaced a hand-maintained SLASH_ICONS map that was missing
// `verse`, `image` and `columns` entirely (those three commands rendered with an empty
// icon square) and stopped at h3.

// Same visual treatment as NoteEditor.tsx's strongsSuggest/verseSuggest/
// backlinkInfo popups (NoteEditor.tsx:3944-4036) — small floating cards for
// the block-suggest popups, a two-pane list+preview for the wikilink
// autocomplete popup.
//
// Every popup in this file carries `.animate-radix-popup-in` (global.css: 140ms
// opacity+scale ease-out). Each one used to appear as a hard pop while every other
// floating surface in the app — tooltips, Radix dropdowns, HintTooltip — fades in;
// reusing the existing keyframes rather than inventing a second timing keeps them
// identical. Deliberately NOT applied to SelectionToolbar's bubble: that one measures
// its own rendered size with getBoundingClientRect to clamp itself inside the viewport,
// and an in-flight `scale()` would feed a wrong width/height into that measurement.

export function StrongsSuggestPopup({
  num, x, y, onInsert, onDismiss,
}: { num: string; x: number; y: number; onInsert: () => void; onDismiss: () => void }) {
  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 'var(--z-popover)' }}
      className="flex items-center gap-2 px-2.5 py-1.5 material-popover rounded-menu animate-radix-popup-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="text-caption2 font-mono font-semibold text-accent">{num}</span>
      <button
        className="text-caption2 text-text-primary hover:text-accent cursor-pointer transition-colors font-medium flex items-center gap-1"
        onMouseDown={onInsert}
      >
        Insert Strong&apos;s block
        <ShortcutKeys keys="↵" className="ml-0.5" />
      </button>
      <button
        className="text-caption2 text-text-muted hover:text-text-primary cursor-pointer transition-colors"
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
      style={{ position: 'fixed', left: x, top: y, zIndex: 'var(--z-popover)' }}
      className="flex items-center gap-2 px-2.5 py-1.5 material-popover rounded-menu animate-radix-popup-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="text-caption2 font-mono font-semibold text-accent">{refText}</span>
      <button
        className="text-caption2 text-text-primary hover:text-accent cursor-pointer transition-colors font-medium flex items-center gap-1"
        onMouseDown={onInsert}
      >
        Insert scripture block
        <ShortcutKeys keys="↵" className="ml-0.5" />
      </button>
      <button
        className="text-caption2 text-text-muted hover:text-text-primary cursor-pointer transition-colors"
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
      style={{ position: 'fixed', left: x, top: y, zIndex: 'var(--z-popover)' }}
      className="flex material-popover rounded-menu overflow-hidden animate-radix-popup-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="w-56 max-h-64 overflow-y-auto py-1 flex-shrink-0">
        {notes.map((note, i) => (
          <button
            key={note.id}
            onMouseDown={() => onInsert(note)}
            onMouseEnter={() => onHoverIdx(i)}
            className={`text-left mx-1 w-[calc(100%-8px)] px-2.5 py-2 rounded-row text-sm cursor-pointer transition-colors flex items-center gap-2 border-l-2 ${
              i === activeIdx
                ? 'bg-surface-selected text-text-primary border-accent'
                : 'text-text-secondary hover:bg-surface-hover border-transparent'
            }`}
          >
            <span className="truncate">{note.title || 'Untitled'}</span>
          </button>
        ))}
      </div>
      {active && (
        <div className="w-64 max-h-64 overflow-y-auto bg-surface-2/60 border-l border-separator p-3 flex-shrink-0">
          <p className="text-caption font-semibold text-text-primary mb-1.5 truncate">
            {active.title || 'Untitled'}
          </p>
          {active.verseRef && (
            <p className="text-micro text-accent mb-1.5 font-mono">{formatDottedVerseRef(active.verseRef)}</p>
          )}
          <p className="text-caption2 text-text-secondary leading-relaxed whitespace-pre-wrap line-clamp-[10] break-words">
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

// Hover-preview card for an already-inserted verse or Strong's reference in a note
// (refDecorations.ts's onVerseRefHoverStart/onLexiconRefHoverStart, 350ms delay) — the one
// inconsistency wikilinks didn't have: hovering a wikilink already showed a preview
// (WikilinkPopup above), plain verse/Strong's refs showed nothing at all despite otherwise
// matching click/right-click treatment. `pointer-events-none` deliberately — this is a passive
// preview, not an interactive popup (no insert/dismiss buttons like the ones above), so it
// should never intercept the mouseleave that's meant to dismiss it.
export function RefHoverPreview({
  x, y, refLabel, text, loading,
}: { x: number; y: number; refLabel: string; text: string; loading: boolean }) {
  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 'var(--z-popover)' }}
      className="max-w-xs px-3 py-2 material-popover rounded-menu pointer-events-none animate-radix-popup-in"
    >
      <p className="text-caption2 font-mono font-semibold text-accent mb-1">{refLabel}</p>
      <p className="text-caption text-text-secondary leading-relaxed line-clamp-6">
        {loading ? 'Loading…' : (text || 'Not found')}
      </p>
    </div>
  )
}

// Real book → chapter → verse picker for the toolbar's scripture-insert button and the
// `/verse` slash command — previously both just inserted literal placeholder text
// ("Book chapter:verse") for the user to type over, relying entirely on the verse-suggest
// autocomplete catching whatever they typed (Toolbar.tsx's own prior comment called this out
// explicitly as a known gap: "no full book/chapter/verse picker UI... doesn't exist yet").
// Cascading selects rather than a free-text search — simpler to get right than a full
// searchable picker, and the chapter/verse ranges are always in bounds by construction (each
// select's options are refetched/reclamped when the one above it changes) so there's no
// "typed an out-of-range verse" case to handle at all.
export function VersePickerPopup({
  x, y, textId, onInsert, onDismiss,
}: { x: number; y: number; textId: string; onInsert: (bookId: string, chapter: number, verse: number) => void; onDismiss: () => void }) {
  const [books, setBooks] = useState<Book[]>([])
  const [bookId, setBookId] = useState('')
  const [chapter, setChapter] = useState(1)
  const [verse, setVerse] = useState(1)
  const [verseCount, setVerseCount] = useState(1)

  useEffect(() => {
    window.bible.getBooks(textId).then((b) => { setBooks(b); if (b[0] && !bookId) setBookId(b[0].id) }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textId])

  const book = books.find((b) => b.id === bookId)

  useEffect(() => {
    if (!bookId) return
    window.bible.queryChapter(bookId, chapter, textId).then((verses) => {
      setVerseCount(Math.max(1, verses.length))
      setVerse((v) => Math.min(v, Math.max(1, verses.length)))
    }).catch(() => {})
  }, [bookId, chapter, textId])

  if (books.length === 0) return null

  return (
    <div
      style={{ position: 'fixed', left: x, top: y, zIndex: 'var(--z-menu)' }}
      className="pm-toolbar-solid material-popover rounded-menu p-2 flex flex-col gap-1.5 w-[220px] animate-radix-popup-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      <Select
        size="sm"
        value={bookId}
        onChange={(v) => { setBookId(v); setChapter(1) }}
        options={books.map((b) => ({ value: b.id, label: b.name }))}
        aria-label="Book"
      />
      <div className="flex items-center gap-1.5">
        <Select
          size="sm"
          className="flex-1 min-w-0"
          value={String(chapter)}
          onChange={(v) => setChapter(Number(v))}
          options={Array.from({ length: book?.chapters_count ?? 1 }, (_, i) => i + 1).map((c) => ({ value: String(c), label: `Ch ${c}` }))}
          aria-label="Chapter"
        />
        <Select
          size="sm"
          className="flex-1 min-w-0"
          value={String(verse)}
          onChange={(v) => setVerse(Number(v))}
          options={Array.from({ length: verseCount }, (_, i) => i + 1).map((v) => ({ value: String(v), label: `Vs ${v}` }))}
          aria-label="Verse"
        />
      </div>
      <div className="flex items-center gap-1.5 justify-end pt-0.5">
        <Button variant="ghost" size="sm" onMouseDown={onDismiss}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onMouseDown={() => onInsert(bookId, chapter, verse)}>
          Insert
        </Button>
      </div>
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
      style={{ position: 'fixed', left: x, top: y, zIndex: 'var(--z-popover)' }}
      className="w-64 max-h-80 overflow-y-auto material-popover rounded-menu py-1 animate-radix-popup-in"
      onMouseDown={(e) => e.preventDefault()}
    >
      {groups.map(({ group, items }) => (
        <div key={group}>
          <SectionLabel className="px-3 pt-2 pb-1">{group}</SectionLabel>
          {items.map(({ cmd, idx }) => {
            const Icon = BLOCK_TYPE_META[cmd.id]?.icon
            return (
              <button
                key={cmd.id}
                onMouseDown={() => onSelect(cmd)}
                onMouseEnter={() => onHoverIdx(idx)}
                className={`text-left mx-1 w-[calc(100%-8px)] px-2.5 py-1.5 rounded-row text-xs cursor-pointer transition-colors flex items-center gap-2.5 border-l-2 ${
                  idx === activeIdx
                    ? 'bg-surface-selected border-l-accent text-text-primary font-medium'
                    : 'border-l-transparent text-text-secondary hover:bg-surface-hover'
                }`}
              >
                <span className="w-6 h-6 flex-shrink-0 rounded-card flex items-center justify-center bg-surface-3 text-text-secondary">
                  {Icon && <Icon size={13} />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block truncate font-medium text-text-primary">{cmd.label}</span>
                  <span className="block truncate text-caption2 text-text-muted">{cmd.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
}
