import { useState, useCallback, useEffect } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { LexiconEntry } from '@/types'
import { useAppStore } from '@/store'
import { applyWordReplacer } from '@/lib/wordReplacer'

interface StrongsTooltipProps {
  children: React.ReactNode
  strongsNum: string
  onClickEntry?: (strongsNum: string) => void
  /** Extra context line shown above the entry (e.g. "Secondary Strong's number",
   *  "Parenthetical — grammatical particle..."). Replaces a native title="" tooltip. */
  contextNote?: string
}

export default function StrongsTooltip({ children, strongsNum, onClickEntry, contextNote }: StrongsTooltipProps) {
  const [entry, setEntry] = useState<LexiconEntry | null>(null)
  const [loaded, setLoaded] = useState(false)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const wr = (t: string) => wordReplacerEnabled && wordReplacerRules.length ? applyWordReplacer(t, wordReplacerRules) : t

  // Reset when strongsNum changes so a recycled component instance always re-fetches
  useEffect(() => {
    setEntry(null)
    setLoaded(false)
  }, [strongsNum])

  const handleOpenChange = useCallback((open: boolean) => {
    if (open) {
      useAppStore.getState().bumpStrongsHoverToken()
      if (!loaded) {
        window.lexicon.getEntry(strongsNum)
          .then((e) => { setEntry(e ?? null); setLoaded(true) })
          .catch(() => setLoaded(true))
      }
    }
  }, [strongsNum, loaded])

  return (
    // No Tooltip.Provider here — one is now hoisted per-chapter in ChapterView.tsx so adjacent
    // Strong's chips can share its `skipDelayDuration` fast-rehover window instead of every
    // single word re-incurring the full open delay. See that file's comment for why one provider
    // per chapter (not a global singleton) is the deliberate granularity.
    <Tooltip.Root onOpenChange={handleOpenChange}>
        <Tooltip.Trigger asChild>
          {/* text-[10px] + leading-none are both load-bearing, together: `leading-none` alone
              (line-height: 1) still resolves against whatever font-size this span INHERITS from
              the surrounding verse text (e.g. ~16px), not the ~9-10px chip actually rendered
              inside it — every caller here passes a small Strong's-number chip as `children`, so
              pinning the trigger's own font-size to match removes that ambiguity and gives an
              unambiguous, tight box instead of a still-oversized one at 1×16px. Without a fixed
              font-size, this span was previously ~16px tall regardless of leading-none, both
              throwing off hover alignment and (via StrongsInline.tsx's now-removed negative
              margin, which was tuned against the OLD ~25px height) making the box tall enough to
              visually swallow/overlap a stacked secondary number entirely. */}
          <span
            className="cursor-pointer leading-none text-[10px]"
            onClick={() => onClickEntry?.(strongsNum)}
          >
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={4} className="z-50 max-w-xs">
            {/* Radix Content owns the positioning transform (Popper) — the entrance
                animation lives on this inner wrapper instead, so the two never fight
                over the `transform` property (see global.css radix-popup-in comment).
                No data-state gating needed: Radix unmounts Content when closed, so
                every mount of this inner div is already a fresh "just opened" event —
                the CSS animation plays on insertion regardless. */}
            <div
              className="
                rounded-shell glass-panel px-3 py-2.5
                origin-[var(--radix-tooltip-content-transform-origin)]
                animate-radix-popup-in
              "
            >
              {contextNote && (
                <p className="text-[10px] text-[rgb(var(--color-text-muted))] italic leading-snug mb-1.5 pb-1.5 border-b border-[rgb(var(--color-surface-4))]">
                  {contextNote}
                </p>
              )}
              {!loaded ? (
                <span className="text-xs text-[rgb(var(--color-text-muted))]">Loading…</span>
              ) : entry ? (
                <div className="space-y-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono font-semibold text-[rgb(var(--color-accent))]">{entry.strongsNum}</span>
                    <span className="text-sm font-medium text-[rgb(var(--color-text-primary))]">{entry.lemma}</span>
                    {entry.transliteration && (
                      <span className="text-xs text-[rgb(var(--color-text-muted))] italic">({entry.transliteration})</span>
                    )}
                  </div>
                  {entry.gloss && (
                    <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-snug">{wr(entry.gloss)}</p>
                  )}
                </div>
              ) : (
                <span className="text-xs text-[rgb(var(--color-text-muted))]">No entry for {strongsNum}</span>
              )}
            </div>
            <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
  )
}
