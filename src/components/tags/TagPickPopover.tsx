import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Plus, Tag as TagIcon, Settings2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { resolveTagColor } from '@/lib/tagPalette'
import { TextField, Button, MenuItem } from '@/components/ui'
import type { VerseTagRange } from '@/types'

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
  const openTagsGraph = useAppStore((s) => s.openTagsGraph)

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

  const dot = (tag: { color: string | null; colorSlot?: number | null } | null) => (
    <span
      className="w-2.5 h-2.5 rounded-full flex-shrink-0"
      style={{ backgroundColor: resolveTagColor(tag) }}
    />
  )

  return createPortal(
    <div
      ref={ref}
      className="fixed z-menu w-[260px] material-popover rounded-menu overflow-hidden flex flex-col"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-3 pt-2.5 pb-1.5 flex items-center gap-1.5 text-caption font-semibold text-text-secondary">
        <TagIcon size={12} className="text-text-muted" />
        <span className="truncate">Tag {label}</span>
      </div>
      <TextField
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); exactExists ? apply() : addCreated() } }}
        placeholder="Filter or create…"
        wrapperClassName="mx-3 mb-1.5"
      />
      <div className="max-h-[220px] overflow-y-auto px-1.5 pb-1">
        {created.map((name) => (
          <div key={`new-${name}`} className="flex items-center gap-2 px-2.5 h-7 text-xs text-text-primary">
            <Check size={13} className="text-accent" />
            {dot(null /* new, unsaved */)}
            <span className="truncate">{name}</span>
            <span className="ml-auto text-caption2 text-text-muted">new</span>
          </div>
        ))}
        {filtered.map((t) => {
          const on = checked.has(t.id)
          return (
            <MenuItem
              key={t.id}
              active={on}
              onClick={() => toggle(t.id)}
              label={<span className="flex items-center gap-2">{dot(t)}<span className="truncate">{t.name}</span></span>}
              trailing={<span className="text-caption2 text-text-muted">{t.verseCount + t.chapterCount}</span>}
            />
          )
        })}
        {q && !exactExists && (
          <MenuItem icon={Plus} label={`Create “${query.trim()}”`} onClick={addCreated} className="text-accent" />
        )}
        {filtered.length === 0 && !q && (
          <div className="px-2 py-3 text-caption text-text-muted text-center">No tags yet — type a name to create one.</div>
        )}
      </div>
      <div className="flex items-center gap-2 px-2 py-2 border-t border-separator">
        <Button variant="ghost" size="sm" icon={Settings2} onClick={() => { openTagsGraph(); onClose() }}>
          Manage
        </Button>
        <Button variant="primary" size="sm" className="ml-auto" onClick={apply} disabled={!canApply || busy}>
          Apply
        </Button>
      </div>
    </div>,
    document.body,
  )
}
