import { describe, it, expect } from 'vitest'
import { classifyModelError, isRetryable, ModelCallError, researchErrorCopy, type ResearchErrorCode } from '../errors'
import { replyTextFor } from '../replyText'

describe('classifyModelError', () => {
  it('classifies the benchmark fault shapes (R02–R05)', () => {
    expect(classifyModelError(new Error('The operation was aborted (synthetic timeout)'))).toBe('TIMEOUT')
    expect(classifyModelError(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe('TIMEOUT')
    expect(classifyModelError(new SyntaxError('Unexpected token S in JSON at position 0'))).toBe('INVALID_STRUCTURED_OUTPUT')
    expect(classifyModelError(new Error("Ollama request failed: 404 model 'x' not found"))).toBe('NO_MODEL_INSTALLED')
    expect(classifyModelError(new Error('Ollama request failed: 500 model requires more system memory (8.1 GiB)'))).toBe('OUT_OF_MEMORY')
    expect(classifyModelError(new Error('Ollama request failed: 500'))).toBe('RUNTIME_UNAVAILABLE')
    expect(classifyModelError(new ModelCallError('CORRUPT_MODEL', 'bad file'))).toBe('CORRUPT_MODEL')
  })

  it('retries only transient failures', () => {
    expect(isRetryable('TIMEOUT')).toBe(true)
    expect(isRetryable('INVALID_STRUCTURED_OUTPUT')).toBe(false)
    expect(isRetryable('OUT_OF_MEMORY')).toBe(false)
  })

  it('has copy for every code', () => {
    const codes: ResearchErrorCode[] = ['NO_MATCHES', 'NO_MODEL_INSTALLED', 'MODEL_LOADING', 'RUNTIME_UNAVAILABLE', 'TIMEOUT', 'INVALID_STRUCTURED_OUTPUT', 'OUT_OF_MEMORY', 'CORRUPT_MODEL', 'UNSUPPORTED_DEVICE', 'SOURCE_UNAVAILABLE', 'PERMISSION_DENIED', 'NETWORK_OFFLINE', 'WEB_FETCH_FAILED', 'CLOUD_AUTH_FAILED', 'CLOUD_RATE_LIMIT', 'CLOUD_COST_LIMIT', 'PARTIAL_RESULTS', 'CANCELLED']
    for (const c of codes) expect(researchErrorCopy(c).title.length).toBeGreaterThan(0)
  })
})

describe('replyTextFor (spec §9.1: never "no verses" for a model error)', () => {
  it('names a model failure and says model-free results are shown', () => {
    const t = replyTextFor({ errorCode: 'TIMEOUT', partial: true, hasAnswer: true })
    expect(t).toMatch(/timed out/)
    expect(t).toMatch(/without the AI model are shown/)
    expect(t).not.toMatch(/No matching/)
  })

  it('never says "no matching" when the model failed with nothing found', () => {
    expect(replyTextFor({ errorCode: 'OUT_OF_MEMORY', partial: false, hasAnswer: false })).not.toMatch(/No matching/)
  })

  it('uses the runtime name only when the runtime did not answer', () => {
    expect(replyTextFor({ errorCode: 'RUNTIME_UNAVAILABLE', error: 'ollama-unavailable', hasAnswer: false }, { runtimeName: 'Ollama' })).toMatch(/Ollama isn't running/)
    expect(replyTextFor({ errorCode: 'RUNTIME_UNAVAILABLE', hasAnswer: false }, { runtimeName: 'Ollama' })).not.toMatch(/isn't running/)
  })

  it('says no matches only when nothing failed and nothing was found', () => {
    expect(replyTextFor({ hasAnswer: false })).toMatch(/No matching passages/)
    expect(replyTextFor({ errorCode: 'NO_MATCHES', hasAnswer: false })).toMatch(/No matching passages/)
    expect(replyTextFor({ hasAnswer: true })).toBe('')
  })
})
