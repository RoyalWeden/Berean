/**
 * Read Aloud (TTS) drove this into existing as its own SHARED module — Content-Security-Policy,
 * built in exactly ONE place and consumed by BOTH of Electron's actual enforcement points:
 *
 *  1. `main.ts`'s `session.defaultSession.webRequest.onHeadersReceived` — the live policy for
 *     anything loaded over http(s):// (the Vite dev server, and any future network request).
 *  2. `src/index.html`'s `<meta http-equiv="Content-Security-Policy">` — the ONLY policy that
 *     applies to a PACKAGED build, because `onHeadersReceived` never fires for `file://` requests
 *     (see `ttsModelProtocol.ts`'s header for the same `file://` constraint from a different
 *     angle). A packaged app is loaded over `file://`, so #1 is silently absent there and #2
 *     becomes the real enforcement — before this module existed the two had drifted out of sync
 *     (the meta tag pre-dated `wasm-unsafe-eval`/`berean-model:` entirely, added only to #1 when
 *     Kokoro TTS shipped), a gap invisible in dev (where #1 additionally applies and IS correct)
 *     that only bites a packaged build.
 *
 * `electron.vite.config.ts`'s renderer `transformIndexHtml` hook injects #2 at build time using
 * this same function, keyed off Vite's own dev/build `command` — the identical dev/prod signal
 * `is.dev` gives `main.ts` — so the two can never independently drift again.
 */
export function buildCSP(dev: boolean): string {
  return [
    "default-src 'self'",
    // 'wasm-unsafe-eval' (NOT the much broader 'unsafe-eval') is required for the Kokoro TTS
    // Web Worker — transformers.js's onnxruntime-web WASM backend instantiates its WebAssembly
    // module via WebAssembly.instantiate(), which Chromium's CSP gates behind this specific
    // token regardless of dev/prod. It does NOT permit eval()/new Function() the way
    // 'unsafe-eval' does, so this is a narrow, WASM-only carve-out.
    dev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'" : "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "media-src 'self' blob: data: https:",
    // berean-model: is the custom protocol serving the locally-downloaded Kokoro model files
    // out of userData (see ttsModelProtocol.ts) — added to connect-src, NOT to a broader
    // directive, since it's fetch()'d, not loaded as a script/frame. No huggingface.co/jsdelivr
    // (or any other remote host) is added here: both the model AND the ORT runtime file download
    // happen in the MAIN process (electron/ipc/ttsModel.ts, via Node's fetch — not subject to
    // renderer CSP at all), and the renderer/worker only ever reads the already-downloaded local
    // copy through this scheme.
    dev ? "connect-src 'self' ws: http: https: berean-model:" : "connect-src 'self' https: berean-model:",
    "frame-src 'self' https://www.youtube.com data:",
    "worker-src 'self' blob:",
  ].join('; ')
}
