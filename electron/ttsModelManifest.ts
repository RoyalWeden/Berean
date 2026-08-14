/**
 * Read Aloud (TTS) — pure manifest/file-list logic for the Kokoro voice pack download. Split out
 * from `electron/ipc/ttsModel.ts` (which does the actual fs/network work) so "what files does a
 * ready pack need" and "is what's already on disk actually complete" are plain functions over
 * data, unit-testable without mocking `fs` or hitting the network. See `ttsModel.ts`'s own header
 * for the download mechanics that consume this module.
 */
import { KOKORO_VOICE_IDS, KOKORO_MODEL_ID } from '../src/lib/tts/kokoro/kokoroVoiceData'
import { TTS_RUNTIME_FILE_RELATIVE_PATH, TTS_MODEL_DTYPE } from '../src/lib/tts/kokoro/modelProtocolConstants'

export { KOKORO_MODEL_ID }

/** transformers.js's DEFAULT_DTYPE_SUFFIX_MAPPING, for the dtypes this app might plausibly use.
 *  Derived rather than hardcoded so the weights file in the manifest below can never disagree
 *  with the dtype the worker actually asks `from_pretrained` for — the two live on opposite sides
 *  of the main/renderer boundary and share only `TTS_MODEL_DTYPE`. */
const DTYPE_FILE_SUFFIX: Record<string, string> = {
  fp32: '', fp16: '_fp16', q8: '_quantized', int8: '_int8', uint8: '_uint8', q4: '_q4', q4f16: '_q4f16',
}
export const MODEL_WEIGHTS_FILE = `onnx/model${DTYPE_FILE_SUFFIX[TTS_MODEL_DTYPE] ?? ''}.onnx`

// The core model files every Kokoro synthesis needs, regardless of which voice is selected.
export const CORE_FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', MODEL_WEIGHTS_FILE]

/** Rough size of the core model weights, for the download progress estimate only. */
export const MODEL_FILE_ESTIMATED_BYTES = 326_000_000

// MUST be the exact onnxruntime-web version `@huggingface/transformers` bundles internally (see
// `node_modules/@huggingface/transformers/package.json`'s `onnxruntime-web` dependency) — the
// JSEP glue embedded in kokoro-js's own onnxruntime-web copy and this standalone .wasm binary
// have to come from the identical build, or WebAssembly.instantiate() fails at the ABI boundary
// (mismatched exports). `ttsModelManifest.test.ts` asserts this string against the installed
// package.json so a routine `npm update` can't silently let the two drift apart.
export const ORT_RUNTIME_VERSION = '1.22.0-dev.20250409-89f8206ba4'

export const RUNTIME_FILE = TTS_RUNTIME_FILE_RELATIVE_PATH
// jsDelivr's npm mirror — stable, versioned-by-package-version URLs, the same kind of "stable,
// versioned, exactly what the library itself already expects" source ttsModel.ts's HF comment
// gives for the core model files. NOT vendored into the repo: at ~21.6MB it would be the largest
// binary in git history for a one-time, user-triggered, opt-in download that already lives
// alongside ~103MB of other third-party binary weights fetched the same way.
export const RUNTIME_FILE_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_RUNTIME_VERSION}/dist/ort-wasm-simd-threaded.jsep.wasm`
// Rough size for progress-bar estimates only (matches the real file's on-disk size at the pinned
// version — see kokoro.worker.ts's header for where that 21,596,019-byte figure came from).
export const RUNTIME_FILE_ESTIMATED_BYTES = 21_596_019

export function voiceFiles(): string[] {
  return KOKORO_VOICE_IDS.map((id) => `voices/${id}.bin`)
}

/** Every file a FULLY ready pack needs, including the ORT runtime file added after the feature
 *  first shipped without it — see `computeStatus`'s `needsRuntimeFile` for how an
 *  already-downloaded pack from before that is told apart from one that's genuinely incomplete. */
export function allManifestFiles(): string[] {
  return [...CORE_FILES, ...voiceFiles(), RUNTIME_FILE]
}

export interface Manifest {
  modelId: string
  files: string[]
  downloadedAt: string
}

export interface TTSModelStatus {
  ready: boolean
  fileCount: number
  /** True when a pack downloaded before the ORT runtime file existed is otherwise complete —
   *  callers (useKokoroModelDownload.ts) should fetch just RUNTIME_FILE via
   *  `ttsModel:downloadRuntimeFile` instead of re-prompting the whole ~125MB download flow. */
  needsRuntimeFile: boolean
}

/** Pure function over a manifest (or its absence) — `ttsModel.ts`'s `getTTSModelStatus()` is
 *  just `computeStatus(readManifestOrNull())`. */
export function computeStatus(manifest: Manifest | null): TTSModelStatus {
  if (!manifest) return { ready: false, fileCount: 0, needsRuntimeFile: false }
  const expected = allManifestFiles()
  const complete = expected.every((f) => manifest.files.includes(f))
  const hasEverythingButRuntime = !manifest.files.includes(RUNTIME_FILE)
    && [...CORE_FILES, ...voiceFiles()].every((f) => manifest.files.includes(f))
  return {
    ready: complete,
    fileCount: manifest.files.length,
    needsRuntimeFile: !complete && hasEverythingButRuntime,
  }
}
