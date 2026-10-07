/**
 * Berean Liquid Glass — the semantic API (docs/liquid-glass.md).
 *
 * The React UI says WHAT it needs ("a sidebar pane", "a grouped floating control cluster"); a
 * platform adapter decides HOW to render it:
 *
 *   macOS   AppKit   NSGlassEffectView · NSGlassEffectContainerView   (electron/liquidGlass.ts)
 *   iOS     UIKit    UIGlassEffect · UIGlassContainerEffect           (BereanGlassPlugin.swift)
 *   other   CSS      the existing material classes (src/styles/glass.css)
 *
 * Nothing here names an Apple class; ordinary components never branch on the OS.
 */

/** Regular is the default for every functional surface. Clear only over visually rich media,
 *  where keeping the media prominent matters more than legibility of the glass itself. */
export type LiquidGlassVariant = 'regular' | 'clear'

/** What the surface IS — drives geometry, the fallback material and accessibility treatment. */
export type LiquidGlassRole =
  | 'sidebar'      // the window's navigation pane
  | 'toolbar'      // a toolbar / title-bar control cluster
  | 'navigation'   // top-level navigation controls (iPhone bottom bar)
  | 'floating'     // a control cluster floating over content
  | 'popover'      // transient surfaces
  | 'inspector'    // an attached study inspector
  | 'control'      // a single control
  | 'custom'

export interface LiquidGlassOptions {
  variant?: LiquidGlassVariant
  role?: LiquidGlassRole
  /** Interactive glass responds to pointer/touch. Only for genuinely important controls — never
   *  for content, panes, or every button. Ignored where the OS lacks it. */
  interactive?: boolean
  /** Selective emphasis only (primary action, selected state). CSS colour, e.g. `#007aff33`. */
  tint?: string | null
  /** Overrides the role's semantic radius (rarely needed — prefer the role's token). */
  cornerRadius?: number
  /** Member of a LiquidGlassGroup (native grouping: the elements blend/merge as one). */
  group?: string | null
  /** Edges the surface is pinned to while the window resizes (macOS autoresizing). */
  pin?: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }
}

export interface LiquidGlassRect { x: number; y: number; width: number; height: number }

/** Where native glass can be used, and the accessibility settings that change its treatment.
 *  Detected once, centrally (capabilities.ts) — never by OS-version checks in components. */
export interface LiquidGlassCapabilities {
  platform: 'macos' | 'ios' | 'web'
  /** A native bridge is installed and working. */
  native: boolean
  /** The OS has Liquid Glass (NSGlassEffectView / UIGlassEffect); false → native fallback material. */
  liquidGlass: boolean
  /** Native grouping (NSGlassEffectContainerView / UIGlassContainerEffect). */
  grouping: boolean
  /** Interactive glass (AppKit: macOS 27+, UIKit: iOS 26+). */
  interactive: boolean
  reduceTransparency: boolean
  increaseContrast: boolean
  reduceMotion: boolean
}

/** One native surface as sent to an adapter (page coordinates, CSS px). */
export interface LiquidGlassSurfaceSpec extends LiquidGlassOptions {
  id: string
  rect: LiquidGlassRect
  cornerRadius: number
  visible?: boolean
}

export interface LiquidGlassGroupSpec {
  id: string
  rect: LiquidGlassRect
  /** Distance at which member surfaces start to merge (the native container's `spacing`). */
  spacing: number
  pin?: LiquidGlassOptions['pin']
  visible?: boolean
}

/** One control in a native control cluster (a glass button the platform draws itself). */
export interface LiquidGlassControlItem {
  id: string
  /** Platform symbol name (SF Symbols on Apple platforms), e.g. `plus`, `chevron.up`. */
  symbol: string
  /** Accessibility label (the native control is what VoiceOver focuses). */
  label: string
  rect: LiquidGlassRect
  /** Small text drawn on the control (the open-tab count). */
  badge?: string
  /** A text label beside the symbol (a labelled capsule, e.g. the reader's passage title). */
  title?: string
  subtitle?: string
  /** Label metrics taken from the web placeholder so the native label fits the same capsule. */
  fontSize?: number
  paddingX?: number
  /** Primary action: symbol drawn in the accent colour, slightly heavier. */
  prominent?: boolean
  iconSize?: number
  /** Temporarily not drawn (its web placeholder is covered by a sheet / popover). */
  hidden?: boolean
}

/** A cluster of related controls drawn by the platform as ONE glass group. */
export interface LiquidGlassControlsSpec {
  id: string
  role: LiquidGlassRole
  items: LiquidGlassControlItem[]
  spacing: number
  visible: boolean
  /** Slid out of the way (e.g. while reading, scrolled down). */
  collapsed?: boolean
  appearance?: 'light' | 'dark' | null
  /** Accent colour for prominent items (#rrggbb). */
  accent?: string | null
}

/** A platform's native glass bridge, installed behind `window.__bereanGlass` (iOS) or
 *  `window.app.glass` (macOS). Only src/platform/liquidGlass talks to it. */
export interface LiquidGlassAdapter {
  readonly platform: 'macos' | 'ios'
  capabilities(): Promise<Omit<LiquidGlassCapabilities, 'platform'>>
  surface(spec: LiquidGlassSurfaceSpec): Promise<boolean>
  group(spec: LiquidGlassGroupSpec): Promise<boolean>
  destroy(id: string, kind: 'surface' | 'group'): Promise<boolean>
  /** The bridge failed at runtime — every surface must fall back to CSS. */
  onDisabled?(cb: () => void): () => void
  /** Native control clusters (iOS: glass buttons above the web view). Absent → React controls. */
  controls?(spec: LiquidGlassControlsSpec): Promise<boolean>
  removeControls?(id: string): Promise<boolean>
  onControlEvent?(cb: (e: { cluster: string; item?: string; swipe?: 'next' | 'previous' }) => void): () => void
}
