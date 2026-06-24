import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { BookMarked, ExternalLink, Layers } from 'lucide-react'
import { useAppStore } from '@/store'

export interface StrongsContextTarget {
  strongsNum: string
  x: number
  y: number
}

/**
 * Right-click context menu for any Strong's number link in the lexicon panel.
 * Provides: Open (in current tab), Open in new tab, Open in floating tab.
 */
export function StrongsContextMenu({
  target,
  onClose,
  onOpen,
  onOpenNewTab,
}: {
  target: StrongsContextTarget | null
  onClose: () => void
  onOpen: (num: string) => void
  onOpenNewTab: (num: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!target) return
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => {
      window.addEventListener('click', close)
      window.addEventListener('contextmenu', close)
      window.addEventListener('keydown', onKey)
    }, 0)
    return () => {
      clearTimeout(t)
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [target, onClose])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const pad = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    let x = parseFloat(el.style.left) || 0
    let y = parseFloat(el.style.top) || 0
    if (x + width + pad > vw) x = Math.max(pad, x - width)
    if (y + height + pad > vh) y = Math.max(pad, y - height)
    x = Math.max(pad, Math.min(x, vw - width - pad))
    y = Math.max(pad, Math.min(y, vh - height - pad))
    el.style.left = `${x}px`
    el.style.top = `${y}px`
  })

  if (!target) return null
  const ITEM = 'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left cursor-pointer text-[rgb(var(--color-text-primary))] hover:bg-[rgb(var(--color-surface-3))] transition-colors'

  function openFloating(num: string) {
    window.app.openFloatingTab?.('lexicon', { strongsNum: num })
    useAppStore.getState().bumpFloatingTabToken()
    onClose()
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[10000] min-w-[160px] rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-1))] shadow-xl py-1"
      style={{ left: target.x, top: target.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1 text-[10px] font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider">
        {target.strongsNum}
      </div>
      <div className="mx-2 my-1 h-px bg-[rgb(var(--color-surface-4))]" />
      <button
        className={ITEM}
        onClick={() => { onOpen(target.strongsNum); onClose() }}
      >
        <BookMarked size={12} className="flex-shrink-0" />
        Open
      </button>
      <button
        className={ITEM}
        onClick={() => { onOpenNewTab(target.strongsNum); onClose() }}
      >
        <Layers size={12} className="flex-shrink-0" />
        Open in new tab
      </button>
      <button
        className={ITEM}
        onClick={() => openFloating(target.strongsNum)}
      >
        <ExternalLink size={12} className="flex-shrink-0" />
        Open in floating tab
      </button>
    </div>,
    document.body,
  )
}

export function useStrongsContextMenu() {
  const [target, setTarget] = useState<StrongsContextTarget | null>(null)
  const open = useCallback((e: React.MouseEvent, strongsNum: string) => {
    e.preventDefault()
    e.stopPropagation()
    setTarget({ strongsNum, x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setTarget(null), [])
  return { target, open, close }
}
