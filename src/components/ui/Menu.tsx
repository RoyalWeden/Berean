import { forwardRef, useCallback, type HTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import ShortcutKeys from '@/components/shell/ShortcutKeys'
import { SectionLabel } from './SectionLabel'

/**
 * Menu surface — the one recipe for context menus, dropdowns and command lists.
 * Position it with `MenuPositioner` (src/lib/usePositionedMenu.ts) exactly as before; this
 * only owns the material, radius, padding and arrow-key roving between items.
 */
export const MenuSurface = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { dense?: boolean }>(
  function MenuSurface({ className, children, dense, onKeyDown, ...rest }, ref) {
    const handleKey = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(e)
      if (e.defaultPrevented) return
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
      const root = e.currentTarget
      const items = Array.from(root.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled]),[role="option"]:not([aria-disabled="true"])'))
      if (!items.length) return
      e.preventDefault()
      const i = items.indexOf(document.activeElement as HTMLElement)
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
        : e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length
      items[next]?.focus()
    }, [onKeyDown])
    return (
      <div
        ref={ref}
        role="menu"
        onKeyDown={handleKey}
        className={cx('material-popover rounded-menu text-footnote text-text-primary select-none min-w-[160px]', dense ? 'p-0.5' : 'p-1', className)}
        {...rest}
      >
        {children}
      </div>
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
        'transition-colors duration-fast',
        'disabled:opacity-40 disabled:pointer-events-none',
        danger
          ? 'text-destructive hover:bg-destructive/12 focus-visible:bg-destructive/12'
          : 'text-text-primary hover:bg-surface-hover focus-visible:bg-surface-hover',
        className,
      )}
      {...rest}
    >
      {active !== undefined && (
        <Check size={12} strokeWidth={2.25} className={cx('flex-shrink-0 -ml-0.5', active ? 'text-accent' : 'opacity-0')} />
      )}
      {Icon && <Icon size={14} strokeWidth={1.75} className={cx('flex-shrink-0', danger ? '' : 'text-text-muted group-hover/mi:text-text-secondary')} />}
      <span className="flex-1 min-w-0">
        <span className="block truncate">{label}</span>
        {description && <span className="block truncate text-caption2 text-text-muted">{description}</span>}
      </span>
      {shortcut && (/^[⌘⇧⌥⌃↵↑↓←→]/.test(shortcut)
        ? <ShortcutKeys keys={shortcut} className="ml-auto opacity-70" />
        : <span className="ml-auto text-caption2 text-text-muted">{shortcut}</span>)}
      {trailing}
    </button>
  )
})

export function MenuSeparator({ className }: { className?: string }) {
  return <div role="separator" className={cx('my-1 h-px bg-separator', className)} />
}

export function MenuLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <SectionLabel className={cx('px-2.5 pt-1.5 pb-1', className)}>{children}</SectionLabel>
}
