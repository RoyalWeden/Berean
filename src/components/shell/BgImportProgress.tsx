import { X, Loader2, CheckCircle2, XCircle, BookOpen } from 'lucide-react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'

// Floating non-blocking progress banner — clicking opens the Import modal.
// Mounts at the App root level so it's visible across all views.

export default function BgImportProgress() {
  // useShallow prevents re-renders when unrelated store slices change (object selector anti-pattern fix)
  const { bgImportPhase, bgImportDone, bgImportTotal, bgImportMessage,
    resetBgImport, openImportModal } = useAppStore(useShallow((s) => ({
      bgImportPhase: s.bgImportPhase,
      bgImportDone: s.bgImportDone,
      bgImportTotal: s.bgImportTotal,
      bgImportMessage: s.bgImportMessage,
      resetBgImport: s.resetBgImport,
      openImportModal: s.openImportModal,
    })))

  // Only show when an import is running or just finished (not idle)
  if (bgImportPhase === 'idle') return null

  const isRunning = bgImportPhase === 'login' || bgImportPhase === 'fetching' || bgImportPhase === 'saving'
  const isReview = bgImportPhase === 'review'
  const isDone = bgImportPhase === 'done'
  const isError = bgImportPhase === 'error'

  const pct = bgImportTotal > 0 ? Math.round((bgImportDone / bgImportTotal) * 100) : null

  const phaseLabel: Record<string, string> = {
    login:    'Signing in to BibleGateway…',
    fetching: 'Fetching notes from BibleGateway…',
    review:   'Notes ready to review',
    saving:   'Saving notes…',
    done:     'BibleGateway import complete',
    error:    'BibleGateway import failed',
  }

  return (
    <div className="fixed bottom-4 right-4 z-[200] pointer-events-auto">
      <div
        className="flex flex-col gap-2 w-72 rounded-xl bg-[rgb(var(--color-surface-2))] border border-[rgb(var(--color-surface-4))] shadow-xl p-3 cursor-pointer"
        onClick={openImportModal}
      >
        {/* Header row */}
        <div className="flex items-center gap-2">
          <BookOpen size={13} className="text-[rgb(var(--color-accent))] flex-shrink-0" />
          <span className="flex-1 text-[12px] font-semibold text-[rgb(var(--color-text-primary))] leading-tight truncate">
            {phaseLabel[bgImportPhase] ?? 'BibleGateway import'}
          </span>

          {isRunning && (
            <Loader2 size={13} className="animate-spin text-[rgb(var(--color-accent))] flex-shrink-0" />
          )}
          {isReview && (
            <CheckCircle2 size={13} className="text-yellow-400 flex-shrink-0" />
          )}
          {isDone && (
            <CheckCircle2 size={13} className="text-green-400 flex-shrink-0" />
          )}
          {isError && (
            <XCircle size={13} className="text-red-400 flex-shrink-0" />
          )}

          {/* Dismiss (only when done, error, or review) */}
          {!isRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); resetBgImport() }}
              className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-4))] transition-colors cursor-pointer flex-shrink-0"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          )}
        </div>

        {/* Progress bar (during fetch/save) */}
        {isRunning && pct !== null && (
          <div className="space-y-1">
            <div className="h-1 rounded-full bg-[rgb(var(--color-surface-4))] overflow-hidden">
              <div
                className="h-full rounded-full bg-[rgb(var(--color-accent))] transition-all duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
              {bgImportDone} / {bgImportTotal} notes
            </p>
          </div>
        )}

        {/* Message */}
        {bgImportMessage && (
          <p className="text-[10px] text-[rgb(var(--color-text-muted))] leading-relaxed line-clamp-2">
            {bgImportMessage}
          </p>
        )}

        {/* Click hint */}
        {!isRunning && (
          <p className="text-[10px] text-[rgb(var(--color-text-muted))]">
            Click to open import
          </p>
        )}
      </div>
    </div>
  )
}
