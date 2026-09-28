/**
 * WCAG 2.x contrast helpers for the design-token audit (DATA-UX-071). Apple's accessibility
 * guidance asks for at least 4.5:1 for text up to 17 pt and 3:1 for larger or bold text.
 */
export type Rgb = [number, number, number]

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
export function luminance([r, g, b]: Rgb): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** `fg` at `alpha` over `bg` (what a translucent material looks like over a backdrop). */
export function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(fg[i] * alpha + bg[i] * (1 - alpha))) as Rgb
}
export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => Math.round(a[i] * t + b[i] * (1 - t))) as Rgb
}
