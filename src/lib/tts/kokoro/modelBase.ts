/**
 * Where the Kokoro worker loads the model files from: `berean-model://local/` on the Mac (served
 * by electron/ttsModelProtocol.ts) — the default when unset. The iPhone points it at the pack
 * downloaded into app storage (src/platform/ios/voicePack.ts). Its own import-free module so the
 * iOS boot can set it without pulling in kokoroBackend.ts and its worker.
 */
let modelBaseUrl: string | undefined
export function setKokoroModelBaseUrl(url: string | undefined) { modelBaseUrl = url }
export function getKokoroModelBaseUrl(): string | undefined { return modelBaseUrl }

/**
 * The model run itself, when the platform does it natively (iPhone: ONNX Runtime in
 * BereanVoicePackPlugin.swift — the WebView can only run it single-threaded WASM, slower than
 * real time). The worker still phonemizes and tokenizes with kokoro-js and hands this the token
 * ids and the voice's style vector; it returns 24 kHz mono samples. Unset on the Mac.
 */
export type KokoroNativeInfer = (input: { ids: number[]; style: Float32Array; speed: number }) => Promise<Float32Array>
let nativeInfer: KokoroNativeInfer | undefined
export function setKokoroNativeInfer(fn: KokoroNativeInfer | undefined) { nativeInfer = fn }
export function getKokoroNativeInfer(): KokoroNativeInfer | undefined { return nativeInfer }
