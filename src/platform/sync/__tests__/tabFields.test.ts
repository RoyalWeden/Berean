import { describe, it, expect } from 'vitest'
import { splitTabState, mergeTabState, stableJson } from '../tabFields'
import type { BibleTabState, NoteTabState, TabState } from '../../../types'

describe('tab state split (sync vs local)', () => {
  it('bible: location + study config sync; scroll, pane sizes and targets do not', () => {
    const state: BibleTabState = {
      bookId: 'GEN', chapter: 1, verse: 3, translation: 'kjva', showStrongs: true, scrollPosition: 812,
      targetVerse: 9, targetVerseQuery: 'light', rightPanelOpen: true, rightPanelWidth: 380, rightPanelTab: 'notes',
      rightPanelNoteId: 'n1', rightPanelNoteCursor: 12, compareMode: true,
      compareColumns: [{ textId: 'lxx', bookId: 'GEN', chapter: 1, scrollPos: { verseNum: 4, frac: 0.2 } }],
      scriptureLayout: 'standard', searchScrollAnchor: { rowKey: 'k', offset: 3 },
    }
    const { sync, local } = splitTabState('bible', state)
    expect(sync).toEqual({
      bookId: 'GEN', chapter: 1, verse: 3, translation: 'kjva', showStrongs: true, compareMode: true,
      compareColumns: [{ textId: 'lxx', bookId: 'GEN', chapter: 1 }], rightPanelTab: 'notes', rightPanelNoteId: 'n1',
      scriptureLayout: 'standard',
    })
    expect(local).toEqual({
      compareColumns: [{ scrollPos: { verseNum: 4, frac: 0.2 } }], scrollPosition: 812, rightPanelOpen: true,
      rightPanelWidth: 380, rightPanelNoteCursor: 12, searchScrollAnchor: { rowKey: 'k', offset: 3 },
    })
    expect(sync).not.toHaveProperty('targetVerse')
    expect(local).not.toHaveProperty('targetVerse')
    const merged = mergeTabState('bible', sync, local) as BibleTabState
    expect(merged.compareColumns?.[0]).toEqual({ textId: 'lxx', bookId: 'GEN', chapter: 1, scrollPos: { verseNum: 4, frac: 0.2 } })
    expect(merged.scrollPosition).toBe(812)
    expect(merged.bookId).toBe('GEN')
  })

  it('note: homeView filters sync but preview selection stays local', () => {
    const state: NoteTabState = {
      noteId: 'abc', isNew: false, scrollTop: 40, cursorPos: 7,
      homeView: { noteSearch: 'x', noteSearchWordMode: 'all', noteFilter: 'f', statusFilter: 's', noteSort: 'date', viewMode: 'list', expandAll: false, previewNoteId: 'p', previewFolderId: null },
    }
    const { sync, local } = splitTabState('note', state)
    expect((sync.homeView as Record<string, unknown>).previewNoteId).toBeUndefined()
    expect((local.homeView as Record<string, unknown>).previewNoteId).toBe('p')
    expect(local.scrollTop).toBe(40)
    const merged = mergeTabState('note', sync, local) as NoteTabState
    expect(merged.homeView?.previewNoteId).toBe('p')
    expect(merged.homeView?.noteSearch).toBe('x')
    expect(merged.cursorPos).toBe(7)
  })

  it('search results are local (re-run on the other device) and the query syncs', () => {
    const { sync, local } = splitTabState('search', { query: 'love', results: [{ verseRef: 'x' } as never], scrollTop: 1 })
    expect(sync).toEqual({ query: 'love' })
    expect(Object.keys(local).sort()).toEqual(['results', 'scrollTop'])
  })

  it('compare columns without a scroll position leave no empty local shells, and merging local over synced keeps the columns', () => {
    const state = { bookId: 'DEU', chapter: 5, translation: 'KJVA', showStrongs: false, scrollPosition: 0, compareMode: true,
      compareColumns: [{ textId: 'kjva', bookId: 'DEU', chapter: 5 }, { textId: 'lxx', bookId: 'DEU', chapter: 5 }] } as unknown as TabState
    const { sync, local } = splitTabState('bible', state)
    expect(local).toEqual({ scrollPosition: 0 })
    expect((sync.compareColumns as unknown[]).length).toBe(2)
    // The startup/remote-apply path merges this device's local part over the synced rows:
    const merged = mergeTabState('bible', sync, { compareColumns: [{ scrollPos: { verseNum: 3, frac: 0 } }, {}], scrollPosition: 40 }) as unknown as Record<string, unknown>
    expect(merged.compareColumns).toEqual([{ textId: 'kjva', bookId: 'DEU', chapter: 5, scrollPos: { verseNum: 3, frac: 0 } }, { textId: 'lxx', bookId: 'DEU', chapter: 5 }])
  })

  it('stableJson is key-order independent and drops undefined', () => {
    expect(stableJson({ b: 1, a: { d: undefined, c: 2 } })).toBe(stableJson({ a: { c: 2 }, b: 1 }))
  })
})
