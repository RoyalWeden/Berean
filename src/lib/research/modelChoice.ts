// Which installed local model answers (decision 5, spec §8.4). Automatic keeps the current default
// and only moves to another model the benchmark passed when the default isn't installed. A manual
// choice wins while it is installed. Never picks a model that isn't installed, and this list can
// only grow from measured results (docs/ai-upgrade/JOURNAL.md).

const AUTO_ORDER = ['llama3.1:latest', 'ministral-3:3b', 'llama3.2:3b']

const norm = (m: string) => (m.includes(':') ? m : `${m}:latest`)

export interface LocalModelChoice {
  model: string
  /** Set when a manual choice couldn't be honoured. */
  notice?: string
}

/** `installed` empty means unknown (Ollama down or not asked): nothing is changed. */
export function chooseLocalModel(requested: string | undefined, installed: readonly string[], fallback: string): LocalModelChoice {
  const manual = requested && requested !== 'auto' ? requested : null
  if (installed.length === 0) return { model: manual ?? fallback }
  const has = new Set(installed.map(norm))
  if (manual && has.has(norm(manual))) return { model: manual }
  const auto = [fallback, ...AUTO_ORDER].find((m) => has.has(norm(m))) ?? fallback
  return manual ? { model: auto, notice: `${manual} isn't installed, so this answer used ${auto}.` } : { model: auto }
}

/** Installed models that can answer questions (embedding models can't). */
export function chatModels(installed: readonly string[]): string[] {
  return installed.filter((m) => !/embed/i.test(m))
}
