import { useEffect, useState } from 'react'
import { Scissors, X } from 'lucide-react'
import { useStudyTrailStore } from '@/store/studyTrailSlice'

// The main window's half of "automatic but confirmable" session detection. When the recorder
// notices what looks like the start of a new study — a long break, or a jump to an unrelated book
// — it raises a proposal (studyTrailSlice.proposeSplit) rather than splitting anything. This is
// the toast that offers it.
//
// Per direct feedback the answer was "both — toast now, banner as fallback": if this is missed or
// ignored, the Study Trail window shows the same proposal as a banner you can act on later, so
// nothing depends on catching a transient toast (see StudyTrailApp.tsx).
//
// Timing out means KEEP THE CURRENT SESSION, never split. An unattended prompt must always decay
// to the conservative option — silently reorganising someone's study because they were reading
// and didn't look at a toast would be exactly the wrong default.
const AUTO_DISMISS_MS = 15_000

export default function StudyTrailSplitToast() {
  const proposal = useStudyTrailStore((s) => s.splitProposal)
  const accept = useStudyTrailStore((s) => s.acceptSplitProposal)
  const clear = useStudyTrailStore((s) => s.clearSplitProposal)
  const [remaining, setRemaining] = useState(AUTO_DISMISS_MS)

  useEffect(() => {
    if (!proposal) return
    setRemaining(AUTO_DISMISS_MS)
    const started = Date.now()
    const tick = setInterval(() => {
      const left = AUTO_DISMISS_MS - (Date.now() - started)
      setRemaining(left)
      if (left <= 0) clear()
    }, 250)
    return () => clearInterval(tick)
  }, [proposal, clear])

  if (!proposal) return null
  const pct = Math.max(0, Math.min(1, remaining / AUTO_DISMISS_MS))

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 18, zIndex: 9999, width: 268,
      background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
      borderRadius: 12, boxShadow: '0 10px 32px rgba(0,0,0,0.34)', overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
          <Scissors size={13} style={{ color: 'rgb(var(--color-accent))', flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgb(var(--color-text-primary))' }}>New study?</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={clear}
            title="Keep the current trail"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.7 }}
          ><X size={12} /></button>
        </div>
        <div style={{ fontSize: 11.5, color: 'rgb(var(--color-text-secondary))', lineHeight: 1.45, marginBottom: 9 }}>
          This looks like the start of something new — {proposal.reason}. Start a separate trail from here?
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={() => { void accept() }}
            style={{
              flex: 1, fontSize: 11.5, fontWeight: 600, padding: '5px 8px', borderRadius: 7, cursor: 'pointer',
              background: 'rgb(var(--color-accent) / 0.18)', border: 'none', color: 'rgb(var(--color-accent))',
            }}
          >Start a new trail</button>
          <button
            onClick={clear}
            style={{
              flex: 1, fontSize: 11.5, padding: '5px 8px', borderRadius: 7, cursor: 'pointer',
              background: 'transparent', border: '1px solid rgb(var(--color-surface-4))', color: 'rgb(var(--color-text-muted))',
            }}
          >Keep current</button>
        </div>
      </div>
      {/* Countdown bar — an auto-dismissing prompt with no visible timer reads as one that
          vanished for no reason. */}
      <div style={{ height: 2, background: 'rgb(var(--color-accent) / 0.4)', width: `${pct * 100}%`, transition: 'width 250ms linear' }} />
    </div>
  )
}
