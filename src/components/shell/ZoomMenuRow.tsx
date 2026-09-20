import { useState } from 'react'
import { ZoomIn, Minus, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { zoomPercent, ZOOM_MIN, ZOOM_MAX } from '@/lib/zoom'
import { IconButton, TextField, Button } from '@/components/ui'

/**
 * Zoom row, shown from the rail's Zoom button. Replaces the old per-panel
 * (Scripture/Notes/Lexicon each independently zoomable) version — zooming
 * "just the lexicon" while everything else stayed put read as confusing, so
 * this now drives one shared `appZoom` value. See lib/zoom.ts for exactly
 * which surfaces it applies to (reading-pane font size, plus TopBar.tsx and
 * the Notes/Lexicon/YouTube side panel via CSS `zoom`) — the sidebar/rail
 * itself stays a fixed size regardless of zoom. Adds a real text input so an
 * exact percentage can be typed rather than only stepped by ±10%.
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
      <ZoomIn size={14} className="flex-shrink-0 text-text-primary" />
      <span className="flex-1 text-footnote text-text-primary">Zoom</span>
      {/* No tooltips inside this row — it already floats as a hover surface; a tooltip on top of it stacked two layers. */}
      <IconButton icon={Minus} label="Zoom out" tooltip={false} size={24} onClick={() => adjust(-1)} />
      <TextField
        type="text"
        inputMode="numeric"
        value={displayValue}
        aria-label={`Zoom level — type an exact percentage (${Math.round(ZOOM_MIN * 100)}–${Math.round(ZOOM_MAX * 100)})`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ''))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).blur() }
          if (e.key === 'Escape') { e.preventDefault(); setDraft(null); (e.target as HTMLInputElement).blur() }
        }}
        size="sm"
        className="h-6 w-11 px-1 text-center tabular-nums"
        wrapperClassName="w-11 flex-shrink-0"
      />
      <IconButton icon={Plus} label="Zoom in" tooltip={false} size={24} onClick={() => adjust(1)} />
      <Button variant="ghost" size="xs" className="flex-shrink-0" onClick={() => reset()} aria-label="Reset to 100% (⌘0)">
        Reset
      </Button>
    </div>
  )
}
