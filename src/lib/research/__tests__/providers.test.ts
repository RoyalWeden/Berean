import { describe, it, expect, vi } from 'vitest'
import { anthropicProvider, chooseProvider, generateJson, cloudHttpError, type HttpPost, type ModelProvider } from '../providers'
import { DEFAULT_PERMISSIONS as D } from '../policy'
import { ModelCallError } from '../errors'

const ok = (body: unknown): HttpPost => vi.fn(async () => ({ status: 200, json: async () => body }))
const local: ModelProvider = { id: 'ollama', label: 'Local', kind: 'local', capabilities: { json: true, tools: false, streaming: true }, generate: async () => '{}' }

describe('anthropicProvider (no network — post is injected)', () => {
  it('sends a Messages API request with the key in the header only', async () => {
    const post = ok({ content: [{ type: 'text', text: '{"a":1}' }] })
    const p = anthropicProvider('sk-test', post)
    expect(await generateJson(p, 'q', 'claude-haiku-5-5', { system: 's' })).toEqual({ a: 1 })
    const [url, init] = (post as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-test')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ model: 'claude-haiku-5-5', system: 's', messages: [{ role: 'user', content: 'q' }] })
    expect(init.body).not.toContain('sk-test')
  })

  it('maps HTTP failures to typed errors without the key', async () => {
    const p = anthropicProvider('sk-secret', vi.fn(async () => ({ status: 401, json: async () => ({}) })))
    const err = await p.generate('q', 'm').catch((e) => e) as ModelCallError
    expect(err.code).toBe('CLOUD_AUTH_FAILED')
    expect(err.message).not.toContain('sk-secret')
    expect(cloudHttpError(429, 'X').code).toBe('CLOUD_RATE_LIMIT')
    expect(cloudHttpError(402, 'X').code).toBe('CLOUD_COST_LIMIT')
  })

  it('refuses to call without a key', async () => {
    const post = vi.fn()
    await expect(anthropicProvider('', post).generate('q', 'm')).rejects.toMatchObject({ code: 'CLOUD_AUTH_FAILED' })
    expect(post).not.toHaveBeenCalled()
  })
})

describe('chooseProvider (spec §8.5: no silent paid fallback)', () => {
  const cloud = anthropicProvider('k', ok({}))
  it('uses local by default, even when a cloud provider is configured', () => {
    expect(chooseProvider({ local, cloud, settings: { ...D, cloudEnabled: true }, preferCloud: false }).provider).toBe(local)
  })
  it('never escalates to the cloud when the local model is missing', () => {
    expect(chooseProvider({ local: null, cloud, settings: { ...D, cloudEnabled: true }, preferCloud: false })).toMatchObject({ provider: null, reason: 'No local model is available.' })
  })
  it('uses the cloud only when enabled and preferred, with disclosure; offline stays local', () => {
    expect(chooseProvider({ local, cloud, settings: D, preferCloud: true }).provider).toBe(local)
    expect(chooseProvider({ local, cloud, settings: { ...D, cloudEnabled: true }, preferCloud: true })).toMatchObject({ provider: cloud, disclose: expect.stringMatching(/billed to your key/) })
    expect(chooseProvider({ local, cloud, settings: { ...D, cloudEnabled: true }, preferCloud: true, offline: true }).provider).toBe(local)
  })
})
