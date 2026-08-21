import {
  ALL_PRESET_CLASSES, NATURALLY_DARK_IDS, PRESET_ANIMATION_STYLE,
  type AnimationStyle, type AnimationIntensity,
} from '@/lib/themePresets'

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
}

export function applyThemeToDocument(opts: ApplyThemeOptions): void {
  const html = document.documentElement
  const {
    theme, themePreset, systemIsDark, systemAccentColor,
    backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity,
  } = opts

  ALL_PRESET_CLASSES.forEach((cls) => html.classList.remove(cls))

  const baseId = (themePreset && themePreset !== 'system-accent') ? themePreset.replace(/-(?:dark|light)$/, '') : ''

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
}
