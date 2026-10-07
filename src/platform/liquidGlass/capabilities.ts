import type { LiquidGlassAdapter, LiquidGlassCapabilities } from './types'

/**
 * The ONE place that decides whether native Liquid Glass is used (docs/liquid-glass.md §Capability
 * detection). Components never compare OS versions: they ask for a surface, and this module says
 * whether a native adapter will draw it or the CSS material stays.
 *
 * Adapters are installed behind `window` by their platform layer (the same boundary every other
 * native feature uses — see src/platform/__tests__/importBoundaries.test.ts):
 *   macOS  window.app.glass        (electron/preload.ts → electron/liquidGlass.ts)
 *   iOS    window.__bereanGlass    (src/platform/ios/liquidGlass.ts → BereanGlassPlugin.swift)
 */

interface MacGlassBridge {
  capabilities(): Promise<{ native: boolean; glass: boolean | number; container: boolean | number; interactive: boolean | number; reduceTransparency: boolean | number; increaseContrast: boolean | number; reduceMotion: boolean | number }>
  surface(msg: unknown): Promise<boolean>
  group(msg: unknown): Promise<boolean>
  destroy(id?: string, kind?: 'surface' | 'group'): Promise<boolean>
  onDisabled?(cb: () => void): () => void
}

declare global {
  interface Window {
    __bereanGlass?: LiquidGlassAdapter
  }
}

function macBridge(): MacGlassBridge | undefined {
  if (typeof window === 'undefined') return undefined
  // Only the main window is a transparent BrowserWindow with a native backdrop; every other window
  // (pop-out, viewer, trail, picker) is opaque, so glass behind its page could never show.
  if (window.__berean_platform !== 'darwin' || document.documentElement.dataset.window !== 'main') return undefined
  return (window as unknown as { app?: { glass?: MacGlassBridge } }).app?.glass
}

const macAdapter = (b: MacGlassBridge): LiquidGlassAdapter => ({
  platform: 'macos',
  async capabilities() {
    const c = await b.capabilities()
    return {
      native: !!c.native,
      liquidGlass: !!c.glass,
      grouping: !!c.container,
      interactive: !!c.interactive,
      reduceTransparency: !!c.reduceTransparency,
      increaseContrast: !!c.increaseContrast,
      reduceMotion: !!c.reduceMotion,
    }
  },
  surface: (spec) => b.surface(spec),
  group: (spec) => b.group(spec),
  destroy: (id, kind) => b.destroy(id, kind),
  onDisabled: b.onDisabled ? (cb) => b.onDisabled!(cb) : undefined,
})

let adapter: LiquidGlassAdapter | null | undefined
let disabled = false

/** The installed native adapter, or null (CSS only). */
export function liquidGlassAdapter(): LiquidGlassAdapter | null {
  if (disabled) return null
  if (adapter !== undefined) return adapter
  const ios = typeof window !== 'undefined' ? window.__bereanGlass : undefined
  const mac = macBridge()
  adapter = ios ?? (mac ? macAdapter(mac) : null)
  adapter?.onDisabled?.(() => { disabled = true; notify() })
  return adapter
}

function platformOf(): LiquidGlassCapabilities['platform'] {
  const tag = typeof window !== 'undefined' ? window.__berean_platform : undefined
  return tag === 'ios' ? 'ios' : tag === 'darwin' ? 'macos' : 'web'
}

function mediaFlag(q: string): boolean {
  try { return typeof matchMedia === 'function' && matchMedia(q).matches } catch { return false }
}

const NONE = (): LiquidGlassCapabilities => ({
  platform: platformOf(),
  native: false,
  liquidGlass: false,
  grouping: false,
  interactive: false,
  reduceTransparency: mediaFlag('(prefers-reduced-transparency: reduce)'),
  increaseContrast: mediaFlag('(prefers-contrast: more)'),
  reduceMotion: mediaFlag('(prefers-reduced-motion: reduce)'),
})

let current: LiquidGlassCapabilities = NONE()
let loading: Promise<LiquidGlassCapabilities> | null = null
const listeners = new Set<() => void>()
function notify() { listeners.forEach((l) => l()) }

/** Detect the native bridge (once) and publish; stamps <html data-native-glass="glass|material">. */
export function loadLiquidGlassCapabilities(): Promise<LiquidGlassCapabilities> {
  if (loading) return loading
  loading = (async () => {
    const a = liquidGlassAdapter()
    let caps = NONE()
    if (a) {
      try {
        const n = await a.capabilities()
        caps = {
          ...n,
          platform: a.platform,
          // Either source can report the setting (native is authoritative where present).
          reduceTransparency: n.reduceTransparency || caps.reduceTransparency,
          increaseContrast: n.increaseContrast || caps.increaseContrast,
          reduceMotion: n.reduceMotion || caps.reduceMotion,
        }
      } catch {
        caps = NONE()
      }
    }
    current = caps
    stamp(caps)
    notify()
    return caps
  })()
  return loading
}

// html[data-reduce-transparency] / [data-increase-contrast] are owned by the platform shell
// (src/main.tsx on macOS, the iOS a11y bridge) and kept live from system notifications; this
// module only reads them, and stamps html[data-native-glass] itself.
function stamp(c: LiquidGlassCapabilities) {
  if (typeof document === 'undefined') return
  const d = document.documentElement.dataset
  if (c.native && !disabled) d.nativeGlass = c.liquidGlass ? 'glass' : 'material'
  else delete d.nativeGlass
}

let snapshot: LiquidGlassCapabilities = current
function live(): LiquidGlassCapabilities {
  const d = typeof document !== 'undefined' ? document.documentElement.dataset : undefined
  const next: LiquidGlassCapabilities = {
    ...current,
    native: current.native && !disabled,
    // Live: the shell's attribute (system notification) or the media query — never the value
    // captured at load, so turning a setting OFF is seen too.
    reduceTransparency: d?.reduceTransparency !== undefined || mediaFlag('(prefers-reduced-transparency: reduce)'),
    increaseContrast: d?.increaseContrast !== undefined || mediaFlag('(prefers-contrast: more)'),
  }
  // Stable identity while nothing changed (useSyncExternalStore).
  if (JSON.stringify(next) !== JSON.stringify(snapshot)) snapshot = next
  return snapshot
}

export function liquidGlassCapabilities(): LiquidGlassCapabilities {
  return live()
}

let observer: MutationObserver | null = null
export function subscribeLiquidGlass(l: () => void): () => void {
  listeners.add(l)
  if (!observer && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    observer = new MutationObserver(() => notify())
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduce-transparency', 'data-increase-contrast'] })
  }
  return () => { listeners.delete(l) }
}

/** Accessibility settings changed (system notification / media query) — re-detect. */
export function refreshLiquidGlassCapabilities(): Promise<LiquidGlassCapabilities> {
  loading = null
  return loadLiquidGlassCapabilities()
}

/** Tests only. */
export function _resetLiquidGlass(): void {
  adapter = undefined; disabled = false; loading = null; current = NONE(); snapshot = current; listeners.clear(); observer?.disconnect(); observer = null
}
