import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModelProvider } from '../../src/lib/research/providers'

const runOllamaJson = vi.fn()
vi.mock('../ollama', () => ({ runOllamaJson: (...a: unknown[]) => runOllamaJson(...a), runOllamaText: async () => 'local' }))

import { modelJson, usingCloud, withModelRequest } from '../modelGateway'

const provider = (reply: string): ModelProvider => ({ id: 'c', label: 'C', kind: 'cloud', capabilities: { json: false, tools: false, streaming: false }, generate: async () => reply })

describe('modelGateway', () => {
  beforeEach(() => { runOllamaJson.mockReset(); runOllamaJson.mockResolvedValue({ from: 'local' }) })

  it('is the local call when no route is set', async () => {
    expect(usingCloud()).toBe(false)
    expect(await modelJson('p', 'm', 5, { numPredict: 9 })).toEqual({ from: 'local' })
    expect(runOllamaJson).toHaveBeenCalledWith('p', 'm', 5, { numPredict: 9 })
  })

  it('gives a large model longer, and leaves other limits alone', async () => {
    await modelJson('p', 'gemma4:12b-it-qat')
    expect(runOllamaJson.mock.calls[0][2]).toBe(120_000)
    await modelJson('p', 'llama3.2:3b')
    expect(runOllamaJson.mock.calls[1][2]).toBeUndefined()
    await modelJson('p', 'gemma4:12b-it-qat', 5)
    expect(runOllamaJson.mock.calls[2][2]).toBe(5)
  })

  it('scopes a cloud route to its own request, even when another runs concurrently', async () => {
    const route = { provider: provider('{"from":"cloud"}'), model: 'x' }
    const [a, b] = await Promise.all([withModelRequest(route, undefined, () => modelJson('p', 'm')), modelJson('p', 'm')])
    expect(a).toEqual({ from: 'cloud' })
    expect(b).toEqual({ from: 'local' })
    expect(usingCloud()).toBe(false)
  })

  it('stops at the next call once cancelled, and names an aborted call as cancelled', async () => {
    const ctrl = new AbortController()
    runOllamaJson.mockImplementation(async () => { ctrl.abort(); throw new Error('This operation was aborted') })
    await withModelRequest(null, ctrl.signal, async () => {
      await expect(modelJson('p', 'm')).rejects.toMatchObject({ code: 'CANCELLED' })
      await expect(modelJson('p', 'm')).rejects.toMatchObject({ code: 'CANCELLED' })
    })
    expect(runOllamaJson).toHaveBeenCalledTimes(1)
  })
})
