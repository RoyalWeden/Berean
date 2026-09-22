import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Capacitor configuration for the Berean iPhone app (docs/mobile/architecture.md §4).
 *
 * `appId` is the default bundle identifier; the developer's own bundle id / team are supplied
 * through the gitignored ios/App/Signing.xcconfig (docs/mobile/ios-build.md §2), never here.
 */
const config: CapacitorConfig = {
  appId: 'com.berean.app',
  appName: 'Berean',
  webDir: 'out/ios',
  ios: {
    contentInset: 'never',
    scheme: 'Berean',
    // The Vite bundle is loaded from capacitor://localhost; keep the default so CSP 'self' works.
    limitsNavigationsToAppBoundDomains: false,
  },
  server: {
    // The bundle is served from capacitor://localhost (Capacitor iOS rejects http/https as a
    // custom scheme). YouTube's embed player refuses that origin as a Referer (error 153), so the
    // video player lives in a native WKWebView with an https base URL — BereanWebViewPlugin.swift.
    // Live-reload URL is injected by `cap run --livereload`; nothing hard-coded here.
  },
  plugins: {
    // The shell handles the keyboard itself: keyboardWillShow/Hide → `--m-keyboard-h` on <html>
    // (src/mobile/MobileApp.tsx), so bars and the editor toolbar lift above it (R083).
    Keyboard: { resize: 'none' },
    StatusBar: { overlaysWebView: true },
    // Native HTTP for fetch(): YouTube's InnerTube/RSS endpoints have no CORS headers, and the
    // WebView origin is capacitor://localhost — the shared youtubeFetchService needs real requests.
    CapacitorHttp: { enabled: true },
  },
}

export default config
