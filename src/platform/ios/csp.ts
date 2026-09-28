/**
 * Content-Security-Policy for the iOS (Capacitor / WKWebView) build. Mirrors electron/csp.ts's
 * production policy — same directives, same 'wasm-unsafe-eval' carve-out for the Kokoro TTS
 * worker — with the Capacitor-specific origins added:
 *
 *  - `capacitor:` is the scheme the app bundle itself is served from (capacitor://localhost) and
 *    the scheme `Capacitor.convertFileSrc()` produces for local files (PDFs, TTS model, images);
 *  - `berean-model:` is kept so the TTS model loader's fetch URLs are platform-independent (the
 *    iOS WKURLSchemeHandler in ios/App/Plugins/BereanAudio serves it, Phase 16).
 *
 * Injected into src/index.html by vite.ios.config.ts's `inject-csp-meta` plugin at build time —
 * the only enforcement point in a WKWebView (there are no response headers for a local bundle).
 */
export function buildIosCSP(dev: boolean): string {
  return [
    "default-src 'self' capacitor:",
    dev ? "script-src 'self' capacitor: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'" : "script-src 'self' capacitor: 'wasm-unsafe-eval'",
    "style-src 'self' capacitor: 'unsafe-inline'",
    "img-src 'self' capacitor: data: blob: https:",
    "font-src 'self' capacitor: data:",
    "media-src 'self' capacitor: blob: data: https:",
    dev ? "connect-src 'self' capacitor: ws: http: https: berean-model:" : "connect-src 'self' capacitor: https: berean-model:",
    "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com data:",
    "worker-src 'self' capacitor: blob:",
  ].join('; ')
}
