import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Tag as TagIcon, Settings2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { highlightDotColor } from '@/styles/highlightPalette'
import type { HighlightColor, VerseTagRange } from '@/types'

/**
 * Shared "add this selection to tags" popover. Opened from the verse selection bar, the
 * single-verse right-click popover, and the ChapterView "Tag chapter" affordance. Lets the
 * user tick any number of existing tags and/or create new ones; applying creates one tag
 * member (group) per chosen tag from `ranges` + `label`.
 */
export function TagPickPopover({
  anchorRect, ranges, label, kind = 'verses', onClose, onApplied,
}: {
  anchorRect: DOMRect
  ranges: VerseTagRange[]
  label: string
  kind?: 'verses' | 'chapter'
  onClose: () => void
  onApplied?: () => void
}) {
  const verseTags = useAppStore((s) => s.verseTags)
  const setVerseTags = useAppStore((s) => s.setVerseTags)
  const openTagManager = useAppStore((s) => s.openTagManager)

  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [created, setCreated] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: anchorRect.left, y: anchorRect.top })

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () => verseTags.filter((t) => !q || t.name.toLowerCase().includes(q)),
    [verseTags, q],
  )
  const exactExists = verseTags.some((t) => t.name.toLowerCase() === q) || created.some((c) => c.toLowerCase() === q)
  const canApply = checked.size > 0 || created.length > 0

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    let x = anchorRect.left + anchorRect.width / 2 - width / 2
    let y = anchorRect.top - height - 8 // above the anchor
    if (y < pad) y = anchorRect.bottom + 8 // flip below if no room
    x = Math.max(pad, Math.min(x, window.innerWidth - width - pad))
    y = Math.max(pad, Math.min(y, window.innerHeight - height - pad))
    setPos({ x, y })
  }, [anchorRect, filtered.length, created.length])

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [onClose])

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function addCreated() {
    const name = query.trim()
    if (!name || exactExists) return
    setCreated((c) => [...c, name])
    setQuery('')
  }
  async function apply() {
    if (!canApply || busy) return
    setBusy(true)
    try {
      const res = await window.verseTags.addMembers({
        tagIds: [...checked],
        newTagNames: created,
        ranges,
        label,
        kind,
      })
      setVerseTags(res)
      onApplied?.()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  const dot = (color: string | null) => (
    <span
      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: color ? highlightDotColor(color as HighlightColor) : 'rgb(var(--color-text-muted))' }}
    />
  )

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[140] w-[260px] rounded-shell context-menu overflow-hidden flex flex-col"
      style={{ left: pos.x, top: pos.y, backgroundColor: 'rgb(var(--color-surface-2) / 0.97)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-[rgb(var(--color-text-secondary))]">
        <TagIcon size={12} className="text-[rgb(var(--color-text-muted))]" />
        <span className="truncate">Tag {label}</span>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); exactExists ? apply() : addCreated() } }}
        placeholder="Filter or create…"
        className="mx-3 mb-1.5 px-2 py-1 text-xs rounded bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
      />
      <div className="max-h-[220px] overflow-y-auto px-1.5 pb-1">
        {created.map((name) => (
          <div key={`new-${name}`} className="flex items-center gap-2 px-2 py-1.5 text-xs text-[rgb(var(--color-text-primary))]">
            <Check size={13} className="text-[rgb(var(--color-accent))]" />
            {dot(null)}
            <span className="truncate">{name}</span>
            <span className="ml-auto text-[10px] text-[rgb(var(--color-text-muted))]">new</span>
          </div>
        ))}
        {filtered.map((t) => {
          const on = checked.has(t.id)
          return (
            <button
              key={t.id}
              onClick={() => toggle(t.id)}
              className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left rounded hover:bg-[rgb(var(--color-surface-4))] cursor-pointer text-[rgb(var(--color-text-primary))]"
            >
              <span className={`w-[13px] h-[13px] rounded border flex items-center justify-center flex-shrink-0 ${on ? 'bg-[rgb(var(--color-accent))] border-[rgb(var(--color-accent))]' : 'border-[rgb(var(--color-surface-4))]'}`}>
                {on && <Check size={10} className="text-white" />}
              </span>
              {dot(t.color)}
              <span className="truncate">{t.name}</span>
              <span className="ml-auto text-[10px] text-[rgb(var(--color-text-muted))]">{t.verseCount + t.chapterCount}</span>
            </button>
          )
        })}
        {q && !exactExists && (
          <button
            onClick={addCreated}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-left rounded hover:bg-[rgb(var(--color-surface-4))] cursor-pointer text-[rgb(var(--color-accent))]"
          >
            <Plus size={12} /> Create “{query.trim()}”
          </button>
        )}
        {filtered.length === 0 && !q && (
          <div className="px-2 py-3 text-[11px] text-[rgb(var(--color-text-muted))] text-center">No tags yet — type a name to create one.</div>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-2 border-t border-[rgb(var(--color-surface-4))]">
        <button
          onClick={() => { openTagManager(); onClose() }}
          className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"
        >
          <Settings2 size={11} /> Manage
        </button>
        <button
          onClick={apply}
          disabled={!canApply || busy}
          className="ml-auto px-3 py-1 text-xs rounded bg-[rgb(var(--color-accent))] text-white font-medium disabled:opacity-40 cursor-pointer hover:brightness-110"
        >
          Apply
        </button>
      </div>
    </div>,
    document.body,
  )
}
