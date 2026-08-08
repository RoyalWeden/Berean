import { net } from 'electron'

// Thin bridge to a locally-running Ollama instance (https://ollama.com) — free,
// offline, no API key. Runs entirely in the main process via Electron's `net.fetch`
// (same pattern as electron/ipc/youtube.ts's fetchWithTimeout), so the renderer's
// CSP connect-src restrictions never come into play. If Ollama isn't running,
// every call here fails fast and callers fall back to a "start Ollama" UI state.

const OLLAMA_BASE = 'http://localhost:11434'
export const DEFAULT_OLLAMA_MODEL = 'gemma3:4b'

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
export async function runOllamaJson<T>(prompt: string, model = DEFAULT_OLLAMA_MODEL, timeoutMs = 30_000): Promise<T> {
  const res = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, format: 'json' }),
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
    body: JSON.stringify({ model, prompt, stream: false }),
  }, timeoutMs)
  if (!res.ok) throw new Error(`Ollama request failed: ${res.status}`)
  const data = await res.json() as { response: string }
  return data.response.trim()
}
