// Emoji picker popover for a note's page icon (replaces the old plain-text-input approach in
// NotesPanel.tsx, which relied on the user knowing to paste an emoji or invoke the macOS system
// picker with ⌃⌘Space — reported as "doesn't show an emoji picker, it just allows me to type").
// Anchored/positioned the same way every other popover menu in this app is (usePositionedMenu +
// MenuPositioner), so it inherits the same click-outside/Escape/berean:closeMenus behavior for
// free instead of reimplementing it.
import { useMemo, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import { EMOJI_CATEGORIES, ALL_EMOJI, type EmojiEntry } from '@/lib/emojiList'

export default function NoteIconPicker({
  x, y, currentIcon, onSelect, onRemove, onClose, menuRef,
}: {
  x: number
  y: number
  currentIcon?: string | null
  onSelect: (emoji: string) => void
  onRemove: () => void
  onClose: () => void
  menuRef: React.RefObject<HTMLDivElement>
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Popover just opened — focus the search box so typing filters immediately
    // (the trigger button itself is a plain button, not a text field, now).
    const t = setTimeout(() => inputRef.current?.focus(), 0)
    return () => clearTimeout(t)
  }, [])

  const results: EmojiEntry[] | null = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null // null = show categorized view instead of a flat filtered grid
    return ALL_EMOJI.filter((e) => e.name.includes(q) || e.keywords.some((k) => k.includes(q)))
  }, [query])

  function pick(emoji: string) {
    onSelect(emoji)
    onClose()
  }

  return createPortal(
    <MenuPositioner
      ref={menuRef}
      x={x}
      y={y}
      className="w-64 max-h-80 flex flex-col rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] shadow-xl overflow-hidden"
    >
      <div className="flex items-center gap-1.5 p-2 border-b border-[rgb(var(--color-surface-4))]">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search emoji…"
          className="flex-1 min-w-0 bg-transparent outline-none text-xs text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))]"
        />
        {currentIcon && (
          <button
            onClick={() => { onRemove(); onClose() }}
            title="Remove icon"
            className="flex-shrink-0 p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {results !== null ? (
          results.length > 0 ? (
            <div className="grid grid-cols-8 gap-0.5">
              {results.map((e) => (
                <EmojiButton key={e.char} entry={e} onPick={pick} />
              ))}
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-[rgb(var(--color-text-muted))]">No matches</div>
          )
        ) : (
          EMOJI_CATEGORIES.map((cat) => (
            <div key={cat.label} className="mb-2 last:mb-0">
              <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-[rgb(var(--color-text-muted))]">
                {cat.label}
              </div>
              <div className="grid grid-cols-8 gap-0.5">
                {cat.emoji.map((e) => (
                  <EmojiButton key={e.char} entry={e} onPick={pick} />
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </MenuPositioner>,
    document.body
  )
}

function EmojiButton({ entry, onPick }: { entry: EmojiEntry; onPick: (emoji: string) => void }) {
  return (
    <button
      onClick={() => onPick(entry.char)}
      title={entry.name}
      className="flex items-center justify-center h-7 w-7 rounded text-base leading-none hover:bg-[rgb(var(--color-surface-4))] transition-colors"
    >
      {entry.char}
    </button>
  )
}
