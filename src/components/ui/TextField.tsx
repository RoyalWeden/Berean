import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './cx'
import { useBarMetrics } from './metrics'

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  size?: 'sm' | 'md'
  icon?: LucideIcon
  /** Trailing slot (clear button, kbd hint…). */
  trailing?: ReactNode
  /** Borderless, transparent variant for fields that live inside a bar/sheet header. */
  bare?: boolean
  /** A `bare` field shows a focus underline by default (its only affordance otherwise, since it
   *  has no box/ring of its own) — set false for a field that's ALREADY the obvious focal point
   *  of its own floating surface (Spotlight-style search bars, find bars), where the underline
   *  reads as a stray extra rule under text you're actively typing rather than as useful
   *  feedback. Only takes effect when `bare` is set. */
  bareUnderline?: boolean
  /** Extra classes for the wrapper (width, margins). */
  wrapperClassName?: string
  invalid?: boolean
  /** Capsule geometry — search fields only (SearchField sets it); text fields are rounded rectangles. */
  capsule?: boolean
  /** 'none' drops the field's own horizontal inset. A `bare` field keeps its padding by default
   *  because it usually sits in a bar where the inset is what separates it from neighbouring
   *  controls; an INLINE editor (a note title typed directly into the page) wants the text to
   *  start exactly where the rendered text would, so it opts out. Replaces `!px-0` at call sites. */
  padding?: 'default' | 'none'
}

const SIZE = { sm: { box: 'h-7 text-footnote', pad: 'px-2.5', icon: 12 }, md: { box: 'h-8 text-subhead', pad: 'px-3', icon: 14 } }
/** In a bar every field renders at the one 32px control height (see metrics.tsx). */
const BAR_UP = { sm: 'md', md: 'md' } as const

/** Text field (rounded rectangle) with optional leading icon and trailing slot; SearchField is the capsule variant. */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { size = 'sm', icon: Icon, trailing, bare, bareUnderline = true, invalid, capsule = false, padding = 'default', className, wrapperClassName, ...rest }, ref,
) {
  const bar = useBarMetrics()
  const s = SIZE[bar ? BAR_UP[size] : size]
  return (
    <div className={cx('relative flex items-center min-w-0', wrapperClassName)}>
      {Icon && <Icon size={s.icon} strokeWidth={1.75} className="absolute left-2.5 text-text-muted pointer-events-none" />}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(
          'no-drag w-full min-w-0 outline-none text-text-primary placeholder:text-text-muted',
          capsule ? 'rounded-control' : 'rounded-control-md',
          'transition-[background-color,box-shadow] duration-base ease-mac',
          'disabled:opacity-50 disabled:cursor-default read-only:text-text-secondary',
          s.box, padding === 'none' ? 'px-0' : s.pad,
          Icon && (size === 'sm' ? 'pl-7' : 'pl-8'),
          trailing && 'pr-7',
          bare
            ? cx('bg-transparent rounded-none', bareUnderline && 'focus:shadow-[inset_0_-1.5px_0_var(--color-focus-ring)]')
            : cx('control-field bg-field hover:bg-surface-1/75 focus:bg-surface-1 focus:shadow-focus', invalid && 'shadow-[inset_0_0_0_1px_rgb(var(--color-destructive)/0.6)] focus:shadow-[0_0_0_1.5px_rgb(var(--color-surface-1)),0_0_0_3.5px_rgb(var(--color-destructive)/0.6)]'),
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
      capsule
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

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
  autoGrow?: boolean
  /** Borderless and transparent — the same role `bare` plays on TextField, for a multi-line
   *  editor typed straight into the page (an inline note body) rather than boxed in a form. */
  bare?: boolean
  /** 'none' drops the field's own inset so inline text starts where rendered text would. */
  padding?: 'default' | 'none'
}

/** Multi-line field with the same material/states as TextField. */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ className, invalid, autoGrow, bare, padding = 'default', rows = 3, onInput, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      aria-invalid={invalid || undefined}
      onInput={(e) => { if (autoGrow) { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } onInput?.(e) }}
      className={cx(
        'no-drag w-full min-w-0 text-footnote leading-relaxed outline-none resize-y text-text-primary placeholder:text-text-muted',
        'transition-[background-color,box-shadow] duration-base ease-mac',
        padding === 'none' ? 'p-0' : 'px-3 py-2',
        bare
          ? 'bg-transparent rounded-none'
          : 'rounded-card control-field bg-field hover:bg-surface-1/75 focus:bg-surface-1 focus:shadow-focus',
        'disabled:opacity-50 disabled:cursor-default',
        invalid && !bare && 'shadow-[inset_0_0_0_1px_rgb(var(--color-destructive)/0.6)]',
        autoGrow && 'resize-none overflow-hidden',
        className,
      )}
      {...rest}
    />
  )
})

export default TextField
