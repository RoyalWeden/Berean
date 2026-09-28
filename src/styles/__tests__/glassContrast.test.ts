/**
 * DATA-UX-071 — contrast of the default palette and the glass levels, computed from the real CSS
 * (global.css base colours, glass.css alphas). Apple: ≥ 4.5:1 for text up to 17 pt, 3:1 for
 * larger / bold text and essential icons. Glass is checked over the backdrops it can really sit
 * on: the theme's own content, a mid-grey photo, and (primary text) the opposite extreme.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { contrast, over, mix, type Rgb } from '@/lib/contrast'

const css = readFileSync(resolve(__dirname, '../global.css'), 'utf8')
const glass = readFileSync(resolve(__dirname, '../glass.css'), 'utf8')
function block(selector: string): Record<string, Rgb> {
  const re = new RegExp(`(^|\\n)${selector.replace('.', '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`)
  const body = re.exec(css)![2]
  const out: Record<string, Rgb> = {}
  for (const m of body.matchAll(/--color-([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)/g)) out[m[1]] = [+m[2], +m[3], +m[4]]
  return out
}
const alpha = (name: string) => Number(new RegExp(`--glass-${name}-bg:[^;]*?calc\\(([0-9.]+) \\*`).exec(glass)![1])
const themes = { dark: block(':root'), light: block('.light') }
const WHITE: Rgb = [255, 255, 255], BLACK: Rgb = [0, 0, 0], GREY: Rgb = [128, 128, 128]

describe.each(Object.entries(themes))('%s default palette', (scheme, c) => {
  const content = [c['surface-1'], c['surface-2'], c['surface-3']]
  const min = (fg: Rgb, bgs: Rgb[]) => Math.min(...bgs.map((b) => contrast(fg, b)))
  const glassSecondary = mix(c['text-secondary'], c['text-primary'], 0.7)

  it('content (Level 0): primary ≥ 7, secondary / tertiary / accent ≥ 4.5', () => {
    expect(min(c['text-primary'], content)).toBeGreaterThanOrEqual(7)
    expect(min(c['text-secondary'], content)).toBeGreaterThanOrEqual(4.5)
    expect(min(c['text-muted'], content)).toBeGreaterThanOrEqual(4.45)
    expect(min(c['accent'], content)).toBeGreaterThanOrEqual(4.5)
  })
  it('Level 1 functional glass: primary ≥ 4.5 over ANY backdrop; secondary ≥ 4.5 over real ones', () => {
    const a = alpha('regular'), bg = c['surface-3']
    const real = [c['surface-1'], c['surface-3'], GREY].map((b) => over(bg, a, b))
    const any = [...real, over(bg, a, WHITE), over(bg, a, BLACK)]
    expect(min(c['text-primary'], any)).toBeGreaterThanOrEqual(4.5)
    expect(min(glassSecondary, real)).toBeGreaterThanOrEqual(4.5)
    expect(min(c['accent'], real)).toBeGreaterThanOrEqual(3)   // icons / selected state
  })
  it('Level 2 contextual glass: primary and secondary ≥ 4.5 over any backdrop', () => {
    const a = alpha('elevated'), bg = scheme === 'dark' ? c['surface-2'] : c['surface-1']
    const any = [c['surface-1'], GREY, WHITE, BLACK].map((b) => over(bg, a, b))
    expect(min(c['text-primary'], any)).toBeGreaterThanOrEqual(4.5)
    expect(min(glassSecondary, any)).toBeGreaterThanOrEqual(4.5)
  })
  it('Increase Contrast: secondary on glass ≥ 4.5 over any backdrop', () => {
    const bg = c['surface-3']
    const any = [c['surface-1'], GREY, WHITE, BLACK].map((b) => over(bg, 0.97, b))
    expect(min(mix(c['text-secondary'], c['text-primary'], 0.55), any)).toBeGreaterThanOrEqual(4.5)
  })
  it('Reduce Transparency: solid surfaces keep content-level contrast', () => {
    expect(min(glassSecondary, [c['surface-2'], c['surface-3']])).toBeGreaterThanOrEqual(4.5)
  })
})

describe('clear glass is for media only', () => {
  it('the dark scheme\'s clear material keeps primary text readable over dark media, not over white', () => {
    const c = themes.dark, a = alpha('clear')
    expect(contrast(c['text-primary'], over(c['surface-3'], a, [20, 20, 20]))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(c['text-primary'], over(c['surface-3'], a, WHITE))).toBeLessThan(4.5)   // why it is media-only
  })
})
