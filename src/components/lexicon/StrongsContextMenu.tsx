import { useRef, useState, useCallback } from 'react'
import { BookMarked, ExternalLink, Layers, Copy, Hash } from 'lucide-react'
import { useAppStore } from '@/store'
import { MenuPositioner, dispatchCloseContextMenus, useMenuDismiss } from '@/lib/usePositionedMenu'
import { MenuSurface, MenuItem, MenuSeparator, MenuLabel } from '@/components/ui'

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

  // Shared dismissal (outside mousedown / Escape / wheel / resize / blur / another menu opening)
  // and MenuPositioner placement (portal to <body>, measure, flip, clamp) — TEST 2026-10-17.
  useMenuDismiss(!!target, [ref], () => onClose(), { closeOnScroll: false })

  if (!target) return null

  function openFloating(num: string) {
    window.app.openFloatingTab?.('lexicon', { strongsNum: num })
    useAppStore.getState().bumpFloatingTabToken()
    onClose()
  }

  return (
    <MenuPositioner ref={ref} x={target.x} y={target.y} onClick={(e) => e.stopPropagation()}>
      <MenuSurface className="min-w-[184px]">
        <MenuLabel>{target.strongsNum}</MenuLabel>
        <MenuSeparator />
        <MenuItem
          icon={BookMarked}
          label="Open"
          onClick={() => { onOpen(target.strongsNum); onClose() }}
        />
        <MenuItem
          icon={Layers}
          label="Open in new tab"
          onClick={() => { onOpenNewTab(target.strongsNum); onClose() }}
        />
        <MenuItem
          icon={ExternalLink}
          label="Open in floating tab"
          onClick={() => openFloating(target.strongsNum)}
        />
        <MenuSeparator />
        <MenuItem
          icon={Copy}
          label="Copy Strong's"
          onClick={() => { navigator.clipboard.writeText(target.strongsNum); onClose() }}
        />
        <MenuItem
          icon={Hash}
          label="Copy reference"
          onClick={() => { navigator.clipboard.writeText(`Strong's ${target.strongsNum}`); onClose() }}
        />
      </MenuSurface>
    </MenuPositioner>
  )
}

export function useStrongsContextMenu() {
  const [target, setTarget] = useState<StrongsContextTarget | null>(null)
  const open = useCallback((e: React.MouseEvent, strongsNum: string) => {
    e.preventDefault()
    e.stopPropagation()
    dispatchCloseContextMenus()
    setTarget({ strongsNum, x: e.clientX, y: e.clientY })
  }, [])
  const close = useCallback(() => setTarget(null), [])
  return { target, open, close }
}
