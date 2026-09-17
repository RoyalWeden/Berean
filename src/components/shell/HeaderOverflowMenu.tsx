import { MoreHorizontal } from 'lucide-react'
import { useState, useEffect, useRef, type ReactNode } from 'react'
import { IconButton, Popover, PopoverTrigger, PopoverSurface, MenuItem, MenuSeparator } from '@/components/ui'

export interface OverflowItem {
  key: string
  label: string
  icon: ReactNode
  /** Omit when `render` is provided instead — see below. */
  onClick?: () => void
  shortcut?: string
  active?: boolean
  danger?: boolean
  /** Renders a hairline divider above this item — for grouping, e.g. a destructive action set apart from the rest. */
  divider?: boolean
  /** Small accent dot next to the icon — unseen/pending-count indicator (e.g. unseen history, archived tabs waiting). */
  badge?: boolean
  /**
   * Escape hatch for a row that opens its own follow-up UI (a popover with a
   * list, a picker) rather than firing one action — e.g. the archived-tabs
   * list or the layout picker. Return the full row markup, typically a
   * nested `Popover.Root`/`Trigger`/`Content` whose trigger reuses this
   * menu's own row styling so it looks identical to a plain action item.
   * When set, `onClick`/`shortcut`/`active`/`danger` are ignored — the
   * render function owns the whole row.
   */
  render?: () => ReactNode
}

/**
 * Shared "..." overflow button for header/top-bar rows — collects lower-
 * frequency actions behind one menu instead of every panel/bar growing its
 * own ever-longer row of icon buttons. Each item renders as a labeled row
 * (icon + label + optional shortcut), not another bare icon, since the whole
 * point is legibility once something is no longer inline.
 */
export default function HeaderOverflowMenu({ items, className = '' }: { items: OverflowItem[]; className?: string }) {
  // Controlled (rather than Radix's default uncontrolled open state) so this
  // menu can participate in the app's "only one overlay open at a time"
  // convention: it closes itself when told to via berean:closeMenus (fired
  // by opening the find bar, Settings, etc.), and fires that same broadcast
  // itself on open so it in turn closes whichever of those was open.
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    function onClose() { setOpen(false) }
    window.addEventListener('berean:closeMenus', onClose)
    return () => window.removeEventListener('berean:closeMenus', onClose)
  }, [open])

  // Manual outside-click fallback, matching the pattern used elsewhere in this codebase (e.g.
  // BookChapterPicker.tsx) — relying solely on Radix Popover's built-in dismissable-layer
  // detection left this menu not closing on outside click, likely because several other
  // components register their own capture-phase `mousedown` listeners (TopBar.tsx, Sidebar.tsx,
  // Ribbon.tsx) that can run before Radix's own pointerdown-outside detection reaches this popover.
  const triggerRef = useRef<HTMLButtonElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !contentRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Hover-to-open/close — same timing as TopBar.tsx's nav-history dropdown (350ms open delay
  // avoids flashing on incidental mouseover, 320ms close delay gives the pointer room to travel
  // from the trigger into the portaled content without it slamming shut mid-move). Click still
  // works as an instant toggle independent of these timers. This is the shared "..." menu used
  // by BiblePanel, NotesPanel, YouTubeTab, and Sidebar, so fixing hover here covers all of them.
  const openTimer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function openOnHover() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    if (openTimer.current) clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => setOpen(true), 350)
  }
  function cancelHoverOpen() {
    if (openTimer.current) { clearTimeout(openTimer.current); openTimer.current = null }
  }
  function scheduleHoverClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), 320)
  }
  function keepHoverOpen() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }
  useEffect(() => () => {
    if (openTimer.current) clearTimeout(openTimer.current)
    if (closeTimer.current) clearTimeout(closeTimer.current)
  }, [])

  if (items.length === 0) return null
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) window.dispatchEvent(new CustomEvent('berean:closeMenus'))
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <IconButton
          ref={triggerRef}
          icon={MoreHorizontal}
          label="More"
          size={28}
          onMouseEnter={openOnHover}
          onMouseLeave={() => { cancelHoverOpen(); scheduleHoverClose() }}
          className={className}
        />
      </PopoverTrigger>
      <PopoverSurface
        ref={contentRef}
        side="bottom"
        align="end"
        sideOffset={6}
        onMouseEnter={keepHoverOpen}
        onMouseLeave={scheduleHoverClose}
        innerClassName="min-w-[180px] p-1"
        style={{ zIndex: 'var(--z-menu)' } as React.CSSProperties}
      >
        {items.map((item) => (
          <div key={item.key}>
            {item.divider && <MenuSeparator />}
            {item.render ? item.render() : (
              <MenuItem
                onClick={item.onClick}
                active={item.active}
                danger={item.danger}
                shortcut={item.shortcut}
                label={
                  <span className="flex items-center gap-2.5">
                    <span className="relative flex-shrink-0 [&_svg]:w-3.5 [&_svg]:h-3.5">
                      {item.icon}
                      {item.badge && (
                        <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-accent opacity-70" />
                      )}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                  </span>
                }
              />
            )}
          </div>
        ))}
      </PopoverSurface>
    </Popover>
  )
}
