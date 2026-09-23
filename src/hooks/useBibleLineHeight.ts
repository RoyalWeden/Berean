import { useEffect } from 'react'
import { useAppStore } from '@/store'

/** CSS `line-height` for each Reading → Line height choice. */
export const BIBLE_LINE_HEIGHTS = { compact: '1.3', comfortable: '1.75', spacious: '2.1' } as const

/**
 * Publishes the Bible line-height setting as `--line-height-comfortable`, the variable every
 * verse row reads. Mounted by BOTH shells (desktop App.tsx, iPhone MobileApp.tsx) — it used to
 * live only in App.tsx, so the phone's Line height control changed the store and nothing else
 * (TEST-024). The setting itself stays a device-local preference.
 */
export function useBibleLineHeight(): void {
  const bibleLineHeight = useAppStore((s) => s.bibleLineHeight)
  useEffect(() => {
    document.documentElement.style.setProperty('--line-height-comfortable', BIBLE_LINE_HEIGHTS[bibleLineHeight] ?? BIBLE_LINE_HEIGHTS.comfortable)
  }, [bibleLineHeight])
}
