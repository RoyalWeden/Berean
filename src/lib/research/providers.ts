// Model provider abstraction (spec §8.5, decisions 7, 25). Retrieval contracts never change per
// provider: a provider only turns a prompt into text or JSON. Local is the default; a cloud
// provider is used only when `policy.decide('cloud-question')` allows it, and a failing local
// model NEVER falls back to a paid one (spec §8.5). Pure — the HTTP call is injected, so tests and
// the benchmark make no network requests. Keys are passed in per call by the main process (which
// reads them from Keychain-backed storage) and are never stored or logged here.

import { ModelCallError } from './errors'
import { decide, type PermissionSettings } from './policy'

export type ProviderKind = 'local' | 'cloud'

export interface ProviderCapabilities {
  /** Native JSON / structured output (otherwise JSON is parsed from text). */
  json: boolean
  tools: boolean
  streaming: boolean
}

export interface GenerateOptions {
  system?: string
  maxTokens?: number
  timeoutMs?: number
  signal?: AbortSignal
}

export interface ModelProvider {
  id: string
  label: string
  kind: ProviderKind
  capabilities: ProviderCapabilities
  generate(prompt: string, model: string, opts?: GenerateOptions): Promise<string>
}

/** The only network primitive a cloud provider gets. */
export type HttpRequest = (url: string, init: { method?: 'GET' | 'POST'; headers: Record<string, string>; body?: string; timeoutMs: number; signal?: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>

/** Maps an HTTP failure to a typed research error (spec §9.1) — the key never appears in it. */
export function cloudHttpError(status: number, provider: string): ModelCallError {
  if (status === 401 || status === 403) return new ModelCallError('CLOUD_AUTH_FAILED', `${provider} rejected the API key.`, status)
  if (status === 429) return new ModelCallError('CLOUD_RATE_LIMIT', `${provider} rate limit reached.`, status)
  if (status === 402) return new ModelCallError('CLOUD_COST_LIMIT', `${provider} billing limit reached.`, status)
  if (status === 408 || status === 504) return new ModelCallError('TIMEOUT', `${provider} timed out.`, status)
  return new ModelCallError('RUNTIME_UNAVAILABLE', `${provider} returned HTTP ${status}.`, status)
}

/** Anthropic Messages API (BYO key). Model ids are the user's choice; no default is billed. */
export function anthropicProvider(apiKey: string, post: HttpRequest): ModelProvider {
  return {
    id: 'anthropic', label: 'Anthropic (your API key)', kind: 'cloud',
    capabilities: { json: false, tools: true, streaming: true },
    async generate(prompt, model, opts = {}) {
      if (!apiKey) throw new ModelCallError('CLOUD_AUTH_FAILED', 'No API key is saved for Anthropic.')
      const res = await post('https://api.anthropic.com/v1/messages', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model, max_tokens: opts.maxTokens ?? 1024,
          ...(opts.system ? { system: opts.system } : {}),
          messages: [{ role: 'user', content: prompt }],
        }),
        timeoutMs: opts.timeoutMs ?? 60_000,
        signal: opts.signal,
      })
      if (res.status !== 200) throw cloudHttpError(res.status, 'Anthropic')
      const body = await res.json() as { content?: Array<{ type: string; text?: string }> }
      const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
      if (!text) throw new ModelCallError('INVALID_STRUCTURED_OUTPUT', 'Anthropic returned no text.')
      return text
    },
  }
}

/** Lists models, which bills nothing, so a key can be checked without a paid call. */
export async function checkAnthropicKey(apiKey: string, request: HttpRequest): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    const res = await request('https://api.anthropic.com/v1/models', { method: 'GET', headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, timeoutMs: 15_000 })
    return res.status === 200 ? { ok: true } : { ok: false, reason: cloudHttpError(res.status, 'Anthropic').message }
  } catch {
    return { ok: false, reason: 'Could not reach Anthropic.' }
  }
}

/** JSON from any provider: native when supported, else the first {...} block of the text. */
export async function generateJson<T>(p: ModelProvider, prompt: string, model: string, opts?: GenerateOptions): Promise<T> {
  const text = await p.generate(prompt, model, opts)
  const block = text.match(/\{[\s\S]*\}/)?.[0]
  try { return JSON.parse(block ?? text) as T } catch {
    throw new ModelCallError('INVALID_STRUCTURED_OUTPUT', `${p.label} did not return valid JSON.`)
  }
}

export interface ProviderChoice {
  provider: ModelProvider | null
  /** Shown to the user whenever a cloud provider is chosen (destination, data, billing). */
  disclose?: string
  reason?: string
}

/** Picks the provider for one request. Cloud only when explicitly enabled and the user asked for
 *  it (or set it as their model); a local failure is reported, never escalated to the cloud. */
export function chooseProvider(opts: {
  local: ModelProvider | null
  cloud: ModelProvider | null
  settings: PermissionSettings
  preferCloud: boolean
  offline?: boolean
}): ProviderChoice {
  if (opts.preferCloud && opts.cloud) {
    const d = decide('cloud-question', opts.settings, { offline: opts.offline })
    if (d.allowed) return { provider: opts.cloud, disclose: d.disclose }
    return { provider: opts.local, reason: d.reason }
  }
  return { provider: opts.local, ...(opts.local ? {} : { reason: 'No local model is available.' }) }
}
