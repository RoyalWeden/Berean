import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { useBarMetrics } from './metrics'
import { MenuSurface, MenuItem, MenuLabel } from './Menu'
import { MenuPositioner, dispatchCloseContextMenus, CLOSE_CONTEXT_MENUS_EVENT } from '@/lib/usePositionedMenu'

export interface SelectOption<T extends string> {
  value: T
  label: ReactNode
  icon?: LucideIcon
  description?: ReactNode
  disabled?: boolean
  /** Optional group heading rendered before this option (first option of a group). */
  group?: string
}

export interface SelectProps<T extends string> {
  value: T
  options: SelectOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  /** Text-only capsule (no fill) for toolbars, e.g. a sort picker. */
  variant?: 'field' | 'ghost'
  placeholder?: ReactNode
  disabled?: boolean
  'aria-label'?: string
  className?: string
  menuClassName?: string
  /** Align the menu to the trigger's right edge (default: left). */
  align?: 'left' | 'right'
}

const SIZE = { sm: 'h-7 px-2.5 text-footnote gap-1.5', md: 'h-8 px-3 text-subhead gap-2' }
/** The one bar box (CONTROL_H_BAR = 34) — a pop-up button lines up with the controls beside it. */
const BAR = 'h-[34px] px-3.5 text-subhead gap-2'

/**
 * Custom select — a rounded-rectangle trigger (Apple's pop-up button shape) opening a `MenuSurface` listbox, so no OS-chrome
 * `<select>` popups anywhere in the app. Keyboard: Enter/Space/↓ open, ↑↓ move, Enter picks,
 * Esc closes; closes on outside click and on the global close-menus events.
 */
export function Select<T extends string>({
  value, options, onChange, size = 'sm', variant = 'field', placeholder, disabled, className, menuClassName, align = 'left', 'aria-label': ariaLabel,
}: SelectProps<T>) {
  const bar = useBarMetrics()
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const current = options.find((o) => o.value === value)

  const open = () => {
    if (disabled || !triggerRef.current) return
    dispatchCloseContextMenus()
    const r = triggerRef.current.getBoundingClientRect()
    setPos({ x: align === 'right' ? r.right : r.left, y: r.bottom + 4 })
  }
  const close = (refocus = false) => { setPos(null); if (refocus) triggerRef.current?.focus() }

  useEffect(() => {
    if (!pos) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || triggerRef.current?.contains(t)) return
      close()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(true) } }
    const onClose = () => close()
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('berean:closeMenus', onClose)
    window.addEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    // Focus the current option so arrow keys work immediately.
    requestAnimationFrame(() => {
      const el = menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
      el?.focus()
    })
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('berean:closeMenus', onClose)
      window.removeEventListener(CLOSE_CONTEXT_MENUS_EVENT, onClose)
    }
  }, [!!pos])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={!!pos}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => (pos ? close() : open())}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open() } }}
        className={cx(
          'no-drag focus-ring inline-flex items-center rounded-control-md select-none whitespace-nowrap cursor-pointer max-w-full',
          'transition-colors duration-base ease-mac disabled:opacity-40 disabled:pointer-events-none',
          bar ? BAR : SIZE[size],
          variant === 'field'
            ? 'control-field bg-field text-text-primary pr-1 hover:bg-surface-1/75 active:bg-surface-1 aria-expanded:bg-surface-1 aria-expanded:shadow-focus'
            : 'text-text-secondary hover:text-text-primary hover:bg-control-hover active:bg-control-pressed aria-expanded:bg-control-pressed',
          className,
        )}
      >
        {current?.icon && <current.icon size={size === 'sm' ? 12 : 14} strokeWidth={1.75} className="text-text-muted flex-shrink-0" />}
        <span className={cx('truncate', !current && 'text-text-muted')}>{current?.label ?? placeholder ?? '—'}</span>
        {variant === 'field'
          ? <span className={cx('inline-flex items-center justify-center rounded-control-sm bg-control text-text-secondary flex-shrink-0 transition-transform duration-base ease-mac', size === 'sm' ? 'w-[18px] h-[18px]' : 'w-5 h-5', pos && 'rotate-180')}><ChevronDown size={size === 'sm' ? 10 : 11} strokeWidth={2.25} /></span>
          : <ChevronDown size={size === 'sm' ? 11 : 12} strokeWidth={2} className={cx('text-text-muted flex-shrink-0 -mr-0.5 transition-transform duration-base ease-mac', pos && 'rotate-180')} />}
      </button>
      {pos && createPortal(
        <MenuPositioner x={pos.x} y={pos.y} align={align} style={{ zIndex: 'var(--z-menu)' as unknown as number }}>
          <MenuSurface ref={menuRef} className={cx('max-h-[min(360px,60vh)] overflow-y-auto', menuClassName)} aria-labelledby={id} role="listbox">
            {options.map((o) => (
              <div key={o.value}>
                {o.group && <MenuLabel>{o.group}</MenuLabel>}
                <MenuItem
                  icon={o.icon}
                  label={o.label}
                  description={o.description}
                  active={o.value === value}
                  disabled={o.disabled}
                  onClick={() => { onChange(o.value); close(true) }}
                />
              </div>
            ))}
          </MenuSurface>
        </MenuPositioner>,
        document.body,
      )}
    </>
  )
}

export default Select
