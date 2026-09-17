import { cx } from './cx'

/** Hairline separator. Vertical form is sized for toolbars (14px tall). */
export function Divider({ orientation = 'horizontal', className }: { orientation?: 'horizontal' | 'vertical'; className?: string }) {
  return orientation === 'vertical'
    ? <span role="separator" aria-orientation="vertical" className={cx('inline-block w-px h-3.5 bg-separator self-center flex-shrink-0', className)} />
    : <div role="separator" className={cx('h-px w-full bg-separator', className)} />
}
export default Divider
