// Typed research failure states (spec §9.1). A model/runtime failure is never reported as
// "no matching verses": the code says what actually happened, and any model-free evidence already
// found is kept alongside it.

export type ResearchErrorCode =
  | 'NO_MATCHES'
  | 'NO_MODEL_INSTALLED'
  | 'MODEL_LOADING'
  | 'RUNTIME_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INVALID_STRUCTURED_OUTPUT'
  | 'OUT_OF_MEMORY'
  | 'CORRUPT_MODEL'
  | 'UNSUPPORTED_DEVICE'
  | 'SOURCE_UNAVAILABLE'
  | 'PERMISSION_DENIED'
  | 'NETWORK_OFFLINE'
  | 'WEB_FETCH_FAILED'
  | 'CLOUD_AUTH_FAILED'
  | 'CLOUD_RATE_LIMIT'
  | 'CLOUD_COST_LIMIT'
  | 'PARTIAL_RESULTS'
  | 'CANCELLED'

/** Thrown by model providers so callers can classify without parsing message text. */
export class ModelCallError extends Error {
  constructor(readonly code: ResearchErrorCode, message: string, readonly status?: number) {
    super(message)
    this.name = 'ModelCallError'
  }
}

/** Best-effort classification of anything a model call threw. */
export function classifyModelError(e: unknown): ResearchErrorCode {
  if (e instanceof ModelCallError) return e.code
  const name = (e as { name?: string })?.name ?? ''
  const msg = String((e as { message?: string })?.message ?? e ?? '')
  if (name === 'AbortError' || /\babort(ed)?\b|timed?\s*out|timeout/i.test(msg)) return 'TIMEOUT'
  if (e instanceof SyntaxError || /JSON|Unexpected token|Unexpected end|not valid json/i.test(msg)) return 'INVALID_STRUCTURED_OUTPUT'
  if (/out of memory|requires more system memory|\boom\b|insufficient memory/i.test(msg)) return 'OUT_OF_MEMORY'
  if (/\b404\b|model ['"]?[^'"]*['"]? not found|no such model|pull the model/i.test(msg)) return 'NO_MODEL_INSTALLED'
  if (/\b(500|502|503)\b/.test(msg)) return 'RUNTIME_UNAVAILABLE'
  if (/ECONNREFUSED|fetch failed|network|ENOTFOUND/i.test(msg)) return 'RUNTIME_UNAVAILABLE'
  return 'RUNTIME_UNAVAILABLE'
}

/** Transient failures worth exactly one retry. */
export function isRetryable(code: ResearchErrorCode): boolean {
  return code === 'TIMEOUT' || code === 'MODEL_LOADING'
}

export interface ResearchErrorCopy {
  title: string
  detail: string
}

/** Short, actionable copy. `partial` = deterministic results were still shown. */
export function researchErrorCopy(code: ResearchErrorCode, opts: { partial?: boolean } = {}): ResearchErrorCopy {
  const keep = opts.partial ? ' Results found without the AI model are shown below.' : ''
  switch (code) {
    case 'NO_MATCHES': return { title: 'No matching passages', detail: 'Nothing in the searched collections matched. Try other wording or widen the scope.' }
    case 'NO_MODEL_INSTALLED': return { title: 'AI model not installed', detail: `The AI model isn't available on this device.${keep}` }
    case 'MODEL_LOADING': return { title: 'AI model is loading', detail: `The model is still starting up — try again in a moment.${keep}` }
    case 'RUNTIME_UNAVAILABLE': return { title: 'AI model unavailable', detail: `Berean couldn't reach the local AI model.${keep}` }
    case 'TIMEOUT': return { title: 'AI model timed out', detail: `The model took too long to respond.${keep}` }
    case 'INVALID_STRUCTURED_OUTPUT': return { title: 'AI model gave an unusable reply', detail: `The model's reply couldn't be read.${keep}` }
    case 'OUT_OF_MEMORY': return { title: 'Not enough memory for the AI model', detail: `This device doesn't have enough free memory to run the model right now.${keep}` }
    case 'CORRUPT_MODEL': return { title: 'AI model file is damaged', detail: `Remove and download the model again.${keep}` }
    case 'UNSUPPORTED_DEVICE': return { title: 'AI model not supported here', detail: `This device can't run the AI model.${keep}` }
    case 'SOURCE_UNAVAILABLE': return { title: 'A source is unavailable', detail: 'One of the research sources couldn\'t be opened.' }
    case 'PERMISSION_DENIED': return { title: 'Permission needed', detail: 'This research step needs a permission you haven\'t granted.' }
    case 'NETWORK_OFFLINE': return { title: 'You\'re offline', detail: 'Online research needs an internet connection. Local results are unaffected.' }
    case 'WEB_FETCH_FAILED': return { title: 'Online source failed', detail: 'An online source couldn\'t be fetched. Local results are unaffected.' }
    case 'CLOUD_AUTH_FAILED': return { title: 'Cloud provider rejected the key', detail: 'Check the API key in Settings.' }
    case 'CLOUD_RATE_LIMIT': return { title: 'Cloud provider rate limit', detail: 'The provider is limiting requests. Try again shortly.' }
    case 'CLOUD_COST_LIMIT': return { title: 'Cloud spending limit reached', detail: 'The limit you set for cloud requests was reached.' }
    case 'PARTIAL_RESULTS': return { title: 'Partial results', detail: 'Some research steps didn\'t finish; what was found is shown.' }
    case 'CANCELLED': return { title: 'Stopped', detail: 'Research was cancelled.' }
  }
}

/** Legacy `error` strings the main process still emits, mapped to typed codes. */
export function legacyErrorToCode(error: string | undefined): ResearchErrorCode | undefined {
  if (!error) return undefined
  if (error === 'ollama-unavailable') return 'RUNTIME_UNAVAILABLE'
  if (error === 'ollama-request-failed') return 'RUNTIME_UNAVAILABLE'
  return undefined
}
