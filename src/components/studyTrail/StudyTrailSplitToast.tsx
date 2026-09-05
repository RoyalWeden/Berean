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
// Per feedback ("i like the thing that pops up at the bottom right... but i want it feeling more
// refreshed and less intrusive and simplified when opened") — a short fade+slide on the way in
// AND out, instead of the previous instant mount/unmount.
const TRANSITION_MS = 180

export default function StudyTrailSplitToast() {
  const proposal = useStudyTrailStore((s) => s.splitProposal)
  const accept = useStudyTrailStore((s) => s.acceptSplitProposal)
  const clear = useStudyTrailStore((s) => s.clearSplitProposal)
  const [remaining, setRemaining] = useState(AUTO_DISMISS_MS)
  // Kept separate from `proposal` itself so the toast can animate OUT before actually
  // unmounting — `proposal` going null (dismissed, accepted, or timed out) used to remove the
  // toast instantly with no exit transition at all.
  const [local, setLocal] = useState(proposal)
  const [phase, setPhase] = useState<'in' | 'shown' | 'out'>('in')

  useEffect(() => {
    if (proposal) {
      setLocal(proposal)
      setPhase('in')
      const raf = requestAnimationFrame(() => setPhase('shown'))
      return () => cancelAnimationFrame(raf)
    }
    setPhase('out')
    const t = setTimeout(() => setLocal(null), TRANSITION_MS)
    return () => clearTimeout(t)
  }, [proposal]) // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!local) return null
  const pct = Math.max(0, Math.min(1, remaining / AUTO_DISMISS_MS))
  const shown = phase === 'shown'

  return (
    <div style={{
      position: 'fixed', right: 18, bottom: 18, zIndex: 9999, width: 244,
      background: 'rgb(var(--color-surface-2))', border: '1px solid rgb(var(--color-surface-4))',
      borderRadius: 12, boxShadow: '0 6px 20px rgba(0,0,0,0.2)', overflow: 'hidden',
      opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(10px)',
      transition: `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease`,
    }}>
      <div style={{ padding: '9px 11px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <Scissors size={12} style={{ color: 'rgb(var(--color-accent))', flexShrink: 0, opacity: 0.85 }} />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgb(var(--color-text-primary))' }}>New study?</span>
          <span style={{ flex: 1 }} />
          <button
            onClick={clear}
            title="Keep the current trail"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'rgb(var(--color-text-muted))', opacity: 0.6 }}
          ><X size={11} /></button>
        </div>
        <div style={{ fontSize: 11, color: 'rgb(var(--color-text-secondary))', lineHeight: 1.4, marginBottom: 8 }}>
          Looks like a new study — {proposal?.reason ?? local.reason}.
        </div>
        {/* One clear primary action — the X above already covers "keep current", so a second,
            equally-weighted "Keep current" button here was a redundant control saying the same
            thing twice (per feedback, "less intrusive... simplified when opened"). */}
        <button
          onClick={() => { void accept() }}
          style={{
            width: '100%', fontSize: 11.5, fontWeight: 600, padding: '5px 8px', borderRadius: 7, cursor: 'pointer',
            background: 'rgb(var(--color-accent) / 0.16)', border: 'none', color: 'rgb(var(--color-accent))',
          }}
        >Start a new trail</button>
      </div>
      {/* Countdown bar — an auto-dismissing prompt with no visible timer reads as one that
          vanished for no reason. Thinner and lower-contrast than before, to match the toast's
          overall quieter footprint. */}
      <div style={{ height: 1.5, background: 'rgb(var(--color-accent) / 0.25)', width: `${pct * 100}%`, transition: 'width 250ms linear' }} />
    </div>
  )
}
