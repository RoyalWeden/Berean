/** SEP27-CAL-002 — the calendar's note-date source: dates with daily notes, no bodies needed. */
import { describe, it, expect, beforeEach } from 'vitest'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createNotesService } from '../notesService'

describe('notesService.getDailyDates', () => {
  let userDb: DatabaseAdapter
  let svc: ReturnType<typeof createNotesService>
  let clock = 1_700_000_000_000
  beforeEach(async () => {
    userDb = await migratedUserDb()
    svc = createNotesService(makeContext({ userDb, events: recordingEvents().events, now: () => clock++ }))
  })

  it('lists each date that has a daily note — ISO and legacy titles, journal type, one entry per date', async () => {
    await svc.create({ type: 'daily', title: 'Daily — 2026-09-26', content: 'a' })
    const long = await svc.create({ type: 'daily', title: 'Daily — 2026-09-26', content: 'a much longer entry' })
    await svc.create({ type: 'journal', title: 'Journal — January 9, 2026', content: 'x' })
    await svc.create({ type: 'general', title: 'Daily — 2026-09-01', content: '' })
    await svc.create({ type: 'general', title: 'Sermon notes', content: 'not a daily' })
    await svc.create({ type: 'verse', verseRef: 'GEN.1.1', content: 'verse' })
    const dates = await svc.getDailyDates()
    expect(dates.map((d) => d.dateKey)).toEqual(['2026-01-09', '2026-09-01', '2026-09-26'])
    // Several notes on one date → one dot, pointing at the fullest note.
    expect(dates.find((d) => d.dateKey === '2026-09-26')!.noteId).toBe(long.note.id)
  })

  it('ignores trashed notes', async () => {
    const n = await svc.create({ type: 'daily', title: 'Daily — 2026-09-20', content: 'x' })
    await svc.delete(n.note.id)
    expect((await svc.getDailyDates()).map((d) => d.dateKey)).not.toContain('2026-09-20')
  })
})
