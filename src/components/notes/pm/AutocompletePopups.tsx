import { useState, useEffect } from 'react'
import type { Note, Book } from '@/types'
import type { SlashCommand } from './slashCommands'
import { BLOCK_TYPE_META } from '@/lib/blockTypeIcons'
import { formatDottedVerseRef } from '@/lib/parseRef'
import ShortcutKeys from '@/components/shell/ShortcutKeys'

// Slash-command icons come straight from the shared block-type config, which is keyed
// by the same ids SLASH_COMMANDS uses — so there is no local icon map to fall out of
// date any more. This replaced a hand-maintained SLASH_ICONS map that was missing
// `verse`, `image` and `columns` entirely (those three commands rendered with an empty
// icon square) and stopped at h3.

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
        <ShortcutKeys keys="↵" className="ml-0.5" />
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
        <ShortcutKeys keys="↵" className="ml-0.5" />
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
            <p className="text-[9px] text-[rgb(var(--color-accent))] mb-1.5 font-mono">{formatDottedVerseRef(active.verseRef)}</p>
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
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
      className="max-w-xs px-3 py-2 shadow-xl rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] pointer-events-none"
    >
      <p className="text-[10px] font-mono font-semibold text-[rgb(var(--color-accent))] mb-1">{refLabel}</p>
      <p className="text-[11px] text-[rgb(var(--color-text-secondary))] leading-relaxed line-clamp-6">
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
      style={{ position: 'fixed', left: x, top: y, zIndex: 9999 }}
      className="pm-toolbar-solid rounded-lg shadow-2xl p-2 flex flex-col gap-1.5 w-[220px]"
      onMouseDown={(e) => e.preventDefault()}
    >
      <select
        value={bookId}
        onChange={(e) => { setBookId(e.target.value); setChapter(1) }}
        className="text-xs px-2 py-1 rounded-md bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]"
      >
        {books.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
      <div className="flex items-center gap-1.5">
        <select
          value={chapter}
          onChange={(e) => setChapter(Number(e.target.value))}
          className="flex-1 min-w-0 text-xs px-2 py-1 rounded-md bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]"
        >
          {Array.from({ length: book?.chapters_count ?? 1 }, (_, i) => i + 1).map((c) => (
            <option key={c} value={c}>Ch {c}</option>
          ))}
        </select>
        <select
          value={verse}
          onChange={(e) => setVerse(Number(e.target.value))}
          className="flex-1 min-w-0 text-xs px-2 py-1 rounded-md bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))]"
        >
          {Array.from({ length: verseCount }, (_, i) => i + 1).map((v) => (
            <option key={v} value={v}>Vs {v}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-1.5 justify-end pt-0.5">
        <button
          onMouseDown={onDismiss}
          className="text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer transition-colors px-1.5 py-1"
        >
          Cancel
        </button>
        <button
          onMouseDown={() => onInsert(bookId, chapter, verse)}
          className="text-[10px] font-medium text-white bg-[rgb(var(--color-accent))] hover:opacity-90 rounded-md px-2.5 py-1 cursor-pointer transition-opacity"
        >
          Insert
        </button>
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
      style={{ position: 'fixed', left: x, top: y, zIndex: 60 }}
      className="w-64 max-h-80 overflow-y-auto shadow-2xl border border-[rgb(var(--color-surface-4))] rounded-lg bg-[rgb(var(--color-surface-1))] py-1"
      onMouseDown={(e) => e.preventDefault()}
    >
      {groups.map(({ group, items }) => (
        <div key={group}>
          <div className="px-3 pt-2 pb-1 text-[9px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">{group}</div>
          {items.map(({ cmd, idx }) => {
            const Icon = BLOCK_TYPE_META[cmd.id]?.icon
            return (
              <button
                key={cmd.id}
                onMouseDown={() => onSelect(cmd)}
                onMouseEnter={() => onHoverIdx(idx)}
                className={`w-full text-left px-3 py-1.5 text-xs cursor-pointer transition-colors flex items-center gap-2.5 border-l-2 ${
                  idx === activeIdx
                    ? 'bg-[rgb(var(--color-accent))]/25 border-l-[rgb(var(--color-accent))] text-[rgb(var(--color-text-primary))] font-medium'
                    : 'border-l-transparent text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))]'
                }`}
              >
                <span className="w-6 h-6 flex-shrink-0 rounded flex items-center justify-center bg-[rgb(var(--color-surface-3))] text-[rgb(var(--color-text-secondary))]">
                  {Icon && <Icon size={13} />}
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
