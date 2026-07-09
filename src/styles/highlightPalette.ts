import type { HighlightColor } from '@/types'

/**
 * Single source of truth for highlight-swatch and note-link colors.
 * Backed by CSS custom properties in global.css (`--highlight-*` / `--link-*`),
 * defined once in :root since these are fixed pigment colors (like a physical
 * highlighter) rather than theme-adaptive chrome — they intentionally look the
 * same across all 19 theme presets. Consumed by VerseRow.tsx, NoteEditor.tsx,
 * and the .cm-live-hl-* / mark.hl-* CSS rules so the palette can never drift
 * out of sync between the verse view and the note editor again.
 */
export const HIGHLIGHT_COLOR_IDS: HighlightColor[] = [
  'yellow', 'orange', 'amber', 'red', 'rose',
  'pink', 'violet', 'purple', 'indigo', 'blue',
  'sky', 'cyan', 'teal', 'green', 'lime'
]

export const HIGHLIGHT_LABELS: Record<HighlightColor, string> = {
  yellow: 'Yellow', orange: 'Orange', amber: 'Amber', red: 'Red', rose: 'Rose',
  pink: 'Pink', violet: 'Violet', purple: 'Purple', indigo: 'Indigo', blue: 'Blue',
  sky: 'Sky', cyan: 'Cyan', teal: 'Teal', green: 'Green', lime: 'Lime'
}

const cssVar = (color: HighlightColor, alpha: number) =>
  `rgb(var(--highlight-${color}) / ${alpha})`

/** Swatch dot / picker UI (solid) — Tailwind arbitrary-value class. */
export const highlightDot = (color: HighlightColor): string => `bg-[rgb(var(--highlight-${color}))]`
/** Swatch dot as a raw CSS color value, for inline `style={{ backgroundColor }}` usage. */
export const highlightDotColor = (color: HighlightColor): string => cssVar(color, 1)
/** Tailwind-class equivalent for swatch buttons (bg-20%, hover-30%). */
export const highlightSwatchClasses = (color: HighlightColor): string =>
  `bg-[rgb(var(--highlight-${color})/0.20)] hover:bg-[rgb(var(--highlight-${color})/0.30)]`
/** Full verse-row background tint. */
export const highlightRowBg = (color: HighlightColor): string => cssVar(color, 0.15)
/** Row left-border accent. */
export const highlightBorder = (color: HighlightColor): string => cssVar(color, 0.7)
/** Word/phrase-level highlight background. */
export const highlightWordBg = (color: HighlightColor): string => cssVar(color, 0.5)
/** CodeMirror live-preview / rendered-preview <mark> background. */
export const highlightMarkBg = (color: HighlightColor): string => cssVar(color, 0.38)

/** Note-editor link/reference colors (wikilinks, verse refs, LXX refs, lexicon refs). */
export const LINK_COLORS = {
  wikilink: 'rgb(var(--link-wikilink))',
  verseRef: 'rgb(var(--color-accent))',
  lxxRef: 'rgb(var(--link-lxx-ref))',
  lexiconRef: 'rgb(var(--link-lexicon-ref))'
} as const

/** Themed red-letter (words of Yeshua) text color — varies per theme preset. */
export const RED_LETTER_COLOR = 'rgb(var(--color-red-letter))'
export const RED_LETTER_CLASS = 'text-[rgb(var(--color-red-letter))]'
