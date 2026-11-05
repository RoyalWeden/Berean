import { describe, it, expect, vi, beforeEach } from 'vitest'

const fetchMock = vi.fn()
vi.mock('electron', () => ({ net: { fetch: (...a: unknown[]) => fetchMock(...a) } }))

const reply = (body: unknown) => ({ ok: true, json: async () => body })
const sent = (i: number) => JSON.parse(fetchMock.mock.calls[i][1].body) as { think?: boolean }

describe('runOllamaJson reply handling', () => {
  let runOllamaJson: typeof import('../ollama').runOllamaJson
  beforeEach(async () => {
    fetchMock.mockReset()
    ;({ runOllamaJson } = await import('../ollama'))
  })

  it('sends think:false to known thinking families in one request', async () => {
    fetchMock.mockResolvedValue(reply({ response: '{"a":1}' }))
    expect(await runOllamaJson('p', 'qwen3.5:4b-q4_K_M')).toEqual({ a: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(sent(0).think).toBe(false)
  })

  it('retries once with thinking off when an unknown family spends its budget thinking', async () => {
    fetchMock.mockResolvedValueOnce(reply({ response: '', thinking: 'hmm', done_reason: 'length' })).mockResolvedValueOnce(reply({ response: '{"a":1}' }))
    expect(await runOllamaJson('p', 'newmodel:1b')).toEqual({ a: 1 })
    expect(sent(0).think).toBeUndefined()
    expect(sent(1).think).toBe(false)
  })

  it('does not loop: a second empty reply is a typed failure', async () => {
    fetchMock.mockResolvedValue(reply({ response: '', thinking: 'hmm', done_reason: 'length' }))
    await expect(runOllamaJson('p', 'newmodel:1b')).rejects.toMatchObject({ code: 'INVALID_STRUCTURED_OUTPUT', message: expect.stringContaining('output budget') })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('treats an empty object as a valid reply, and truncated JSON as malformed', async () => {
    fetchMock.mockResolvedValueOnce(reply({ response: '{}' }))
    expect(await runOllamaJson('p', 'llama3.1:latest')).toEqual({})
    fetchMock.mockResolvedValueOnce(reply({ response: '{"a":', done_reason: 'length' }))
    await expect(runOllamaJson('p', 'llama3.1:latest')).rejects.toMatchObject({ code: 'INVALID_STRUCTURED_OUTPUT' })
  })
})
