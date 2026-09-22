import React from 'react'
import ReactDOM from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { initIosServices } from './services'
import { installIosBridge } from './bridge'
import { installIosBridgeExtras } from './bridgeExtras'
import { installIosSyncBridge, initIosSyncHost } from './syncHost'
import { installIosDeepLinks } from './deepLinks'
import { installIosSpotlight } from './spotlight'
import { installIosShareInbox } from './shareInbox'
import { setActiveTTSBackend } from '../../lib/tts/ttsEngine'
import { NativeSpeechBackend, createNativeVoiceProvider } from '../../lib/tts/nativeSpeechBackend'
import { BereanSpeech } from './plugins'
import MobileApp from '../../mobile/MobileApp'
import '../../styles/global.css'
import 'pdfjs-dist/web/pdf_viewer.css'

/**
 * iPhone renderer entry (built by vite.ios.config.ts into out/ios, loaded by Capacitor). The
 * desktop entry src/main.tsx is untouched; this file is its Capacitor counterpart:
 *
 *  1. open berean.db + bundled DBs through the BereanSQLite plugin and run the shared migrations;
 *  2. install the `window.<namespace>` bridge objects the renderer already calls, backed by the
 *     shared services in-process (src/platform/ios/bridge.ts);
 *  3. render the mobile shell (src/mobile/MobileApp.tsx). The Phase 2/4 self-test screen
 *     (`IosBoot`) stays reachable under More → Diagnostics.
 */
document.documentElement.dataset.window = 'main'
document.documentElement.dataset.platform = 'ios'

// Capacitor's console bridge JSON-serialises arguments, so an Error prints as `{}` in the Xcode /
// simulator console. Print name, message and stack instead (diagnostics only; no behaviour change).
for (const level of ['error', 'warn'] as const) {
  const orig = console[level].bind(console)
  console[level] = (...args: unknown[]) => orig(...args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}${a.stack ? `\n${a.stack}` : ''}` : a)))
}

async function boot() {
  const root = ReactDOM.createRoot(document.getElementById('root')!)
  try {
    const services = await initIosServices()
    installIosBridge(services)
    installIosBridgeExtras(services, import.meta.env.VITE_APP_VERSION ?? '0')
    installIosSyncBridge()
    void initIosSyncHost()   // starts only if the user enabled iCloud sync; never blocks boot
    void installIosDeepLinks()   // berean:// URLs queue until the mobile shell registers its target
    void installIosSpotlight()   // notes searchable from the home screen; results are deep links
    installIosShareInbox()       // "Open in Berean": items the Share Extension left in the App Group
    // Read Aloud: the system speech synthesiser implements the shared TTSBackend on the phone.
    setActiveTTSBackend(new NativeSpeechBackend(BereanSpeech), createNativeVoiceProvider(BereanSpeech))
    root.render(
      <React.StrictMode>
        <MotionConfig reducedMotion="user">
          <MobileApp />
        </MotionConfig>
      </React.StrictMode>,
    )
  } catch (err) {
    const headers = (window as unknown as { Capacitor?: { PluginHeaders?: Array<{ name: string }> } }).Capacitor?.PluginHeaders?.map((h) => h.name).join(', ')
    const message = `${err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)}\n\nNative plugins seen by JS: ${headers ?? '(none)'}`
    console.error('[ios-boot] failed', message)
    root.render(
      <pre style={{ padding: 24, whiteSpace: 'pre-wrap', color: '#f87171', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
        {`Berean failed to start\n\n${message}`}
      </pre>,
    )
  }
}

void boot()
