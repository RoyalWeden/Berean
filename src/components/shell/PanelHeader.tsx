import type { ReactNode } from 'react'

/**
 * Shared header chrome for every tab-panel type (Bible, Notes, Lexicon,
 * YouTube, Search). Standardizes height, padding, and drag-region behavior so
 * floating windows are always draggable from the header and docked panels
 * always clear the traffic-light cluster consistently — previously each
 * panel reimplemented this independently and drifted (Lexicon and YouTube
 * dropped `app-drag-region` in docked mode; Search never had floating
 * handling at all).
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
      className={`flex items-center gap-2 h-11 flex-shrink-0 border-b border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] app-drag-region ${
        floating ? 'pl-[76px] pr-4' : 'px-4'
      } ${className}`}
    >
      {children}
    </div>
  )
}
