import { Children, createContext, forwardRef, isValidElement, useCallback, useContext, useEffect, useRef, useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import ShortcutKeys from '@/components/shell/ShortcutKeys'
import { SectionLabel } from './SectionLabel'
import { CompactMetrics } from './metrics'
import { InPositionedMenuContext } from '@/lib/usePositionedMenu'

/**
 * Menu surface — the one recipe for context menus, dropdowns and command lists.
 * Position it with `MenuPositioner` (src/lib/usePositionedMenu.ts) exactly as before; this
 * only owns the material, radius, padding and arrow-key roving between items.
 */
/** When true, every MenuItem reserves the leading check column so labels align in menus that mix
 *  radio items and plain items. Set on MenuSurface via `inset`. */
const MenuInsetContext = createContext(false)
/** When true, every MenuItem in the section reserves the icon column (Apple 26/27: icons form one
 *  column per section) — items without an icon get a spacer so labels align. */
const MenuIconColumnContext = createContext(false)

export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { dense?: boolean; inset?: boolean; autoFocus?: boolean }>(
  function MenuSurface({ className, children, dense, inset = false, autoFocus, onKeyDown, ...rest }, ref) {
    const inPositioned = useContext(InPositionedMenuContext)
    const localRef = useRef<HTMLDivElement | null>(null)
    const setRef = (el: HTMLDivElement | null) => { localRef.current = el; if (typeof ref === 'function') ref(el); else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = el }
    // Transient menus (inside a MenuPositioner) focus their first item on open so ↑/↓/typeahead
    // work immediately — the macOS menu model. Opt out with autoFocus={false} (e.g. a menu that
    // contains a text field). Pointer-opened menus keep focus too; focus return is handled by the
    // opener (useContextMenu / Select).
    useEffect(() => {
      if (!(autoFocus ?? inPositioned)) return
      const root = localRef.current
      if (!root || root.contains(document.activeElement)) return
      const first = root.querySelector<HTMLElement>('[aria-checked="true"],[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="option"]:not([aria-disabled="true"])')
      first?.focus({ preventScroll: true })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    const handleKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e)
      if (e.defaultPrevented) return
      const root = e.currentTarget
      const items = Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="menuitemcheckbox"]:not([disabled]),[role="option"]:not([aria-disabled="true"])'))
      if (!items.length) return
      // Typeahead: a single printable character jumps to the next item starting with it.
      if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && /\S/.test(e.key)) {
        const i = items.indexOf(document.activeElement as HTMLElement)
        const order = [...items.slice(i + 1), ...items.slice(0, i + 1)]
        const hit = order.find((el) => (el.textContent ?? '').trim().toLowerCase().startsWith(e.key.toLowerCase()))
        if (hit) { e.preventDefault(); hit.focus() }
        return
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      e.preventDefault()
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next]?.focus()
    }, [onKeyDown])
    return (
      <MenuInsetContext.Provider value={inset}>
        <CompactMetrics>
        <div
          ref={setRef}
          role="menu"
          onKeyDown={handleKey}
          className={cx('material-popover rounded-menu text-footnote text-text-primary select-none min-w-[160px] animate-menu-in', dense ? 'p-0.5' : 'p-1', className)}
          {...rest}
        >
          {children}
        </div>
        </CompactMetrics>
      </MenuInsetContext.Provider>
    )
  },
)

export interface MenuItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: LucideIcon
  label: ReactNode
  /** Right-aligned secondary text (shortcut keycaps when it looks like one, else plain). */
  shortcut?: string
  trailing?: ReactNode
  danger?: boolean
  /** Checked state — renders a leading check (menuitemradio semantics). */
  active?: boolean
  disabled?: boolean
  /** Secondary line under the label. */
  description?: ReactNode
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { icon: Icon, label, shortcut, trailing, danger, active, disabled, description, className, ...rest }, ref,
) {
  const inset = useContext(MenuInsetContext)
  const iconColumn = useContext(MenuIconColumnContext)
  return (
    <button
      ref={ref}
      type="button"
      role={active !== undefined ? 'menuitemradio' : 'menuitem'}
      aria-checked={active !== undefined ? active : undefined}
      disabled={disabled}
      className={cx(
        'group/mi flex w-full items-center gap-2.5 px-2.5 rounded-card text-left outline-none cursor-pointer',
        description ? 'py-1.5' : 'h-7',
        'transition-colors duration-fast active:brightness-90',
        'disabled:opacity-40 disabled:pointer-events-none',
        // NSMenu highlight: accent fill + white text (danger: destructive fill)
        danger
          ? 'text-destructive hover:bg-destructive hover:text-white focus-visible:bg-destructive focus-visible:text-white'
          : 'text-text-primary hover:bg-accent hover:text-white focus-visible:bg-accent focus-visible:text-white',
        className,
      )}
      {...rest}
    >
      {(active !== undefined || inset) && (
        <Check size={12} strokeWidth={2.25} className={cx('flex-shrink-0 -ml-0.5', active ? 'text-accent group-hover/mi:text-white group-focus-visible/mi:text-white' : 'opacity-0')} />
      )}
      {Icon
        ? <Icon size={14} strokeWidth={1.75} className={cx('flex-shrink-0', danger ? '' : 'text-text-muted group-hover/mi:text-white/85 group-focus-visible/mi:text-white/85')} />
        : iconColumn ? <span aria-hidden className="w-3.5 flex-shrink-0" /> : null}
      <span className="flex-1 min-w-0">
        <span className="block truncate">{label}</span>
        {description && <span className="block truncate text-caption2 text-text-muted group-hover/mi:text-white/75 group-focus-visible/mi:text-white/75">{description}</span>}
      </span>
      {shortcut && (/^[⌘⇧⌥⌃↵↑↓←→]/.test(shortcut)
        ? <ShortcutKeys keys={shortcut} className="ml-auto opacity-70 group-hover/mi:opacity-90" />
        : <span className="ml-auto text-caption2 text-text-muted group-hover/mi:text-white/75 group-focus-visible/mi:text-white/75">{shortcut}</span>)}
      {trailing}
    </button>
  )
})

/**
 * A section of a menu. Apple 26/27 menus align icons in one column per section: when any item
 * in the group carries an icon (or a check state), every item in the group reserves the column.
 */
export function MenuGroup({ children, label, className }: { children: ReactNode; label?: ReactNode; className?: string }) {
  const kids = Children.toArray(children).filter(isValidElement) as React.ReactElement<MenuItemProps>[]
  const hasIcon = kids.some((c) => !!c.props.icon)
  const hasCheck = kids.some((c) => c.props.active !== undefined)
  return (
    <MenuInsetContext.Provider value={hasCheck}>
      <MenuIconColumnContext.Provider value={hasIcon}>
        <div role="group" className={className}>
          {label && <MenuLabel>{label}</MenuLabel>}
          {children}
        </div>
      </MenuIconColumnContext.Provider>
    </MenuInsetContext.Provider>
  )
}

/** Submenu row: opens its panel to the right on hover / → / Enter, closes on ← / Escape / leave. */
export function MenuSub({ label, icon: Icon, children, disabled }: { label: ReactNode; icon?: LucideIcon; children: ReactNode; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const inset = useContext(MenuInsetContext)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = () => { if (timer.current) clearTimeout(timer.current); setOpen(true) }
  const hide = () => { timer.current = setTimeout(() => setOpen(false), 180) }
  return (
    <div className="relative" onMouseEnter={disabled ? undefined : show} onMouseLeave={hide}>
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); show(); requestAnimationFrame(() => (e.currentTarget.nextElementSibling as HTMLElement | null)?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus()) } }}
        className={cx('group/mi flex w-full items-center gap-2.5 px-2.5 h-7 rounded-card text-left outline-none cursor-pointer transition-colors duration-fast text-text-primary hover:bg-accent hover:text-white focus-visible:bg-accent focus-visible:text-white aria-expanded:bg-accent aria-expanded:text-white disabled:opacity-40 disabled:pointer-events-none')}
      >
        {inset && <span className="w-3 -ml-0.5 flex-shrink-0" />}
        {Icon && <Icon size={14} strokeWidth={1.75} className="flex-shrink-0 text-text-muted group-hover/mi:text-white/85" />}
        <span className="flex-1 min-w-0 truncate">{label}</span>
        <ChevronRight size={12} strokeWidth={2} className="ml-auto opacity-70" />
      </button>
      {open && (
        <div
          role="menu"
          onKeyDown={(e) => { if (e.key === 'ArrowLeft' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus() } }}
          className="absolute top-0 left-full ml-1 z-menu material-popover rounded-menu p-1 min-w-[160px] text-footnote text-text-primary animate-menu-in"
          style={{ '--menu-origin': 'top left' } as React.CSSProperties}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cx('my-1 h-px bg-separator', className)} />
}

export function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <SectionLabel className={cx('px-2.5 pt-1.5 pb-1', className)}>{children}</SectionLabel>
}
