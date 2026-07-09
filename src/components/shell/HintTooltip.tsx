import * as Tooltip from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

/**
 * Shared hover hint that shows a button's function and (optionally) its keyboard
 * shortcut as a styled key chip. Self-contained (includes its own Provider) so it
 * works anywhere without a global TooltipProvider.
 *
 * Usage:
 *   <HintTooltip label="Find in chapter" shortcut="⌘F">
 *     <button>…</button>
 *   </HintTooltip>
 */
export function HintTooltip({
  label,
  shortcut,
  side = 'bottom',
  children,
}: {
  label: string
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  children: ReactNode
}) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={300}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side={side}
            sideOffset={6}
            collisionPadding={8}
            className="z-[400] flex items-center gap-2 px-2 py-1 rounded-md text-xs bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] shadow-lg select-none data-[state=delayed-open]:animate-radix-popup-in data-[state=instant-open]:animate-radix-popup-in"
          >
            <span className="whitespace-nowrap">{label}</span>
            {shortcut && (
              <kbd className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))] whitespace-nowrap">
                {shortcut}
              </kbd>
            )}
            <Tooltip.Arrow className="fill-[rgb(var(--color-surface-4))]" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
