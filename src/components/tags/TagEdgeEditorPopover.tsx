import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ArrowLeft, ArrowLeftRight, Minus, Trash2 } from 'lucide-react'
import { TAG_SLOT_COUNT } from '@/lib/tagPalette'
import { Button, SegmentedControl, ColorSwatchRow, Switch, TextArea, type Swatch } from '@/components/ui'
import type { TagEdge, TagEdgeArrows } from '@/types'

const ARROW_OPTS: Array<{ value: TagEdgeArrows; icon: typeof Minus; title: string }> = [
  { value: 'none', icon: Minus, title: 'Plain line' },
  { value: 'forward', icon: ArrowRight, title: 'Arrow at target' },
  { value: 'backward', icon: ArrowLeft, title: 'Arrow at source' },
  { value: 'both', icon: ArrowLeftRight, title: 'Arrows both ends' },
]

const COLOR_SWATCHES: Swatch[] = Array.from({ length: TAG_SLOT_COUNT }, (_, i) => ({
  id: String(i), rgb: `var(--tag-slot-${i})`, label: `Colour ${i + 1}`,
}))

export interface EdgeDraft {
  id?: string           // present when editing a real edge
  source: string
  target: string
  arrows: TagEdgeArrows
  color: string | null
  dashed: boolean
  note: string
}

export default function TagEdgeEditorPopover({
  draft, at, sourceName, targetName, onChange, onCommitDraft, onDelete, onClose,
}: {
  draft: EdgeDraft
  at: { x: number; y: number }
  sourceName: string
  targetName: string
  onChange: (patch: Partial<Pick<TagEdge, 'arrows' | 'color' | 'dashed' | 'note'>>) => void
  onCommitDraft: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [local, setLocal] = useState(draft)
  useEffect(() => { setLocal(draft) }, [draft])

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Enter' && (e.target as HTMLElement)?.tagName !== 'TEXTAREA') { e.preventDefault(); if (!draft.id) onCommitDraft() }
    }
    const t = setTimeout(() => {
      window.addEventListener('mousedown', onDown)
      window.addEventListener('keydown', onKey, true)
    }, 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey, true) }
  }, [onClose, onCommitDraft, draft.id])

  function apply(patch: Partial<EdgeDraft>) {
    setLocal((l) => ({ ...l, ...patch }))
    onChange(patch as never)
    if (!draft.id) onCommitDraft()
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-popover w-[272px] material-popover rounded-menu p-3 flex flex-col gap-2.5"
      style={{ left: Math.max(8, at.x - 136), top: Math.max(8, at.y + 8) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-footnote text-text-secondary truncate">
        <span className="font-semibold text-text-primary">{sourceName}</span>
        <span className="mx-1">→</span>
        <span className="font-semibold text-text-primary">{targetName}</span>
      </div>

      <SegmentedControl
        aria-label="Arrow style"
        fill
        value={local.arrows}
        onChange={(v) => apply({ arrows: v })}
        options={ARROW_OPTS.map(({ value, icon, title }) => ({ value, icon, title }))}
      />

      <ColorSwatchRow swatches={COLOR_SWATCHES} value={local.color} onChange={(id) => apply({ color: id })} allowNone size={16} />

      <div className="flex items-center gap-2 text-footnote text-text-secondary">
        <Switch checked={local.dashed} onCheckedChange={() => apply({ dashed: !local.dashed })} label="Dashed line" />
        Dashed line
      </div>

      <TextArea
        value={local.note}
        onChange={(e) => setLocal((l) => ({ ...l, note: e.target.value }))}
        onBlur={() => { onChange({ note: local.note }); if (!draft.id) onCommitDraft() }}
        placeholder="Relationship note (shown on hover)…"
        rows={2}
        className="resize-none"
      />

      <div className="flex items-center justify-between">
        {draft.id ? (
          <Button variant="ghost" size="sm" icon={Trash2} danger onClick={onDelete}>Delete</Button>
        ) : <span className="text-caption text-text-muted">Set anything or press Enter to keep</span>}
        <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>,
    document.body,
  )
}
