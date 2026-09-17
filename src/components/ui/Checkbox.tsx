import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cx } from './cx'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> {
  label?: ReactNode
  description?: ReactNode
  indeterminate?: boolean
}

/** 14px macOS-style checkbox with optional label. Uses a visually-hidden native input for a11y. */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, indeterminate, className, checked, disabled, ...rest }, ref,
) {
  return (
    <label className={cx('inline-flex items-start gap-2 select-none cursor-pointer', disabled && 'opacity-40 cursor-default', className)}>
      <span className="relative inline-flex flex-shrink-0 mt-px">
        <input ref={ref} type="checkbox" checked={checked} disabled={disabled} className="peer sr-only" {...rest} />
        <span className={cx(
          'inline-flex items-center justify-center w-[14px] h-[14px] rounded-chip transition-[background-color,box-shadow] duration-fast',
          'peer-focus-visible:shadow-focus',
          checked || indeterminate ? 'bg-accent text-white shadow-control' : 'control-field bg-field',
        )} aria-hidden>
          {indeterminate ? <Minus size={10} strokeWidth={3} /> : checked ? <Check size={10} strokeWidth={3} /> : null}
        </span>
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-footnote text-text-primary leading-tight">{label}</span>}
          {description && <span className="block text-caption2 text-text-muted mt-0.5">{description}</span>}
        </span>
      )}
    </label>
  )
})

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> { label?: ReactNode; description?: ReactNode }

/** 14px radio with optional label. */
export const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio({ label, description, className, checked, disabled, ...rest }, ref) {
  return (
    <label className={cx('inline-flex items-start gap-2 select-none cursor-pointer', disabled && 'opacity-40 cursor-default', className)}>
      <span className="relative inline-flex flex-shrink-0 mt-px">
        <input ref={ref} type="radio" checked={checked} disabled={disabled} className="peer sr-only" {...rest} />
        <span className={cx(
          'inline-flex items-center justify-center w-[14px] h-[14px] rounded-control transition-[background-color,box-shadow] duration-fast peer-focus-visible:shadow-focus',
          checked ? 'bg-accent shadow-control' : 'control-field bg-field',
        )} aria-hidden>
          {checked && <span className="w-[5px] h-[5px] rounded-control bg-white" />}
        </span>
      </span>
      {(label || description) && (
        <span className="min-w-0">
          {label && <span className="block text-footnote text-text-primary leading-tight">{label}</span>}
          {description && <span className="block text-caption2 text-text-muted mt-0.5">{description}</span>}
        </span>
      )}
    </label>
  )
})
export default Checkbox
