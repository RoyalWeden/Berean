import type { CSSProperties } from 'react'
import type { HighlightColor } from '@/types'
import {
  HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS,
  highlightSwatchBg, highlightDotColor, highlightRowBg, highlightBorder, highlightWordBg
} from '@/styles/highlightPalette'

/**
 * Highlight/row-background style derivations for VerseRow.tsx and ChapterView.tsx,
 * built from the single-source-of-truth colors in src/styles/highlightPalette.ts.
 * Extracted out of VerseRow.tsx so the 1600+ line component only consumes these,
 * never redefines them — that redefinition is exactly how the highlight palette
 * drifted into 3 copies before.
 */

// NOTE: `bg`/`dot` are raw CSS color strings (not Tailwind classes) — apply via
// inline `style`, never `className`. See highlightPalette.ts for why.
export const HIGHLIGHT_COLORS: { id: HighlightColor; bg: string; dot: string; label: string }[] =
  HIGHLIGHT_COLOR_IDS.map((id) => ({
    id,
    bg: highlightSwatchBg(id),
    dot: highlightDotColor(id),
    label: HIGHLIGHT_LABELS[id]
  }))

export const HIGHLIGHT_ROW_BG: Record<HighlightColor, string> =
  Object.fromEntries(HIGHLIGHT_COLOR_IDS.map((id) => [id, highlightRowBg(id)])) as Record<HighlightColor, string>

export const HIGHLIGHT_BORDER: Record<HighlightColor, string> =
  Object.fromEntries(HIGHLIGHT_COLOR_IDS.map((id) => [id, highlightBorder(id)])) as Record<HighlightColor, string>

export const WORD_HIGHLIGHT_BG: Record<HighlightColor, string> =
  Object.fromEntries(HIGHLIGHT_COLOR_IDS.map((id) => [id, highlightWordBg(id)])) as Record<HighlightColor, string>

const HIGHLIGHT_ACCENT_STYLE_BASE: CSSProperties = {
  paddingLeft: '0.5rem',
  marginLeft: '-0.75rem',
  borderRadius: '0 4px 4px 0'
}

/**
 * Row-level background/border-accent style for a verse, in priority order:
 * cross-ref/note match > active color highlight > find-query match > none.
 * Mirrors the exact rgba/token values previously inlined in VerseRow.tsx.
 */
export function getVerseRowStyle(opts: {
  isHighlighted?: boolean
  activeHighlight?: HighlightColor | null
  isFindMatch?: boolean
}): CSSProperties | undefined {
  const { isHighlighted, activeHighlight, isFindMatch } = opts
  if (isHighlighted) {
    return {
      ...HIGHLIGHT_ACCENT_STYLE_BASE,
      backgroundColor: 'var(--verse-highlight-bg)',
      borderLeft: '3px solid rgb(var(--color-accent))'
    }
  }
  if (activeHighlight) {
    return {
      ...HIGHLIGHT_ACCENT_STYLE_BASE,
      backgroundColor: HIGHLIGHT_ROW_BG[activeHighlight],
      borderLeft: `3px solid ${HIGHLIGHT_BORDER[activeHighlight]}`
    }
  }
  if (isFindMatch) {
    return {
      ...HIGHLIGHT_ACCENT_STYLE_BASE,
      backgroundColor: 'rgba(234,179,8,0.08)',
      borderLeft: '3px solid rgba(234,179,8,0.5)'
    }
  }
  return undefined
}
