import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import { cx } from './cx'
import { Tooltip } from './Tooltip'

export interface Swatch { id: string; /** "r g b" triple or a CSS var reference like `var(--highlight-red)` */ rgb: string; label?: string }

/** Row of color swatches (highlight colors, note colors, tag colors). Radio semantics. */
export function ColorSwatchRow({ swatches, value, onChange, size = 16, className, allowNone, rows, noneLabel = 'None' }: {
  swatches: Swatch[]; value: string | null | undefined; onChange: (id: string | null) => void; size?: 14 | 16 | 20; className?: string; allowNone?: boolean
  /** Fixed number of rows (the Scripture highlight menus use 2 — TEST-016); omitted = wrap. */
  rows?: number
  /** Label for the "none" swatch (e.g. "Remove highlight"). */
  noneLabel?: string
}) {
  const count = swatches.length + (allowNone ? 1 : 0)
  const grid = rows && rows > 0 ? { display: 'grid', gridTemplateColumns: `repeat(${Math.ceil(count / rows)}, ${size}px)`, justifyContent: 'start' } as CSSProperties : undefined
  return (
    <div role="radiogroup" className={cx(grid ? 'gap-1.5' : 'flex flex-wrap items-center gap-1.5', className)} style={grid}>
      {allowNone && (
        <Tooltip label={noneLabel}>
          <button type="button" role="radio" aria-checked={value === null} aria-label={noneLabel} onClick={() => onChange(null)}
            className={cx('focus-ring rounded-control control-field bg-field flex items-center justify-center transition-[filter,box-shadow] duration-fast hover:brightness-110', value === null && 'ring-2 ring-accent')}
            style={{ width: size, height: size }}>
            <span className="w-[60%] h-px bg-text-muted rotate-45" />
          </button>
        </Tooltip>
      )}
      {swatches.map((s) => {
        const on = s.id === value
        const color = s.rgb.startsWith('var(') ? `rgb(${s.rgb})` : `rgb(${s.rgb})`
        return (
          <Tooltip key={s.id} label={s.label ?? s.id} disabled={!s.label}>
            <button type="button" role="radio" aria-checked={on} aria-label={s.label ?? s.id} onClick={() => onChange(s.id)}
              className={cx('focus-ring rounded-control flex items-center justify-center transition-[filter,box-shadow] duration-fast hover:brightness-110 shadow-[inset_0_0_0_1px_rgb(0_0_0/0.15)]', on && 'ring-2 ring-offset-1 ring-offset-surface-1 ring-accent')}
              style={{ width: size, height: size, backgroundColor: color }}>
              {on && <Check size={Math.round(size * 0.6)} strokeWidth={3} className="text-white drop-shadow" />}
            </button>
          </Tooltip>
        )
      })}
    </div>
  )
}
export default ColorSwatchRow
