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
// Exported (Round: token budgeting) so aiLookup.ts's prompt assembly can budget material against
// the real context window instead of only ad hoc character/row caps — see electron/tokenBudget.ts.
export const NUM_CTX = 16384

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

// Keeps the model resident between calls instead of Ollama's default 5-minute idle-unload —
// directly benchmarked this round (see /private/tmp/.../scratchpad/ollama-speed-benchmark.md):
// forcing an unload before every call (simulating a real gap between study-session questions)
// cost ~1.2s of load_duration per call; adding keep_alive and only unloading before the FIRST
// call in a batch cut median total latency from 3.82s to 2.63s (-31%), with prompt_eval/eval
// time statistically unchanged between arms — the entire improvement is exactly the load-time
// mechanism keep_alive is supposed to affect, not a placebo.
//
// Round 11 shrunk this to 5m paired with a 2-minute proactive idle-unload below, on feedback
// that ~7GB resident for 30 minutes was too much idle memory. In practice that made "thinking
// for two minutes between questions" — the ordinary pace of actually reading a passage before
// asking the next question — pay a ~2.7s cold-reload tax on almost every question, which is a
// worse trade than the memory it saved on a 32GB machine. Restored to 15m, matched to
// IDLE_UNLOAD_MS below so this is genuinely just Ollama's own fallback, not a second shorter
// timer racing the JS one back down to 2 minutes.
const KEEP_ALIVE = '15m'

// Proactively unloads the model after the user STOPS asking questions — independent of whether
// the chat panel is still open, so leaving it open while browsing elsewhere doesn't keep ~7GB
// resident forever. Reset on every real call (see noteOllamaActivity), so the model stays loaded
// while the user is actively going back and forth, and only unloads once they've genuinely
// stopped for this long.
//
// Raised from 2m to 15m this round — 2 minutes was shorter than a normal reading pause between
// questions in an actual Bible study session, so nearly every question paid a ~2.7s cold-load
// tax (measured, see ollama.ts:53 above) for no real memory benefit: the panel is usually reused
// within a few minutes, not left resident all afternoon. 15m still frees the ~7GB once a session
// is clearly over, without punishing normal read-then-ask pacing.
const IDLE_UNLOAD_MS = 15 * 60 * 1000
let idleUnloadTimer: ReturnType<typeof setTimeout> | null = null

/** Sends a real request with `keep_alive: 0`, Ollama's own signal to unload the model right
 *  after responding — best-effort; a failure (Ollama not running, network hiccup) is silently
 *  ignored, same as every other best-effort path in this file. An empty prompt keeps this cheap
 *  — it's a control message, not a real generation call. */
async function unloadModelNow(model: string): Promise<void> {
  try {
    await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: '', stream: false, keep_alive: 0 }),
    }, 5000)
  } catch { /* best-effort — see comment above */ }
}

/** Call at the start of every real AI Lookup call — (re)starts the idle-unload countdown so an
 *  active back-and-forth keeps the model loaded (fast), while genuinely stopping (even with the
 *  chat panel left open) lets it unload again after IDLE_UNLOAD_MS instead of waiting out the
 *  full KEEP_ALIVE window. */
function noteOllamaActivity(model: string): void {
  if (idleUnloadTimer) clearTimeout(idleUnloadTimer)
  idleUnloadTimer = setTimeout(() => {
    idleUnloadTimer = null
    void unloadModelNow(model)
  }, IDLE_UNLOAD_MS)
}

/** Call immediately when the AI Lookup panel closes — a redundant, instant path on top of the
 *  idle timer above (which already covers "left the panel open but stopped asking questions"),
 *  for the common case of actually closing the panel. */
export function unloadOllamaImmediately(model = DEFAULT_OLLAMA_MODEL): void {
  if (idleUnloadTimer) { clearTimeout(idleUnloadTimer); idleUnloadTimer = null }
  void unloadModelNow(model)
}

// Worst-case backstop, not a typical-path speed lever — benchmarked this round: capping this at
// 512 changed nothing in 30 real extraction-style calls (tok/s identical, no response exceeded
// 82 tokens), so it costs nothing typical-case and only exists to bound a pathological runaway
// generation. Deliberately NOT applied to runOllamaText below — commentary responses are
// free-form and legitimately want more than 512 tokens; capping that one would truncate real
// output, per the same benchmark's explicit caveat.
// Exported alongside NUM_CTX above, same token-budgeting reason.
export const NUM_PREDICT_JSON = 512

// Lower than Ollama's default (~0.8) — requested for steadier answers run-to-run. Tested
// directly this round: at 0.2 the model's Jubilees guess became MORE CONSISTENT, not more
// correct (same wrong chapter every time) — this is not a correctness fix for any specific
// case, it's a general-quality change for reducing "ask the same question twice, get different
// answers" on ordinary extraction calls. Only applied to the structured-JSON extraction/
// verification/prune calls, not runOllamaText's free-form commentary, where some variation in
// phrasing is fine (even welcome) rather than something to suppress.
const EXTRACTION_TEMPERATURE = 0.3

/** Runs a single prompt against a local Ollama model, forcing JSON output.
 *  Throws on any failure (network, non-2xx, timeout) — callers must catch. */
export async function runOllamaJson<T>(prompt: string, model = DEFAULT_OLLAMA_MODEL, timeoutMs = 45_000): Promise<T> {
  noteOllamaActivity(model)
  const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, stream: false, format: 'json', keep_alive: KEEP_ALIVE,
      options: { num_ctx: NUM_CTX, num_predict: NUM_PREDICT_JSON, temperature: EXTRACTION_TEMPERATURE },
    }),
  }, timeoutMs)
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`)
  const data = await res.json() as { response: string }
  return JSON.parse(data.response) as T
}

/** Runs a single prompt and returns plain text (no forced JSON) — used for
 *  free-form commentary, where forcing a JSON shape would just add noise. */
export async function runOllamaText(prompt: string, model = DEFAULT_OLLAMA_MODEL, timeoutMs = 30_000): Promise<string> {
  noteOllamaActivity(model)
  const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, keep_alive: KEEP_ALIVE, options: { num_ctx: NUM_CTX } }),
  }, timeoutMs)
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`)
  const data = await res.json() as { response: string }
  return data.response.trim()
}
