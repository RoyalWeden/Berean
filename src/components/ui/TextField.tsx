import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  icon?: LucideIcon
  /** Trailing slot (clear button, kbd hint…). */
  trailing?: ReactNode
  /** Borderless, transparent variant for fields that live inside a bar/sheet header. */
  bare?: boolean
  /** Extra classes for the wrapper (width, margins). */
  wrapperClassName?: string
}

const SIZE = { sm: { box: 'h-7 text-footnote', pad: 'px-2.5', icon: 12 }, md: { box: 'h-8 text-subhead', pad: 'px-3', icon: 14 } }

/** Capsule text field with optional leading icon and trailing slot. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { size = 'sm', icon: Icon, trailing, bare, className, wrapperClassName, ...rest }, ref,
) {
  const s = SIZE[size]
  return (
    <div className={cx('relative flex items-center min-w-0', wrapperClassName)}>
      {Icon && <Icon size={s.icon} strokeWidth={1.75} className="absolute left-2.5 text-text-muted pointer-events-none" />}
      <input
        ref={ref}
        className={cx(
          'no-drag w-full min-w-0 rounded-control outline-none text-text-primary placeholder:text-text-muted',
          'transition-[background-color,border-color,box-shadow] duration-base ease-mac',
          s.box, s.pad,
          Icon && (size === 'sm' ? 'pl-7' : 'pl-8'),
          trailing && 'pr-7',
          bare
            ? 'bg-transparent'
            : 'bg-surface-4/40 border border-transparent hover:bg-surface-4/55 focus:bg-surface-1 focus:border-border focus:shadow-focus',
          className,
        )}
        {...rest}
      />
      {trailing && <div className="absolute right-1.5 flex items-center">{trailing}</div>}
    </div>
  )
})

export interface SearchFieldProps extends Omit<TextFieldProps, 'icon' | 'trailing' | 'onChange' | 'value'> {
  value: string
  onValueChange: (value: string) => void
  onClear?: () => void
}

/** Search field: leading magnifier, clear (×) when non-empty, Esc clears. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { value, onValueChange, onClear, onKeyDown, placeholder = 'Search', ...rest }, ref,
) {
  const clear = () => { onValueChange(''); onClear?.() }
  return (
    <TextField
      ref={ref}
      type="text"
      role="searchbox"
      icon={Search}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onValueChange(e.target.value)}
      onKeyDown={(e) => { onKeyDown?.(e); if (!e.defaultPrevented && e.key === 'Escape' && value) { e.stopPropagation(); clear() } }}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      trailing={value ? (
        <button type="button" aria-label="Clear" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={clear}
          className="flex items-center justify-center w-4 h-4 rounded-control bg-text-muted/60 text-surface-1 hover:bg-text-muted transition-colors">
          <X size={9} strokeWidth={3} />
        </button>
      ) : undefined}
      {...rest}
    />
  )
})

export default TextField
