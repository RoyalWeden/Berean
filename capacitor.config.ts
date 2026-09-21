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
    // Live-reload URL is injected by `cap run --livereload`; nothing hard-coded here.
  },
  plugins: {
    Keyboard: { resize: 'none' },
    StatusBar: { overlaysWebView: true },
  },
}

export default config
