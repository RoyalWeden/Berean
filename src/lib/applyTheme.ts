import {
  ALL_PRESET_CLASSES, NATURALLY_DARK_IDS, PRESET_ANIMATION_STYLE,
  type AnimationStyle, type AnimationIntensity,
} from '@/lib/themePresets'
import { applyTagPaletteToDocument } from '@/lib/tagPalette'
import { useAppStore } from '@/store'
import { CUSTOM_THEME_VARS, findCustomTheme, resolveThemeVars, type CustomTheme } from '@/lib/customTheme'

/**
 * Single, shared implementation of "apply the current theme/preset/animation to <html>" —
 * used by the main window (App.tsx), the floating "Pop Out Tab" window (FloatingShell.tsx), and
 * the presenter/viewer window (ViewerApp.tsx, when following the main window's theme).
 *
 * Before this existed, each of those three files had its OWN copy-pasted version of this logic,
 * including its own hardcoded list of preset class names — three separate places that had to be
 * kept in sync by hand every time a theme was added. They weren't: adding the 22 Muted & Pastel
 * themes only updated App.tsx's copy, so a floating tab or the presenter window opened while one
 * of those was active silently fell back to no preset at all (reported: "make sure the floating
 * tab and the presenter window have the same theme as the main app"). Fixed at the source by
 * having only one function that knows how to do this, built on themePresets.ts's own exports —
 * the same fix already applied to App.tsx's copy in an earlier pass, now actually shared instead
 * of just being the one copy that happened to get updated.
 */
export interface ApplyThemeOptions {
  theme: 'dark' | 'light' | 'system'
  themePreset: string
  systemIsDark: boolean
  /** Live macOS accent color ("r g b" string) — backs the 'system-accent' preset. */
  systemAccentColor?: string | null
  backgroundAnimationEnabled?: boolean
  backgroundAnimationStyle?: 'auto' | AnimationStyle
  backgroundAnimationIntensity?: AnimationIntensity
  /** Settings → Appearance → Glass appearance. Scales every material's alpha via
   *  `--glass-alpha-mult` (mirrors macOS 27's system transparency slider). */
  glassAppearance?: GlassAppearance
  /** User-made themes (src/lib/customTheme.ts). Needed when `themePreset` is `custom:<id>`;
   *  an unknown/missing custom id falls back to the Default palette. */
  customThemes?: readonly CustomTheme[]
}

export type GlassAppearance = 'clear' | 'regular' | 'tinted'
export const GLASS_ALPHA_MULT: Record<GlassAppearance, number> = { clear: 0.8, regular: 1, tinted: 1.18 }

export function applyThemeToDocument(opts: ApplyThemeOptions): void {
  const html = document.documentElement
  const {
    theme, themePreset, systemIsDark, systemAccentColor,
    backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity,
    glassAppearance,
  } = opts
  // Callers should pass customThemes (and re-run on its change so edits apply live); fall back to
  // this window's store so a 'custom:<id>' selection still resolves if a caller doesn't yet.
  const customThemes = opts.customThemes ?? useAppStore.getState().customThemes

  ALL_PRESET_CLASSES.forEach((cls) => html.classList.remove(cls))

  // Design-system scheme flag. The 73 theme classes only define the 11 base palette vars;
  // anything that must differ between a light and a dark ground (status pigments, shadow
  // strength, selection mix — see global.css's `.scheme-light` block) keys off this ONE class
  // instead of hand-listing every preset. Also sets `color-scheme` so native form controls,
  // scrollbars and <select> popups follow the app rather than the OS.
  const isDark = theme === 'system' ? systemIsDark : theme === 'dark'
  html.classList.toggle('scheme-dark', isDark)
  html.classList.toggle('scheme-light', !isDark)
  html.style.colorScheme = isDark ? 'dark' : 'light'
  // html[data-glass] selects a whole knob set in global.css (alpha, blur, saturation, tint,
  // highlight); the inline multiplier is kept for anything still reading it directly.
  html.dataset.glass = glassAppearance ?? 'regular'
  html.style.setProperty('--glass-alpha-mult', String(GLASS_ALPHA_MULT[glassAppearance ?? 'regular']))

  // A custom theme ('custom:<id>') rides on its base preset's class for everything it doesn't
  // override; the text/background overrides are applied inline further down.
  const custom = findCustomTheme(themePreset, customThemes)
  const presetId = custom ? custom.basedOn : (themePreset.startsWith('custom:') ? '' : themePreset)
  const baseId = (presetId && presetId !== 'system-accent') ? presetId.replace(/-(?:dark|light)$/, '') : ''

  if (baseId) {
    const applyPreset = (isDark: boolean) => {
      html.classList.remove('dark', 'light')
      const cls = NATURALLY_DARK_IDS.has(baseId)
        ? (isDark ? baseId : `${baseId}-light`)
        : (isDark ? `${baseId}-dark` : baseId)
      html.classList.add(cls)
    }
    applyPreset(theme === 'system' ? systemIsDark : theme === 'dark')
  } else {
    const applyTheme = (isDark: boolean) => {
      html.classList.toggle('dark', isDark)
      html.classList.toggle('light', !isDark)
    }
    applyTheme(theme === 'system' ? systemIsDark : theme === 'dark')
  }

  if (themePreset === 'system-accent' && systemAccentColor) {
    html.style.setProperty('--color-accent', systemAccentColor)
  } else {
    html.style.removeProperty('--color-accent')
  }

  // Custom theme palette overrides — inline on <html> so they beat the preset class. Always
  // cleared first so switching back to a built-in preset leaves no residue.
  for (const v of CUSTOM_THEME_VARS) if (v !== '--color-accent') html.style.removeProperty(v)
  const customVars = resolveThemeVars(themePreset, customThemes, isDark ? 'dark' : 'light')
  for (const [k, v] of Object.entries(customVars)) html.style.setProperty(k, v)

  const curatedStyle = PRESET_ANIMATION_STYLE[baseId]
  const effectiveStyle = curatedStyle
    ?? (backgroundAnimationEnabled
      ? (backgroundAnimationStyle === 'auto' || !backgroundAnimationStyle ? 'drift' : backgroundAnimationStyle)
      : null)
  html.classList.toggle('theme-anim-bg', !!effectiveStyle)
  if (effectiveStyle) {
    html.dataset.animStyle = effectiveStyle
    html.dataset.animIntensity = backgroundAnimationIntensity ?? 'noticeable'
  } else {
    delete html.dataset.animStyle
    delete html.dataset.animIntensity
  }

  // Regenerate the 12 tag-palette slots for the theme that was just applied (reads the resolved
  // CSS vars off <html>). Every window that themes itself gets theme-adaptive tag colours.
  applyTagPaletteToDocument()
}
