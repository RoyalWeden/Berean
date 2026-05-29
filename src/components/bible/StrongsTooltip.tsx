import { useState, useCallback } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import type { LexiconEntry } from '@/types'
import { useAppStore } from '@/store'

interface StrongsTooltipProps {
  children: React.ReactNode
  strongsNum: string
  onClickEntry?: (strongsNum: string) => void
}

export default function StrongsTooltip({ children, strongsNum, onClickEntry }: StrongsTooltipProps) {
  const [entry, setEntry] = useState<LexiconEntry | null>(null)
  const [loaded, setLoaded] = useState(false)

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
    <Tooltip.Provider delayDuration={300}>
      <Tooltip.Root onOpenChange={handleOpenChange}>
        <Tooltip.Trigger asChild>
          <span
            className="cursor-pointer"
            onClick={() => onClickEntry?.(strongsNum)}
          >
            {children}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={4}
            className="
              z-50 max-w-xs rounded-lg shadow-xl
              bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))]
              px-3 py-2.5
              animate-in fade-in-0 zoom-in-95
            "
          >
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
                  <p className="text-xs text-[rgb(var(--color-text-secondary))] leading-snug">{entry.gloss}</p>
                )}
              </div>
            ) : (
              <span className="text-xs text-[rgb(var(--color-text-muted))]">No entry for {strongsNum}</span>
            )}
            <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
