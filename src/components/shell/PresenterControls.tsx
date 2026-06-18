import { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Cast, MousePointer2, Highlighter, PanelRight, RefreshCw, X, GripVertical, MonitorPlay, Minus } from 'lucide-react'
import { useAppStore } from '@/store'
import { pushCurrentToViewer } from '@/hooks/useViewerSync'
import type { BibleTabState } from '@/types'

/** Current active scripture chapter (the chapter the presenter mirrors), for overlay clears. */
function activeScriptureChapter(): { bookId: string; chapter: number } | null {
  const s = useAppStore.getState()
  const id = s.activeTabId['scripture']
  const t = id ? s.tabs['scripture'].find((x) => x.id === id) : null
  const bs = t?.state as BibleTabState | undefined
  return bs?.bookId ? { bookId: bs.bookId, chapter: bs.chapter } : null
}

/** A clear on/off switch (track + knob). */
function Switch({ on }: { on: boolean }) {
  return (
    <span
      className="relative inline-block flex-shrink-0 rounded-full transition-colors"
      style={{ width: 34, height: 20, background: on ? 'rgb(var(--color-accent))' : 'rgb(var(--color-surface-4))' }}
    >
      <span className="absolute rounded-full bg-white shadow transition-all" style={{ width: 16, height: 16, top: 2, left: on ? 16 : 2 }} />
    </span>
  )
}

function ToggleRow({ icon, label, on, onClick }: { icon: React.ReactNode; label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors hover:bg-[rgb(var(--color-surface-3))]"
    >
      <span className={on ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}>{icon}</span>
      <span className={`flex-1 text-left text-[12px] font-medium ${on ? 'text-[rgb(var(--color-text-primary))]' : 'text-[rgb(var(--color-text-muted))]'}`}>{label}</span>
      <span className={`text-[9px] font-bold uppercase tracking-wide ${on ? 'text-[rgb(var(--color-accent))]' : 'text-[rgb(var(--color-text-muted))]'}`}>{on ? 'On' : 'Off'}</span>
      <Switch on={on} />
    </button>
  )
}

export default function PresenterControls() {
  const viewerWindowOpen = useAppStore((s) => s.viewerWindowOpen)
  const viewerPaused = useAppStore((s) => s.viewerPaused)
  const setViewerPaused = useAppStore((s) => s.setViewerPaused)
  const setViewerWindowOpen = useAppStore((s) => s.setViewerWindowOpen)
  const laserEnabled = useAppStore((s) => s.viewerLaserEnabled)
  const setLaserEnabled = useAppStore((s) => s.setViewerLaserEnabled)
  const selectionMirror = useAppStore((s) => s.viewerSelectionMirror)
  const setSelectionMirror = useAppStore((s) => s.setViewerSelectionMirror)
  const sidePanelEnabled = useAppStore((s) => s.viewerSidePanelEnabled)
  const setSidePanelEnabled = useAppStore((s) => s.setViewerSidePanelEnabled)

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
    if (!nowPaused) pushCurrentToViewer()
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
        className="fixed z-[9998] flex items-center gap-1.5 px-2.5 py-1.5 rounded-full shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))/95] backdrop-blur cursor-pointer"
        style={pos ? { left: pos.left, top: pos.top } : { right: 20, bottom: 20 }}
        title="Expand presenter controls"
      >
        <MonitorPlay size={14} className="text-[rgb(var(--color-accent))]" />
        <span className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))]">Presenter</span>
        {viewerPaused && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
      </div>,
      document.body
    )
  }

  return createPortal(
    <div
      data-presenter-controls
      className="fixed z-[9998] w-[224px] rounded-xl shadow-2xl border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))/95] backdrop-blur"
      style={pos ? { left: pos.left, top: pos.top } : { right: 20, bottom: 20 }}
    >
      {/* Header: drag handle + collapse + close */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-[rgb(var(--color-surface-3))]">
        <div onMouseDown={startDrag} className="flex items-center gap-1.5 flex-1 cursor-grab active:cursor-grabbing">
          <GripVertical size={12} className="text-[rgb(var(--color-text-muted))]" />
          <MonitorPlay size={13} className="text-[rgb(var(--color-accent))]" />
          <span className="text-[11px] font-semibold text-[rgb(var(--color-text-primary))]">Presenter</span>
        </div>
        <button onClick={() => setCollapsed(true)} title="Collapse" className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] cursor-pointer">
          <Minus size={13} />
        </button>
        <button onClick={closePresenter} title="Close presenter window" className="p-0.5 rounded text-[rgb(var(--color-text-muted))] hover:bg-red-500/15 hover:text-red-400 cursor-pointer">
          <X size={13} />
        </button>
      </div>

      {/* Toggles */}
      <div className="p-1.5 space-y-0.5">
        <ToggleRow icon={<Cast size={15} />} label="Live sync" on={!viewerPaused} onClick={toggleSync} />
        <ToggleRow icon={<MousePointer2 size={15} />} label="Laser pointer" on={laserEnabled} onClick={toggleLaser} />
        <ToggleRow icon={<Highlighter size={15} />} label="Selection mirror" on={selectionMirror} onClick={toggleSelection} />
        <ToggleRow icon={<PanelRight size={15} />} label="Side panel" on={sidePanelEnabled} onClick={() => setSidePanelEnabled(!sidePanelEnabled)} />
      </div>

      {/* Action */}
      <div className="p-1.5 border-t border-[rgb(var(--color-surface-3))]">
        <button
          onClick={() => pushCurrentToViewer()}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] cursor-pointer transition-colors"
          title="Re-sync the presenter to the current view"
        >
          <RefreshCw size={13} /> Re-sync now
        </button>
      </div>
    </div>,
    document.body
  )
}
