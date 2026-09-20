import * as RT from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'
import ShortcutKeys from '@/components/shell/ShortcutKeys'

/**
 * The one tooltip. Shows a control's name and, optionally, its shortcut as keycaps.
 * Self-contained (own Provider) so it works anywhere. Replaces HintTooltip and the 16
 * inline copies of the Radix recipe that used to live in Ribbon/Sidebar/ShellHeader/….
 *
 * The entrance animation lives on the INNER div, never on Tooltip.Content — Radix Popper
 * owns Content's transform for positioning and a CSS animation touching transform there
 * would fight it (see global.css's radix-popup-in comment).
 */
export function Tooltip({
  label,
  shortcut,
  side = 'bottom',
  align = 'center',
  delay = 350,
  disabled = false,
  children,
}: {
  label: ReactNode
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  delay?: number
  /** Render children only (no tooltip) — handy when a label is conditionally absent. */
  disabled?: boolean
  children: ReactNode
}) {
  if (disabled || !label) return <>{children}</>
  return (
    <RT.Provider delayDuration={delay} skipDelayDuration={300}>
      <RT.Root>
        <RT.Trigger asChild>{children}</RT.Trigger>
        <RT.Portal>
          <RT.Content side={side} align={align} sideOffset={6} collisionPadding={8} className="z-popover">
            <div className="material-popover rounded-card flex items-center gap-2 px-2 py-1 text-caption text-text-primary select-none animate-radix-popup-in">
              <span className="whitespace-nowrap">{label}</span>
              {shortcut && <ShortcutKeys keys={shortcut} className="whitespace-nowrap" />}
            </div>
          </RT.Content>
        </RT.Portal>
      </RT.Root>
    </RT.Provider>
  )
}

export default Tooltip
