import { describe, it, expect } from 'vitest'
import { searchResultActions, buildSearchPreview, samePreview, SEARCH_PREVIEW_LINES } from '../search/resultActions'

const ids = (k: Parameters<typeof searchResultActions>[0], o?: { canShare?: boolean }) => searchResultActions(k, o).map((a) => a.id)

describe('searchResultActions', () => {
  it('Scripture hits get the verse-sheet vocabulary, Highlight as a submenu', () => {
    expect(ids('scripture')).toEqual(['open', 'open-new-tab', 'copy-ref', 'copy-verse', 'share', 'add-note', 'highlight', 'cancel'])
    expect(searchResultActions('scripture').find((a) => a.id === 'highlight')?.submenu).toBe(true)
  })
  it('Notes: open / new tab / copy title / share', () => {
    expect(ids('note')).toEqual(['open', 'open-new-tab', 'copy-title', 'share', 'cancel'])
  })
  it('Lexicon: open / lexicon tab / copy number — no share, note or highlight', () => {
    expect(ids('lexicon')).toEqual(['open', 'open-lexicon-tab', 'copy-strongs', 'cancel'])
  })
  it('Recent queries: search / new tab / copy', () => {
    expect(ids('recent')).toEqual(['open', 'search-new-tab', 'copy-query', 'cancel'])
  })
  it('drops Share when sharing is unavailable; Cancel is always last', () => {
    expect(ids('scripture', { canShare: false })).not.toContain('share')
    for (const k of ['scripture', 'note', 'lexicon', 'recent'] as const) expect(ids(k).at(-1)).toBe('cancel')
  })
  it('labels are unique within each set', () => {
    for (const k of ['scripture', 'note', 'lexicon', 'recent'] as const) {
      const labels = searchResultActions(k).map((a) => a.label)
      expect(new Set(labels).size).toBe(labels.length)
    }
  })
})

describe('buildSearchPreview', () => {
  it('keeps the first few lines, strips Strong\'s tags and clips long snippets', () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({ ref: `Genesis 1:${i + 1}`, text: `In{H7225} the   beginning ${'word '.repeat(40)}` }))
    const p = buildSearchPreview(' beginning ', 42, rows)
    expect(p.query).toBe('beginning')
    expect(p.total).toBe(42)
    expect(p.lines).toHaveLength(SEARCH_PREVIEW_LINES)
    expect(p.lines[0].snippet.startsWith('In the beginning')).toBe(true)
    expect(p.lines[0].snippet.length).toBeLessThanOrEqual(90)
    expect(p.lines[0].snippet.endsWith('…')).toBe(true)
  })
  it('samePreview compares by value (avoids redundant tab-state writes)', () => {
    const a = buildSearchPreview('love', 2, [{ ref: 'John 3:16', text: 'For God so loved' }])
    expect(samePreview(a, buildSearchPreview('love', 2, [{ ref: 'John 3:16', text: 'For God so loved' }]))).toBe(true)
    expect(samePreview(a, buildSearchPreview('love', 3, [{ ref: 'John 3:16', text: 'For God so loved' }]))).toBe(false)
    expect(samePreview(null, null)).toBe(true)
    expect(samePreview(a, null)).toBe(false)
  })
})
