import { Capacitor } from '@capacitor/core'
import {
  KOKORO_MODEL_ID, MODEL_FILE_ESTIMATED_BYTES, CORE_FILES, voiceFiles, type Manifest,
} from '../../../electron/ttsModelManifest'
import { setKokoroModelBaseUrl, setKokoroNativeInfer } from '@/lib/tts/kokoro/modelBase'
import { BereanVoicePack } from './plugins'
import { useAppStore } from '@/store'
import { activateKokoroBackend } from '@/lib/tts/ttsEngine'

/**
 * Read Aloud on iPhone — Berean's own (Kokoro) voices, the same neural voices as the Mac.
 *
 * Installs `window.ttsModel` (the desktop contract, src/types/electron.d.ts) over
 * BereanVoicePackPlugin.swift, so the shared `useKokoroModelDownload` hook and the store's
 * `kokoroModelReady` → `activateKokoroBackend()` path work unchanged: one tap downloads the pack
 * once, and from then on Read Aloud runs the Kokoro worker offline inside the app.
 *
 * The Mac's files (electron/ttsModelManifest.ts) from the same source (Hugging Face), minus the
 * Mac's ONNX Runtime WASM file — the iPhone runs the model natively, never in the WebView. The
 * worker reads the tokenizer and voice files from app storage through Capacitor's
 * `_capacitor_file_` URLs.
 */
const HF_BASE_URL = `https://huggingface.co/${KOKORO_MODEL_ID}/resolve/main`
/** Every file the iPhone needs. */
export const IOS_PACK_FILES = [...CORE_FILES, ...voiceFiles()]
/** ~0.5 MB per voice style file + config/tokenizer. */
const SMALL_FILES_ESTIMATED_BYTES = voiceFiles().length * 524_000 + 100_000
export const VOICE_PACK_ESTIMATED_BYTES = MODEL_FILE_ESTIMATED_BYTES + SMALL_FILES_ESTIMATED_BYTES

const urlFor = (rel: string) => `${HF_BASE_URL}/${rel}`

/** Ready when every iPhone file is in the installed manifest (a pack copied from a Mac, with its
 *  extra runtime file, counts too). */
export function iosPackStatus(manifest: Manifest | null) {
  const files = manifest?.files ?? []
  return { ready: !!manifest && IOS_PACK_FILES.every((f) => files.includes(f)), fileCount: files.length, needsRuntimeFile: false }
}

/** `capacitor://localhost/_capacitor_file_/…/tts-models/` — what the worker uses as `localModelPath`. */
function baseUrlFor(root: string): string {
  return Capacitor.convertFileSrc(`file://${root.replace(/\/?$/, '/')}`)
}

async function status() {
  const st = await BereanVoicePack.status({ modelId: KOKORO_MODEL_ID })
  setKokoroModelBaseUrl(baseUrlFor(st.root))
  return iosPackStatus(st.manifest as Manifest | null)
}

let progressCb: ((p: { receivedBytes: number; totalBytes: number }) => void) | null = null
let verifyingCb: (() => void) | null = null
let listening = false
function listen() {
  if (listening) return
  listening = true
  void BereanVoicePack.addListener('progress', (p) => progressCb?.(p))
  void BereanVoicePack.addListener('verifying', () => verifyingCb?.())
}

async function download(files: string[], estimatedBytes: number) {
  listen()
  try {
    const res = await BereanVoicePack.download({ modelId: KOKORO_MODEL_ID, files: files.map((path) => ({ path, url: urlFor(path) })), estimatedBytes })
    if (res.success) await status() // sets the model base URL before the backend activates
    return res.success ? { success: true as const } : { success: false as const, error: res.error ?? 'Download failed' }
  } catch (e) {
    return { success: false as const, error: String((e as Error)?.message ?? e) }
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

/** Runs the model in BereanVoicePackPlugin.swift (ONNX Runtime, multi-threaded). */
async function nativeInfer({ ids, style, speed }: { ids: number[]; style: Float32Array; speed: number }): Promise<Float32Array> {
  const res = await BereanVoicePack.synthesize({ modelId: KOKORO_MODEL_ID, ids, style: toBase64(new Uint8Array(style.buffer, style.byteOffset, style.byteLength)), speed })
  const bin = atob(res.pcm)
  const out = new Float32Array(bin.length >> 1)
  for (let i = 0; i < out.length; i++) {
    const v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8)
    out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 32768
  }
  return out
}

export function installIosVoicePack(): void {
  setKokoroNativeInfer(nativeInfer)
  const ttsModel: Window['ttsModel'] = {
    getStatus: () => status(),
    download: () => download(IOS_PACK_FILES, VOICE_PACK_ESTIMATED_BYTES),
    // The runtime file is Mac-only (needsRuntimeFile is never true here).
    downloadRuntimeFile: () => download(IOS_PACK_FILES, VOICE_PACK_ESTIMATED_BYTES),
    cancelDownload: async () => (await BereanVoicePack.cancel()).cancelled,
    clearModelCache: async () => BereanVoicePack.clear({ modelId: KOKORO_MODEL_ID }),
    getModelId: async () => KOKORO_MODEL_ID,
    onDownloadProgress: (cb) => { progressCb = cb; listen() },
    onDownloadVerifying: (cb) => { verifyingCb = cb; listen() },
  }
  Object.assign(window, { ttsModel })
}

/**
 * Download state for the iPhone's Berean Voices screen (src/mobile/audio/GetVoicesView.tsx).
 * Module-level, not component state: the 360 MB download keeps running — and its progress keeps
 * showing — when the user leaves the screen and comes back.
 */
export interface VoicePackState {
  status: 'unknown' | 'none' | 'downloading' | 'verifying' | 'ready' | 'error'
  receivedBytes: number
  totalBytes: number
  error: string | null
}
let state: VoicePackState = { status: 'unknown', receivedBytes: 0, totalBytes: VOICE_PACK_ESTIMATED_BYTES, error: null }
const listeners = new Set<() => void>()
function setState(patch: Partial<VoicePackState>) { state = { ...state, ...patch }; listeners.forEach((l) => l()) }
export const voicePackStore = {
  get: () => state,
  subscribe: (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb) } },
}

/** Reads what is on disk (at boot and whenever the screen opens). */
export async function refreshVoicePack(): Promise<void> {
  if (state.status === 'downloading' || state.status === 'verifying') return
  try {
    const st = await window.ttsModel.getStatus()
    setState({ status: st.ready ? 'ready' : 'none' })
    if (st.ready && !useAppStore.getState().kokoroModelReady) useAppStore.getState().setKokoroModelReady(true)
  } catch {
    setState({ status: 'none' })
  }
}

/**
 * Switch Read Aloud's engine (system voice ⇄ Berean Voices) without leaving the player stuck:
 * a chapter being read stops on the old engine and carries on from the same verse on the new one.
 */
async function switchEngine(ready: boolean): Promise<void> {
  const st = useAppStore.getState()
  const ap = st.audioPlayback
  const resume = ap && ap.isPlaying && !ap.isPaused && !ap.finished ? ap : null
  if (ap) st.stopPlayback()
  st.setKokoroModelReady(ready) // false → main.tsx puts the system voice back
  if (ready) await activateKokoroBackend()
  if (resume) useAppStore.getState().startPlaybackFrom(resume.bookId, resume.chapter, resume.verse, resume.textId, resume.endVerse)
}

export async function startVoicePackDownload(): Promise<void> {
  if (state.status === 'downloading' || state.status === 'verifying') return
  setState({ status: 'downloading', receivedBytes: 0, totalBytes: VOICE_PACK_ESTIMATED_BYTES, error: null })
  window.ttsModel.onDownloadProgress((p) => setState({ status: 'downloading', receivedBytes: p.receivedBytes, totalBytes: p.totalBytes }))
  window.ttsModel.onDownloadVerifying(() => setState({ status: 'verifying' }))
  const res = await window.ttsModel.download()
  if (res.success) {
    setState({ status: 'ready', receivedBytes: state.totalBytes })
    await switchEngine(true)
  } else if (res.error === 'Cancelled') {
    setState({ status: 'none', receivedBytes: 0 })
  } else {
    setState({ status: 'error', error: res.error })
  }
}

export function cancelVoicePackDownload(): void { void window.ttsModel.cancelDownload() }

export async function removeVoicePack(): Promise<void> {
  await switchEngine(false)
  await window.ttsModel.clearModelCache()
  setState({ status: 'none', receivedBytes: 0 })
}
