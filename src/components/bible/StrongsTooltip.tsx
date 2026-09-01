import { useState, useCallback, useEffect, useRef } from 'react'
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

// Broadcast so that opening one Strong's tooltip force-closes any other that's still showing —
// Radix's own close delay otherwise leaves the previous one up when you skim quickly from one
// number to the next.
const STRONGS_TOOLTIP_OPEN_EVENT = 'berean:strongsTooltipOpen'

export default function StrongsTooltip({ children, strongsNum, onClickEntry, contextNote }: StrongsTooltipProps) {
  const [entry, setEntry] = useState<LexiconEntry | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [open, setOpen] = useState(false)
  const selfId = useRef<object>({})
  // True while the pointer is genuinely over THIS trigger — guards against a stray broadcast
  // from an adjacent (overlapping) chip closing the tooltip the user is actually pointing at,
  // which otherwise showed up as the card flickering / never settling open.
  const pointerOverRef = useRef(false)
  useEffect(() => {
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== selfId.current && !pointerOverRef.current) setOpen(false)
    }
    window.addEventListener(STRONGS_TOOLTIP_OPEN_EVENT, onOther)
    return () => window.removeEventListener(STRONGS_TOOLTIP_OPEN_EVENT, onOther)
  }, [])
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const wr = (t: string) => wordReplacerEnabled && wordReplacerRules.length ? applyWordReplacer(t, wordReplacerRules) : t

  // Strong's definitions reference other entries as bare numbers ("Compare 3050, 3069.") — the
  // language letter is implied. Put the H/G back (same language as this entry) so they read as
  // real Strong's numbers instead of "Compare 3050".
  const langLetter = strongsNum.trim().charAt(0).toUpperCase() === 'G' ? 'G' : 'H'
  const restoreStrongsPrefixes = (t: string) =>
    t.replace(/((?:compare|see|from|akin to)\b[^.;]*)/gi, (clause) =>
      clause.replace(/(^|[\s(,])(\d{2,5})(?![.\d])/g, `$1${langLetter}$2`))

  // Reset when strongsNum changes so a recycled component instance always re-fetches
  useEffect(() => {
    setEntry(null)
    setLoaded(false)
  }, [strongsNum])

  const triggerRef = useRef<HTMLSpanElement>(null)
  // The number pill sits BELOW its word (absolute, top:100%). We want the hover card to appear
  // above the WORD (so the word is visible with the definition), not just above the pill — so
  // on open, measure the gap from the word's top to the pill's top and use that as the extra
  // side-offset. Radix's own avoidCollisions still flips the card downward when it would clip
  // the top of the window.
  const [sideOffset, setSideOffset] = useState(4)

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next)
    if (next) {
      window.dispatchEvent(new CustomEvent(STRONGS_TOOLTIP_OPEN_EVENT, { detail: selfId.current }))
      useAppStore.getState().bumpStrongsHoverToken()
      const wrap = triggerRef.current?.closest<HTMLElement>('[data-sw-idx]')
      const wordEl = wrap?.firstElementChild as HTMLElement | undefined
      if (wordEl && triggerRef.current) {
        const wordTop = wordEl.getBoundingClientRect().top
        const gap = triggerRef.current.getBoundingClientRect().top - wordTop
        // Lift the card to just above the word — but only when there's room above. Near the top
        // of the window Radix will flip it downward; use a small offset there so the flipped
        // card sits tidily just under the pill instead of a line-height below it.
        const roomAbove = wordTop > 160
        setSideOffset(roomAbove ? Math.round(Math.max(4, gap + 6)) : 4)
      }
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
    <Tooltip.Root open={open} onOpenChange={handleOpenChange}>
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
            ref={triggerRef}
            className="cursor-pointer leading-none text-[10px]"
            onClick={() => onClickEntry?.(strongsNum)}
            onPointerEnter={() => { pointerOverRef.current = true }}
            onPointerLeave={() => { pointerOverRef.current = false }}
          >
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side="top" sideOffset={sideOffset} collisionPadding={8} className="z-50 max-w-xs">
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
                    <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-snug">{restoreStrongsPrefixes(wr(entry.gloss))}</p>
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
