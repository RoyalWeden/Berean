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

// ── Read Aloud (TTS) playback tints ──────────────────────────────────────────
// Deliberately NOT one of the 5 saved-highlight colors above — Read Aloud is a transient,
// auto-advancing visual cue (not a persisted highlight), so it gets its own theme-aware
// token pair that composes as an ADDITIONAL layer on top of any real highlight/find-match
// styling already applied to a row, rather than replacing it.
export const PLAYBACK_ROW_BG = 'rgb(var(--color-accent) / 0.06)'
export const PLAYBACK_WORD_BG = 'rgb(var(--color-accent) / 0.32)'

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
  /** Read Aloud is currently reading this verse — composes on TOP of any style below via
   *  an inset box-shadow (never overrides backgroundColor, so a real highlight underneath
   *  stays fully visible) rather than participating in the priority chain above. */
  isPlaybackVerse?: boolean
}): CSSProperties | undefined {
  const { isHighlighted, activeHighlight, isFindMatch, isPlaybackVerse } = opts
  const playbackLayer: CSSProperties = isPlaybackVerse
    ? { boxShadow: `inset 0 0 0 999px ${PLAYBACK_ROW_BG}` }
    : {}
  if (isHighlighted) {
    return {
      ...HIGHLIGHT_ACCENT_STYLE_BASE,
      backgroundColor: 'var(--verse-highlight-bg)',
      borderLeft: '3px solid rgb(var(--color-accent))',
      ...playbackLayer,
    }
  }
  if (activeHighlight) {
    return {
      ...HIGHLIGHT_ACCENT_STYLE_BASE,
      backgroundColor: HIGHLIGHT_ROW_BG[activeHighlight],
      borderLeft: `3px solid ${HIGHLIGHT_BORDER[activeHighlight]}`,
      ...playbackLayer,
    }
  }
  if (isFindMatch) {
    return {
      ...HIGHLIGHT_ACCENT_STYLE_BASE,
      // Was a hardcoded amber rgba() literal, disconnected from the 15-color highlight token
      // system every other color here goes through (highlightPalette.ts's own header comment
      // warns this palette has drifted into separate copies before — this was exactly a 4th,
      // untracked one). Reference the SAME `--highlight-amber` CSS var the real "Amber" saved
      // highlight uses (so it can never drift out of sync with a theme change), just at find-
      // match's own lighter alpha (0.08/0.5, distinct from highlightRowBg/highlightBorder's
      // 0.15/0.7 — find matches are transient search results, not a persisted highlight, so
      // deliberately less visually heavy) rather than exporting a new bespoke helper for it.
      backgroundColor: 'rgb(var(--highlight-amber) / 0.08)',
      borderLeft: '3px solid rgb(var(--highlight-amber) / 0.5)',
      ...playbackLayer,
    }
  }
  if (isPlaybackVerse) {
    return { ...HIGHLIGHT_ACCENT_STYLE_BASE, backgroundColor: PLAYBACK_ROW_BG, borderLeft: '3px solid rgb(var(--color-accent) / 0.5)' }
  }
  return undefined
}
