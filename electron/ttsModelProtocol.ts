/**
 * Read Aloud (TTS) — custom `berean-model://` protocol that serves the locally-cached Kokoro
 * model files (ONNX weights, tokenizer, voice style vectors) out of `userData` to the renderer.
 *
 * WHY THIS EXISTS: transformers.js (which `kokoro-js` is built on) loads model files via
 * `fetch()` in a browser/worker context — see `getFile()` in
 * `@huggingface/transformers/dist/transformers.js`. Electron's renderer CANNOT `fetch()` a
 * `file://` path (Chromium blocks it for security), so there is no way to point
 * `env.localModelPath` at a plain filesystem path and have it work. Registering a custom
 * `protocol.handle` scheme that serves the same bytes over something `fetch()` DOES accept is
 * the standard, documented Electron pattern for this — see
 * https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler.
 *
 * Deliberately NOT done by weakening `webSecurity` or disabling the CSP (see main.ts's CSP
 * handler, which allows exactly this scheme in `connect-src` and nothing broader).
 *
 * `registerSchemesAsPrivileged` MUST run before `app.whenReady()` — Electron ignores privilege
 * registration after the app is ready — so `registerTTSModelScheme()` is called at module load
 * time from main.ts, while `protocol.handle(...)` itself (which needs `app` to be ready) is
 * called separately from inside the `whenReady().then()` block.
 */
import { protocol, app } from 'electron'
import { createReadStream, existsSync, statSync } from 'fs'
import { join, normalize, sep } from 'path'
import { Readable } from 'stream'
import { TTS_MODEL_SCHEME, TTS_MODEL_LOCAL_MODEL_PATH } from '../src/lib/tts/kokoro/modelProtocolConstants'

export { TTS_MODEL_SCHEME, TTS_MODEL_LOCAL_MODEL_PATH }

/** `{userData}/tts-models/` — the root every downloaded Kokoro file (model + tokenizer + voice
 *  bins) lives under. Exported so ttsModel.ts (the IPC download handlers) and this protocol
 *  handler agree on exactly the same root without either hardcoding it twice. */
export function getTTSModelsRoot(): string {
  return join(app.getPath('userData'), 'tts-models')
}

/** Registers the scheme's privileges. Must be called at MODULE LOAD TIME (before
 *  `app.whenReady()`), per Electron's own requirement — see file header. `standard: true` +
 *  `supportFetchAPI: true` are what make `fetch('berean-model://...')` work at all from a
 *  renderer/worker context; `secure: true` avoids the scheme being treated as mixed content
 *  under the CSP; `corsEnabled: true` since the Web Worker's fetch is technically a
 *  cross-context request from the worker's own scope. */
export function registerTTSModelScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: TTS_MODEL_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
    },
  ])
}

// Node's fs.ReadStream is not a web ReadableStream — Response() (used below) needs the latter.
// Readable.toWeb was added in Node 17 and is present in every Electron 32 Node runtime.
function nodeStreamToWeb(stream: ReturnType<typeof createReadStream>): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream
}

/** Registers the actual request handler. Must run AFTER `app.whenReady()` (protocol.handle
 *  requires a ready app). Serves `berean-model://local/<anything>` by reading
 *  `{userData}/tts-models/<anything>` — 404s cleanly for anything not yet downloaded (which is
 *  exactly what tells transformers.js's `getFile()` to fall through to its own "not found"
 *  handling rather than crash). */
export function registerTTSModelProtocolHandler(): void {
  const root = getTTSModelsRoot()
  protocol.handle(TTS_MODEL_SCHEME, (request) => {
    const url = new URL(request.url)
    // `berean-model://local/onnx-community/Kokoro-.../onnx/model_quantized.onnx` → host is
    // "local" (a fixed, ignored authority — see localModelPath below), pathname is everything
    // the model loader asked for.
    const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    // Reject any path that normalizes outside `root` (e.g. `../../../etc/passwd`) — this
    // handler only ever needs to serve files WE downloaded into `root`, never anything else on
    // disk, so there's no legitimate request that should ever need `..` to escape it.
    const target = normalize(join(root, relPath))
    if (!target.startsWith(normalize(root) + sep) && target !== normalize(root)) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!existsSync(target) || !statSync(target).isFile()) {
      return new Response('Not found', { status: 404 })
    }
    const stat = statSync(target)
    const stream = createReadStream(target)
    return new Response(nodeStreamToWeb(stream), {
      status: 200,
      headers: { 'Content-Length': String(stat.size), 'Content-Type': 'application/octet-stream' },
    })
  })
}
