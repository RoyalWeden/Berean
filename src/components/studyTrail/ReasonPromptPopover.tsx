import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Trash2, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { parseRef, bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import TrailPopoverShell from './TrailPopoverShell'
import type { TrailConnection } from '@/types/studyTrail'

// The unified reason/note popover — ONE place a note lives for ANY connection, any clarity
// tier, not a separate system per trigger. Its hosts:
//  - The Study Trail window's Map — the pencil icon on every ConnRow/TangentBullet/node hover
//    card opens this pre-filled with whatever's already stored.
//  - The opt-in arrival prompt (pendingArrivalPrompt in studyTrailSlice.ts), mounted in the main
//    Bible reader via StudyTrailArrivalPrompt.tsx, for a tier-2/3 chapter jump.
//  - The bottom-right toast's OWN "committed" expanded state (StudyTrailArrivalPrompt.tsx's
//    ArrivalPill) — per direct feedback ("it should also show a text box for the note and two
//    columns for typing verse connections"), the toast needed the SAME real inputs this popover
//    already has, not a re-invented lightweight version of them.
//  - (All three share the same TrailReasonFormBody below — the arrival prompt/toast are just two
//    more ways to reach it, not a separate mechanism.)
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
function TieRow({ value, onChange, onRemove, onBlur, hideRemove }: { value: string; onChange: (v: string) => void; onRemove: () => void; onBlur?: () => void; hideRemove?: boolean }) {
  const parsed = value.trim() ? parseRef(value.trim()) : null
  const resolved = parsed ? bookChapterVerseLabel(parsed.bookId, parsed.chapter, parsed.verse) + (parsed.endVerse ? `–${parsed.endVerse}` : '') : null
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder="e.g. Mark 13:1"
          style={{ flex: 1, minWidth: 0, background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '5px 7px', color: 'rgb(var(--color-text-primary))', fontSize: 12 }}
        />
        {!hideRemove && (
          <button
            onClick={onRemove}
            title="Remove this tie"
            style={{ flexShrink: 0, background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: '0 4px' }}
          ><X size={13} /></button>
        )}
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
export function TieColumn({ label, values, onChange, hideRemove }: { label: string; values: string[]; onChange: (next: string[]) => void; hideRemove?: boolean }) {
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
      {values.map((t, i) => (
        <TieRow
          key={i}
          value={t}
          onChange={(v) => update(i, v)}
          onRemove={() => remove(i)}
          hideRemove={hideRemove}
          // With the explicit × gone (autoSave/toast mode), clearing a row's text and
          // clicking away is how you delete it — never removing the single trailing blank.
          onBlur={hideRemove ? () => { if (!values[i]?.trim() && values.length > 1) remove(i) } : undefined}
        />
      ))}
      <button
        className="trail-ctx-btn"
        onClick={() => onChange([...values, ''])}
        style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10.5, color: 'rgb(var(--color-accent))', background: 'transparent', border: 'none', borderRadius: 5, cursor: 'pointer', padding: '2px 4px' }}
      ><Plus size={11} /> add</button>
    </div>
  )
}

/** The actual note-textarea + From/To tie-columns + Delete/Not now/Save row — factored out of
 *  ReasonPromptPopover so the toast (StudyTrailArrivalPrompt.tsx's ArrivalPill, once "committed")
 *  can render the exact same real inputs instead of a separate, smaller reimplementation. Owns
 *  its own note/ties/saving state (seeded from `connection`) and the save/delete/dismiss IPC
 *  calls — callers just supply layout (this renders unstyled/unwrapped, a plain fragment-like
 *  block) and get `onSaved`/`onClose` callbacks. `onFieldTouched` (optional) fires the first time
 *  the note or any tie actually gets typed into — the toast uses this to switch itself from
 *  hover-triggered to click-committed ("stays open until explicitly dismissed") mode. */
export function TrailReasonFormBody({
  connection, onClose, onSaved, originBookId, originChapter, onFieldTouched, autoFocusNote, autoSave,
}: {
  connection: TrailConnection
  onClose: () => void
  onSaved: () => void
  /** Toast mode (the "ask why" toggle is OFF): no Delete/Not now/Save row and no
   *  "auto-detected: …" context line — the note just auto-saves (debounced + on unmount),
   *  and per-tie × buttons are replaced by "clear the text + click away to remove". */
  autoSave?: boolean
  /** The chapter this connection departed FROM — needed only to format the legacy
   *  originVersePinFrom fallback tie as a full reference ("Deuteronomy 32:3") instead of a bare
   *  "v.3", per direct feedback. The connection itself has no book/chapter for its own origin
   *  (only fromNodeId), so the caller resolves it via a node lookup and passes it in; omitted
   *  entirely (falls back to "v.3") for hosts — the auto arrival prompt — that don't have an
   *  easy node list to resolve it from, which is fine since that path rarely has legacy data. */
  originBookId?: string
  originChapter?: number
  onFieldTouched?: () => void
  autoFocusNote?: boolean
}) {
  const [note, setNote] = useState(connection.userNote ?? '')
  // Seed from tiesFrom/To; fall back to the legacy numeric pins (old data, pre-v35) so nothing
  // already recorded is invisible in the new UI, then always end with one blank row per column.
  // Full "Book Chapter:Verse" when the book/chapter is known — per direct feedback ("for the
  // 'from' it should show as the full book chapter verse instead of 'v.3'") — falling back to
  // the bare "v.3" form only when that context genuinely isn't available.
  const legacyFrom = connection.originVersePinFrom != null
    ? [`${originBookId ? `${bookName(originBookId)} ${originChapter}:` : 'v.'}${connection.originVersePinFrom}${connection.originVersePinTo && connection.originVersePinTo !== connection.originVersePinFrom ? `-${connection.originVersePinTo}` : ''}`]
    : []
  const legacyTo = connection.versePinFrom != null
    ? [`${connection.toBookId ? `${bookName(connection.toBookId)} ${connection.toChapter}:` : 'v.'}${connection.versePinFrom}${connection.versePinTo && connection.versePinTo !== connection.versePinFrom ? `-${connection.versePinTo}` : ''}`]
    : []
  const [tiesFrom, setTiesFrom] = useState<string[]>(connection.tiesFrom.length > 0 ? [...connection.tiesFrom, ''] : [...legacyFrom, ''])
  const [tiesTo, setTiesTo] = useState<string[]>(connection.tiesTo.length > 0 ? [...connection.tiesTo, ''] : [...legacyTo, ''])
  const [saving, setSaving] = useState(false)

  // ── Auto-save (toast mode) ────────────────────────────────────────────────
  // Persist silently on a short debounce after any edit, and flush once more on unmount
  // (dismiss/navigate away) so the last keystrokes are never lost. Refs keep the unmount
  // flush reading the latest values without re-registering the effect each render.
  const latestRef = useRef({ note, tiesFrom, tiesTo })
  latestRef.current = { note, tiesFrom, tiesTo }
  function persist() {
    const { note, tiesFrom, tiesTo } = latestRef.current
    return window.studyTrail.updateConnectionReason(connection.id, {
      userNote: note.trim() || undefined,
      tiesFrom: tiesFrom.map((t) => t.trim()).filter(Boolean),
      tiesTo: tiesTo.map((t) => t.trim()).filter(Boolean),
    })
  }
  useEffect(() => {
    if (!autoSave) return
    const dirty = note !== (connection.userNote ?? '')
      || tiesFrom.some(Boolean) || tiesTo.some(Boolean)
    if (!dirty) return
    const t = setTimeout(() => { void persist() }, 500)
    return () => clearTimeout(t)
  }, [autoSave, note, tiesFrom, tiesTo]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoSave) return
    return () => { void persist() }
  }, [autoSave]) // eslint-disable-line react-hooks/exhaustive-deps

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

  return (
    <>
      {!autoSave && connection.reasonText && (
        <div style={{ fontSize: 10.5, fontStyle: 'italic', color: 'rgb(var(--color-text-muted))', marginBottom: 8 }}>
          auto-detected: {connection.reasonText}
        </div>
      )}
      <textarea
        value={note}
        autoFocus={autoFocusNote}
        onChange={(e) => { setNote(e.target.value); onFieldTouched?.() }}
        onFocus={onFieldTouched}
        placeholder="Add a note (optional)"
        rows={2}
        style={{ width: '100%', background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 6, padding: '6px 8px', color: 'rgb(var(--color-text-primary))', fontSize: 12, resize: 'none', fontFamily: 'inherit', marginBottom: 12 }}
      />

      <div style={{ display: 'flex', gap: 14, marginBottom: 4 }} onFocus={onFieldTouched}>
        <TieColumn label="From" values={tiesFrom} hideRemove={autoSave} onChange={(v) => { setTiesFrom(v); onFieldTouched?.() }} />
        <TieColumn label="To" values={tiesTo} hideRemove={autoSave} onChange={(v) => { setTiesTo(v); onFieldTouched?.() }} />
      </div>

      {!autoSave && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
          <button
            className="trail-ctx-btn"
            onClick={deleteNote} title="Delete your note"
            style={{ background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', borderRadius: 7, padding: '5px 8px', color: '#e08468', cursor: 'pointer' }}
          ><Trash2 size={12} /></button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="trail-ctx-btn"
              onClick={notNow}
              style={{ fontSize: 11.5, color: 'rgb(var(--color-text-muted))', background: 'transparent', border: 'none', borderRadius: 7, padding: '3px 6px', cursor: 'pointer' }}
            >Not now</button>
            <button
              className="trail-btn-accent"
              onClick={save}
              disabled={saving}
              style={{ fontSize: 11.5, fontWeight: 600, color: 'rgb(var(--color-surface-1))', background: 'rgb(var(--color-accent))', border: 'none', borderRadius: 7, padding: '5px 12px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}
            >Save</button>
          </div>
        </div>
      )}
    </>
  )
}

export default function ReasonPromptPopover({
  connection, onClose, onSaved, title, originBookId, originChapter,
}: {
  connection: TrailConnection
  onClose: () => void
  onSaved: () => void
  title?: string
  originBookId?: string
  originChapter?: number
}) {
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

  return createPortal(
    <div ref={cardRef} style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: 100 }}>
      <TrailPopoverShell
        title={title ?? 'Why did you jump here?'}
        onClose={onClose}
        width={WIDTH}
        dragHandleProps={{ onPointerDown: onDragStart, onPointerMove: onDragMove, onPointerUp: onDragEnd }}
      >
        <TrailReasonFormBody connection={connection} onClose={onClose} onSaved={onSaved} originBookId={originBookId} originChapter={originChapter} />
      </TrailPopoverShell>
    </div>,
    document.body
  )
}
