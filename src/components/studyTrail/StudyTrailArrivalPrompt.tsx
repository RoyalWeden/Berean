import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useAppStore } from '@/store'
import { useStudyTrailStore } from '@/store/studyTrailSlice'
import { bookName } from '@/lib/parseRef'
import ReasonPromptPopover from './ReasonPromptPopover'

// Mounted once in the main Bible-reader window (src/App.tsx) — per the plan's Phase 1 "auto-
// prompt in the main window" note, the "why did you jump chapters?" prompt needs to surface
// here, not only inside the separate Study Trail window, since that's where Michael is actually
// reading. Driven entirely by pendingArrivalPrompt (set by the recorder in studyTrailSlice.ts
// right after it records a tier-2/3 chapter connection) — nothing to fetch, nothing to poll.
//
// studyTrailAskChapterJumpReason now only decides WHICH of two UIs shows for that same
// pendingArrivalPrompt fact — the full draggable popup (on), or a small non-blocking topbar
// pill (off) that still lets a reason be jotted down without the fuller "why did you jump here"
// workflow. Per direct feedback: "i think when i dont have the ask why thing toggle, i might
// want to still put the reason why i went to where i went so there should maybe be a little
// thing that pops up in the topbar."
export default function StudyTrailArrivalPrompt() {
  const conn = useStudyTrailStore((s) => s.pendingArrivalPrompt)
  const nodeId = useStudyTrailStore((s) => s.pendingArrivalNodeId)
  const clear = useStudyTrailStore((s) => s.clearPendingArrivalPrompt)
  const askChapterJumpReason = useAppStore((s) => s.studyTrailAskChapterJumpReason)
  if (!conn) return null
  if (askChapterJumpReason) {
    const title = conn.toBookId && conn.toChapter != null
      ? `Why did you jump to ${bookName(conn.toBookId)} ${conn.toChapter}?`
      : undefined
    return (
      <ReasonPromptPopover
        connection={conn}
        title={title}
        nodeId={nodeId ?? undefined}
        onClose={clear}
        onSaved={clear}
      />
    )
  }
  return <ArrivalPill connectionId={conn.id} onClose={clear} />
}

const AUTO_DISMISS_MS = 6000

/** The lightweight, non-blocking alternative to the full popup — a small pill in the topbar
 *  area. Auto-dismisses (saving nothing) if ignored; typing something and pressing Enter/blur
 *  saves it as the connection's own userNote, same field the full popup writes to. */
function ArrivalPill({ connectionId, onClose }: { connectionId: string; onClose: () => void }) {
  const [text, setText] = useState('')
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (expanded) return // paused while the user is actively typing
    const t = setTimeout(onClose, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [expanded, onClose])

  async function save() {
    const trimmed = text.trim()
    if (trimmed) await window.studyTrail.updateConnectionReason(connectionId, { userNote: trimmed }).catch(() => {})
    onClose()
  }

  return createPortal(
    <div
      className="no-drag"
      style={{
        position: 'fixed', top: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 6,
        background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 999, boxShadow: '0 6px 20px rgba(0,0,0,0.3)', padding: expanded ? '4px 6px 4px 10px' : '5px 6px 5px 12px',
        fontSize: 11.5,
      }}
    >
      {expanded ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); else if (e.key === 'Escape') onClose() }}
          onBlur={save}
          placeholder="Why'd you go here?"
          style={{
            width: 200, background: 'rgb(var(--color-surface-1))', border: '1px solid rgb(var(--color-surface-4))',
            borderRadius: 999, padding: '3px 10px', color: 'rgb(var(--color-text-primary))', fontSize: 11.5,
          }}
        />
      ) : (
        <button
          onClick={() => setExpanded(true)}
          style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-secondary))', cursor: 'pointer', fontSize: 11.5, padding: 0 }}
        >Why'd you go here? <span style={{ color: 'rgb(var(--color-text-muted))' }}>(optional)</span></button>
      )}
      <button
        onClick={onClose}
        title="Dismiss"
        style={{ background: 'transparent', border: 'none', color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 2, display: 'flex' }}
      ><X size={12} /></button>
    </div>,
    document.body
  )
}
