import type { LiquidGlassRole } from './types'

/**
 * Semantic geometry → platform values (docs/liquid-glass.md §Geometry). The NAMES are shared; the
 * NUMBERS are per platform, never forced identical. Radii are concentric: a surface inset by `i`
 * inside a container of radius `R` gets `R − i`, so nested corners share a centre.
 *
 * Exposed to CSS as `--lg-*` custom properties (applyLiquidGlassTokens) so the CSS fallback and
 * the native surface draw the same shape.
 */
export interface LiquidGlassTokens {
  /** The window's own corner radius (macOS) / the display corner context (iOS). */
  containerRadius: number
  /** Inset of a floating pane from the window edge. */
  paneInset: number
  radius: { small: number; medium: number; large: number }
  /** Height of a standard control (toolbar item / touch target). */
  controlSize: number
  iconSize: number
  /** Gap between grouped controls before native glass merges them. */
  groupSpacing: number
  motion: { fast: number; standard: number; /** spring response (s) */ spring: number }
}

const MACOS: LiquidGlassTokens = {
  // Berean's main window (Electron, hiddenInset title bar, no NSToolbar): 16pt corners, measured
  // from the running window on macOS 27 (docs/liquid-glass.md §Geometry) — an empty NSToolbar was
  // tried and does not change it. Sidebar pane inset 6 → concentric 10.
  containerRadius: 16,
  paneInset: 6,
  radius: { small: 6, medium: 10, large: 18 },
  controlSize: 36,
  iconSize: 16,
  groupSpacing: 8,
  motion: { fast: 0.14, standard: 0.22, spring: 0.35 },
}

const IOS: LiquidGlassTokens = {
  containerRadius: 44,
  paneInset: 12,
  radius: { small: 10, medium: 16, large: 26 },
  controlSize: 44,
  iconSize: 20,
  groupSpacing: 12,
  motion: { fast: 0.16, standard: 0.26, spring: 0.4 },
}

export function liquidGlassTokens(platform: 'macos' | 'ios' | 'web'): LiquidGlassTokens {
  return platform === 'ios' ? IOS : MACOS
}

/** The semantic corner radius for a role (a capsule for controls, concentric for panes). */
export function roleRadius(role: LiquidGlassRole | undefined, t: LiquidGlassTokens, height: number): number {
  switch (role) {
    case 'sidebar':
    case 'inspector':
      return t.containerRadius - t.paneInset
    case 'toolbar':
    case 'navigation':
    case 'floating':
    case 'control':
      return Math.round(height / 2) // capsule / circle — never squashed (height is the source)
    case 'popover':
      return t.radius.large
    default:
      return t.radius.medium
  }
}

export function applyLiquidGlassTokens(root: HTMLElement, platform: 'macos' | 'ios' | 'web'): void {
  const t = liquidGlassTokens(platform)
  const set = (k: string, v: string) => root.style.setProperty(k, v)
  set('--lg-container-radius', `${t.containerRadius}px`)
  set('--lg-pane-inset', `${t.paneInset}px`)
  set('--lg-pane-radius', `${t.containerRadius - t.paneInset}px`)
  set('--lg-radius-sm', `${t.radius.small}px`)
  set('--lg-radius-md', `${t.radius.medium}px`)
  set('--lg-radius-lg', `${t.radius.large}px`)
  set('--lg-control', `${t.controlSize}px`)
  set('--lg-icon', `${t.iconSize}px`)
  set('--lg-group-spacing', `${t.groupSpacing}px`)
  set('--lg-dur-fast', `${t.motion.fast}s`)
  set('--lg-dur', `${t.motion.standard}s`)
}
