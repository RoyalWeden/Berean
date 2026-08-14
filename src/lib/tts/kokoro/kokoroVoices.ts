/**
 * Read Aloud (TTS) — Kokoro's voice catalog expressed as `TTSVoiceOption`s (see ttsBackend.ts),
 * so Kokoro voices drop into the exact same VoicePicker.tsx used for Web Speech voices.
 *
 * The catalog DATA (model id, voice metadata, ids, default, tier mapping) lives in the
 * import-free leaf module kokoroVoiceData.ts — see that file's header for why that separation is
 * load-bearing rather than cosmetic. Short version: the Electron main process needs the model id
 * and voice ids, main-process code is type-checked without the DOM lib, and this file's single
 * `import type` from ttsBackend.ts transitively drags the entire renderer graph into that
 * program. Type-only imports are erased at runtime but NOT for type-checking.
 *
 * Everything from the data module is re-exported here so renderer-side consumers can keep
 * importing from one place.
 */
import type { TTSVoiceOption } from '../ttsBackend'
import { KOKORO_VOICES, tierForGrade } from './kokoroVoiceData'

export {
  KOKORO_MODEL_ID,
  KOKORO_VOICES,
  KOKORO_VOICE_IDS,
  DEFAULT_KOKORO_VOICE_ID,
  isKokoroVoiceId,
  tierForGrade,
  type KokoroVoiceMeta,
} from './kokoroVoiceData'

export const KOKORO_VOICE_OPTIONS: TTSVoiceOption[] = KOKORO_VOICES.map((v) => ({
  voiceURI: v.id,
  name: v.name,
  lang: v.lang,
  tier: tierForGrade(v.overallGrade),
}))
