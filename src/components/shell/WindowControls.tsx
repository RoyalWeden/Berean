import { useState, useEffect } from 'react'

/**
 * Native-style Windows min/max/close buttons for the frameless title bar.
 * Only renders on Windows (window.__berean_platform === 'win32').
 *
 * Follows Windows 11 Fluent sizing and hover colours:
 *   Minimize / Maximize: 46×32px, subtle grey hover
 *   Close:               46×32px, #C42B1C red hover
 */
export default function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false)

  useEffect(() => {
    // Fetch initial state
    window.windowControls?.isMaximized().then(setIsMaximized).catch(() => {})
    // Subscribe to changes
    window.windowControls?.onMaximizeChange(setIsMaximized)
  }, [])

  if (window.__berean_platform !== 'win32') return null

  const btnBase =
    'flex items-center justify-center flex-shrink-0 h-8 w-[46px] ' +
    'transition-colors duration-75 cursor-pointer select-none ' +
    'text-[rgb(var(--color-text-primary))] app-no-drag'

  return (
    <div className="flex items-center flex-shrink-0 h-8 app-no-drag" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {/* Minimize — ─ */}
      <button
        className={`${btnBase} hover:bg-white/10`}
        title="Minimize"
        onClick={() => window.windowControls?.minimize()}
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
          <rect width="10" height="1" />
        </svg>
      </button>

      {/* Maximize / Restore */}
      <button
        className={`${btnBase} hover:bg-white/10`}
        title={isMaximized ? 'Restore' : 'Maximize'}
        onClick={() => window.windowControls?.maximize()}
      >
        {isMaximized ? (
          /* Restore — overlapping squares ❐ */
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="2" y="0" width="8" height="8" />
            <polyline points="0,2 0,10 8,10" />
          </svg>
        ) : (
          /* Maximize — single square □ */
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="0" y="0" width="10" height="10" />
          </svg>
        )}
      </button>

      {/* Close — × */}
      <button
        className={`${btnBase} hover:bg-[#C42B1C] hover:text-white`}
        title="Close"
        onClick={() => window.windowControls?.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
          <line x1="0" y1="0" x2="10" y2="10" />
          <line x1="10" y1="0" x2="0" y2="10" />
        </svg>
      </button>
    </div>
  )
}
