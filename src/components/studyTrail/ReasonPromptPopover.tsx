import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { parseRef, bookChapterVerseLabel } from '@/lib/parseRef'
import TrailPopoverShell from './TrailPopoverShell'
import type { TrailConnection } from '@/types/studyTrail'

// The unified reason/note popover — ONE place a note lives for ANY connection, any clarity
// tier, not a separate system per trigger. Its hosts:
//  - The Study Trail window's Map — the pencil icon on every ConnRow/TangentBullet/node hover
//    card opens this pre-filled with whatever's already stored.
//  - The opt-in arrival prompt (pendingArrivalPrompt in studyTrailSlice.ts), mounted in the main
//    Bible reader via StudyTrailArrivalPrompt.tsx, for a tier-2/3 chapter jump.
//  - (Both share the same component/fields — the arrival prompt is just one way to fill this
//    in, not its own separate mechanism.)
//
// Draggable, non-blocking card (same pointer-capture pattern as AudioQueuePopover.tsx/
// AiLookupPanel.tsx) — deliberately NO click-outside-to-close, since the whole point is that
// jumping between chapters to check your answer must never dismiss it.
//
// Refreshed per direct feedback ("refresh the 'why did you jump here' menu to be more
// simplified... this popup should look a lot nicer"): a single note textbox, then two columns
// (From / To) of free-typed verse ties — no quick tags, no Tangent/New-topic checkboxes (both
// moved to the right-click menu, see TrailRefContextMenu.tsx's tangentToggle/topicBreak) and no
// collapsed "More" section, since the ties are now the ONLY thing left to show. Shares
// TrailPopoverShell with the arrival prompt so the two read as one family.
//
// The auto-detected fact (reasonText, e.g. "Strong's word · G26") and the user's OWN note
// (userNote) stay fully separate fields (v35): reasonText renders READ-ONLY as context; userNote
// is a blank-until-typed textarea.
//
// Copying a note is NOT done from here — that's a hover bubble in MapView.tsx (see
// TrailNoteBubbleContent) so copying doesn't require opening the editor at all.

const MARGIN = 12
const WIDTH = 420

function clampPos(pos: { x: number; y: number }, height: number) {
  const maxX = Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN)
  return { x: Math.min(Math.max(MARGIN, pos.x), maxX), y: Math.min(Math.max(MARGIN, pos.y), maxY) }
}
// Default dock: top-right, per direct feedback ("on the top right of the window").
function defaultPos() {
  return clampPos({ x: window.innerWidth - WIDTH - MARGIN, y: 48 }, 320)
}

/** A typed tie, resolved against parseRef on every render — cheap, pure, no need to persist the
 *  parsed form separately. Unparseable text still shows (never silently dropped), just without
 *  the "resolved to X" confirmation/click-to-navigate affordance. */
function TieRow({ value, onChange, onRemove }: { value: string; onChange: (v: string) => void; onRemove: () => void }) {
  const parsed = value.trim() ? parseRef(value.trim()) : null
  const resolved = parsed ? bookChapterVerseLabel(parsed.bookId, parsed.chapter, parsed.verse) + (parsed.endVerse ? `–${parsed.endVerse}` : '') : null
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. Mark 13:1"
          style={{ flex: 1, minWidth: 0, background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
        />
        <button
          onClick={onRemove}
          title="Remove this tie"
          style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: '0 4px' }}
        ><X size={13} /></button>
      </div>
      {value.trim() && (
        <div style={{ fontSize: 9.5, marginTop: 2, paddingLeft: 2, color: resolved ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))' }}>
          {resolved ? `→ ${resolved}` : 'not recognized yet'}
        </div>
      )}
    </div>
  )
}

/** One "+add another" tie-list column — used twice below (from-chapter / to-chapter), side by
 *  side. Short labels ("From"/"To") per direct feedback ("the labels for those should be
 *  shorter/simpler"), replacing the old full-sentence "Ties to the chapter you left/landed on". */
function TieColumn({ label, values, onChange }: { label: string; values: string[]; onChange: (next: string[]) => void }) {
  function update(i: number, v: string) {
    const next = [...values]
    next[i] = v
    if (i === next.length - 1 && v.trim()) next.push('')
    onChange(next)
  }
  function remove(i: number) {
    onChange(values.filter((_, idx) => idx !== i))
  }
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
        {label}
      </div>
      {values.map((t, i) => <TieRow key={i} value={t} onChange={(v) => update(i, v)} onRemove={() => remove(i)} />)}
      <button
        onClick={() => onChange([...values, ''])}
        style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'rgb(var(--color-accent))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}
      ><Plus size={11} /> add</button>
    </div>
  )
}

export default function ReasonPromptPopover({
  connection, onClose, onSaved, title,
}: {
  connection: TrailConnection
  onClose: () => void
  onSaved: () => void
  title?: string
}) {
  const [note, setNote] = useState(connection.userNote ?? '')
  // Seed from tiesFrom/To; fall back to the legacy numeric pins (old data, pre-v35) so nothing
  // already recorded is invisible in the new UI, then always end with one blank row per column.
  const legacyFrom = connection.originVersePinFrom != null
    ? [`v.${connection.originVersePinFrom}${connection.originVersePinTo && connection.originVersePinTo !== connection.originVersePinFrom ? `-${connection.originVersePinTo}` : ''}`]
    : []
  const legacyTo = connection.versePinFrom != null
    ? [`v.${connection.versePinFrom}${connection.versePinTo && connection.versePinTo !== connection.versePinFrom ? `-${connection.versePinTo}` : ''}`]
    : []
  const [tiesFrom, setTiesFrom] = useState<string[]>(connection.tiesFrom.length > 0 ? [...connection.tiesFrom, ''] : [...legacyFrom, ''])
  const [tiesTo, setTiesTo] = useState<string[]>(connection.tiesTo.length > 0 ? [...connection.tiesTo, ''] : [...legacyTo, ''])
  const [saving, setSaving] = useState(false)

  const storedPos = useAppStore((s) => s.reasonPromptPopoverPos)
  const setStoredPos = useAppStore((s) => s.setReasonPromptPopoverPos)
  const [pos, setPosLocal] = useState(() => (storedPos ? clampPos(storedPos, 320) : defaultPos()))
  function setPos(next: { x: number; y: number } | ((p: { x: number; y: number }) => { x: number; y: number })) {
    setPosLocal((p) => {
      const resolved = typeof next === 'function' ? next(p) : next
      setStoredPos(resolved)
      return resolved
    })
  }
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onResize() { setPos((p) => clampPos(p, cardRef.current?.offsetHeight ?? 320)) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  function onDragStart(e: React.PointerEvent) {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onDragMove(e: React.PointerEvent) {
    if (!dragRef.current) return
    const dx = e.clientX - dragRef.current.startX, dy = e.clientY - dragRef.current.startY
    setPos(clampPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }, cardRef.current?.offsetHeight ?? 320))
  }
  function onDragEnd() { dragRef.current = null }

  async function save() {
    setSaving(true)
    try {
      await window.studyTrail.updateConnectionReason(connection.id, {
        userNote: note.trim() || undefined,
        tiesFrom: tiesFrom.map((t) => t.trim()).filter(Boolean),
        tiesTo: tiesTo.map((t) => t.trim()).filter(Boolean),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function notNow() {
    // Not permanent — closing without saving never silences this feature going forward.
    // dismissPrompt (still used by the "?" badge's own needsInput flag, MapView.tsx) is a
    // separate, permanent action this popover no longer calls itself.
    onClose()
  }

  async function deleteNote() {
    setSaving(true)
    try {
      await window.studyTrail.clearConnectionNote(connection.id)
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div ref={cardRef} style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 100 }}>
      <TrailPopoverShell
        title={title ?? 'Why did you jump here?'}
        onClose={onClose}
        width={WIDTH}
        dragHandleProps={{ onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd }}
      >
        {connection.reasonText && (
          <div style={{ fontSize: 10.5, fontStyle: 'italic', color: 'rgb(var(--color-text-muted))', marginBottom: 8 }}>
            auto-detected: {connection.reasonText}
          </div>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          rows={2}
          style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12, resize: 'none', fontFamily: 'inherit', marginBottom: 12 }}
        />

        <div style={{ display: 'flex', gap: 14, marginBottom: 4 }}>
          <TieColumn label="From" values={tiesFrom} onChange={setTiesFrom} />
          <TieColumn label="To" values={tiesTo} onChange={setTiesTo} />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
          <button
            onClick={deleteNote} title="Delete your note"
            style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '5px 8px', color: '#e08468', cursor: 'pointer' }}
          ><Trash2 size={12} /></button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={notNow}
              style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >Not now</button>
            <button
              onClick={save}
              disabled={saving}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'rgb(var(--color-surface-1))', background: 'rgb(var(--color-accent))', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
            >Save</button>
          </div>
        </div>
      </TrailPopoverShell>
    </div>,
    document.body
  )
}
