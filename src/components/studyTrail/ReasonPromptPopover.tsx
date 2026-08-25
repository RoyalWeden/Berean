import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { GripHorizontal, X, Trash2, Plus, ChevronRight } from 'lucide-react'
import { useAppStore } from '@/store'
import { useStudyTrailStore } from '@/store/studyTrailSlice'
import { parseRef, bookChapterVerseLabel } from '@/lib/parseRef'
import type { TrailConnection } from '@/types/studyTrail'

// The unified reason/note popover — ONE place a note lives for ANY connection, any clarity
// tier, not a separate system per trigger. Its three hosts:
//  - The Study Trail window's Map — a small pencil icon on every ConnRow (always present, not
//    gated to tier-3) opens this pre-filled with whatever's already stored.
//  - The opt-in arrival prompt (pendingArrivalPrompt in studyTrailSlice.ts), mounted in the main
//    Bible reader via StudyTrailArrivalPrompt.tsx, for a tier-2/3 chapter jump.
//  - (Both share the same component/fields — the arrival prompt is just one way to fill this
//    in, not its own separate mechanism.)
//
// Draggable, non-blocking card (same pointer-capture pattern as AudioQueuePopover.tsx/
// AiLookupPanel.tsx) — deliberately NO click-outside-to-close, since the whole point is that
// jumping between chapters to check your answer must never dismiss it.
//
// The auto-detected fact (reasonText, e.g. "Strong's word · G26") and the user's OWN note
// (userNote) are fully separate fields (v35) — per direct feedback: "the note that the user
// puts for the connection shouldnt be on the part where it has 'strongs occurrence' or
// whatever else... it should be a separate note that has nothing on it until the user puts
// it." reasonText renders READ-ONLY as context; userNote is a blank-until-typed textarea,
// preferably beside it (side by side when there's room, wrapping below otherwise).
//
// Verse ties are free-typed references ("Mark 13:1-5") parsed via the existing parseRef(),
// split into two labeled sections (the chapter left / the chapter landed on) rather than one
// combined list.
//
// Copying a note is NOT done from here anymore — moved to a hover bubble in MapView.tsx (see
// TrailNoteHoverBubble) so copying doesn't require opening the editor at all.

const QUICK_TAGS = ['Key insight', 'Cross-reference', 'Tangent only']
const MARGIN = 12
const WIDTH = 440

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

/** One "+add another" tie-list section, used twice below (from-chapter / to-chapter). */
function TieSection({ label, values, onChange }: { label: string; values: string[]; onChange: (next: string[]) => void }) {
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
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, color: 'rgb(var(--color-text-muted))', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 4 }}>
        {label}
      </div>
      {values.map((t, i) => <TieRow key={i} value={t} onChange={(v) => update(i, v)} onRemove={() => remove(i)} />)}
      <button
        onClick={() => onChange([...values, ''])}
        style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'rgb(var(--color-accent))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 0' }}
      ><Plus size={11} /> add another</button>
    </div>
  )
}

export default function ReasonPromptPopover({
  connection, onClose, onSaved, title, nodeId, nodeIsTopicBreak,
}: {
  connection: TrailConnection
  onClose: () => void
  onSaved: () => void
  title?: string
  /** The node this connection LANDED on — only known for the live arrival-prompt path (the
   *  recorder just created it) or when the caller looks it up. Needed for the "new topic"
   *  checkbox, which is a node-level flag, not a connection-level one. Omitted entirely (the
   *  checkbox hides) when the caller has no node to attach it to. */
  nodeId?: string
  nodeIsTopicBreak?: boolean
}) {
  const [note, setNote] = useState(connection.userNote ?? '')
  const [tags, setTags] = useState<string[]>(connection.reasonTags ?? [])
  const [isBranch, setIsBranch] = useState(connection.isBranch)
  const [isTopicBreak, setIsTopicBreak] = useState(!!nodeIsTopicBreak)
  const [detailOpen, setDetailOpen] = useState(false)
  const markBranchReturn = useStudyTrailStore((s) => s.markBranchReturn)
  // Seed from tiesFrom/To; fall back to the legacy numeric pins (old data, pre-v35) so nothing
  // already recorded is invisible in the new UI, then always end with one blank row per section.
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

  async function save() {
    setSaving(true)
    try {
      await window.studyTrail.updateConnectionReason(connection.id, {
        reasonTags: tags,
        userNote: note.trim() || undefined,
        tiesFrom: tiesFrom.map((t) => t.trim()).filter(Boolean),
        tiesTo: tiesTo.map((t) => t.trim()).filter(Boolean),
        isBranch,
      })
      if (nodeId) await window.studyTrail.setNodeTopicBreak(nodeId, isTopicBreak)
      // Best-effort live continuation — see currentlyInBranch's own comment in
      // studyTrailSlice.ts: checking "tangent" here means whatever the user does NEXT (before
      // marking a return) also stays flagged as part of this same branch, not just this one
      // connection. Only meaningful if this popup is still open/answered promptly; a later
      // reclassification from the Study Trail window (this same checkbox, on an old
      // connection) intentionally does NOT retroactively affect live recording.
      if (isBranch) useStudyTrailStore.setState({ currentlyInBranch: true })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  function backToMain() {
    markBranchReturn(connection.id)
    onSaved()
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

        {/* Minimal by default — the two checkboxes plus one free-text box is everything most
            jumps need; tags/ties are one click away behind "Add detail", not shown up front. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'rgb(var(--color-text-primary))', marginBottom: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={isBranch} onChange={(e) => setIsBranch(e.target.checked)} />
          This is a tangent/branch (not part of the main study)
        </label>
        {isBranch && (
          <button
            onClick={backToMain}
            title="Mark that the tangent ends HERE — everything after this goes back to being the main branch"
            style={{ fontSize: 10.5, color: 'rgb(var(--color-accent))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 6px 22px', textAlign: 'left' }}
          >↩ back to main branch from here</button>
        )}
        {nodeId && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'rgb(var(--color-text-primary))', marginBottom: 10, cursor: 'pointer' }}>
            <input type="checkbox" checked={isTopicBreak} onChange={(e) => setIsTopicBreak(e.target.checked)} />
            This is a new topic (break in the trail here)
          </label>
        )}

        {connection.reasonText && (
          <div style={{ fontSize: 11, fontStyle: 'italic', color: 'rgb(var(--color-text-muted))', marginBottom: 6 }}>
            Study Trail detected: {connection.reasonText}
          </div>
        )}
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why did you jump here? (optional)"
          rows={2}
          style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12, resize: 'none', fontFamily: 'inherit', marginBottom: 8 }}
        />

        <button
          onClick={() => setDetailOpen((v) => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', cursor: 'pointer', padding: '0 0 8px', marginLeft: -2 }}
        >
          <ChevronRight size={11} style={{ transform: detailOpen ? 'rotate(90deg)' : 'none', transition: 'transform 100ms' }} />
          Add detail (tags, verse ties)
        </button>

        {detailOpen && (
          <>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
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

            <TieSection label="Verse(s) in the chapter you left" values={tiesFrom} onChange={setTiesFrom} />
            <TieSection label="Verse(s) in the chapter you landed on" values={tiesTo} onChange={setTiesTo} />
          </>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 2 }}>
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
      </div>
    </div>,
    document.body
  )
}
