import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Scenarios 21 and 22: the setting decides, a model never does, and only the search words go out.
const fetchMock = vi.fn()
let online = true
const dir = mkdtempSync(join(tmpdir(), 'berean-web-'))
vi.mock('electron', () => ({ app: { getPath: () => dir, getVersion: () => '1' }, net: { fetch: (...a: unknown[]) => fetchMock(...a), isOnline: () => online }, safeStorage: {} }))

import { registerAiProviderHandlers, webResearchFor } from '../aiProviders'

const handlers: Record<string, (e: unknown, ...a: unknown[]) => unknown> = {}
registerAiProviderHandlers({ handle: (c: string, f: (e: unknown, ...a: unknown[]) => unknown) => { handlers[c] = f } } as never)
const setWeb = (web: string) => handlers['aiProviders:setSettings'](null, { web })

const ok = (url: string) => ({ status: 200, json: async () => (url.includes('wikipedia') ? { query: { search: [{ title: 'Qumran', pageid: 1, snippet: 's' }] } } : { hits: { hits: [] } }) })
const plain = { approved: false, deepSearch: false }

describe('webResearchFor', () => {
  beforeEach(() => { fetchMock.mockReset(); fetchMock.mockImplementation(async (u: string) => ok(u)); online = true })

  it('off: no network, even for Deep Search; an explicit ask is told how to turn it on', async () => {
    setWeb('off')
    expect(await webResearchFor('verses about Qumran', { ...plain, deepSearch: true })).toEqual({ sources: [] })
    const asked = await webResearchFor('search online for Qumran', plain)
    expect(asked.notice).toMatch(/turn it on in Settings/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ask: offers instead of searching until the user approves', async () => {
    setWeb('ask')
    expect(await webResearchFor('Qumran history', { ...plain, deepSearch: true })).toEqual({ sources: [], offered: true })
    expect(fetchMock).not.toHaveBeenCalled()
    const res = await webResearchFor('Qumran history', { approved: true, deepSearch: false })
    expect(res.sources).toHaveLength(1)
    expect(res.notice).toContain('never your notes')
  })

  it('auto: only with Deep Search or a request, and never offline', async () => {
    setWeb('auto')
    await webResearchFor('Qumran history', plain)
    expect(fetchMock).not.toHaveBeenCalled()
    online = false
    expect((await webResearchFor('Qumran history', { ...plain, deepSearch: true })).sources).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
    online = true
    expect((await webResearchFor('Qumran history', { ...plain, deepSearch: true })).sources).toHaveLength(1)
  })

  it('sends only the search words, identifies the app and not the person, and survives a failed source', async () => {
    setWeb('auto')
    fetchMock.mockImplementation(async (u: string) => { if (u.includes('sefaria')) throw new Error('down'); return ok(u) })
    const res = await webResearchFor('search online for Qumran me@example.com', plain)
    expect(res.sources).toHaveLength(1)
    const sent = JSON.stringify(fetchMock.mock.calls)
    expect(sent).toContain('Qumran')
    expect(sent).not.toContain('example.com')
    expect(fetchMock.mock.calls[0][1].headers['user-agent']).toMatch(/^Berean\/1 \(https:/)
  })
})
