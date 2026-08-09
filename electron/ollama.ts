import { net } from 'electron'

// Thin bridge to a locally-running Ollama instance (https://ollama.com) — free,
// offline, no API key. Runs entirely in the main process via Electron's `net.fetch`
// (same pattern as electron/ipc/youtube.ts's fetchWithTimeout), so the renderer's
// CSP connect-src restrictions never come into play. If Ollama isn't running,
// every call here fails fast and callers fall back to a "start Ollama" UI state.

const OLLAMA_BASE = 'http://localhost:11434'
// llama3.1:latest, not gemma3:4b — empirically, on named-passage recall questions (the kind
// this feature lives or dies on), gemma3:4b's guesses were frequently wrong or hallucinated
// (e.g. "Yeshua's long prayer" → Matthew 26 instead of the correct John 17; "fallen angels
// in Enoch" → chapters 60/80/87/91/105, none of which are close) while llama3.1 got both
// right. Slower per response, but a wrong guess can't be fixed by any amount of ranking, so
// accuracy wins the trade-off here.
export const DEFAULT_OLLAMA_MODEL = 'llama3.1:latest'

// Ollama defaults an unset context window to the MODEL'S OWN max (131,072 tokens for
// llama3.1) — observed via `ollama ps` ballooning to 22GB resident memory for this feature's
// prompts, which were only ever a few hundred to a couple thousand tokens. That's not a
// one-time fluke of testing; every request would reload at that same size. 16384 (bumped from
// an earlier 8192) leaves comfortable room for the largest single call — the commentary prompt
// with up to 12 verses, PLUS the new conversational-memory block (recent chat turns folded into
// the extraction prompt) — while still cutting the KV-cache footprint roughly 8x versus the
// model's own unbounded default. Measured: 8192 cost ~1GB of KV-cache overhead over the base
// model weight; doubling to 16384 should cost roughly another ~1GB (~7GB total), nowhere close
// to the 22GB seen at the model's full 131K default.
const NUM_CTX = 16384

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await net.fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function checkOllamaAvailable(): Promise<{ available: boolean; models: string[] }> {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {}, 2500)
    if (!res.ok) return { available: false, models: [] }
    const data = await res.json() as { models?: Array<{ name: string }> }
    return { available: true, models: (data.models ?? []).map((m) => m.name) }
  } catch {
    return { available: false, models: [] }
  }
}

/** Runs a single prompt against a local Ollama model, forcing JSON output.
 *  Throws on any failure (network, non-2xx, timeout) — callers must catch. */
export async function runOllamaJson<T>(prompt: string, model = DEFAULT_OLLAMA_MODEL, timeoutMs = 45_000): Promise<T> {
  const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { num_ctx: NUM_CTX } }),
  }, timeoutMs)
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`)
  const data = await res.json() as { response: string }
  return JSON.parse(data.response) as T
}

/** Runs a single prompt and returns plain text (no forced JSON) — used for
 *  free-form commentary, where forcing a JSON shape would just add noise. */
export async function runOllamaText(prompt: string, model = DEFAULT_OLLAMA_MODEL, timeoutMs = 30_000): Promise<string> {
  const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_ctx: NUM_CTX } }),
  }, timeoutMs)
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`)
  const data = await res.json() as { response: string }
  return data.response.trim()
}
