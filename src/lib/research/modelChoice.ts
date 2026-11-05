// Which installed local model answers (decisions 5, 25; spec §8.4). A manual choice wins while it
// is installed. Automatic takes the first installed model below, and Deep Search moves up to the
// larger model when it is installed and the Mac has the memory. Never picks a model that isn't
// installed, never leaves the device, and these lists change only from measured results
// (docs/ai-upgrade/JOURNAL.md).

const AUTO_ORDER = ['qwen3.5:2b-q4_K_M', 'llama3.1:latest', 'ministral-3:3b', 'llama3.2:3b']
const ESCALATION_MODEL = 'gemma4:12b-it-qat'
/** Measured 2026-11-05 on a 32 GB M5, generating at Berean's context size. */
const ESCALATION_RESIDENT_BYTES = 8.4e9
/** Twice that, so the app and the rest of the Mac keep room. */
const ESCALATION_MIN_MEMORY = 2 * ESCALATION_RESIDENT_BYTES

const norm = (m: string) => (m.includes(':') ? m : `${m}:latest`)

export interface LocalModelChoice {
  model: string
  /** Set when a manual choice couldn't be honoured. */
  notice?: string
}

/** `installed` empty means unknown (Ollama down or not asked): nothing is changed. */
export function chooseLocalModel(requested: string | undefined, installed: readonly string[], fallback: string, ctx: { deepSearch?: boolean; totalMemoryBytes?: number } = {}): LocalModelChoice {
  const manual = requested && requested !== 'auto' ? requested : null
  if (installed.length === 0) return { model: manual ?? fallback }
  const has = new Set(installed.map(norm))
  if (manual && has.has(norm(manual))) return { model: manual }
  if (!manual && ctx.deepSearch && has.has(ESCALATION_MODEL) && (ctx.totalMemoryBytes ?? 0) >= ESCALATION_MIN_MEMORY) {
    return { model: ESCALATION_MODEL, notice: `Deep Search used the larger model installed on this Mac, ${ESCALATION_MODEL}.` }
  }
  const auto = [...AUTO_ORDER, fallback].find((m) => has.has(norm(m))) ?? fallback
  return manual ? { model: auto, notice: `${manual} isn't installed, so this answer used ${auto}.` } : { model: auto }
}

/** Installed models that can answer questions (embedding models can't). */
export function chatModels(installed: readonly string[]): string[] {
  return installed.filter((m) => !/embed/i.test(m))
}
