import type { YouTubeLayout } from '@/types'

export interface LayoutDef {
  id: YouTubeLayout
  label: string
  description: string
  /** True when this layout requires both panelA and panelB */
  requiresBoth: boolean
  /** Rendered preview element (inline SVG-style grid) */
  preview: string
}

export const YOUTUBE_LAYOUTS: LayoutDef[] = [
  {
    id: 'video-full',
    label: 'Video only',
    description: 'Full-width video, no secondary panel',
    requiresBoth: false,
    preview: 'full',
  },
  {
    id: 'side-right',
    label: 'Panel right',
    description: 'Video left · panel right (55/45)',
    requiresBoth: false,
    preview: 'v|p',
  },
  {
    id: 'side-left',
    label: 'Panel left',
    description: 'Panel left · video right (45/55)',
    requiresBoth: false,
    preview: 'p|v',
  },
  {
    id: 'wide-video',
    label: 'Video wide',
    description: 'Video left (65%) · panel narrow right',
    requiresBoth: false,
    preview: 'vv|p',
  },
  {
    id: 'wide-panel',
    label: 'Panel wide',
    description: 'Video narrow left · panel wide right (35/65)',
    requiresBoth: false,
    preview: 'v|pp',
  },
  {
    id: 'stack-below',
    label: 'Panel below',
    description: 'Video top (60%) · panel below',
    requiresBoth: false,
    preview: 'v/p',
  },
  {
    id: 'stack-above',
    label: 'Panel above',
    description: 'Panel above · video below (40/60)',
    requiresBoth: false,
    preview: 'p/v',
  },
  {
    id: 'three-col',
    label: 'Three columns',
    description: 'Panel A · video · panel B — equal thirds',
    requiresBoth: true,
    preview: 'p|v|p',
  },
  {
    id: 'three-col-wide-video',
    label: 'Three columns (wide video)',
    description: 'Panel A (25%) · video (50%) · panel B (25%)',
    requiresBoth: true,
    preview: 'p|vv|p',
  },
  {
    id: 'stacked-right',
    label: 'Stacked right',
    description: 'Video left · panel A + panel B stacked right',
    requiresBoth: true,
    preview: 'v|p/p',
  },
  {
    id: 'stacked-left',
    label: 'Stacked left',
    description: 'Panel A + panel B stacked left · video right',
    requiresBoth: true,
    preview: 'p/p|v',
  },
]

export const LAYOUT_BY_ID = new Map(YOUTUBE_LAYOUTS.map((l) => [l.id, l]))

/** Given the current panel state, suggest a sensible default layout when panels are added/removed. */
export function suggestLayout(
  hasPanelA: boolean,
  hasPanelB: boolean,
  current: YouTubeLayout,
): YouTubeLayout {
  if (!hasPanelA && !hasPanelB) return 'video-full'
  if (hasPanelA && !hasPanelB) {
    // Keep current if it's a single-panel layout, else fall back to side-right
    const def = LAYOUT_BY_ID.get(current)
    if (def && !def.requiresBoth) return current
    return 'side-right'
  }
  if (hasPanelA && hasPanelB) {
    // Keep current if it's a two-panel layout, else fall back to three-col
    const def = LAYOUT_BY_ID.get(current)
    if (def?.requiresBoth) return current
    return 'three-col'
  }
  return 'video-full'
}

/** CSS flex/grid style for a given layout */
export interface LayoutStyle {
  containerClass: string   // flex row/col class
  videoClass: string       // flex-basis or grid-area
  panelAClass: string
  panelBClass: string
}

export function getLayoutStyle(layout: YouTubeLayout): LayoutStyle {
  switch (layout) {
    case 'video-full':
      return { containerClass: 'flex flex-col', videoClass: 'flex-1', panelAClass: 'hidden', panelBClass: 'hidden' }
    case 'side-right':
      return { containerClass: 'flex flex-row', videoClass: 'w-[55%] flex-shrink-0', panelAClass: 'flex-1 min-w-0', panelBClass: 'hidden' }
    case 'side-left':
      return { containerClass: 'flex flex-row', videoClass: 'flex-1 min-w-0', panelAClass: 'w-[45%] flex-shrink-0', panelBClass: 'hidden' }
    case 'wide-video':
      return { containerClass: 'flex flex-row', videoClass: 'w-[65%] flex-shrink-0', panelAClass: 'flex-1 min-w-0', panelBClass: 'hidden' }
    case 'wide-panel':
      return { containerClass: 'flex flex-row', videoClass: 'w-[35%] flex-shrink-0', panelAClass: 'flex-1 min-w-0', panelBClass: 'hidden' }
    case 'stack-below':
      return { containerClass: 'flex flex-col', videoClass: 'h-[60%] flex-shrink-0', panelAClass: 'flex-1 min-h-0', panelBClass: 'hidden' }
    case 'stack-above':
      return { containerClass: 'flex flex-col', videoClass: 'flex-1 min-h-0', panelAClass: 'h-[40%] flex-shrink-0', panelBClass: 'hidden' }
    case 'three-col':
      return { containerClass: 'flex flex-row', videoClass: 'flex-1 min-w-0', panelAClass: 'w-[30%] flex-shrink-0', panelBClass: 'w-[30%] flex-shrink-0' }
    case 'three-col-wide-video':
      return { containerClass: 'flex flex-row', videoClass: 'w-[50%] flex-shrink-0', panelAClass: 'flex-1 min-w-0', panelBClass: 'flex-1 min-w-0' }
    case 'stacked-right':
      return { containerClass: 'flex flex-row', videoClass: 'w-[55%] flex-shrink-0', panelAClass: 'flex-1 min-w-0', panelBClass: 'flex-1 min-w-0' }
    case 'stacked-left':
      return { containerClass: 'flex flex-row', videoClass: 'flex-1 min-w-0', panelAClass: 'w-[45%] flex-shrink-0', panelBClass: 'w-[45%] flex-shrink-0' }
    default:
      return { containerClass: 'flex flex-col', videoClass: 'flex-1', panelAClass: 'hidden', panelBClass: 'hidden' }
  }
}

/**
 * For stacked-right and stacked-left, panelA and panelB need to be wrapped
 * in a nested flex-col div. Returns true when that wrapping is needed.
 */
export function needsPanelWrapper(layout: YouTubeLayout): boolean {
  return layout === 'stacked-right' || layout === 'stacked-left'
}

/**
 * For stacked-right/left, the panels go in a wrapper column on one side.
 * Returns 'right' if panels are on the right, 'left' if on the left.
 */
export function panelSide(layout: YouTubeLayout): 'left' | 'right' | 'none' {
  if (layout === 'stacked-right') return 'right'
  if (layout === 'stacked-left') return 'left'
  return 'none'
}
