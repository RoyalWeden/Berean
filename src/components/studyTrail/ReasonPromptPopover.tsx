import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripHorizontal, X, Copy, Trash2, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { parseRef, bookChapterVerseLabel } from '@/lib/parseRef'
import type { TrailConnection } from '@/types/studyTrail'

// The unified reason/note popover — ONE place a reason/note lives for ANY connection, any
// clarity tier, not a separate system per trigger. Its three hosts:
//  - The Study Trail window's Map — a small pencil icon on every ConnRow (always present, not
//    gated to tier-3) opens this pre-filled with whatever's already stored.
//  - The opt-in arrival prompt (pendingArrivalPrompt in studyTrailSlice.ts), mounted in the main
//    Bible reader via StudyTrailArrivalPrompt.tsx, for a tier-2/3 chapter jump.
//  - (Both share the same component/fields — the arrival prompt is just one way to fill this
//    in, not its own separate mechanism.)
//
// Redesigned this round from a full-screen modal into a small DRAGGABLE, non-blocking card
// (same pointer-capture pattern as AudioQueuePopover.tsx/AiLookupPanel.tsx) — per direct
// feedback: "i may need to jump back and forth between the two chapters so i cant have this
// prompt disable me from doing that... it should be like a popup that can get dismissed on the
// top right of the window and i should be able to drag this popup around too." Deliberately NO
// click-outside-to-close (unlike AudioQueuePopover) — the whole point is that clicking around
// elsewhere in the app (jumping between chapters to check your answer) must never dismiss it.
//
// Verse ties are free-typed references ("Mark 13:1-5", "Ezekiel 33:4") parsed via the existing
// parseRef() — multiple allowed, since a real connection may tie together more than one origin
// verse and one destination verse. Supersedes the old numeric verse-pin inputs for new entries.

const QUICK_TAGS = ['Key insight', 'Cross-reference', 'Tangent only']
const MARGIN = 12
const WIDTH = 320

function clampPos(pos: { x: number; y: number }, height: number) {
  const maxX = Math.max(MARGIN, window.innerWidth - WIDTH - MARGIN)
  const maxY = Math.max(MARGIN, window.innerHeight - height - MARGIN)
  return { x: Math.min(Math.max(MARGIN, pos.x), maxX), y: Math.min(Math.max(MARGIN, pos.y), maxY) }
}
// Default dock: top-right, per direct feedback ("on the top right of the window").
function defaultPos() {
  return clampPos({ x: window.innerWidth - WIDTH - MARGIN, y: 48 }, 400)
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
          placeholder="e.g. Mark 13:1-5"
          style={{ flex: 1, background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
        />
        <button
          onClick={onRemove}
          title="Remove this tie"
          style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: '0 4px' }}
        ><X size={13} /></button>
      </div>
      {value.trim() && (
        <div style={{ fontSize: 9.5, marginTop: 2, paddingLeft: 2, color: resolved ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))' }}>
          {resolved ? `→ ${resolved}` : 'not recognized yet — still saved as typed'}
        </div>
      )}
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
  const [text, setText] = useState(connection.reasonText ?? '')
  const [tags, setTags] = useState<string[]>(connection.reasonTags ?? [])
  // Seed from any existing ties; fall back to the legacy numeric pins (old data, pre-v34) so
  // nothing already recorded is ever invisible in the new UI, then always end with one blank
  // row ready to type into.
  const legacyTies: string[] = []
  if (connection.originVersePinFrom != null) legacyTies.push(`v.${connection.originVersePinFrom}${connection.originVersePinTo && connection.originVersePinTo !== connection.originVersePinFrom ? `-${connection.originVersePinTo}` : ''} (origin)`)
  if (connection.versePinFrom != null) legacyTies.push(`v.${connection.versePinFrom}${connection.versePinTo && connection.versePinTo !== connection.versePinFrom ? `-${connection.versePinTo}` : ''} (destination)`)
  const [ties, setTies] = useState<string[]>(connection.ties.length > 0 ? [...connection.ties, ''] : [...legacyTies, ''])
  const [saving, setSaving] = useState(false)

  const storedPos = useAppStore((s) => s.reasonPromptPopoverPos)
  const setStoredPos = useAppStore((s) => s.setReasonPromptPopoverPos)
  const [pos, setPosLocal] = useState(() => (storedPos ? clampPos(storedPos, 400) : defaultPos()))
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
    function onResize() { setPos((p) => clampPos(p, cardRef.current?.offsetHeight ?? 400)) }
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
    setPos(clampPos({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy }, cardRef.current?.offsetHeight ?? 400))
  }
  function onDragEnd() { dragRef.current = null }

  function toggleTag(t: string) {
    setTags((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t])
  }
  function updateTie(i: number, v: string) {
    setTies((prev) => {
      const next = [...prev]
      next[i] = v
      // Always keep exactly one trailing blank row to type into.
      if (i === next.length - 1 && v.trim()) next.push('')
      return next
    })
  }
  function removeTie(i: number) {
    setTies((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function save() {
    setSaving(true)
    try {
      await window.studyTrail.updateConnectionReason(connection.id, {
        reasonText: text.trim() || undefined,
        reasonTags: tags,
        ties: ties.map((t) => t.trim()).filter(Boolean),
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function notNow() {
    // Not permanent — see the file-level comment: closing without saving never silences this
    // feature going forward. dismissPrompt (still used by the "?" badge's own needsInput flag,
    // MapView.tsx) is a separate, permanent action this popover no longer calls itself.
    onClose()
  }

  async function copyToClipboard() {
    const lines = [text.trim(), ...ties.map((t) => t.trim()).filter(Boolean)].filter(Boolean)
    try { await navigator.clipboard.writeText(lines.join('\n')) } catch { /* clipboard unavailable — no-op */ }
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
    <div
      ref={cardRef}
      className="no-drag"
      style={{
        position: 'fixed', left: pos.x, top: pos.y, width: WIDTH, zIndex: 100,
        background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.4)', overflow: 'hidden',
      }}
    >
      <div
        onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd}
        className="no-drag"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          padding: '8px 10px', borderBottom: '1px solid rgb(var(--color-surface-4))',
          cursor: 'grab', userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'rgb(var(--color-text-primary))' }}>
          <GripHorizontal size={12} color="rgb(var(--color-text-muted))" />
          {title ?? 'Why did you jump here?'}
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer' }}>
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 10.5, color: 'rgb(var(--color-text-muted))', marginBottom: 10 }}>
          Optional — this is just for your own recall later. Drag me anywhere; I won't block navigation.
        </div>

        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
            Verse(s) this ties together
          </div>
          {ties.map((t, i) => (
            <TieRow key={i} value={t} onChange={(v) => updateTie(i, v)} onRemove={() => removeTie(i)} />
          ))}
          <button
            onClick={() => setTies((prev) => [...prev, ''])}
            style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'rgb(var(--color-accent))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}
          ><Plus size={11} /> add another tie</button>
        </div>

        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 10 }}>
          {QUICK_TAGS.map((t) => (
            <button
              key={t}
              onClick={() => toggleTag(t)}
              style={{
                fontSize: 10.5, padding: '4px 8px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${tags.includes(t) ? 'rgb(var(--color-accent))' : 'rgb(var(--color-surface-4))'}`,
                background: tags.includes(t) ? 'rgb(var(--color-accent) / 0.14)' : 'transparent',
                color: tags.includes(t) ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))',
              }}
            >{t}</button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="A word or two about the connection…"
          rows={2}
          style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12, resize: 'none', marginBottom: 12, fontFamily: 'inherit' }}
        />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              onClick={copyToClipboard} title="Copy this note"
              style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '5px 8px', color: 'rgb(var(--color-text-secondary))', cursor: 'pointer' }}
            ><Copy size={12} /></button>
            <button
              onClick={deleteNote} title="Delete this note"
              style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '5px 8px', color: '#e08468', cursor: 'pointer' }}
            ><Trash2 size={12} /></button>
          </div>
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
      </div>
    </div>,
    document.body
  )
}
