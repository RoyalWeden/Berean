import { useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { useAppStore } from '@/store'
import { zoomPercent, ZOOM_MIN, ZOOM_MAX } from '@/lib/zoom'

/**
 * App-wide zoom row, shown from the rail's Zoom button. Replaces the old
 * per-panel (Scripture/Notes/Lexicon each independently zoomable) version —
 * zooming "just the lexicon" while everything else stayed put read as
 * confusing, so this now drives one shared `appZoom` value applied via CSS
 * zoom to the whole app shell (App.tsx). Adds a real text input so an exact
 * percentage can be typed rather than only stepped by ±10%.
 */
export default function ZoomMenuRow() {
  const level = useAppStore((s) => s.appZoom)
  const adjust = useAppStore((s) => s.adjustAppZoom)
  const reset = useAppStore((s) => s.resetAppZoom)
  const setZoom = useAppStore((s) => s.setAppZoom)
  const [draft, setDraft] = useState<string | null>(null)

  function commit(raw: string) {
    const n = parseInt(raw.replace(/[^\d]/g, ''), 10)
    if (Number.isFinite(n)) setZoom(n / 100)
    setDraft(null)
  }

  const displayValue = draft ?? String(Math.round(parseFloat(zoomPercent(level))))

  return (
    <div className="flex items-center gap-1.5 w-full px-2.5 py-1.5">
      <span className="flex-shrink-0 text-[rgb(var(--color-text-primary))] [&_svg]:w-3.5 [&_svg]:h-3.5"><ZoomIn /></span>
      <span className="flex-1 text-xs text-[rgb(var(--color-text-primary))]">Zoom</span>
      <button
        onClick={() => adjust(-1)}
        title="Zoom out (⌘−)"
        className="flex items-center justify-center w-5 h-5 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors text-xs leading-none font-medium"
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        value={displayValue}
        title={`Zoom level — type an exact percentage (${Math.round(ZOOM_MIN * 100)}–${Math.round(ZOOM_MAX * 100)})`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null); (e.target as HTMLInputElement).blur() }
        }}
        className="w-9 text-center text-[11px] tabular-nums bg-[rgb(var(--color-surface-4))] rounded px-0.5 py-0.5 text-[rgb(var(--color-text-primary))] outline-none focus:ring-1 focus:ring-[rgb(var(--color-accent))]"
      />
      <button
        onClick={() => adjust(1)}
        title="Zoom in (⌘+)"
        className="flex items-center justify-center w-5 h-5 rounded cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-4))] hover:text-[rgb(var(--color-text-primary))] transition-colors text-xs leading-none font-medium"
      >
        +
      </button>
      <button
        onClick={() => reset()}
        title="Reset to 100% (⌘0)"
        className="flex-shrink-0 text-[10px] text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))] cursor-pointer transition-colors"
      >
        Reset
      </button>
    </div>
  )
}
