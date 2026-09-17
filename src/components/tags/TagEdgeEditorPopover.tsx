import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, ArrowLeft, ArrowLeftRight, Minus, Ban, Trash2 } from 'lucide-react'
import { TAG_SLOT_COUNT, tagSlotVar } from '@/lib/tagPalette'
import { Button } from '@/components/ui'
import type { TagEdge, TagEdgeArrows } from '@/types'

const ARROW_OPTS: Array<{ id: TagEdgeArrows; icon: typeof Minus; tip: string }> = [
  { id: 'none', icon: Minus, tip: 'Plain line' },
  { id: 'forward', icon: ArrowRight, tip: 'Arrow at target' },
  { id: 'backward', icon: ArrowLeft, tip: 'Arrow at source' },
  { id: 'both', icon: ArrowLeftRight, tip: 'Arrows both ends' },
]

export interface EdgeDraft {
  id?: string           // present when editing a real edge
  source: string
  target: string
  arrows: TagEdgeArrows
  color: string | null
  dashed: boolean
  note: string
}

const SEG =
  'flex-1 flex items-center justify-center py-1 rounded-card cursor-pointer border transition-colors'
const SEG_ON = 'border-accent bg-accent/15'
const SEG_OFF = 'border-border hover:bg-surface-hover'

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
      className="fixed z-popover w-[272px] material-popover rounded-menu p-3 flex flex-col gap-2.5 native-buttons"
      style={{ left: Math.max(8, at.x - 136), top: Math.max(8, at.y + 8) }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="text-xs text-text-secondary truncate">
        <span className="font-semibold text-text-primary">{sourceName}</span>
        <span className="mx-1">→</span>
        <span className="font-semibold text-text-primary">{targetName}</span>
      </div>

      <div className="flex items-center gap-1">
        {ARROW_OPTS.map(({ id, icon: Icon, tip }) => (
          <button key={id} title={tip} onClick={() => apply({ arrows: id })}
            className={`${SEG} ${local.arrows === id ? SEG_ON : SEG_OFF}`}>
            <Icon size={14} className="text-text-primary" />
          </button>
        ))}
      </div>

      <div className="flex items-center flex-wrap gap-1.5">
        {Array.from({ length: TAG_SLOT_COUNT }, (_, i) => (
          <button key={i} title={`Colour ${i + 1}`} onClick={() => apply({ color: String(i) })}
            className={`w-4 h-4 rounded-full cursor-pointer transition-transform hover:scale-110 ${
              local.color === String(i) ? 'ring-2 ring-text-primary ring-offset-1 ring-offset-transparent' : ''
            }`}
            style={{ backgroundColor: tagSlotVar(i) }} />
        ))}
        <button title="Neutral line" onClick={() => apply({ color: null })}
          className={`w-4 h-4 rounded-full flex items-center justify-center cursor-pointer transition-colors text-text-muted hover:text-text-primary ${
            local.color == null ? 'ring-2 ring-text-primary ring-offset-1 ring-offset-transparent' : ''
          }`}>
          <Ban size={11} />
        </button>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer">
        <input type="checkbox" checked={local.dashed} onChange={(e) => apply({ dashed: e.target.checked })} />
        Dashed line
      </label>

      <textarea
        value={local.note}
        onChange={(e) => setLocal((l) => ({ ...l, note: e.target.value }))}
        onBlur={() => { onChange({ note: local.note }); if (!draft.id) onCommitDraft() }}
        placeholder="Relationship note (shown on hover)…"
        rows={2}
        className="text-subhead rounded-card bg-surface-1/60 border border-border px-2 py-1.5 outline-none focus:border-accent text-text-primary resize-none placeholder:text-text-muted"
      />

      <div className="flex items-center justify-between">
        {draft.id ? (
          <button onClick={onDelete}
            className="flex items-center gap-1 px-1.5 py-1 rounded-card text-caption text-destructive hover:bg-destructive/15 transition-colors cursor-pointer">
            <Trash2 size={12} /> Delete
          </button>
        ) : <span className="text-caption text-text-muted">Set anything or press Enter to keep</span>}
        <Button variant="ghost" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>,
    document.body,
  )
}
