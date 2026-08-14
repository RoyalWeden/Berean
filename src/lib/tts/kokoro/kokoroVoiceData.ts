/**
 * Read Aloud (TTS) — Kokoro's raw voice catalog and model id, as a TRUE LEAF MODULE.
 *
 * This file must never import anything. Not a value, not even a type.
 *
 * Why that rule exists (it is load-bearing, not stylistic): the Electron MAIN process needs two
 * things from this catalog — the model id to build a download manifest from, and the list of
 * `voices/<id>.bin` style-vector files to fetch (electron/ipc/ttsModel.ts) — and main-process
 * code is type-checked by tsconfig.node.json, whose `lib` is `["ES2022"]` with NO DOM. Its
 * `include` is only `["electron", ...]`, but TypeScript pulls in every file reachable by import
 * from there, and it type-checks all of them under that DOM-less lib.
 *
 * These constants previously lived in kokoroVoices.ts, which carries a single
 * `import type { TTSVoiceOption } from '../ttsBackend'`. That one type-only edge was enough:
 * ttsBackend.ts -> extractSpokenText.ts -> `@/store` -> notePreviewRender -> staticRender ->
 * the ProseMirror schema and ref decorations, and separately -> ttsEngine -> webSpeechBackend /
 * kokoroBackend. The entire renderer graph landed in the main-process program and produced ~157
 * spurious `Cannot find name 'window'`-class errors, taking `npm run typecheck` (which runs BOTH
 * tsconfigs) from 3 pre-existing errors to 160. A type-only import is erased at runtime but is
 * NOT erased for type-checking, which is exactly the trap.
 *
 * So: anything the main process needs from the Kokoro catalog belongs HERE, and kokoroVoices.ts
 * imports from this file to build the renderer-facing `TTSVoiceOption[]`. If you find yourself
 * adding an import to this file, add the new thing to kokoroVoices.ts instead.
 */

/** The HuggingFace model id `kokoro-js`'s `KokoroTTS.from_pretrained()` is called with. Shared by
 *  the worker's `from_pretrained()` call and the main process's download manifest, so the two can
 *  never name two different models. */
export const KOKORO_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

export interface KokoroVoiceMeta {
  id: string
  name: string
  lang: string
  overallGrade: string
}

// Transcribed directly from `kokoro-js`'s own bundled voice metadata (the `voices` getter on a
// loaded `KokoroTTS` instance — see node_modules/kokoro-js/dist/kokoro.js). Hardcoded rather than
// read from a loaded instance because a model doesn't need to be downloaded or loaded at all just
// to let the user SEE and pick a voice in Settings — only actual synthesis needs it in memory.
// Only the English (en-us/en-gb) voices are listed; kokoro-js ships other languages too, but
// Berean's texts are all English.
//
// EXCLUDED DELIBERATELY: `am_adam` (grade F+) and `am_santa` (grade D-), the two lowest-graded
// voices Kokoro ships. Adam was reported producing broken audio — garbled for the first several
// verses of Psalm 116 while sounding fine elsewhere — which is the characteristic failure of a
// voice this poorly graded: an F+ style vector is undertrained and degrades unpredictably on
// particular phoneme sequences rather than being uniformly bad. That's an upstream model quality
// issue, not something Berean can fix by changing how it's called, so the honest fix is not to
// offer it. Santa goes for the same reason plus being a novelty voice with no place reading
// Scripture. Every remaining voice is grade C- or better.
// Order matches kokoro-js's own voices object (best-known/highest-quality voices first within
// each gender/locale group, per the model card).
export const KOKORO_VOICES: KokoroVoiceMeta[] = [
  { id: 'af_heart', name: 'Heart', lang: 'en-US', overallGrade: 'A' },
  { id: 'af_bella', name: 'Bella', lang: 'en-US', overallGrade: 'A-' },
  { id: 'af_nicole', name: 'Nicole', lang: 'en-US', overallGrade: 'B-' },
  { id: 'af_aoede', name: 'Aoede', lang: 'en-US', overallGrade: 'C+' },
  { id: 'af_kore', name: 'Kore', lang: 'en-US', overallGrade: 'C+' },
  { id: 'af_sarah', name: 'Sarah', lang: 'en-US', overallGrade: 'C+' },
  { id: 'af_nova', name: 'Nova', lang: 'en-US', overallGrade: 'C' },
  { id: 'af_sky', name: 'Sky', lang: 'en-US', overallGrade: 'C-' },
  { id: 'af_alloy', name: 'Alloy', lang: 'en-US', overallGrade: 'C' },
  { id: 'af_jessica', name: 'Jessica', lang: 'en-US', overallGrade: 'D' },
  { id: 'af_river', name: 'River', lang: 'en-US', overallGrade: 'D' },
  { id: 'am_fenrir', name: 'Fenrir', lang: 'en-US', overallGrade: 'C+' },
  { id: 'am_michael', name: 'Michael', lang: 'en-US', overallGrade: 'C+' },
  { id: 'am_puck', name: 'Puck', lang: 'en-US', overallGrade: 'C+' },
  { id: 'am_echo', name: 'Echo', lang: 'en-US', overallGrade: 'D' },
  { id: 'am_eric', name: 'Eric', lang: 'en-US', overallGrade: 'D' },
  { id: 'am_liam', name: 'Liam', lang: 'en-US', overallGrade: 'D' },
  { id: 'am_onyx', name: 'Onyx', lang: 'en-US', overallGrade: 'D' },
  { id: 'bf_emma', name: 'Emma', lang: 'en-GB', overallGrade: 'B-' },
  { id: 'bf_isabella', name: 'Isabella', lang: 'en-GB', overallGrade: 'C' },
  { id: 'bm_fable', name: 'Fable', lang: 'en-GB', overallGrade: 'C' },
  { id: 'bm_george', name: 'George', lang: 'en-GB', overallGrade: 'C' },
  { id: 'bf_alice', name: 'Alice', lang: 'en-GB', overallGrade: 'D' },
  { id: 'bf_lily', name: 'Lily', lang: 'en-GB', overallGrade: 'D' },
  { id: 'bm_daniel', name: 'Daniel', lang: 'en-GB', overallGrade: 'D' },
  { id: 'bm_lewis', name: 'Lewis', lang: 'en-GB', overallGrade: 'D+' },
]

/** Bare voice ids only — reused by electron/ipc/ttsModel.ts to know which `voices/<id>.bin`
 *  style-vector files to download, so the download manifest and the picker can never drift out of
 *  sync on which voices Berean actually offers. */
export const KOKORO_VOICE_IDS: string[] = KOKORO_VOICES.map((v) => v.id)

export const DEFAULT_KOKORO_VOICE_ID = 'af_heart'

export function isKokoroVoiceId(id: string | null): boolean {
  return !!id && KOKORO_VOICES.some((v) => v.id === id)
}

/** Kokoro publishes an `overallGrade` (A/B/C/D/F, each optionally +/-) per voice, from the model
 *  card's community MOS-style ranking. A-grade maps to 'Premium', B-grade to 'Enhanced', and
 *  C-or-below gets no badge at all — still usable, just not called out as notably good. Same
 *  convention Web Speech's voiceQuality.ts uses, so both engines' voices badge identically. */
export function tierForGrade(grade: string): 'Premium' | 'Enhanced' | null {
  if (grade.startsWith('A')) return 'Premium'
  if (grade.startsWith('B')) return 'Enhanced'
  return null
}
