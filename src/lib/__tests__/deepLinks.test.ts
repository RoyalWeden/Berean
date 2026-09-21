import { describe, it, expect, vi } from 'vitest'
import { parseDeepLink, formatDeepLink, handleDeepLink, isDeepLink, describeDeepLink, type DeepLinkTarget } from '../deepLinks'

const target = (): DeepLinkTarget & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    openVerse: (r) => calls.push(`verse:${r.bookId}/${r.chapter}/${r.verse ?? ''}-${r.endVerse ?? ''}:${r.textId ?? ''}`),
    openNote: (id) => calls.push(`note:${id}`),
    openLexicon: (n) => calls.push(`lex:${n}`),
    openVideo: (id, t) => calls.push(`video:${id}@${t ?? ''}`),
    openPdf: (id, p) => { calls.push(`pdf:${id}/${p ?? ''}`) },
    openSearch: (q) => calls.push(`search:${q}`),
    openTrail: (id) => calls.push(`trail:${id}`),
  }
}

describe('deep links (berean://)', () => {
  it('parses every route form, including the legacy berean-pdf:// and the future https /berean/ path', () => {
    expect(parseDeepLink('berean://verse/Gen/1/1')).toEqual({ kind: 'verse', bookId: 'GEN', chapter: 1, verse: 1 })
    expect(parseDeepLink('berean://verse/Genesis/1/1-5?text=lxx')).toEqual({ kind: 'verse', bookId: 'GEN', chapter: 1, verse: 1, endVerse: 5, textId: 'lxx' })
    expect(parseDeepLink('berean://verse/Exo/20')).toEqual({ kind: 'verse', bookId: 'EXO', chapter: 20 })
    expect(parseDeepLink('berean://open?ref=Rev%2022%3A1-5')).toEqual({ kind: 'verse', bookId: 'REV', chapter: 22, verse: 1, endVerse: 5 })
    expect(parseDeepLink('berean://note/abc-123')).toEqual({ kind: 'note', noteId: 'abc-123' })
    expect(parseDeepLink('berean://lexicon/h7225')).toEqual({ kind: 'lexicon', strongsNum: 'H7225' })
    expect(parseDeepLink('berean://video/dQw4w9WgXcQ?t=754')).toEqual({ kind: 'video', videoId: 'dQw4w9WgXcQ', startTime: 754 })
    expect(parseDeepLink('berean://pdf/p1/7')).toEqual({ kind: 'pdf', pdfId: 'p1', page: 7 })
    expect(parseDeepLink('berean://pdf/p1?page=3')).toEqual({ kind: 'pdf', pdfId: 'p1', page: 3 })
    expect(parseDeepLink('berean-pdf://p1/12')).toEqual({ kind: 'pdf', pdfId: 'p1', page: 12 })
    expect(parseDeepLink('berean://search?q=in%20the%20beginning')).toEqual({ kind: 'search', query: 'in the beginning' })
    expect(parseDeepLink('berean://trail/t1')).toEqual({ kind: 'trail', trailSessionId: 't1' })
    expect(parseDeepLink('https://sitgmeat.com/berean/verse/Gen/1/1')).toEqual({ kind: 'verse', bookId: 'GEN', chapter: 1, verse: 1 })
  })

  it('rejects what it does not understand instead of guessing', () => {
    for (const bad of ['', 'https://example.com/x', 'berean://verse/NotABook/1', 'berean://verse/Gen', 'berean://lexicon/X1', 'berean://nothing/1', 'mailto:a@b', 'berean://video/'])
      expect(parseDeepLink(bad), bad).toBeNull()
    expect(isDeepLink('berean://note/1')).toBe(true)
    expect(isDeepLink('berean-pdf://p/1')).toBe(true)
    expect(isDeepLink('https://x/berean/note/1')).toBe(true)
    expect(isDeepLink('https://x/note/1')).toBe(false)
  })

  it('format ↔ parse round-trips every route', () => {
    const routes = [
      { kind: 'verse', bookId: 'GEN', chapter: 1, verse: 1, endVerse: 5, textId: 'kjva' },
      { kind: 'verse', bookId: 'PSA', chapter: 119 },
      { kind: 'note', noteId: 'n/1 ?' },
      { kind: 'lexicon', strongsNum: 'G3056' },
      { kind: 'video', videoId: 'abc', startTime: 12 },
      { kind: 'pdf', pdfId: 'p', page: 2 },
      { kind: 'search', query: 'love & mercy' },
      { kind: 'trail', trailSessionId: 't' },
    ] as const
    for (const r of routes) expect(parseDeepLink(formatDeepLink(r)), formatDeepLink(r)).toEqual(r)
    expect(describeDeepLink({ kind: 'verse', bookId: 'GEN', chapter: 1, verse: 1, endVerse: 3 })).toBe('Genesis 1:1-3')
  })

  it('routes to the target and reports non-links', () => {
    const t = target()
    expect(handleDeepLink('berean://verse/Gen/1/1?text=lxx', t)).toBe(true)
    expect(handleDeepLink('berean-pdf://p1/4', t)).toBe(true)
    expect(handleDeepLink('berean://video/v?t=3', t)).toBe(true)
    expect(handleDeepLink('https://youtube.com/watch?v=1', t)).toBe(false)
    expect(t.calls).toEqual(['verse:GEN/1/1-:lxx', 'pdf:p1/4', 'video:v@3'])
    const spy = vi.fn()
    handleDeepLink('berean://search?q=x', { ...t, openSearch: spy })
    expect(spy).toHaveBeenCalledWith('x')
  })
})
