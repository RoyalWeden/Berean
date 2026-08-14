import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ─── The ORT wasm binary must NOT ship inside the app bundle ─────────────────
//
// Vite's bundler statically resolves onnxruntime-web's own internal
// `new URL('ort-wasm-simd-threaded.jsep.wasm', import.meta.url)` reference and
// emits the whole 21.6MB binary into `out/renderer/assets/` as a hashed asset.
//
// That path is never taken at runtime: kokoro.worker.ts primes
// `env.backends.onnx.wasm.wasmBinary` with bytes fetched over `berean-model://`
// from the downloaded voice pack, and onnxruntime-web's `initializeWebAssembly`
// short-circuits on `wasmBinary` before any URL/locateFile logic runs. So the
// emitted asset is dead weight — and shipping it would silently undo the
// deliberate product decision that the 21.6MB runtime rides along with the
// OPT-IN voice-pack download (ttsModelManifest.ts's RUNTIME_FILE) rather than
// being paid for by every user on every install and every auto-update,
// including the ones who never enable neural voices.
//
// It is excluded at the electron-builder layer (a `!` entry in package.json's
// `build.files`) rather than by fighting Vite's asset scan, deliberately: that
// leaves onnxruntime-web's own bundle code completely untouched, so there is no
// chance of breaking some other fallback path inside it. The asset is simply
// not copied into the .app.
//
// This test guards the exclusion, because nothing else would notice its loss —
// the app would keep working perfectly and just get 21.6MB heavier per update.

describe('packaged app assets', () => {
  it('excludes the dead ORT wasm binary from the electron-builder file list', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      build: { files: string[] }
    }
    expect(pkg.build.files).toContain('!out/renderer/assets/ort-wasm-*.wasm')
    // The broad include must still come first — electron-builder applies these
    // in order, so a negation ahead of the include would be a no-op.
    expect(pkg.build.files.indexOf('out/**/*')).toBeLessThan(
      pkg.build.files.indexOf('!out/renderer/assets/ort-wasm-*.wasm'),
    )
  })
})
