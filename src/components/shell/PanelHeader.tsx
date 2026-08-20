import type { ReactNode } from 'react'

/**
 * Shared header chrome for every tab-panel type (Bible, Notes, Lexicon,
 * YouTube, Search). Standardizes height, padding, and drag-region behavior so
 * floating windows are always draggable from the header and docked panels
 * always clear the traffic-light cluster consistently — previously each
 * panel reimplemented this independently and drifted (Lexicon and YouTube
 * dropped `app-drag-region` in docked mode; Search never had floating
 * handling at all).
 *
 * `floating` gets its own distinct look: no bar background at all (the row
 * itself is fully transparent, laid directly over the panel's own content,
 * so any plain text/spacer sitting between controls stays fully visible
 * against the panel behind it) — each actual CONTROL (a button/link, or an
 * `ActionPillGroup` cluster) instead floats on its own as a small frosted
 * chip, via the `.floating-header-buttons` CSS rule in global.css. That rule
 * deliberately targets only `button`/`a`/`[role=button]`/`.action-pill-group`
 * among this row's direct children — not every direct child indiscriminately
 * — so a layout spacer or plain text sibling never gets an unwanted chip
 * background of its own. See that rule's own comment for the radius handling
 * too (forced to a full pill on plain controls, since most have none of
 * their own — left alone on `.action-pill-group`, which already has one).
 * A "Pop Out Tab" window (FloatingShell.tsx) is a real separate top-level
 * BrowserWindow, plain and OPAQUE (no `transparent`/`vibrancy`, see
 * createFloatingWindow in main.ts) — `.floating-header-buttons`'s chips use
 * `backdrop-filter` (blurs the app's OWN DOM behind them, i.e. content
 * scrolling under the header) rather than `.topbar-vibrant`'s OS-level
 * vibrancy, which needs window transparency to have anything behind it to
 * blur and would just be a flat tint here.
 */
export default function PanelHeader({
  floating = false,
  children,
  className = '',
}: {
  floating?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`flex items-center gap-2 h-11 flex-shrink-0 app-drag-region ${
        floating
          ? 'floating-header-buttons pl-[76px] pr-4'
          : 'border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] px-4'
      } ${className}`}
    >
      {children}
    </div>
  )
}
