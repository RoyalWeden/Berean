/**
 * Read Aloud (TTS) — Kokoro neural synthesis, run in a dedicated Web Worker.
 *
 * WHY A WORKER: `kokoro-js` runs ONNX inference (via onnxruntime-web, WASM or WebGPU) which is
 * CPU/GPU-heavy and, on the WASM path, synchronous-feeling enough to visibly stall the main
 * thread for a chunk's whole synthesis time. Berean already suffered one renderer-freeze bug
 * (see the M6/M7 fix history) and must not gain another — every synthesis call happens off the
 * UI thread here, with only small transferable audio buffers crossing back.
 *
 * This file is loaded via `new Worker(new URL('./kokoro.worker.ts', import.meta.url), { type:
 * 'module' })` in kokoroBackend.ts — Vite's worker-import syntax, which electron-vite's renderer
 * build (Vite under the hood) supports natively and bundles as its own chunk.
 */
import { KokoroTTS } from 'kokoro-js'
import { env } from '@huggingface/transformers'
import { TTS_MODEL_LOCAL_MODEL_PATH, TTS_RUNTIME_FILE_RELATIVE_PATH, TTS_MODEL_DTYPE } from './modelProtocolConstants'

// `kokoro-js` sets NOTHING of its own on `env` — allowLocalModels/localModelPath/
// allowRemoteModels/useBrowserCache below (and env.backends.onnx.wasm.* in
// primeOfflineWasmRuntime()) all have to be set on the SAME `@huggingface/transformers` package's
// `env` singleton directly. This works because there's exactly one resolved copy of
// `@huggingface/transformers` in node_modules (it's kokoro-js's own dependency, not duplicated) —
// both this import and kokoro-js's internal one reference the identical module instance, so
// mutating it here is visible to kokoro-js's own `from_pretrained()`/`generate()` calls. (There is
// no top-level `env.wasmPaths` in this version of the package to re-export in the first place —
// the real field is the nested `env.backends.onnx.wasm.wasmPaths` primeOfflineWasmRuntime() below
// clears.)
env.allowLocalModels = true
env.allowRemoteModels = false // never phone home for model files — see main.ts's CSP comment
env.localModelPath = TTS_MODEL_LOCAL_MODEL_PATH
// The Cache API layer is redundant with (and would just duplicate on disk) the cache Berean
// already manages itself via the `berean-model://` protocol reading straight from userData —
// disabling it avoids a second silent copy of ~100MB of model weights living in Chromium's own
// Cache Storage on top of the one in userData.
env.useBrowserCache = false

let tts: KokoroTTS | null = null
let loadingPromise: Promise<KokoroTTS> | null = null
// Ids the main thread told us to abandon (see the 'cancel' message below) — kokoro-js's
// generate() has no real cancellation hook, so this just suppresses posting a result/error for
// an id nobody's listening for anymore, rather than actually stopping the inference early.
const cancelledIds = new Set<string>()

type DeviceChoice = 'webgpu' | 'wasm'

async function pickDevice(): Promise<DeviceChoice> {
  // Prefer WebGPU when the runtime actually exposes it — checked defensively since `navigator.gpu`
  // existing doesn't guarantee `requestAdapter()` succeeds (e.g. disabled by a flag, unsupported
  // GPU under Electron's sandboxed GPU process). Falls back to WASM on any failure.
  try {
    const gpu = (navigator as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
    if (gpu) {
      const adapter = await gpu.requestAdapter()
      if (adapter) return 'webgpu'
    }
  } catch { /* fall through to wasm */ }
  return 'wasm'
}

/**
 * Makes ORT's WASM backend load with ZERO network requests, fully offline, in a PACKAGED build.
 * Two separate defaults fight this otherwise:
 *
 *  1. transformers.js's `backends/onnx.js` fills in `env.backends.onnx.wasm.wasmPaths` with a
 *     jsDelivr CDN URL the very first time `@huggingface/transformers` is imported — before ANY
 *     of Berean's own code runs — which is exactly the `Refused to load the script
 *     https://cdn.jsdelivr.net/...` CSP violation this function exists to avoid. Clearing it back
 *     to `undefined` restores onnxruntime-web's own "embedded glue, same-origin script" fast path
 *     (see `ort.bundle.min.mjs`'s `importWasmModule`, which statically imports the JS glue rather
 *     than dynamically `import()`-ing it when no override is set) — that fast path needs no
 *     import()/fetch() at all for the JS glue. Only the separate ~21.6MB `.wasm` binary is then
 *     still unresolved.
 *  2. That `.wasm` binary is located via `new URL('ort-wasm-simd-threaded.jsep.wasm',
 *     import.meta.url)` inside onnxruntime-web's OWN bundled code (not something Berean's code
 *     calls directly) — which resolves to a `file://` URL inside `app.asar` in a packaged build,
 *     and Chromium's `fetch()` refuses `file://` outright (see ttsModelProtocol.ts's header for
 *     the same constraint from a different angle). Setting `wasmBinary` short-circuits that fetch
 *     entirely: `initializeWebAssembly()` reads `flags.wasmBinary` before ever computing a URL
 *     for the `.wasm` file (see onnxruntime-web's `wasm-factory.ts`), so no fetch of any kind
 *     happens for it either — the bytes are just handed over directly.
 *
 * With BOTH cleared/set, model load needs no CSP change and issues zero network requests — the
 * only bytes fetched are `berean-model://` reads of files Berean already downloaded to disk (see
 * ttsModelProtocol.ts), which `connect-src` already allows.
 *
 * MUST run before the first `KokoroTTS.from_pretrained()` call, since that's what actually
 * triggers ORT's `initializeWebAssembly()` — `wasmPaths`/`wasmBinary` are read lazily at that
 * point, not at module-import time, so setting them here (even though `env.backends.onnx` was
 * already touched once by transformers.js's own module-load-time defaulting, above) still wins.
 */
async function primeOfflineWasmRuntime(modelId: string): Promise<void> {
  const wasm = env.backends.onnx.wasm
  if (!wasm) return // defensive only — `backends.onnx.wasm` is always populated by onnx.js's own module-load side effect
  wasm.wasmPaths = undefined
  const url = `${TTS_MODEL_LOCAL_MODEL_PATH}${modelId}/${TTS_RUNTIME_FILE_RELATIVE_PATH}`
  const res = await fetch(url)
  if (!res.ok) {
    // Most likely cause: a voice pack downloaded before this runtime file existed in the
    // manifest (see ttsModelManifest.ts's `needsRuntimeFile`) that hasn't finished its
    // auto-upgrade yet, or a corrupted/partial download. Either way, surfacing this through the
    // normal `loadError` path (see the caller below) is correct — it's the same "model files
    // aren't ready" failure mode ensureModelLoaded() already documents.
    throw new Error(`Offline ONNX runtime file missing (HTTP ${res.status} for ${url}) — the voice pack may need to be re-downloaded.`)
  }
  wasm.wasmBinary = await res.arrayBuffer()
}

async function loadModel(modelId: string, onProgress: (p: unknown) => void): Promise<KokoroTTS> {
  if (tts) return tts
  if (loadingPromise) return loadingPromise
  loadingPromise = (async () => {
    await primeOfflineWasmRuntime(modelId)
    const device = await pickDevice()
    const loaded = await KokoroTTS.from_pretrained(modelId, {
      // Shared with the main process's download manifest — see TTS_MODEL_DTYPE's comment for why
      // this is fp32 rather than a smaller quantization, and why it must never be changed here
      // alone: ttsModelManifest.ts derives the weights FILENAME from this same constant, so
      // editing one side would download one file and then ask the runtime to load a different one.
      dtype: TTS_MODEL_DTYPE as 'fp32',
      device,
      progress_callback: onProgress,
    })
    tts = loaded
    return loaded
  })()
  return loadingPromise
}

interface LoadModelMsg { type: 'loadModel'; modelId: string }
interface SynthesizeMsg { type: 'synthesize'; id: string; text: string; voice: string; speed: number }
interface CancelMsg { type: 'cancel'; id: string }
type InboundMsg = LoadModelMsg | SynthesizeMsg | CancelMsg

self.onmessage = async (event: MessageEvent<InboundMsg>) => {
  const msg = event.data
  if (msg.type === 'loadModel') {
    try {
      await loadModel(msg.modelId, (p) => self.postMessage({ type: 'loadProgress', progress: p }))
      self.postMessage({ type: 'loadComplete' })
    } catch (e) {
      self.postMessage({ type: 'loadError', message: String((e as Error)?.message ?? e) })
    }
    return
  }

  if (msg.type === 'cancel') {
    cancelledIds.add(msg.id)
    return
  }

  if (msg.type === 'synthesize') {
    const { id, text, voice, speed } = msg
    try {
      if (!tts) throw new Error('Kokoro model not loaded')
      // `generate()`'s `voice` param type is `keyof typeof VOICES` — kokoro-js's own internal,
      // unexported voice-id union (KOKORO_VOICE_IDS in kokoroVoices.ts is Berean's own copy of
      // the same ids). Runtime validation happens inside `generate()` itself (`_validate_voice`,
      // throws for an unrecognized id), so casting here is safe.
      type GenerateOptions = NonNullable<Parameters<KokoroTTS['generate']>[1]>
      const raw = await tts.generate(text, { voice: voice as GenerateOptions['voice'], speed })
      if (cancelledIds.has(id)) { cancelledIds.delete(id); return }
      // Transfer the underlying ArrayBuffer instead of structured-cloning it — the audio is
      // real PCM data (seconds of float32 samples), copying it would be a needless allocation +
      // memcpy on every chunk.
      const buffer = raw.audio.buffer
      self.postMessage(
        { type: 'synthesisResult', id, samplingRate: raw.sampling_rate, buffer },
        { transfer: [buffer] },
      )
    } catch (e) {
      cancelledIds.delete(id)
      self.postMessage({ type: 'synthesisError', id, message: String((e as Error)?.message ?? e) })
    }
  }
}
