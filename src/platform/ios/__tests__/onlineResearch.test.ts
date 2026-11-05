// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}) }))
vi.mock('@capacitor/browser', () => ({ Browser: { open: async () => {} } }))
vi.mock('@capacitor/filesystem', () => ({ Filesystem: {}, Directory: { Library: 'LIBRARY' }, Encoding: { UTF8: 'utf8' } }))

import { migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createServices } from '../../services'
import { consoleLogger, defaultUuid, type ServiceContext } from '../../services/context'
import { installIosBridgeExtras } from '../bridgeExtras'
import { setOnlineResearch } from '../onlineResearchSetting'
import * as iosServices from '../services'

const fetchMock = vi.fn()
type Query = (q: string, o?: { webApproved?: boolean }) => Promise<{ external?: Array<{ excerpt: string; title: string }>; webOffered?: boolean; providerNotice?: string }>
let query: Query

beforeEach(async () => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) => (url.includes('wikipedia')
    ? { status: 200, json: async () => ({ query: { search: [{ title: 'Qumran', pageid: 1, snippet: 'an excerpt' }] } }) }
    : { status: 500, json: async () => ({}) }))
  vi.stubGlobal('fetch', fetchMock)
  setOnlineResearch('off')
  const db = await migratedUserDb('web')
  const ctx: ServiceContext = { userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('n/a') }, dataDb: async () => null, events: recordingEvents().events, now: () => Date.now(), uuid: defaultUuid, isDev: true, log: consoleLogger }
  vi.spyOn(iosServices, 'iosServiceContext').mockReturnValue(ctx)
  installIosBridgeExtras(createServices(ctx), '0.0.0')
  query = (window as unknown as { aiLookup: { query: Query } }).aiLookup.query
})

describe('iPhone online research', () => {
  it('Off: no request, no offer', async () => {
    const res = await query('Qumran community history')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.webOffered).toBeUndefined()
  })

  it('Off: a typed request gets the turn-it-on notice and no request', async () => {
    const res = await query('search wikipedia for Qumran')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(res.providerNotice).toMatch(/Settings → Ask Berean/)
  })

  it('Ask: the keyword fallback offers; approving searches with the words only, no excerpt, failed source survives', async () => {
    setOnlineResearch('ask')
    expect((await query('Qumran community history')).webOffered).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    const res = await query('Qumran community history', { webApproved: true })
    expect(res.external).toEqual([expect.objectContaining({ title: 'Qumran', excerpt: '' })])
    const urls = fetchMock.mock.calls.map((c) => String(c[0]) + String((c[1] as { body?: string }).body ?? ''))
    expect(urls.some((u) => u.includes('Qumran'))).toBe(true)
  })
})
