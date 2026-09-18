import { useState, useEffect } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { IconButton } from '@/components/ui'

/**
 * Windows min/max/close buttons for the frameless title bar. Only renders on Windows
 * (window.__berean_platform === 'win32'). Same 28px square IconButton recipe as the rest of
 * this bar's controls — no bespoke button styling — rather than Fluent-pixel-matched custom
 * SVGs; the app's one control language takes priority over platform-exact iconography here.
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

  return (
    <div className="flex items-center gap-1 flex-shrink-0 app-no-drag" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <IconButton
        icon={Minus}
        label="Minimize"
        shape="square"
        variant="ghost"
        size={28}
        onClick={() => window.windowControls?.minimize()}
      />
      <IconButton
        icon={isMaximized ? Copy : Square}
        label={isMaximized ? 'Restore' : 'Maximize'}
        shape="square"
        variant="ghost"
        size={28}
        onClick={() => window.windowControls?.maximize()}
      />
      <IconButton
        icon={X}
        label="Close"
        shape="square"
        variant="ghost"
        size={28}
        danger
        onClick={() => window.windowControls?.close()}
      />
    </div>
  )
}
