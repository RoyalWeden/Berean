import { AsyncLocalStorage } from 'node:async_hooks'
import { runOllamaJson } from './ollama'
import { generateJson, type ModelProvider } from '../src/lib/research/providers'
import { ModelCallError } from '../src/lib/research/errors'

// The one place a lookup's model calls go through (spec §8.5). With no route they are the local
// Ollama calls, unchanged. A cloud route exists only for a request `chooseProvider` allowed, and
// is scoped to that request by AsyncLocalStorage, so a concurrent local lookup can't pick it up.
export interface CloudRoute {
  provider: ModelProvider
  model: string
}

const requests = new AsyncLocalStorage<{ route: CloudRoute | null; signal?: AbortSignal }>()

/** Runs one lookup. Every model call inside it uses this route and stops when `signal` aborts. */
export function withModelRequest<T>(route: CloudRoute | null, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  return requests.run({ route, signal }, fn)
}

export function usingCloud(): boolean {
  return !!requests.getStore()?.route
}

async function cancellable<T>(call: (signal?: AbortSignal) => Promise<T>): Promise<T> {
  const signal = requests.getStore()?.signal
  const cancelled = () => new ModelCallError('CANCELLED', 'Research was cancelled.')
  if (signal?.aborted) throw cancelled()
  try {
    return await call(signal)
  } catch (e) {
    throw signal?.aborted ? cancelled() : e
  }
}

export function modelJson<T>(prompt: string, model: string, timeoutMs?: number, opts: { numPredict?: number } = {}): Promise<T> {
  const route = requests.getStore()?.route
  return cancellable((signal) => (route
    ? generateJson<T>(route.provider, prompt, route.model, { system: 'Reply with one valid JSON object and nothing else.', maxTokens: opts.numPredict, timeoutMs, signal })
    : runOllamaJson<T>(prompt, model, timeoutMs, { ...opts, ...(signal ? { signal } : {}) })))
}
