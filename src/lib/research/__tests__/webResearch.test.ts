import { describe, it, expect } from 'vitest'
import { cleanExcerpt, forCommentaryOff, parseSefaria, parseWikipedia, safeSourceUrl, wantsWeb, webQuery } from '../webResearch'

const at = '2026-11-04T00:00:00.000Z'

describe('webQuery', () => {
  it('keeps only content words', () => {
    expect(webQuery('please search online for the Dead Sea Scrolls')).toBe('Dead Sea Scrolls')
  })
  it('drops addresses, links and long numbers', () => {
    expect(webQuery('Qumran me@example.com https://x.y/z 5551234567')).toBe('Qumran')
  })
  it('has nothing to send for an empty question', () => {
    expect(webQuery('what is the')).toBeNull()
  })
})

describe('wantsWeb', () => {
  it('recognises an explicit request only', () => {
    for (const q of ['search online for Qumran', 'look this up on the web', 'what does wikipedia say about Qumran', 'check Sefaria for Shabbat']) expect(wantsWeb(q)).toBe(true)
    for (const q of ['verses about the sabbath', 'a spider web', 'John 3:16', 'search the scriptures']) expect(wantsWeb(q)).toBe(false)
  })
})

describe('untrusted content', () => {
  it('strips markup and bounds length', () => {
    expect(cleanExcerpt('<script>alert(1)</script><b>Hi</b> &amp; bye')).toBe('alert(1)Hi & bye')
    expect(cleanExcerpt('x'.repeat(999))).toHaveLength(240)
  })
  it('allows only https links to the hosts Berean asked', () => {
    expect(safeSourceUrl('https://en.wikipedia.org/?curid=1')).toBeTruthy()
    for (const u of ['http://en.wikipedia.org/', 'https://evil.example/', 'javascript:alert(1)', 'not a url']) expect(safeSourceUrl(u)).toBeNull()
  })
})

describe('parsers', () => {
  it('reads Wikipedia search results', () => {
    const [s] = parseWikipedia({ query: { search: [{ title: 'Dead Sea Scrolls', pageid: 77712, snippet: 'The <span>Dead</span> Sea' }] } }, at)
    expect(s).toMatchObject({ provider: 'wikipedia', title: 'Dead Sea Scrolls', url: 'https://en.wikipedia.org/?curid=77712', excerpt: 'The Dead Sea', retrievedAt: at })
    expect(s.limitation).toMatch(/Secondary source/)
  })
  it('reads Sefaria search results into a working link', () => {
    const [s] = parseSefaria({ hits: { hits: [{ _id: 'Sifrei Bamidbar 144:2 (Sifrei by Rabbi Shraga Silverstein [en])', highlight: { exact: ['the <b>Sabbath</b>'] } }] } }, at)
    expect(s).toMatchObject({ title: 'Sifrei Bamidbar 144:2', url: 'https://www.sefaria.org/Sifrei_Bamidbar.144.2', excerpt: 'the Sabbath' })
  })
  it('returns nothing for anything unexpected', () => {
    for (const bad of [null, 'x', {}, { query: {} }, { hits: {} }]) { expect(parseWikipedia(bad, at)).toEqual([]); expect(parseSefaria(bad, at)).toEqual([]) }
  })
  it('removes excerpts for Commentary off', () => {
    expect(forCommentaryOff(parseWikipedia({ query: { search: [{ title: 'T', pageid: 1, snippet: 'text' }] } }, at))[0]).toMatchObject({ title: 'T', excerpt: '' })
  })
})
