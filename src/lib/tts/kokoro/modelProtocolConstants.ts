/**
 * Read Aloud (TTS) — the `berean-model://` scheme name/base URL, shared between the RENDERER
 * (kokoro.worker.ts, which sets `env.localModelPath` to this) and the MAIN process
 * (electron/ttsModelProtocol.ts, which registers and serves this scheme). Deliberately its own
 * tiny file with zero other imports: electron/ttsModelProtocol.ts imports Node/Electron APIs
 * that can't be bundled into a renderer Web Worker, so the one constant both sides actually need
 * to agree on lives here instead of either side importing the other's module.
 */
export const TTS_MODEL_SCHEME = 'berean-model'
export const TTS_MODEL_LOCAL_MODEL_PATH = `${TTS_MODEL_SCHEME}://local/`

// Relative path, INSIDE a model's own directory (`{userData}/tts-models/<model_id>/`), of the
// standalone onnxruntime-web WASM runtime file `kokoro.worker.ts` fetches directly (via
// `env.backends.onnx.wasm.wasmBinary`) so Kokoro model load never has to hit
// `https://cdn.jsdelivr.net/...` — see that file's `primeOfflineWasmRuntime()` for why, and
// `electron/ttsModelManifest.ts` (which adds this file to the download manifest) for where it
// comes from. Lives here — the zero-import file both main and worker already share — rather than
// in either side's own module, for the same reason `TTS_MODEL_SCHEME` does.
export const TTS_RUNTIME_FILE_RELATIVE_PATH = 'runtime/ort-wasm-simd-threaded.jsep.wasm'

/**
 * ONNX weights precision, shared by the WORKER (passed to `KokoroTTS.from_pretrained({ dtype })`)
 * and the MAIN process (which derives the weights filename for the download manifest). They MUST
 * agree: transformers.js maps dtype → filename via DEFAULT_DTYPE_SUFFIX_MAPPING (fp32 →
 * `model.onnx`, q8 → `model_quantized.onnx`), so a mismatch downloads one file and then asks the
 * runtime to load another that was never fetched. Living here, in the file both sides already
 * import, is what makes that mismatch impossible to introduce by editing only one side.
 *
 * fp32 rather than a smaller quantization: q8 (`model_quantized.onnx`, ~92MB) shipped first and
 * produced garbled, mumbling speech — a known failure mode of this particular export, not the
 * mild degradation quantization is meant to cost. fp16/q4f16 would be the obvious middle ground,
 * but half-precision is reliable on WebGPU and NOT on the WASM fallback, so either would fix
 * quality only for users whose machine negotiates a GPU adapter and leave everyone else with the
 * same mumbling. fp32 behaves identically on both paths.
 */
export const TTS_MODEL_DTYPE = 'fp32'
