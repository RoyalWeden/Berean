import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getChapterNotesShared, searchNotesShared, getNotesShared,
  getLexiconEntryShared, getTSKeForChapterShared,
  __resetPanelDataCache,
} from '../panelDataCache'

const notes = {
  getChapterNotes: vi.fn(),
  searchNotes: vi.fn(),
  getNotes: vi.fn(),
}
const lexicon = { getEntry: vi.fn() }
const crossrefs = { getTSKeForChapter: vi.fn() }

beforeEach(() => {
  __resetPanelDataCache()
  vi.clearAllMocks()
  notes.getChapterNotes.mockResolvedValue([{ id: 'n1' }])
  notes.searchNotes.mockResolvedValue([{ id: 'n2' }])
  notes.getNotes.mockResolvedValue([{ id: 'n3' }])
  lexicon.getEntry.mockResolvedValue({ strongsNum: 'H7225' })
  crossrefs.getTSKeForChapter.mockResolvedValue({ verseRefs: [] })
  ;(globalThis as any).window = { notes, lexicon, crossrefs }
})

describe('panelDataCache — note data', () => {
  it('shares one IPC call between two callers asking for the same chapter', async () => {
    const a = getChapterNotesShared('GEN', 1, 0)
    const b = getChapterNotesShared('GEN', 1, 0)
    expect(a).toBe(b)
    expect(notes.getChapterNotes).toHaveBeenCalledTimes(1)
    expect(await b).toEqual([{ id: 'n1' }])
  })

  it('does not share between different chapters', async () => {
    await getChapterNotesShared('GEN', 1, 0)
    await getChapterNotesShared('GEN', 2, 0)
    expect(notes.getChapterNotes).toHaveBeenCalledTimes(2)
  })

  it('refetches after the note change token bumps (no stale data post-edit)', async () => {
    await getChapterNotesShared('GEN', 1, 0)
    await getChapterNotesShared('GEN', 1, 1)
    expect(notes.getChapterNotes).toHaveBeenCalledTimes(2)
  })

  it('serves both slots from the single post-bump fetch', async () => {
    await getChapterNotesShared('GEN', 1, 0)
    const a = getChapterNotesShared('GEN', 1, 1)
    const b = getChapterNotesShared('GEN', 1, 1)
    expect(a).toBe(b)
    expect(notes.getChapterNotes).toHaveBeenCalledTimes(2)
  })

  it('expires an entry once the short TTL has elapsed', async () => {
    const now = Date.now()
    const spy = vi.spyOn(Date, 'now')
    spy.mockReturnValue(now)
    await getChapterNotesShared('GEN', 1, 0)
    spy.mockReturnValue(now + 10_000)
    await getChapterNotesShared('GEN', 1, 0)
    expect(notes.getChapterNotes).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })

  it('does not remember a failed fetch', async () => {
    notes.getChapterNotes.mockRejectedValueOnce(new Error('boom'))
    await getChapterNotesShared('GEN', 1, 0).catch(() => {})
    await getChapterNotesShared('GEN', 1, 0)
    expect(notes.getChapterNotes).toHaveBeenCalledTimes(2)
  })

  it('keys searches by query and limit', async () => {
    await searchNotesShared('Genesis', 300, 0)
    await searchNotesShared('Genesis', 300, 0)
    await searchNotesShared('Genesis', 80, 0)
    expect(notes.searchNotes).toHaveBeenCalledTimes(2)
  })

  it('dedupes the all-notes list fetch', async () => {
    await getNotesShared(500, 0, 0)
    await getNotesShared(500, 0, 0)
    expect(notes.getNotes).toHaveBeenCalledTimes(1)
  })
})

describe('panelDataCache — immutable database data', () => {
  it('dedupes lexicon entry lookups', async () => {
    const a = getLexiconEntryShared('H7225')
    const b = getLexiconEntryShared('H7225')
    expect(a).toBe(b)
    expect(lexicon.getEntry).toHaveBeenCalledTimes(1)
  })

  it('dedupes chapter cross-ref lookups but not across chapters', async () => {
    await getTSKeForChapterShared('GEN', 1)
    await getTSKeForChapterShared('GEN', 1)
    await getTSKeForChapterShared('GEN', 2)
    expect(crossrefs.getTSKeForChapter).toHaveBeenCalledTimes(2)
  })
})
