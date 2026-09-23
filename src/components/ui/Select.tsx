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
  /** Align the menu to the trigger's edge. 'left' / 'right' pin unconditionally (the caller
   *  knows there's always room). 'auto' (default) — pick whichever edge actually has room in
   *  the viewport, measured at open time; falls back to 'left' when both sides have space. Use
   *  an explicit value only when the trigger is guaranteed a fixed position (e.g. deliberately
   *  right-hugging a panel edge regardless of measured space). */
  align?: 'left' | 'right' | 'auto'
}

const SIZE = { sm: 'h-7 px-2.5 text-footnote gap-1.5', md: 'h-8 px-3 text-subhead gap-2' }
/** The one bar box (CONTROL_H_BAR = 36) — a pop-up button lines up with the controls beside it. */
const BAR = 'h-9 px-4 text-subhead gap-2'
/** MenuSurface's own floor (`min-w-[160px]` in Menu.tsx) — the smallest a Select menu ever
 *  renders, used to decide (for `align="auto"`) whether the trigger has room to its right. */
const MENU_MIN_W = 160

/** Pure alignment decision, pulled out of `open()` so it's unit-testable without a DOM. Given
 *  the trigger's rect and the viewport width, picks which edge the menu should hug.
 *  `align="left"`/`"right"` pin unconditionally (caller's explicit choice); `"auto"` uses
 *  whichever side has more room, preferring 'left' on a tie or when both sides fit — this is
 *  what fixes a trigger pinned near the right edge of a narrow container (e.g. a side panel):
 *  previously a hardcoded 'left' default meant the menu opened rightward from the trigger's
 *  left edge assuming there was room, and — since the flip/clamp logic in MenuPositioner only
 *  checks the WINDOW's edge, not the narrow panel's edge — a menu that fits the full window but
 *  not the panel would render past the panel into whatever sits beside it, reading as
 *  disconnected from the button that opened it. */
export function resolveSelectAlign(
  align: 'left' | 'right' | 'auto',
  rect: { left: number; right: number },
  viewportWidth: number,
  minMenuWidth: number = MENU_MIN_W,
): 'left' | 'right' {
  if (align !== 'auto') return align
  const spaceRight = viewportWidth - rect.left
  const spaceLeft = rect.right
  return spaceRight < minMenuWidth && spaceLeft > spaceRight ? 'right' : 'left'
}

/**
 * Custom select — a rounded-rectangle trigger (Apple's pop-up button shape) opening a `MenuSurface` listbox, so no OS-chrome
 * `<select>` popups anywhere in the app. Keyboard: Enter/Space/↓ open, ↑↓ move, Enter picks,
 * Esc closes; closes on outside click and on the global close-menus events.
 */
export function Select<T extends string>({
  value, options, onChange, size = 'sm', variant = 'field', placeholder, disabled, className, menuClassName, align = 'auto', 'aria-label': ariaLabel,
}: SelectProps<T>) {
  const bar = useBarMetrics()
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number; width: number; align: 'left' | 'right' } | null>(null)
  const current = options.find((o) => o.value === value)

  const open = () => {
    if (disabled || !triggerRef.current) return
    dispatchCloseContextMenus()
    const r = triggerRef.current.getBoundingClientRect()
    const resolved = resolveSelectAlign(align, r, window.innerWidth)
    setPos({ x: resolved === 'right' ? r.right : r.left, y: r.bottom + 4, width: r.width, align: resolved })
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
        <MenuPositioner x={pos.x} y={pos.y} align={pos.align} style={{ zIndex: 'var(--z-menu)' as unknown as number }}>
          <MenuSurface ref={menuRef} className={cx('max-h-[min(360px,60vh)] overflow-y-auto', menuClassName)} style={{ minWidth: pos.width }} aria-labelledby={id} role="listbox">
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
