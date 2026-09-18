import * as RD from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { IconButton } from './IconButton'

export type SheetSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZE: Record<SheetSize, string> = {
  sm: 'w-[min(420px,92vw)]',
  md: 'w-[min(640px,92vw)]',
  lg: 'w-[min(920px,94vw)] h-[min(700px,88vh)]',
  xl: 'w-[min(1100px,95vw)] h-[min(800px,90vh)]',
}

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  size?: SheetSize
  /** Optional header row: title (+ description) and a close button. Omit for fully custom content. */
  title?: ReactNode
  description?: ReactNode
  /** Hide the header close button (e.g. when the content provides its own). */
  hideClose?: boolean
  /** Layer above other sheets (command palette, theme picker). */
  critical?: boolean
  className?: string
  /** Applied to the scrollable body wrapper. */
  bodyClassName?: string
  children: ReactNode
  /** Extra content on the header's trailing side (left of the close button). */
  headerActions?: ReactNode
  /** 'stack' (default): header pinned above a single scrolling body. 'split': a left `sidebar`
   *  column (own scroll, own material) beside the scrolling body — e.g. Settings' nav list. */
  layout?: 'stack' | 'split'
  /** Left column content when `layout="split"`. */
  sidebar?: ReactNode
  /** Passed through to Radix Dialog.Root — set `false` while a non-Portal overlay (e.g.
   *  ThemePicker, which portals straight to document.body) needs to sit on top without Radix's
   *  scroll-lock/inert sweep treating it as "outside". */
  modal?: boolean
  onPointerDownOutside?: (e: Event) => void
  onInteractOutside?: (e: Event) => void
}

/**
 * Modal sheet — the one dialog shell: a dimmed + lightly blurred scrim, a sheet-material
 * card at the window's own 20px radius, native-ish header, Esc/click-outside to close
 * (Radix Dialog handles focus trapping and `aria-modal`).
 */
export function Sheet({ open, onOpenChange, size = 'md', title, description, hideClose, critical, className, bodyClassName, children, headerActions, layout = 'stack', sidebar, modal, onPointerDownOutside, onInteractOutside }: SheetProps) {
  const z = critical ? 'z-critical' : 'z-modal'
  return (
    <RD.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <RD.Portal>
        <RD.Overlay className={cx('fixed inset-0 bg-black/40 animate-fade-in', z)} style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }} />
        <RD.Content
          onPointerDownOutside={onPointerDownOutside}
          onInteractOutside={onInteractOutside}
          className={cx(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col outline-none',
            'material-sheet rounded-sheet overflow-hidden text-text-primary animate-radix-popup-in',
            z, SIZE[size], className,
          )}
        >
          {(title || !hideClose) && (
            <div className="flex items-center gap-3 px-5 pt-4 pb-3 flex-shrink-0">
              <div className="flex-1 min-w-0">
                {title && <RD.Title className="text-title3 font-semibold leading-tight truncate">{title}</RD.Title>}
                {description && <RD.Description className="text-caption text-text-muted mt-0.5">{description}</RD.Description>}
              </div>
              {headerActions}
              {!hideClose && (
                <RD.Close asChild>
                  <IconButton icon={X} label="Close" size={24} tooltip={false} />
                </RD.Close>
              )}
            </div>
          )}
          {layout === 'split' ? (
            <div className="flex-1 min-h-0 flex items-stretch">
              <div className="material-sidebar border-r border-separator flex-shrink-0 overflow-y-auto">{sidebar}</div>
              <div className={cx('flex-1 min-w-0 overflow-y-auto', bodyClassName)}>{children}</div>
            </div>
          ) : (
            <div className={cx('flex-1 min-h-0 overflow-y-auto', bodyClassName)}>{children}</div>
          )}
        </RD.Content>
      </RD.Portal>
    </RD.Root>
  )
}

export const SheetClose = RD.Close
export default Sheet
