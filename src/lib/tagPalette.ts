/**
 * Generated per-theme tag colour palette.
 *
 * A verse tag stores a *slot* index (0..11), not a colour name. Each theme gets its own set of
 * 12 slot colours, generated here from the theme's resolved background luminance (+ accent hue),
 * and written to `<html>` as `--tag-slot-0 .. --tag-slot-11` ("r g b" triples). Switching themes
 * keeps every tag's slot but re-generates the colours, so a tag "flips" to suit the new theme.
 *
 * Highlight colours (`--highlight-*`) are deliberately theme-invariant and are NOT touched here.
 */

export const TAG_SLOT_COUNT = 12

// Hue stops around the wheel. Slightly non-uniform: the yellow→green band (~60–150°) is
// perceptually crowded, so it's compressed; blues/purples get a little more room.
const HUE_STOPS = [0, 28, 45, 62, 96, 140, 170, 194, 214, 246, 280, 320]

function clamp01(n: number) { return n < 0 ? 0 : n > 1 ? 1 : n }

function hslToRgbTriple(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360
  s = clamp01(s)
  l = clamp01(l)
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) { r = c; g = x } else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x } else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c } else { r = c; b = x }
  return `${Math.round((r + m) * 255)} ${Math.round((g + m) * 255)} ${Math.round((b + m) * 255)}`
}

function parseTriple(v: string): [number, number, number] | null {
  const m = v.trim().match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

function relLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function rgbToHue([r, g, b]: [number, number, number]): number {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), d = max - min
  if (d === 0) return 0
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return ((h * 60) % 360 + 360) % 360
}

export interface TagPaletteInput {
  isDark: boolean
  /** Theme accent as an "r g b" string; used to rotate the whole wheel so palettes feel on-brand. */
  accentRgb?: string | null
}

/** The 12 slot colours for a theme, as "r g b" triples. */
export function computeTagSlotTriples({ isDark, accentRgb }: TagPaletteInput): string[] {
  // S/L tuned so all 12 stay legible and mutually distinct on the theme background.
  const sat = isDark ? 0.62 : 0.68
  const light = isDark ? 0.64 : 0.42
  let rot = 0
  if (accentRgb) {
    const t = parseTriple(accentRgb)
    if (t) rot = rgbToHue(t) * 0.25 // gentle nudge toward the accent hue, not a full lock
  }
  return HUE_STOPS.map((h, i) => {
    // alternate a touch of S/L per slot so adjacent hues read as clearly different chips
    const s = sat + (i % 2 ? -0.06 : 0.04)
    const l = light + (i % 3 === 1 ? 0.05 : i % 3 === 2 ? -0.04 : 0)
    return hslToRgbTriple(h + rot, s, l)
  })
}

/**
 * Resolve the current theme (from the DOM, after applyThemeToDocument has run) and write the 12
 * `--tag-slot-*` custom properties onto `<html>`. Safe to call on every theme change.
 */
export function applyTagPaletteToDocument(): void {
  if (typeof document === 'undefined') return
  const html = document.documentElement
  const cs = getComputedStyle(html)
  const surface = parseTriple(cs.getPropertyValue('--color-surface-1') || cs.getPropertyValue('--color-bg') || '')
  const isDark = surface ? relLuminance(surface) < 0.5 : html.classList.contains('dark') || !html.classList.contains('light')
  const accentRgb = cs.getPropertyValue('--color-accent') || null
  const triples = computeTagSlotTriples({ isDark, accentRgb })
  triples.forEach((t, i) => html.style.setProperty(`--tag-slot-${i}`, t))
}

/** `rgb(var(--tag-slot-N))` — for inline `style={{ ... }}` (Tailwind JIT can't see interpolation). */
export function tagSlotVar(slot: number, alpha = 1): string {
  const s = Math.max(0, Math.min(TAG_SLOT_COUNT - 1, Math.floor(slot)))
  return alpha === 1 ? `rgb(var(--tag-slot-${s}))` : `rgb(var(--tag-slot-${s}) / ${alpha})`
}

const NEUTRAL = 'rgb(var(--color-text-muted))'

// Legacy literal `color` values were highlight-palette ids (see highlightPalette.ts).
const HIGHLIGHT_IDS = new Set([
  'yellow', 'orange', 'amber', 'red', 'rose', 'pink', 'violet', 'purple',
  'indigo', 'blue', 'sky', 'cyan', 'teal', 'green', 'lime',
])

/**
 * Precedence: literal `color` override → generated slot colour → neutral.
 * A `color` that is a bare integer string is treated as "no override" (defensive — slots are
 * stored in `colorSlot`, never here).
 */
export function resolveTagColor(
  tag: { color?: string | null; colorSlot?: number | null } | null | undefined,
  alpha = 1,
): string {
  if (!tag) return NEUTRAL
  const { color, colorSlot } = tag
  if (color && !/^\d+$/.test(color.trim())) {
    if (HIGHLIGHT_IDS.has(color)) {
      return alpha === 1 ? `rgb(var(--highlight-${color}))` : `rgb(var(--highlight-${color}) / ${alpha})`
    }
    return color // raw CSS colour
  }
  if (colorSlot != null && colorSlot >= 0) return tagSlotVar(colorSlot, alpha)
  return NEUTRAL
}
