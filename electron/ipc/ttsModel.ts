/**
 * Read Aloud (TTS) — main-process download manager for the Kokoro neural voice pack.
 *
 * This is an OPT-IN, explicit-user-action download (never a silent background fetch — see
 * AudioSection.tsx, which is the only caller of `ttsModel:download`). Files land in
 * `{userData}/tts-models/.download-tmp/` while downloading and only get atomically renamed into
 * the real `{userData}/tts-models/<model_id>/` directory once EVERY file has downloaded and
 * matched its expected size — a failed, cancelled, or partial download always leaves the real
 * directory either absent or in its last-known-good state, never half-written, so
 * `ttsModel:getStatus` can never report "ready" for something that isn't actually complete.
 *
 * File source: Hugging Face directly (`onnx-community/Kokoro-82M-v1.0-ONNX`), NOT this repo's
 * own GitHub Releases pipeline (`scripts/publish-data.js`) — that pipeline hosts Berean's OWN
 * `data/*.db` files, which Berean controls the contents/versioning of. The Kokoro ONNX export is
 * a third-party model artifact Berean doesn't own or rebuild; mirroring ~103MB of someone else's
 * binary model weights into Berean's own release assets on every release would bloat every future
 * release for no benefit over linking the canonical upstream copy directly. HuggingFace's
 * `resolve/main` URLs are stable, versioned-by-commit, and exactly what `kokoro-js` itself is
 * built to fetch from — using the same source it already expects avoids a second copy silently
 * drifting out of sync with what `kokoro-js` was tested against.
 */
import type { IpcMain, WebContents } from 'electron'
import { mkdirSync, existsSync, rmSync, renameSync, writeFileSync, readFileSync, createWriteStream } from 'fs'
import { join } from 'path'
import { getTTSModelsRoot } from '../ttsModelProtocol'
import {
  KOKORO_MODEL_ID, RUNTIME_FILE, RUNTIME_FILE_URL, RUNTIME_FILE_ESTIMATED_BYTES, MODEL_FILE_ESTIMATED_BYTES,
  allManifestFiles, computeStatus, type Manifest, type TTSModelStatus,
} from '../ttsModelManifest'

export { KOKORO_MODEL_ID }
const HF_BASE_URL = `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/main`

// Every manifest file except RUNTIME_FILE comes from HuggingFace; RUNTIME_FILE comes from
// jsDelivr's npm mirror instead (see ttsModelManifest.ts's own comment on RUNTIME_FILE_URL for
// why it isn't part of the HF model repo at all).
function urlForFile(relPath: string): string {
  return relPath === RUNTIME_FILE ? RUNTIME_FILE_URL : `${HF_BASE_URL}/${relPath}`
}

function modelDir(): string {
  return join(getTTSModelsRoot(), KOKORO_MODEL_ID)
}
function tmpDir(): string {
  return join(getTTSModelsRoot(), '.download-tmp', KOKORO_MODEL_ID)
}
function manifestPath(dir: string): string {
  return join(dir, '.manifest.json')
}

function readManifest(dir: string): Manifest | null {
  try {
    return JSON.parse(readFileSync(manifestPath(dir), 'utf8')) as Manifest
  } catch {
    return null
  }
}

export function getTTSModelStatus(): TTSModelStatus {
  return computeStatus(readManifest(modelDir()))
}

// Held module-level so a concurrent `ttsModel:cancelDownload` call can abort whichever download
// is currently in flight — there is only ever one download at a time (AudioSection.tsx's UI
// disables the download button while one is running), so a single slot is sufficient.
let activeDownload: AbortController | null = null

function cleanupTmp() {
  try { rmSync(tmpDir(), { recursive: true, force: true }) } catch { /* best-effort */ }
}

async function downloadOneFile(relPath: string, destDir: string, signal: AbortSignal, onBytes: (n: number) => void): Promise<void> {
  const url = urlForFile(relPath)
  const dest = join(destDir, relPath)
  mkdirSync(join(dest, '..'), { recursive: true })
  const res = await fetch(url, { signal })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${relPath}`)

  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(dest)
    out.on('error', reject)
    out.on('finish', resolve)
    const reader = res.body!.getReader()
    const pump = (): void => {
      reader.read().then(({ done, value }) => {
        if (done) { out.end(); return }
        onBytes(value.byteLength)
        out.write(Buffer.from(value), (err) => { if (err) reject(err); else pump() })
      }).catch(reject)
    }
    pump()
  })
}

/**
 * Downloads every file in the manifest into a temp dir, reporting aggregate progress via
 * `ttsModel:downloadProgress` events on `sender`, then atomically promotes the temp dir to the
 * real model dir only once every file succeeded. Any failure (including user cancellation via
 * `ttsModel:cancelDownload`, which aborts `signal`) deletes the temp dir before rejecting — the
 * real model dir, if one already existed from a previous successful download, is left untouched,
 * so a failed RE-download doesn't destroy a working install.
 */
async function runDownload(sender: WebContents): Promise<{ success: true } | { success: false; error: string }> {
  const controller = new AbortController()
  activeDownload = controller
  const dir = tmpDir()
  cleanupTmp()
  mkdirSync(dir, { recursive: true })

  const files = allManifestFiles()
  let receivedBytes = 0
  // No pre-flight HEAD pass — the total shown during download is a rough estimate (~125MB for
  // the current q8 manifest: ~88MB model + ~15MB of voice style vectors + ~21.6MB ORT WASM
  // runtime) rather than an exact sum, since fetching Content-Length for every file before
  // starting would just delay the visible "downloading…" state for no real accuracy gain (both
  // HuggingFace and jsDelivr serve accurate Content-Length per-file as each request lands
  // anyway, which is what drives the per-file portion of progress).
  // ~326MB fp32 weights + ~15MB of voice style vectors + ~21.6MB ORT WASM runtime. See
  // TTS_MODEL_DTYPE for why the weights are fp32 (q8 shipped first and mumbled).
  const ESTIMATED_TOTAL_BYTES = MODEL_FILE_ESTIMATED_BYTES + 15 * 1024 * 1024 + RUNTIME_FILE_ESTIMATED_BYTES

  try {
    for (const relPath of files) {
      if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
      await downloadOneFile(relPath, dir, controller.signal, (n) => {
        receivedBytes += n
        sender.send('ttsModel:downloadProgress', { receivedBytes, totalBytes: ESTIMATED_TOTAL_BYTES })
      })
    }
    sender.send('ttsModel:downloadVerifying')
    // Promote: remove any stale final dir first (a prior partial state, or an older model
    // version) then rename the fully-downloaded temp dir into place. rename() is atomic on the
    // same filesystem, which both dirs are (both under userData) on every platform Berean ships.
    const finalDir = modelDir()
    rmSync(finalDir, { recursive: true, force: true })
    mkdirSync(join(finalDir, '..'), { recursive: true })
    renameSync(dir, finalDir)
    const manifest: Manifest = { modelId: KOKORO_MODEL_ID, files, downloadedAt: new Date().toISOString() }
    writeFileSync(manifestPath(finalDir), JSON.stringify(manifest, null, 2))
    return { success: true }
  } catch (e) {
    cleanupTmp()
    const cancelled = e instanceof DOMException && e.name === 'AbortError'
    return { success: false, error: cancelled ? 'Cancelled' : String((e as Error)?.message ?? e) }
  } finally {
    activeDownload = null
  }
}

/**
 * Upgrade path for a pack that was downloaded before RUNTIME_FILE existed (see
 * `computeStatus`'s `needsRuntimeFile` in ttsModelManifest.ts) — fetches ONLY the ~21.6MB runtime
 * file directly into the EXISTING model dir (no wipe, no re-touching the ~103MB of core/voice
 * files already on disk) and appends it to the manifest. A cancel/failure here removes just the
 * one partial file and leaves the manifest untouched, so the pack is exactly as usable (still
 * missing only the runtime file, still reported `needsRuntimeFile`) as before the attempt — the
 * user/AudioSection can retry without having lost anything or triggered a full re-download.
 */
async function runRuntimeFileDownload(sender: WebContents): Promise<{ success: true } | { success: false; error: string }> {
  const controller = new AbortController()
  activeDownload = controller
  const dir = modelDir()
  const manifest = readManifest(dir)
  if (!manifest) {
    activeDownload = null
    return { success: false, error: 'No existing voice pack found to upgrade.' }
  }

  let receivedBytes = 0
  try {
    if (controller.signal.aborted) throw new DOMException('Cancelled', 'AbortError')
    await downloadOneFile(RUNTIME_FILE, dir, controller.signal, (n) => {
      receivedBytes += n
      sender.send('ttsModel:downloadProgress', { receivedBytes, totalBytes: RUNTIME_FILE_ESTIMATED_BYTES })
    })
    const updated: Manifest = { ...manifest, files: [...manifest.files, RUNTIME_FILE] }
    writeFileSync(manifestPath(dir), JSON.stringify(updated, null, 2))
    return { success: true }
  } catch (e) {
    try { rmSync(join(dir, RUNTIME_FILE), { force: true }) } catch { /* best-effort */ }
    const cancelled = e instanceof DOMException && e.name === 'AbortError'
    return { success: false, error: cancelled ? 'Cancelled' : String((e as Error)?.message ?? e) }
  } finally {
    activeDownload = null
  }
}

export function registerTTSModelHandlers(ipcMain: IpcMain): void {
  // Idempotent/cheap — ensures the root dir exists before the protocol handler or any download
  // ever needs it. Called here (inside registration, which main.ts only invokes from
  // `app.whenReady().then(...)`) rather than at module import time, since `app.getPath()` is
  // only guaranteed available once the app is ready.
  try { mkdirSync(getTTSModelsRoot(), { recursive: true }) } catch { /* best-effort */ }

  ipcMain.handle('ttsModel:getStatus', () => getTTSModelStatus())

  ipcMain.handle('ttsModel:download', async (event) => runDownload(event.sender))

  ipcMain.handle('ttsModel:downloadRuntimeFile', async (event) => runRuntimeFileDownload(event.sender))

  ipcMain.handle('ttsModel:cancelDownload', () => {
    activeDownload?.abort()
    return true
  })

  ipcMain.handle('ttsModel:clearModelCache', () => {
    if (activeDownload) return { success: false, error: 'Cannot clear cache while a download is in progress.' }
    try {
      rmSync(modelDir(), { recursive: true, force: true })
      cleanupTmp()
      return { success: true }
    } catch (e) {
      return { success: false, error: String((e as Error)?.message ?? e) }
    }
  })

  ipcMain.handle('ttsModel:getModelId', () => KOKORO_MODEL_ID)
}
