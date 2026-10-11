/**
 * How many characters of running text fit on one line of a given width — used to size a
 * single-line snippet (makeSnippet) to the line that will actually show it, so the snippet is
 * neither cut short of the row's real edge nor so long that its match lands past the edge.
 */

// A representative run of verse/note prose: average glyph width varies a lot between fonts, so
// measure real text rather than assuming ~0.5em per character.
const SAMPLE = 'And whosoever shall exalt himself shall be abased; and he that shall humble himself '

const avgCache = new Map<string, number>()
let ctx: CanvasRenderingContext2D | null | undefined

/** Average advance width (px) of one character of prose in `font` (a CSS font shorthand). */
export function averageCharWidth(font: string): number | null {
  const cached = avgCache.get(font)
  if (cached != null) return cached
  if (ctx === undefined) {
    try { ctx = document.createElement('canvas').getContext('2d') } catch { ctx = null }
  }
  if (!ctx) return null
  ctx.font = font
  const w = ctx.measureText(SAMPLE).width / SAMPLE.length
  if (!(w > 0)) return null
  avgCache.set(font, w)
  return w
}

/**
 * Characters that fit across `widthPx` at an average `charPx`, plus a small overshoot so the
 * line is always filled to its edge (the CSS ellipsis then marks the real cut). `null` when
 * either input is unknown — callers keep their own default.
 */
export function charsThatFit(widthPx: number, charPx: number | null, overshoot = 1.12): number | null {
  if (!(widthPx > 0) || !charPx || !(charPx > 0)) return null
  return Math.max(24, Math.round((widthPx / charPx) * overshoot))
}
