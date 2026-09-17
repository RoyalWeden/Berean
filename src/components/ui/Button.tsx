import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  /** Icon on the trailing side instead of leading. */
  iconTrailing?: boolean
  loading?: boolean
  /** For `ghost`: accent-tinted toggled-on state (e.g. "LXX", "Strong's"). */
  selected?: boolean
  children?: ReactNode
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-1 hover:brightness-110 active:brightness-95',
  secondary: 'bg-surface-2 text-text-primary border border-border hover:bg-surface-hover active:bg-surface-pressed',
  ghost: 'text-text-secondary hover:text-text-primary hover:bg-surface-hover active:bg-surface-pressed',
  destructive: 'bg-destructive text-white shadow-1 hover:brightness-110 active:brightness-95',
}
const SIZE: Record<ButtonSize, { box: string; icon: number }> = {
  sm: { box: 'h-7 px-2.5 text-footnote gap-1.5', icon: 13 },
  md: { box: 'h-8 px-3.5 text-subhead gap-2', icon: 14 },
}

/** Capsule text button. Primary = accent fill; secondary = bordered; ghost = toolbar text. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'sm', icon: Icon, iconTrailing, loading, selected, className, type = 'button', children, disabled, ...rest },
  ref,
) {
  const s = SIZE[size]
  const iconEl = loading
    ? <Loader2 size={s.icon} className="animate-spin" />
    : Icon ? <Icon size={s.icon} strokeWidth={1.75} /> : null
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-pressed={selected !== undefined ? selected : undefined}
      className={cx(
        'no-drag focus-ring inline-flex items-center justify-center flex-shrink-0 rounded-control font-medium select-none whitespace-nowrap',
        'transition-[background-color,color,filter,transform] duration-base ease-mac cursor-pointer',
        'active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none',
        s.box,
        selected && variant === 'ghost' ? 'bg-accent-muted text-accent hover:bg-accent-hover' : VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {!iconTrailing && iconEl}
      {children}
      {iconTrailing && iconEl}
    </button>
  )
})

export default Button
