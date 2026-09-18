import { useEffect, useState } from 'react'
import { Scissors, X } from 'lucide-react'
import { useStudyTrailStore } from '@/store/studyTrailSlice'
import { IconButton, Button } from '@/components/ui'

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
  const arrivalPillRect = useStudyTrailStore((s) => s.arrivalPillRect)
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
  // Stack above the arrival-prompt toast (StudyTrailArrivalPrompt.tsx's ArrivalPill) when it's
  // ALSO currently showing in this same corner, instead of sharing its exact right/bottom and
  // overlapping it — per direct feedback ("the new study prompt should show above the study
  // trail toast... not on top of it"). arrivalPillRect is null whenever that toast isn't up.
  // Flush to the same 16px corner every other floating toast uses (BgImportProgress, the
  // arrival pill) when nothing else is in this corner — 18 read as "a little away from the
  // bottom-right." Only when the arrival pill is up do we stack above it.
  const right = arrivalPillRect ? arrivalPillRect.right : 16
  const bottom = arrivalPillRect ? arrivalPillRect.bottom + arrivalPillRect.height + 10 : 16

  return (
    <div
      className="fixed z-critical w-[244px] material-popover rounded-menu overflow-hidden"
      style={{
        right, bottom,
        opacity: shown ? 1 : 0, transform: shown ? 'translateY(0)' : 'translateY(10px)',
        transition: `opacity ${TRANSITION_MS}ms ease, transform ${TRANSITION_MS}ms ease, bottom 160ms ease`,
      }}
    >
      <div className="p-2.5">
        <div className="flex items-center gap-1.5 mb-1">
          <Scissors size={12} className="text-accent flex-shrink-0 opacity-85" />
          <span className="text-footnote font-semibold text-text-primary">New study?</span>
          <span className="flex-1" />
          <IconButton icon={X} label="Keep the current trail" size={20} variant="ghost" tooltip={false} onClick={clear} />
        </div>
        <div className="text-footnote text-text-secondary leading-relaxed mb-2">
          Looks like a new study — {proposal?.reason ?? local.reason}.
        </div>
        {/* One clear primary action — the X above already covers "keep current", so a second,
            equally-weighted "Keep current" button here was a redundant control saying the same
            thing twice (per feedback, "less intrusive... simplified when opened"). */}
        <Button variant="ghost" selected size="sm" className="w-full" onClick={() => { void accept() }}>Start a new trail</Button>
      </div>
      {/* Countdown bar — an auto-dismissing prompt with no visible timer reads as one that
          vanished for no reason. Thinner and lower-contrast than before, to match the toast's
          overall quieter footprint. */}
      <div className="h-[1.5px] bg-accent/25" style={{ width: `${pct * 100}%`, transition: 'width 250ms linear' }} />
    </div>
  )
}
