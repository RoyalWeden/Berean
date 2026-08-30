import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Plus, Trash2, ChevronRight, ChevronDown, GripHorizontal, Merge } from 'lucide-react'
import { useAppStore } from '@/store'
import { HIGHLIGHT_COLOR_IDS, highlightDotColor } from '@/styles/highlightPalette'
import type { HighlightColor, VerseTag, VerseTagMember } from '@/types'

const WIDTH = 340

function clampPos(p: { x: number; y: number }, h: number) {
  const pad = 8
  return {
    x: Math.max(pad, Math.min(p.x, window.innerWidth - WIDTH - pad)),
    y: Math.max(pad, Math.min(p.y, window.innerHeight - Math.min(h, 200) - pad)),
  }
}
const defaultPos = () => ({ x: Math.max(16, window.innerWidth - WIDTH - 48), y: 88 })

export default function TagManagerPanel() {
  const open = useAppStore((s) => s.tagManagerOpen)
  const close = useAppStore((s) => s.closeTagManager)
  const tags = useAppStore((s) => s.verseTags)
  const setVerseTags = useAppStore((s) => s.setVerseTags)
  const openScriptureSearchTab = useAppStore((s) => s.openScriptureSearchTab)
  const modalOpen = useAppStore((s) => s.searchOpen || s.settingsOpen)

  const [pos, setPos] = useState(defaultPos)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [members, setMembers] = useState<VerseTagMember[]>([])
  const [colorFor, setColorFor] = useState<string | null>(null)
  const [mergeFor, setMergeFor] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string; noteRefCount: number } | null>(null)
  const [newName, setNewName] = useState('')
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) { setExpanded(null); setColorFor(null); setMergeFor(null); setConfirmDelete(null) }
  }, [open])
  useEffect(() => {
    if (!expanded) { setMembers([]); return }
    let cancelled = false
    window.verseTags.getMembers([expanded]).then((m) => { if (!cancelled) setMembers(m) }).catch(() => {})
    return () => { cancelled = true }
  }, [expanded, tags])
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, cardRef.current?.offsetHeight ?? 300))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  if (!open) return null

  const onDragStart = (e: React.PointerEvent) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    setPos(clampPos({ x: dragRef.current.ox + (e.clientX - dragRef.current.sx), y: dragRef.current.oy + (e.clientY - dragRef.current.sy) }, cardRef.current?.offsetHeight ?? 300))
  }
  const onDragEnd = () => { dragRef.current = null }

  async function rename(id: string, name: string) {
    const trimmed = name.trim()
    const cur = tags.find((t) => t.id === id)
    if (!trimmed || !cur || trimmed === cur.name) return
    setVerseTags(await window.verseTags.rename(id, trimmed))
  }
  async function recolor(id: string, color: string | null) {
    setVerseTags(await window.verseTags.setColor(id, color))
    setColorFor(null)
  }
  async function doMerge(fromId: string, intoId: string) {
    setVerseTags(await window.verseTags.merge(fromId, intoId))
    setMergeFor(null)
    if (expanded === fromId) setExpanded(null)
  }
  async function doDelete(id: string, force = false) {
    const res = await window.verseTags.delete(id, force)
    if (res.blocked) {
      setConfirmDelete({ id, name: res.name ?? '', noteRefCount: res.noteRefCount ?? 0 })
      return
    }
    if (res.list) setVerseTags(res.list)
    setConfirmDelete(null)
    if (expanded === id) setExpanded(null)
  }
  async function createTag() {
    const name = newName.trim()
    if (!name) return
    setVerseTags(await window.verseTags.create(name))
    setNewName('')
  }
  async function removeMember(memberId: string) {
    setVerseTags(await window.verseTags.removeMember(memberId))
  }

  return createPortal(
    <div
      ref={cardRef}
      className="fixed rounded-shell context-menu shadow-[0_16px_48px_rgba(0,0,0,0.4)] flex flex-col overflow-hidden"
      style={{ left: pos.x, top: pos.y, width: WIDTH, maxHeight: '70vh', zIndex: modalOpen ? 40 : 120, backgroundColor: 'rgb(var(--color-surface-2) / 0.98)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-[rgb(var(--color-surface-4))] cursor-grab active:cursor-grabbing select-none"
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
      >
        <GripHorizontal size={13} className="text-[rgb(var(--color-text-muted))]" />
        <span className="text-xs font-semibold text-[rgb(var(--color-text-primary))]">Verse Tags</span>
        <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{tags.length}</span>
        <button onClick={close} className="ml-auto text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"><X size={14} /></button>
      </div>

      <div className="overflow-y-auto flex-1 py-1">
        {tags.length === 0 && (
          <div className="px-4 py-6 text-center text-[11px] text-[rgb(var(--color-text-muted))]">
            No tags yet. Select verses in the reader and use the Tag action, or create one below.
          </div>
        )}
        {tags.map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            expanded={expanded === t.id}
            members={expanded === t.id ? members : []}
            colorOpen={colorFor === t.id}
            mergeOpen={mergeFor === t.id}
            otherTags={tags.filter((x) => x.id !== t.id)}
            onToggleExpand={() => setExpanded((e) => (e === t.id ? null : t.id))}
            onRename={(name) => rename(t.id, name)}
            onOpenColor={() => { setColorFor(colorFor === t.id ? null : t.id); setMergeFor(null) }}
            onRecolor={(c) => recolor(t.id, c)}
            onOpenMerge={() => { setMergeFor(mergeFor === t.id ? null : t.id); setColorFor(null) }}
            onMerge={(intoId) => doMerge(t.id, intoId)}
            onDelete={() => doDelete(t.id)}
            onOpenInSearch={() => { openScriptureSearchTab(undefined, { tagIds: [t.id] }); close() }}
            onRemoveMember={removeMember}
          />
        ))}
      </div>

      <div className="flex items-center gap-1.5 px-3 py-2 border-t border-[rgb(var(--color-surface-4))]">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createTag() }}
          placeholder="New tag name…"
          className="flex-1 px-2 py-1 text-xs rounded bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] outline-none focus:border-[rgb(var(--color-accent))]"
        />
        <button onClick={createTag} className="p-1 rounded bg-[rgb(var(--color-accent))] text-white cursor-pointer hover:brightness-110"><Plus size={14} /></button>
      </div>

      {confirmDelete && (
        <div className="absolute inset-0 bg-[rgb(var(--color-surface-1))/85] backdrop-blur-sm flex items-center justify-center p-4">
          <div className="rounded-shell context-menu p-3 text-center" style={{ backgroundColor: 'rgb(var(--color-surface-2))' }}>
            <p className="text-xs text-[rgb(var(--color-text-primary))]">
              Delete “{confirmDelete.name}”? Referenced in {confirmDelete.noteRefCount} note{confirmDelete.noteRefCount !== 1 ? 's' : ''}.
            </p>
            <div className="mt-3 flex gap-2 justify-center">
              <button onClick={() => setConfirmDelete(null)} className="px-2.5 py-1 text-xs rounded border border-[rgb(var(--color-surface-4))] cursor-pointer">Cancel</button>
              <button onClick={() => doDelete(confirmDelete.id, true)} className="px-2.5 py-1 text-xs rounded bg-red-500 text-white cursor-pointer hover:brightness-110">Delete anyway</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

function TagRow({
  tag, expanded, members, colorOpen, mergeOpen, otherTags,
  onToggleExpand, onRename, onOpenColor, onRecolor, onOpenMerge, onMerge, onDelete, onOpenInSearch, onRemoveMember,
}: {
  tag: VerseTag
  expanded: boolean
  members: VerseTagMember[]
  colorOpen: boolean
  mergeOpen: boolean
  otherTags: VerseTag[]
  onToggleExpand: () => void
  onRename: (name: string) => void
  onOpenColor: () => void
  onRecolor: (c: string | null) => void
  onOpenMerge: () => void
  onMerge: (intoId: string) => void
  onDelete: () => void
  onOpenInSearch: () => void
  onRemoveMember: (memberId: string) => void
}) {
  const [name, setName] = useState(tag.name)
  useEffect(() => setName(tag.name), [tag.name])
  return (
    <div className="border-b border-[rgb(var(--color-surface-4))/40] last:border-0">
      <div className="flex items-center gap-1.5 px-2 py-1.5">
        <button onClick={onToggleExpand} className="text-[rgb(var(--color-text-muted))] cursor-pointer">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div className="relative">
          <button onClick={onOpenColor} title="Colour" className="w-3 h-3 rounded-full cursor-pointer border border-black/10"
            style={{ backgroundColor: tag.color ? highlightDotColor(tag.color as HighlightColor) : 'rgb(var(--color-text-muted))' }} />
          {colorOpen && (
            <div className="absolute z-10 top-5 left-0 p-2 rounded-shell context-menu grid grid-cols-5 gap-1.5" style={{ backgroundColor: 'rgb(var(--color-surface-2))' }}>
              {HIGHLIGHT_COLOR_IDS.map((c) => (
                <button key={c} onClick={() => onRecolor(c)} title={c} className="w-4 h-4 rounded-full cursor-pointer hover:scale-110 transition-transform" style={{ backgroundColor: highlightDotColor(c) }} />
              ))}
              <button onClick={() => onRecolor(null)} title="No colour" className="w-4 h-4 rounded-full cursor-pointer border border-[rgb(var(--color-surface-4))] flex items-center justify-center"><X size={9} /></button>
            </div>
          )}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => onRename(name)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
          className="flex-1 min-w-0 bg-transparent text-xs text-[rgb(var(--color-text-primary))] outline-none focus:bg-[rgb(var(--color-surface-1))] rounded px-1 py-0.5"
        />
        <span className="text-[10px] text-[rgb(var(--color-text-muted))]">{tag.verseCount}{tag.chapterCount ? `+${tag.chapterCount}ch` : ''}</span>
        <div className="relative">
          <button onClick={onOpenMerge} title="Merge into…" className="text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer"><Merge size={12} /></button>
          {mergeOpen && (
            <div className="absolute z-10 right-0 top-5 min-w-[130px] max-h-40 overflow-y-auto rounded-shell context-menu py-1" style={{ backgroundColor: 'rgb(var(--color-surface-2))' }}>
              {otherTags.length === 0 && <div className="px-2 py-1 text-[10px] text-[rgb(var(--color-text-muted))]">No other tags</div>}
              {otherTags.map((o) => (
                <button key={o.id} onClick={() => onMerge(o.id)} className="block w-full text-left px-2 py-1 text-[11px] hover:bg-[rgb(var(--color-surface-4))] cursor-pointer text-[rgb(var(--color-text-primary))]">{o.name}</button>
              ))}
            </div>
          )}
        </div>
        <button onClick={onDelete} title="Delete tag" className="text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"><Trash2 size={12} /></button>
      </div>
      {expanded && (
        <div className="pb-1.5 pl-7 pr-2">
          <button onClick={onOpenInSearch} className="text-[10px] text-[rgb(var(--color-accent))] hover:underline cursor-pointer mb-1">Open in Advanced Search →</button>
          {members.length === 0 && <div className="text-[10px] text-[rgb(var(--color-text-muted))]">No tagged verses.</div>}
          {members.map((m) => (
            <div key={m.memberId} className="flex items-center gap-2 py-0.5 text-[11px] text-[rgb(var(--color-text-secondary))]">
              <span className="truncate">{m.label}</span>
              {m.kind === 'chapter' && <span className="text-[9px] text-[rgb(var(--color-text-muted))]">chapter</span>}
              <button onClick={() => onRemoveMember(m.memberId)} className="ml-auto text-[rgb(var(--color-text-muted))] hover:text-red-400 cursor-pointer"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
