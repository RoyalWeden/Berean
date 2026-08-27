import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, MessageSquarePlus } from 'lucide-react'
import { useAppStore } from '@/store'
import { useStudyTrailStore } from '@/store/studyTrailSlice'
import { bookName } from '@/lib/parseRef'
import type { TrailConnection } from '@/types/studyTrail'
import ReasonPromptPopover, { TrailReasonFormBody } from './ReasonPromptPopover'

// Fixed width for the toast in BOTH collapsed and expanded states — per direct feedback ("width
// should be a fixed narrow width in both states, not shrink-to-fit; text wraps instead of the
// box growing/shrinking horizontally"). Round 4/5 had this grow 190->300px between states; that
// horizontal resize itself was part of what read as "busy."
const PILL_WIDTH = 250

// Mounted once in the main Bible-reader window (src/App.tsx) — per the plan's Phase 1 "auto-
// prompt in the main window" note, the "why did you jump chapters?" prompt needs to surface
// here, not only inside the separate Study Trail window, since that's where Michael is actually
// reading. Driven entirely by pendingArrivalPrompt (set by the recorder in studyTrailSlice.ts
// right after it records a tier-2/3 chapter connection) — nothing to fetch, nothing to poll.
//
// studyTrailAskChapterJumpReason now only decides WHICH of two UIs shows for that same
// pendingArrivalPrompt fact — the full draggable popup (on), or a small non-blocking toast (off)
// that still lets a reason be jotted down without the fuller "why did you jump here" workflow.
// Per direct feedback: "i think when i dont have the ask why thing toggle, i might want to still
// put the reason why i went to where i went so there should maybe be a little thing that pops up
// in the topbar."
export default function StudyTrailArrivalPrompt() {
  const conn = useStudyTrailStore((s) => s.pendingArrivalPrompt)
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
        onClose={clear}
        onSaved={clear}
      />
    )
  }
  return <ArrivalPill conn={conn} onClose={clear} />
}

/** The lightweight, non-blocking alternative to the full popup — a small toast pinned to the
 *  bottom-right corner (same corner/shape/z-index idiom as BgImportProgress.tsx, the app's
 *  existing floating-toast pattern — reused here rather than inventing a new one). Originally
 *  docked top-center, which sat directly over the presenter outline/trail sidebar area and
 *  effectively hid it on every tier-2/3 chapter jump; a corner toast never overlaps that.
 *
 *  Two states now, simplified per direct feedback ("the note box + two verse-tie columns should
 *  appear directly on hover — no click required" — the earlier three-state collapsed→hover-
 *  preview→click-to-commit design added a step nobody wanted):
 *   1. Collapsed — a single compact CTA line + dismiss ×.
 *   2. Hover-expanded — hovering alone reveals the REAL form (TrailReasonFormBody, the same
 *      note-textarea + From/To verse-tie columns the full popup uses — reused, not a second
 *      hand-rolled input). `autoFocusNote` is deliberately false here: hover shouldn't yank
 *      keyboard focus away from wherever the user actually is.
 *  `touched` (fires the first time any field in the form is actually typed into or focused —
 *  see TrailReasonFormBody's onFieldTouched) is what carries the round-3 "stays open once you've
 *  started" behavior forward: once true, mouseleave/blur/tab-switch is a total no-op — per direct
 *  feedback, "users will realistically alt-tab or switch Berean tabs mid-way through filling this
 *  in to go check a verse," so only Save, Not now, or the × can close it from then on. Before
 *  `touched`, it's still purely hover-driven (a glance that costs nothing to back out of). */
function ArrivalPill({ conn, onClose }: { conn: TrailConnection; onClose: () => void }) {
  const [hovering, setHovering] = useState(false)
  const [touched, setTouched] = useState(false)
  const expanded = touched || hovering
  // Sit behind the floating search / settings modal (z-50) while one is open.
  const modalOpen = useAppStore((s) => s.searchOpen || s.settingsOpen)
  // Icon-first collapsed state — per direct feedback ("icon-first with text-on-demand: show just
  // an icon + short reference at rest, explanatory text/buttons only once expanded"). Falls back
  // to the plain CTA text on the rare non-chapter connection (a Strong's/video/note destination)
  // where there's no book/chapter to shorten.
  const shortRef = conn.toBookId && conn.toChapter != null ? `${bookName(conn.toBookId)} ${conn.toChapter}` : null

  return createPortal(
    <div
      className="no-drag"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: modalOpen ? 40 : 200, width: PILL_WIDTH,
        background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
        borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.3)', overflow: 'hidden',
      }}
    >
      {/* Collapsed CTA — hidden once expanded (hover or touched); the form's own Save/Not now
          row plus the always-present × below take over as the toast's controls at that point.
          Text wraps within the fixed PILL_WIDTH rather than the box resizing to fit it. */}
      {!expanded && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 4px 6px 10px', fontSize: 11 }}>
          <MessageSquarePlus size={13} style={{ color: 'rgb(var(--color-text-muted))', flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, color: 'rgb(var(--color-text-secondary))' }}>
            {shortRef ? `Why'd you go to ${shortRef}?` : "Why'd you go here?"}
          </span>
          <button
            className="trail-ctx-btn"
            onClick={onClose}
            title="Dismiss"
            style={{ background: 'transparent', border: 'none', borderRadius: 6, color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0 }}
          ><X size={11} /></button>
        </div>
      )}
      {/* Real form — always mounted (so expanding never pops in unmeasured), collapsed to
          max-height:0/opacity:0 until hover or touch. Compact per direct feedback ("less text/
          explanation, tighter layout"): smaller padding/font than the full popup. */}
      <div style={{
        position: 'relative', maxHeight: expanded ? 2000 : 0, opacity: expanded ? 1 : 0, overflow: 'hidden',
        transition: 'max-height 160ms ease, opacity 130ms ease',
        padding: expanded ? '8px 10px 10px' : '0 10px', fontSize: 11,
      }}>
        {/* Header when expanded — keeps the "Why'd you go to …?" question visible at the top of
            the hover form (per direct feedback), with the dismiss × on the same row. Inline
            (not an absolute ×) so it never overlaps the note box and both tie columns keep the
            full uniform width. */}
        {expanded && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <MessageSquarePlus size={12} style={{ color: 'rgb(var(--color-text-muted))', flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: 'rgb(var(--color-text-secondary))' }}>
              {shortRef ? `Why'd you go to ${shortRef}?` : "Why'd you go here?"}
            </span>
            <button
              className="trail-ctx-btn"
              onClick={onClose}
              title="Dismiss"
              style={{
                background: 'transparent', border: 'none', borderRadius: 6,
                color: 'rgb(var(--color-text-muted))', cursor: 'pointer', padding: 2, display: 'flex', flexShrink: 0,
              }}
            ><X size={11} /></button>
          </div>
        )}
        <TrailReasonFormBody
          connection={conn}
          onClose={onClose}
          onSaved={onClose}
          onFieldTouched={() => setTouched(true)}
          autoSave
        />
      </div>
    </div>,
    document.body
  )
}
