import { forwardRef, type InputHTMLAttributes } from 'react'
import { cx } from './cx'

export interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number
  min?: number
  max?: number
  step?: number
  onValueChange: (value: number) => void
  /** Optional value readout on the right. */
  readout?: string
}

/** NSSlider-style range control (styling in global.css `.ui-slider`). */
export const Slider = forwardRef<HTMLInputElement, SliderProps>(function Slider(
  { value, min = 0, max = 100, step = 1, onValueChange, readout, className, ...rest }, ref,
) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0
  return (
    <span className={cx('inline-flex items-center gap-2 min-w-0', className)}>
      <input
        ref={ref}
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onValueChange(Number(e.target.value))}
        className="ui-slider flex-1 min-w-[80px]"
        style={{ ['--slider-fill' as string]: `${pct}%` }}
        {...rest}
      />
      {readout !== undefined && <span className="text-caption2 text-text-muted tabular-nums w-10 text-right flex-shrink-0">{readout}</span>}
    </span>
  )
})
export default Slider
