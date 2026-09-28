import { applyThemeToDocument, type ApplyThemeOptions } from '@/lib/applyTheme'
import {
  basePresetFor, effectiveScheme, findCustomTheme, hexToRgb, parseTriple, presetPalette, type CustomTheme,
} from '@/lib/customTheme'
import '../reader/scriptureTheme.css'

/**
 * iPhone colour presets are a SCRIPTURE theme (SEP25): a preset (built-in or custom) colours only
 * the reading surface — reader background, Scripture text, verse numbers, Strong's numbers,
 * red letters / italics — never the app (sheets, Notes, Search, Settings, tabs, navigation). The
 * app itself follows System Light/Dark with the Default palette, independently of the preset, so
 * System Light + a black Scripture theme and System Dark + Sepia are both valid.
 *
 * Data model: unchanged — the store's `themePreset` ('' | preset id | 'custom:<id>') and
 * `customThemes` are REINTERPRETED as the Scripture theme, so every existing choice carries over
 * (a custom theme's text/background, which used to become global surface/text tokens, now become
 * the Scripture text/background). The optional `verseNumber` / `strongs` fields refine it.
 *
 * Mechanism: `--scripture-*` custom properties (full colours, plus `-rgb` triples) written into ONE injected
 * <style> scoped to the reading surfaces, gated by `html[data-scripture-theme]` — no :root colour
 * token is ever set. src/mobile/reader/scriptureTheme.css consumes them.
 */

export type RGB = [number, number, number]

/** "r g b" triples (for `rgb(var(--x) / a)` and re-pointing the app's triple-format tokens)… */
export const SCRIPTURE_RGB_VARS = [
  '--scripture-bg-rgb', '--scripture-text-rgb', '--scripture-text-secondary-rgb', '--scripture-text-muted-rgb',
  '--scripture-verse-num-rgb', '--scripture-strongs-rgb', '--scripture-red-letter-rgb',
] as const
/** …and full colours, usable directly (`background: var(--scripture-bg)`) — e.g. by readerChrome.css. */
export const SCRIPTURE_COLOR_VARS = ['--scripture-bg', '--scripture-text', '--scripture-verse-num', '--scripture-strongs'] as const
export const SCRIPTURE_VARS = [...SCRIPTURE_RGB_VARS, ...SCRIPTURE_COLOR_VARS] as const
export type ScriptureVar = typeof SCRIPTURE_VARS[number]

/** Where the vars are defined: the reading surfaces (reader + compare) and their page roots, so
 *  page-level chrome such as the status-bar band above the reader can read them too. */
export const SCRIPTURE_SCOPE_SELECTOR = ':is(.mobile-reader, .m-compare, .mobile-page.is-reader, .mobile-page.is-compare)'
const STYLE_ID = 'berean-scripture-theme'

const triple = ([r, g, b]: RGB) => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/** WCAG relative luminance. */
export function luminance([r, g, b]: RGB): number {
  const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/**
 * Pure: the `--scripture-*` vars (full colours + `-rgb` triples) for a themePreset under the app's light/dark scheme, or `{}` when
 * the reader should simply follow the app (Default, system accent, unknown custom id).
 * Unset custom colours are derived so the page stays coherent: verse numbers sit halfway between
 * text and background, Strong's use the accent (or a text tint when the accent would not read
 * on the chosen background), red letters pick a red that suits a light or dark page.
 */
export function scriptureThemeVars(
  themePreset: string, customThemes: readonly CustomTheme[] | undefined, scheme: 'dark' | 'light',
): Partial<Record<ScriptureVar, string>> {
  const custom = findCustomTheme(themePreset, customThemes)
  if (!custom && (!themePreset || themePreset === 'system-accent' || themePreset.startsWith('custom:'))) return {}
  const base = presetPalette(basePresetFor(themePreset, customThemes), scheme)
  const bg: RGB = (custom && hexToRgb(custom.background)) || parseTriple(base.bg)
  const text: RGB = (custom && hexToRgb(custom.text)) || parseTriple(base.text)
  const accent: RGB = (custom?.accent && hexToRgb(custom.accent)) || parseTriple(base.accent)
  const verseNum: RGB = (custom?.verseNumber && hexToRgb(custom.verseNumber)) || mix(text, bg, 0.5)
  const strongs: RGB = (custom?.strongs && hexToRgb(custom.strongs))
    || (contrast(accent, bg) >= 3 ? accent : mix(text, bg, 0.3))
  const darkPage = luminance(bg) < 0.2
  const rgb = {
    '--scripture-bg-rgb': triple(bg),
    '--scripture-text-rgb': triple(text),
    '--scripture-text-secondary-rgb': triple(mix(text, bg, 0.35)),
    '--scripture-text-muted-rgb': triple(mix(text, bg, 0.55)),
    '--scripture-verse-num-rgb': triple(verseNum),
    '--scripture-strongs-rgb': triple(strongs),
    '--scripture-red-letter-rgb': darkPage ? '255 110 110' : '190 30 30',
  }
  return {
    ...rgb,
    '--scripture-bg': `rgb(${rgb['--scripture-bg-rgb']})`,
    '--scripture-text': `rgb(${rgb['--scripture-text-rgb']})`,
    '--scripture-verse-num': `rgb(${rgb['--scripture-verse-num-rgb']})`,
    '--scripture-strongs': `rgb(${rgb['--scripture-strongs-rgb']})`,
  }
}

/** Pure: the injected stylesheet body for a var set ('' when there is nothing to apply). */
export function scriptureThemeCss(vars: Partial<Record<ScriptureVar, string>>): string {
  const decls = Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')
  return decls ? `${SCRIPTURE_SCOPE_SELECTOR} { ${decls} }` : ''
}

/** Apply (or clear) the Scripture theme on the document: one scoped <style> + the gate attribute. */
export function applyScriptureTheme(themePreset: string, customThemes: readonly CustomTheme[] | undefined, scheme: 'dark' | 'light'): void {
  const css = scriptureThemeCss(scriptureThemeVars(themePreset, customThemes, scheme))
  const html = document.documentElement
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    el?.remove()
    delete html.dataset.scriptureTheme
    return
  }
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  if (el.textContent !== css) el.textContent = css
  html.dataset.scriptureTheme = themePreset
}

/**
 * The iPhone shell's appearance entry point (replaces MobileApp's direct applyThemeToDocument
 * call): the app gets the Default palette for System Light/Dark (the preset is NOT passed through,
 * except the system accent), and the preset goes to the Scripture scope only.
 */
export function applyMobileAppearance(opts: ApplyThemeOptions): void {
  const { themePreset } = opts
  applyThemeToDocument({ ...opts, themePreset: themePreset === 'system-accent' ? 'system-accent' : '' })
  applyScriptureTheme(themePreset, opts.customThemes, effectiveScheme(opts.theme, opts.systemIsDark))
}
