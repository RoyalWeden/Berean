import { THEME_PRESETS, type ThemePresetDef } from '@/lib/themePresets'

/**
 * User-made color themes (T23-034). Built-in presets in themePresets.ts are immutable — a
 * "customized" preset is always a NEW CustomTheme initialised from that preset's current
 * (light/dark-resolved) colors. The active selection stays the store's `themePreset`, where a
 * custom theme is selected as `custom:<id>`. Stored per device (zustand persist + the SQLite
 * settings table via settingsBridge) — deliberately never synced through iCloud.
 */
export interface CustomTheme {
  id: string
  name: string
  /** Built-in preset id this theme starts from ('' = Default). Its CSS class supplies every
   *  palette var the custom theme does not override. */
  basedOn: string
  /** #rrggbb */
  text: string
  /** #rrggbb */
  background: string
  /** #rrggbb — optional accent override */
  accent?: string
  /** #rrggbb — iPhone Scripture theme only: verse-number colour (derived from text/background when unset). */
  verseNumber?: string
  /** #rrggbb — iPhone Scripture theme only: Strong's number colour (derived from the accent when unset). */
  strongs?: string
}

export const CUSTOM_PREFIX = 'custom:'

export function isCustomThemeId(themePreset: string): boolean {
  return themePreset.startsWith(CUSTOM_PREFIX)
}

export function customThemeKey(id: string): string {
  return `${CUSTOM_PREFIX}${id}`
}

export function findCustomTheme(themePreset: string, customThemes: readonly CustomTheme[] | undefined): CustomTheme | undefined {
  if (!isCustomThemeId(themePreset) || !customThemes) return undefined
  const id = themePreset.slice(CUSTOM_PREFIX.length)
  return customThemes.find((t) => t.id === id)
}

// ── Color helpers ────────────────────────────────────────────────────────────

type RGB = [number, number, number]

/** "r g b" triple (the palette-var format) → [r,g,b]. */
export function parseTriple(triple: string): RGB {
  const [r = 0, g = 0, b = 0] = triple.trim().split(/\s+/).map((n) => Number(n) || 0)
  return [r, g, b]
}

export function hexToRgb(hex: string): RGB | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgbToHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')
}

export function tripleToHex(triple: string): string {
  return rgbToHex(parseTriple(triple))
}

const toTriple = ([r, g, b]: RGB): string => `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`

/** Linear mix: `t` of the way from a to b. */
function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

// ── Preset resolution ───────────────────────────────────────────────────────

/** The built-in preset a (possibly suffixed / custom / system-accent) themePreset maps to. */
export function basePresetFor(themePreset: string, customThemes?: readonly CustomTheme[]): ThemePresetDef {
  const custom = findCustomTheme(themePreset, customThemes)
  const id = custom ? custom.basedOn : (themePreset === 'system-accent' ? '' : themePreset.replace(/-(?:dark|light)$/, ''))
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0]
}

/** A preset's palette for the given scheme. applyThemeToDocument always picks the variant that
 *  matches the effective light/dark scheme (NATURALLY_DARK decides only the class NAME), so the
 *  palette is simply `preset[scheme]`. */
export function presetPalette(preset: ThemePresetDef, scheme: 'dark' | 'light'): { bg: string; accent: string; text: string } {
  return preset[scheme]
}

/** Preview/editor colors (#rrggbb) for any themePreset value under a scheme. */
export function previewColors(
  themePreset: string, customThemes: readonly CustomTheme[] | undefined, scheme: 'dark' | 'light',
): { background: string; text: string; accent: string } {
  const custom = findCustomTheme(themePreset, customThemes)
  const base = presetPalette(basePresetFor(themePreset, customThemes), scheme)
  if (custom) {
    return { background: custom.background, text: custom.text, accent: custom.accent ?? tripleToHex(base.accent) }
  }
  return { background: tripleToHex(base.bg), text: tripleToHex(base.text), accent: tripleToHex(base.accent) }
}

/** The CSS vars that make up the custom override layer (cleared when leaving a custom theme). */
export const CUSTOM_THEME_VARS = [
  '--color-surface-1', '--color-surface-2', '--color-surface-3', '--color-surface-4',
  '--color-text-primary', '--color-text-secondary', '--color-text-muted',
  '--color-accent', '--selection-bg', '--verse-highlight-bg',
] as const

/**
 * Pure: which inline palette-var overrides to put on <html> for this themePreset. Returns `{}`
 * for any built-in preset (the preset's CSS class does all the work) or an unknown custom id.
 *
 * For a custom theme: the chosen background becomes the reading ground (surface-3 — the content
 * surface), with surface-1/2/4 derived as slight steps toward the text color (window, bars,
 * hover/border) so hierarchy survives; the chosen text becomes text-primary with secondary /
 * muted derived by mixing toward the background. An accent override also re-derives the
 * selection and verse-highlight tints.
 */
export function resolveThemeVars(
  themePreset: string, customThemes: readonly CustomTheme[] | undefined, _scheme: 'dark' | 'light',
): Record<string, string> {
  const custom = findCustomTheme(themePreset, customThemes)
  if (!custom) return {}
  const bg = hexToRgb(custom.background)
  const text = hexToRgb(custom.text)
  const vars: Record<string, string> = {}
  if (bg && text) {
    vars['--color-surface-3'] = toTriple(bg)
    vars['--color-surface-1'] = toTriple(mix(bg, text, 0.035))
    vars['--color-surface-2'] = toTriple(mix(bg, text, 0.06))
    vars['--color-surface-4'] = toTriple(mix(bg, text, 0.18))
    vars['--color-text-primary'] = toTriple(text)
    vars['--color-text-secondary'] = toTriple(mix(text, bg, 0.35))
    vars['--color-text-muted'] = toTriple(mix(text, bg, 0.55))
  } else if (bg) {
    vars['--color-surface-3'] = toTriple(bg)
  } else if (text) {
    vars['--color-text-primary'] = toTriple(text)
  }
  const accent = custom.accent ? hexToRgb(custom.accent) : null
  if (accent) {
    vars['--color-accent'] = toTriple(accent)
    vars['--selection-bg'] = `rgba(${accent.join(', ')}, 0.35)`
    vars['--verse-highlight-bg'] = `rgba(${accent.join(', ')}, 0.1)`
  }
  return vars
}

/** New custom theme initialised from `fromPreset`'s current scheme-resolved colors. Never
 *  mutates THEME_PRESETS — it only reads from it. Customizing a custom theme copies it. */
export function makeCustomThemeFrom(
  fromPreset: string, customThemes: readonly CustomTheme[] | undefined, scheme: 'dark' | 'light',
  id: string = newCustomThemeId(),
): CustomTheme {
  const custom = findCustomTheme(fromPreset, customThemes)
  const base = basePresetFor(fromPreset, customThemes)
  const colors = previewColors(fromPreset, customThemes, scheme)
  return {
    id,
    name: custom ? `${custom.name} copy` : `Custom ${base.label}`,
    basedOn: base.id,
    text: colors.text,
    background: colors.background,
    ...(custom?.accent ? { accent: custom.accent } : {}),
  }
}

export function newCustomThemeId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto
  if (c?.randomUUID) return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** Same resolution applyThemeToDocument uses for the effective scheme. */
export function effectiveScheme(theme: 'dark' | 'light' | 'system', systemIsDark: boolean): 'dark' | 'light' {
  return (theme === 'system' ? systemIsDark : theme === 'dark') ? 'dark' : 'light'
}

/** Sanitise persisted data (settings table / localStorage) into CustomTheme[]. */
export function sanitizeCustomThemes(v: unknown): CustomTheme[] {
  if (!Array.isArray(v)) return []
  return v.filter((t): t is CustomTheme =>
    !!t && typeof t === 'object'
    && typeof (t as CustomTheme).id === 'string'
    && typeof (t as CustomTheme).name === 'string'
    && typeof (t as CustomTheme).basedOn === 'string'
    && typeof (t as CustomTheme).text === 'string'
    && typeof (t as CustomTheme).background === 'string')
}
