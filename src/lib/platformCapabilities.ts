/**
 * What the current platform can do (R013): shared components ask this object instead of
 * comparing `window.__berean_platform` themselves, so a capability has one definition and an
 * iPad (or Windows) shell can adjust it in one place. Evaluated once; the platform tag is set
 * by the preload (Electron) or `src/platform/ios/bridge.ts` before any component renders.
 *
 * Desktop OS distinctions (window controls on Windows, vibrancy on macOS) are not
 * capabilities — they stay as `__berean_platform === 'win32' | 'darwin'` checks in the shell.
 */
export interface PlatformCapabilities {
  /** Runs inside the Capacitor iOS shell (touch-first, WKWebView, no Node). */
  readonly ios: boolean
  /** YouTube plays in a native WKWebView overlay (`BereanWebView`) rather than an Electron `<webview>`. */
  readonly nativeVideoPlayer: boolean
  /** Electron `<webview>` tags are available (YouTube login page, watch fallback). */
  readonly electronWebview: boolean
  /** Touch is the primary pointer: long-press action sheets instead of hover/context menus. */
  readonly touchPrimary: boolean
}

function detect(): PlatformCapabilities {
  const tag = typeof window !== 'undefined' ? window.__berean_platform : undefined
  const ios = tag === 'ios'
  return Object.freeze({
    ios,
    nativeVideoPlayer: ios,
    electronWebview: !ios && tag !== undefined,
    touchPrimary: ios,
  })
}

export const capabilities: PlatformCapabilities = detect()
