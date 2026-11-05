import { describe, it, expect, vi } from 'vitest'
import { forCommentaryOff, researchWeb, type WebRequest } from '../webResearch'

const wiki = { query: { search: [{ title: 'Qumran', pageid: 1, snippet: 'a <b>site</b>' }] } }
const okRequest = () => vi.fn(async (url: string, _init?: { body?: string }) => ({ status: 200, json: async () => (url.includes('wikipedia') ? wiki : { hits: { hits: [] } }) }))
const base = { approved: false, broad: false, online: true }

describe('researchWeb', () => {
  it('off: no network, even when broad; a typed request gets the turn-it-on notice', async () => {
    const request = okRequest()
    expect(await researchWeb('verses about Qumran', { ...base, web: 'off', broad: true, request })).toEqual({ sources: [] })
    const asked = await researchWeb('search online for Qumran', { ...base, web: 'off', request })
    expect(asked.notice).toMatch(/turn it on in Settings/)
    expect(request).not.toHaveBeenCalled()
  })

  it('ask: offers when broad, searches once approved or typed', async () => {
    const request = okRequest()
    expect(await researchWeb('Qumran history', { ...base, web: 'ask', broad: true, request })).toEqual({ sources: [], offered: true })
    expect(await researchWeb('Qumran history', { ...base, web: 'ask', request })).toEqual({ sources: [] })
    expect(request).not.toHaveBeenCalled()
    expect((await researchWeb('Qumran history', { ...base, web: 'ask', approved: true, request })).sources).toHaveLength(1)
    expect((await researchWeb('look up Qumran on wikipedia', { ...base, web: 'ask', request })).sources).toHaveLength(1)
  })

  it('offline: nothing is sent', async () => {
    const request = okRequest()
    const res = await researchWeb('search online for Qumran', { ...base, web: 'ask', online: false, request })
    expect(res.sources).toEqual([])
    expect(res.notice).toMatch(/offline/i)
    expect(request).not.toHaveBeenCalled()
  })

  it('sends the search words only, never the rest of the question', async () => {
    const request = okRequest()
    await researchWeb('please search online for Qumran me@example.com 5551234567 my private note', { ...base, web: 'ask', approved: true, request })
    const sent = request.mock.calls.map(([url, init]) => `${url} ${init?.body ?? ''}`).join('\n')
    expect(sent).toContain('Qumran')
    expect(sent).not.toMatch(/example\.com|5551234567|please/)
  })

  it('a failed source does not drop the other', async () => {
    const request = vi.fn(async (url: string, _init?: { body?: string }) => {
      if (url.includes('sefaria')) throw new Error('network')
      return { status: 200, json: async () => wiki }
    })
    const res = await researchWeb('Qumran history', { ...base, web: 'ask', approved: true, request })
    expect(res.sources.map((s) => s.provider)).toEqual(['wikipedia'])
  })

  it('Commentary off removes the excerpt but keeps title, site, date and limitation', async () => {
    const res = await researchWeb('Qumran history', { ...base, web: 'ask', approved: true, request: okRequest() })
    expect(res.sources[0].excerpt).toBe('a site')
    const [card] = forCommentaryOff(res.sources)
    expect(card).toMatchObject({ excerpt: '', title: 'Qumran', site: 'Wikipedia' })
    expect(card.limitation).toBeTruthy()
    expect(card.retrievedAt).toBeTruthy()
  })
})
