import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, MapPin } from 'lucide-react'
import { useAppStore } from '@/store'
import { bookName } from '@/lib/parseRef'
import { formatVerseTieReference, parseVerseTieReferenceToNumbers } from '@/lib/verseRangeFormat'
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
// simplified... this popup should look a lot nicer"): a single note textbox, then a compact
// verse-ties summary — no quick tags, no Tangent/New-topic checkboxes (both moved to the
// right-click menu, see TrailRefContextMenu.tsx's tangentToggle/topicBreak) and no collapsed
// "More" section, since the ties are now the ONLY thing left to show. Shares TrailPopoverShell
// with the arrival prompt so the two read as one family.
//
// Verse ties are no longer typed by hand (v36+): a "Pick verses" button opens a separate OS
// window (VersePickerApp.tsx, via window.app.openVersePicker) showing the origin and
// destination chapters side by side — click a verse number to tie it, shift-click for a range.
// Every click live-applies back here via versePicker:selectionChanged (no Done step, close the
// picker window anytime), which is why tiesFrom/tiesTo below are driven entirely by that IPC
// listener instead of any local text input.
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

/** The actual note-textarea + verse-ties summary + Delete/Not now/Save row — factored out of
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
  const [noteFocused, setNoteFocused] = useState(false)
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
  // A single compact reference string per side now (e.g. "Mark 13:1-2,5,8-10"), set only via the
  // verse picker — not a free-typed list anymore. `tiesFrom`/`tiesTo` on the connection record are
  // still arrays (shared with the older schema/API), so these just read/write index 0.
  const [tieFrom, setTieFrom] = useState<string>(connection.tiesFrom[0] ?? legacyFrom[0] ?? '')
  const [tieTo, setTieTo] = useState<string>(connection.tiesTo[0] ?? legacyTo[0] ?? '')
  const [saving, setSaving] = useState(false)

  // ── Auto-save (toast mode) ────────────────────────────────────────────────
  // Persist silently on a short debounce after any edit, and flush once more on unmount
  // (dismiss/navigate away) so the last keystrokes are never lost. Refs keep the unmount
  // flush reading the latest values without re-registering the effect each render.
  const latestRef = useRef({ note, tieFrom, tieTo })
  latestRef.current = { note, tieFrom, tieTo }
  function persist() {
    const { note, tieFrom, tieTo } = latestRef.current
    return window.studyTrail.updateConnectionReason(connection.id, {
      userNote: note.trim() || undefined,
      tiesFrom: tieFrom.trim() ? [tieFrom.trim()] : [],
      tiesTo: tieTo.trim() ? [tieTo.trim()] : [],
    })
  }
  useEffect(() => {
    if (!autoSave) return
    const dirty = note !== (connection.userNote ?? '') || Boolean(tieFrom) || Boolean(tieTo)
    if (!dirty) return
    const t = setTimeout(() => { void persist() }, 500)
    return () => clearTimeout(t)
  }, [autoSave, note, tieFrom, tieTo]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!autoSave) return
    return () => { void persist() }
  }, [autoSave]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live-apply from the verse-picker window (VersePickerApp.tsx) — every click there pushes a
  // versePicker:selectionChanged event back here, no separate Done step. Guarded on connectionId
  // since the underlying IPC listener is a single global registration (only the most-recently
  // mounted form's registration wins), so a stale event for a different connection is ignored.
  useEffect(() => {
    window.app.onVersePickerSelectionChanged((payload) => {
      if (payload.connectionId !== connection.id) return
      if (payload.side === 'from') {
        setTieFrom(originBookId && originChapter
          ? formatVerseTieReference(bookName(originBookId), originChapter, payload.selected) : '')
      } else {
        setTieTo(connection.toBookId && connection.toChapter != null
          ? formatVerseTieReference(bookName(connection.toBookId), connection.toChapter, payload.selected) : '')
      }
      onFieldTouched?.()
    })
  }, [connection.id, connection.toBookId, connection.toChapter, originBookId, originChapter]) // eslint-disable-line react-hooks/exhaustive-deps

  const pickerAvailable = Boolean(originBookId && originChapter && connection.toBookId && connection.toChapter)
  function openPicker() {
    if (!pickerAvailable) return
    window.app.openVersePicker({
      connectionId: connection.id,
      from: { bookId: originBookId!, bookLabel: bookName(originBookId!), chapter: originChapter!, selected: parseVerseTieReferenceToNumbers(tieFrom) },
      to: { bookId: connection.toBookId!, bookLabel: bookName(connection.toBookId!), chapter: connection.toChapter!, selected: parseVerseTieReferenceToNumbers(tieTo) },
    })
    onFieldTouched?.()
  }

  async function save() {
    setSaving(true)
    try {
      await window.studyTrail.updateConnectionReason(connection.id, {
        userNote: note.trim() || undefined,
        tiesFrom: tieFrom.trim() ? [tieFrom.trim()] : [],
        tiesTo: tieTo.trim() ? [tieTo.trim()] : [],
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
        onFocus={() => { setNoteFocused(true); onFieldTouched?.() }}
        onBlur={() => setNoteFocused(false)}
        placeholder="Add a note (optional)"
        rows={autoSave ? 3 : 2}
        style={{
          width: '100%', background: 'rgb(var(--color-surface-2))',
          border: `1px solid ${noteFocused ? 'rgb(var(--color-accent))' : 'rgb(var(--color-surface-4))'}`,
          borderRadius: 9, padding: '8px 10px', color: 'rgb(var(--color-text-primary))', fontSize: 12,
          resize: 'none', fontFamily: 'inherit', marginBottom: 14, lineHeight: 1.5,
          boxShadow: noteFocused ? '0 0 0 3px rgb(var(--color-accent) / 0.15)' : 'none',
          transition: 'border-color 120ms ease, box-shadow 120ms ease', outline: 'none',
        }}
      />

      <div style={{ marginBottom: 4 }}>
        <button
          className="trail-ctx-btn"
          onClick={openPicker}
          disabled={!pickerAvailable}
          title={pickerAvailable ? 'Pick which verses this connection ties together' : 'Verse ties need both a known origin and destination chapter'}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 600,
            color: pickerAvailable ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
            background: pickerAvailable ? 'rgb(var(--color-accent) / 0.1)' : 'rgb(var(--color-surface-2))',
            border: 'none', borderRadius: 999, cursor: pickerAvailable ? 'pointer' : 'default',
            padding: '5px 10px', opacity: pickerAvailable ? 1 : 0.6,
          }}
        ><MapPin size={12} /> {tieFrom || tieTo ? 'Edit verse ties' : 'Pick verses'}</button>
        {(tieFrom || tieTo) && (
          <div style={{ fontSize: 10.5, marginTop: 6, color: 'rgb(var(--color-text-muted))', lineHeight: 1.6 }}>
            {tieFrom && <div><span style={{ fontWeight: 700 }}>From:</span> {tieFrom}</div>}
            {tieTo && <div><span style={{ fontWeight: 700 }}>To:</span> {tieTo}</div>}
          </div>
        )}
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
  // Sit behind the floating search / settings modal (z-50) while one is open.
  const modalOpen = useAppStore((s) => s.searchOpen || s.settingsOpen)
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
    <div ref={cardRef} style={{ position: 'fixed', left: pos.x, top: pos.y, zIndex: modalOpen ? 40 : 100 }}>
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
