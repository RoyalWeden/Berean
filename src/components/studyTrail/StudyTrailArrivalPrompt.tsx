import { useStudyTrailStore } from '@/store/studyTrailSlice'
import { bookName } from '@/lib/parseRef'
import ReasonPromptPopover from './ReasonPromptPopover'

// Mounted once in the main Bible-reader window (src/App.tsx) — per the plan's Phase 1 "auto-
// prompt in the main window" note, the opt-in "why did you jump chapters?" prompt needs to
// surface here, not only inside the separate Study Trail window, since that's where Michael is
// actually reading. Driven entirely by pendingArrivalPrompt (set by the recorder in
// studyTrailSlice.ts right after it records a tier-2/3 chapter connection, when
// studyTrailAskChapterJumpReason is on) — nothing to fetch, nothing to poll.
export default function StudyTrailArrivalPrompt() {
  const conn = useStudyTrailStore((s) => s.pendingArrivalPrompt)
  const clear = useStudyTrailStore((s) => s.clearPendingArrivalPrompt)
  if (!conn) return null
  const title = conn.toBookId && conn.toChapter != null
    ? `Why did you jump to ${bookName(conn.toBookId)} ${conn.toChapter}?`
    : undefined
  return (
    <ReasonPromptPopover
      connection={conn}
      title={title}
      showOriginPins
      permanentDismiss={false}
      onClose={clear}
      onSaved={clear}
    />
  )
}
