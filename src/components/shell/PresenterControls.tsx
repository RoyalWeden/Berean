import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Cast, MousePointer2, Highlighter, PanelRight, RefreshCw, X, GripVertical, MonitorPlay, Minus, Eye } from 'lucide-react'
import { useAppStore } from '@/store'
import { pushCurrentToViewer } from '@/hooks/useViewerSync'
import { IconButton, Switch, Button, Badge } from '@/components/ui'
import type { BibleTabState } from '@/types'

/** Current active scripture chapter (the chapter the presenter mirrors), for overlay clears. */
function activeScriptureChapter(): { bookId: string; chapter: number } | null {
  const s = useAppStore.getState()
  const id = s.activeTabId['scripture']
  const t = id ? s.tabs['scripture'].find((x) => x.id === id) : null
  const bs = t?.state as BibleTabState | undefined
  return bs?.bookId ? { bookId: bs.bookId, chapter: bs.chapter } : null
}

// The row is a div (not a button) because it wraps a real <Switch> button — the interactive
// switch carries the `role="switch"` semantics; the row's own onClick just extends the click
// target to the whole row, stopping propagation from the switch itself so a click there doesn't
// also bubble up and fire the row's handler a second time.
function ToggleRow({ icon, label, on, onClick }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  // The whole row is one keyboard unit (role=switch): Tab reaches it, Space/Enter toggles.
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="focus-ring w-full flex items-center gap-2 px-2.5 py-1.5 rounded-row cursor-pointer transition-colors hover:bg-surface-hover"
    >
      <span className={on ? 'text-accent' : 'text-text-muted'}>{icon}</span>
      <span className={`flex-1 text-left text-footnote font-medium ${on ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
      <span className={`text-micro font-semibold uppercase tracking-wide ${on ? 'text-accent' : 'text-text-muted'}`}>{on ? 'On' : 'Off'}</span>
      <Switch checked={on} onCheckedChange={onClick} label={label} decorative />
    </button>
  )
}

export default function PresenterControls() {
  // Drop behind the floating search / settings modal (both z-50) when one is open, so those
  // overlays sit fully in front of the presenter pill instead of it floating over them.
  const modalOpen = useAppStore((s) => s.searchOpen || s.settingsOpen)
  const zClass = modalOpen ? 'z-raised' : 'z-overlay'
  const viewerWindowOpen = useAppStore((s) => s.viewerWindowOpen)
  const viewerPaused = useAppStore((s) => s.viewerPaused)
  const presenterRange = useAppStore((s) => s.presenterRange)
  const setViewerPaused = useAppStore((s) => s.setViewerPaused)
  const setViewerWindowOpen = useAppStore((s) => s.setViewerWindowOpen)
  const laserEnabled = useAppStore((s) => s.viewerLaserEnabled)
  const setLaserEnabled = useAppStore((s) => s.setViewerLaserEnabled)
  const selectionMirror = useAppStore((s) => s.viewerSelectionMirror)
  const setSelectionMirror = useAppStore((s) => s.setViewerSelectionMirror)
  const sidePanelEnabled = useAppStore((s) => s.viewerSidePanelEnabled)
  const setSidePanelEnabled = useAppStore((s) => s.setViewerSidePanelEnabled)
  const blank = useAppStore((s) => s.viewerBlank)
  const setBlank = useAppStore((s) => s.setViewerBlank)

  const [collapsed, setCollapsed] = useState(false)
  // Position: default bottom-right; switches to absolute coords once dragged.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const dragRef = useRef<{ dx: number; dy: number } | null>(null)

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragRef.current) return
      setPos({ left: e.clientX - dragRef.current.dx, top: e.clientY - dragRef.current.dy })
    }
    function onUp() { dragRef.current = null }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [])

  if (!viewerWindowOpen) return null

  function startDrag(e: React.MouseEvent) {
    e.preventDefault() // don't start a text selection while dragging
    const root = (e.currentTarget as HTMLElement).closest('[data-presenter-controls]') as HTMLElement
    const r = root.getBoundingClientRect()
    dragRef.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    setPos({ left: r.left, top: r.top })
  }

  function clearOverlay(part: { laser?: null; selection?: null }) {
    const ref = activeScriptureChapter()
    if (ref) window.app.pushViewerOverlay?.({ ...ref, ...part })
  }
  function toggleSync() {
    const nowPaused = !viewerPaused
    setViewerPaused(nowPaused)
    if (!nowPaused) {
      pushCurrentToViewer()
      // The presenter's last-reported visible region may be stale relative to tab switches
      // that happened in the main window while paused. If the landed-on chapter happens to be
      // the same one the presenter was frozen on, the content push above is a no-op for the
      // viewer (no reload → no fresh report) — force one explicitly so the outline band can't
      // get stuck hidden.
      window.app.requestViewerVisibleRegion?.()
    }
  }
  function toggleLaser() {
    const next = !laserEnabled
    setLaserEnabled(next)
    if (!next) clearOverlay({ laser: null })
  }
  function toggleSelection() {
    const next = !selectionMirror
    setSelectionMirror(next)
    if (!next) clearOverlay({ selection: null })
  }
  function toggleBlank() {
    const next = !blank
    setBlank(next)
    if (next) window.app.pushViewerContent?.({ kind: 'idle' })
    else pushCurrentToViewer()
  }
  // Closing the controls closes the presenter window.
  function closePresenter() {
    window.app.closeViewerWindow?.()
    setViewerWindowOpen(false)
  }

  // Collapsed: a small draggable pill that expands on click.
  if (collapsed) {
    return createPortal(
      <div
        data-presenter-controls
        onMouseDown={startDrag}
        onClick={() => setCollapsed(false)}
        className={`fixed ${zClass} flex items-center gap-1.5 px-2.5 py-1.5 rounded-control material-popover cursor-pointer`}
        style={{ ...(pos ? { left: pos.left, top: pos.top } : { right: 20, bottom: 20 }), userSelect: 'none', WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties}
        title="Expand presenter controls"
      >
        <MonitorPlay size={14} className="text-accent" />
        <span className="text-caption font-semibold text-text-primary">Presenter</span>
        {presenterRange && !viewerPaused && <span className="text-meta">v.{presenterRange.first}{presenterRange.last !== presenterRange.first ? `–${presenterRange.last}` : ''}</span>}
        {viewerPaused ? <Badge variant="text" tone="warning">Paused</Badge> : <Badge variant="live" tone="accent" label="Live" />}
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      data-presenter-controls
      className={`fixed ${zClass} w-[224px] material-popover rounded-menu`}
      style={{ ...(pos ? { left: pos.left, top: pos.top } : { right: 20, bottom: 20 }), userSelect: 'none', WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties}
    >
      {/* Header: drag handle + collapse + close */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-separator">
        <div onMouseDown={startDrag} className="flex items-center gap-1.5 flex-1 cursor-grab active:cursor-grabbing">
          <GripVertical size={12} className="text-text-muted" />
          <MonitorPlay size={13} className="text-accent" />
          <span className="text-caption font-semibold text-text-primary">Presenter</span>
          {presenterRange && !viewerPaused && <span className="text-meta">v.{presenterRange.first}{presenterRange.last !== presenterRange.first ? `–${presenterRange.last}` : ''}</span>}
          {viewerPaused ? <Badge variant="text" tone="warning">Paused</Badge> : <Badge variant="live" tone="accent" label="Live" />}
        </div>
        <IconButton icon={Minus} label="Collapse" size={20} onClick={() => setCollapsed(true)} />
        <IconButton icon={X} label="Close presenter window" size={20} danger onClick={closePresenter} />
      </div>

      {/* Toggles */}
      <div className="p-1.5 space-y-0.5">
        <ToggleRow icon={<Eye size={15} />} label="Show output" on={!blank} onClick={toggleBlank} />
        <ToggleRow icon={<Cast size={15} />} label="Live sync" on={!viewerPaused} onClick={toggleSync} />
        <ToggleRow icon={<MousePointer2 size={15} />} label="Laser pointer" on={laserEnabled} onClick={toggleLaser} />
        <ToggleRow icon={<Highlighter size={15} />} label="Selection mirror" on={selectionMirror} onClick={toggleSelection} />
        <ToggleRow icon={<PanelRight size={15} />} label="Side panel" on={sidePanelEnabled} onClick={() => setSidePanelEnabled(!sidePanelEnabled)} />
      </div>

      {/* Action */}
      <div className="p-1.5 border-t border-separator">
        <Button
          variant="ghost"
          size="sm"
          icon={RefreshCw}
          onClick={() => { pushCurrentToViewer(); window.app.requestViewerVisibleRegion?.() }}
          className="w-full"
          title="Force the presenter to jump to exactly what the main window is showing right now (use if it ever looks out of sync)"
        >
          Re-sync now
        </Button>
      </div>
    </div>,
    document.body
  )
}
