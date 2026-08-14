import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CORE_FILES, RUNTIME_FILE, ORT_RUNTIME_VERSION, MODEL_WEIGHTS_FILE, voiceFiles, allManifestFiles,
  computeStatus, type Manifest,
} from '../ttsModelManifest'
import { TTS_MODEL_DTYPE } from '../../src/lib/tts/kokoro/modelProtocolConstants'

describe('model dtype ↔ weights filename', () => {
  // These two live on opposite sides of the main/renderer boundary: the WORKER passes
  // TTS_MODEL_DTYPE to `from_pretrained`, and the MAIN process derives the filename it downloads
  // from that same constant. If they ever disagree, the download fetches one file and the runtime
  // asks for another that was never fetched — surfacing only at synthesis time, as a confusing
  // 404 from the berean-model:// handler rather than anything that points at the dtype.
  it('derives the weights filename transformers.js will actually request for this dtype', () => {
    const expected: Record<string, string> = {
      fp32: 'onnx/model.onnx',
      fp16: 'onnx/model_fp16.onnx',
      q8: 'onnx/model_quantized.onnx',
      q4f16: 'onnx/model_q4f16.onnx',
    }
    expect(MODEL_WEIGHTS_FILE).toBe(expected[TTS_MODEL_DTYPE])
  })

  it('includes the weights file in the core download set', () => {
    expect(CORE_FILES).toContain(MODEL_WEIGHTS_FILE)
  })

  it('is fp32 — q8 shipped first and produced garbled, mumbling speech', () => {
    // Locked deliberately, not incidentally. Half-precision (fp16/q4f16) is the tempting middle
    // ground on size, but it is reliable on WebGPU and NOT on the WASM fallback path, so it would
    // fix quality only for users whose machine negotiates a GPU adapter. Anyone changing this
    // should have verified real audio on BOTH paths first.
    expect(TTS_MODEL_DTYPE).toBe('fp32')
  })
})

describe('ORT_RUNTIME_VERSION', () => {
  it('matches the onnxruntime-web version @huggingface/transformers actually bundles', () => {
    // See ttsModelManifest.ts's own comment on this constant: kokoro.worker.ts's `wasmBinary`
    // override (the standalone .wasm this constant's URL points at) and the JSEP glue embedded
    // inside kokoro-js's onnxruntime-web copy MUST be from the identical build, or
    // WebAssembly.instantiate() fails at the ABI boundary. This test is the tripwire for a
    // routine `npm update` silently letting the two drift apart.
    const transformersPkg = JSON.parse(
      readFileSync(join(__dirname, '../../node_modules/@huggingface/transformers/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> }
    expect(transformersPkg.dependencies?.['onnxruntime-web']).toBe(ORT_RUNTIME_VERSION)
  })
})

describe('allManifestFiles', () => {
  it('includes every core file, every voice file, and the runtime file exactly once', () => {
    const files = allManifestFiles()
    for (const f of CORE_FILES) expect(files).toContain(f)
    for (const f of voiceFiles()) expect(files).toContain(f)
    expect(files).toContain(RUNTIME_FILE)
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('computeStatus', () => {
  const fullManifest = (): Manifest => ({
    modelId: 'test-model',
    files: allManifestFiles(),
    downloadedAt: '2026-01-01T00:00:00.000Z',
  })

  it('reports not-ready with no needsRuntimeFile when there is no manifest at all', () => {
    expect(computeStatus(null)).toEqual({ ready: false, fileCount: 0, needsRuntimeFile: false })
  })

  it('reports ready when every manifest file (including the runtime file) is present', () => {
    const status = computeStatus(fullManifest())
    expect(status.ready).toBe(true)
    expect(status.needsRuntimeFile).toBe(false)
    expect(status.fileCount).toBe(allManifestFiles().length)
  })

  it('reports needsRuntimeFile for a pre-existing pack that has every core/voice file but predates RUNTIME_FILE', () => {
    const manifest = fullManifest()
    manifest.files = manifest.files.filter((f) => f !== RUNTIME_FILE)
    const status = computeStatus(manifest)
    expect(status.ready).toBe(false)
    expect(status.needsRuntimeFile).toBe(true)
  })

  it('does NOT report needsRuntimeFile for a genuinely incomplete/corrupt pack missing other files too', () => {
    const manifest = fullManifest()
    manifest.files = manifest.files.filter((f) => f !== RUNTIME_FILE && f !== CORE_FILES[0])
    const status = computeStatus(manifest)
    expect(status.ready).toBe(false)
    expect(status.needsRuntimeFile).toBe(false)
  })
})
