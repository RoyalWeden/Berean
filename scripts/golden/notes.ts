/**
 * Notes read-path golden (M3-04 / M6 Notes Space): createNotesService reads over synthetic note rows inserted
 * into a migrated in-memory berean.db (the same rows are inserted by the Swift test). FTS via notes_fts triggers.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createNotesService } from '../../src/platform/services/notesService'
import { migratedUserDb } from '../../src/platform/db/__tests__/testDb'
import { consoleLogger, createServiceEvents } from '../../src/platform/services/context'

const ROOT = resolve(__dirname, '../..')
const base = { type: 'general', title: '', content: '', verse_ref: null, color: 'blue', icon: null, status: null, tags: '[]', imported_at: null, folder_id: null,
  text_id: 'kjva', idiom_term: null, idiom_meaning: null, idiom_aliases: null, idiom_auto_variants: 0, idiom_data: null, deleted_at: null, pinned: 0, ai_excluded: 0 }
export const NOTE_ROWS: Array<Record<string, unknown>> = [
  { id: 'n01', type: 'verse', title: 'Creation', content: 'In the beginning Yehovah created. See [[Exod 20:11]].', verse_ref: 'GEN.1.1', created_at: 1000, updated_at: 5000, tags: '["creation","torah"]' },
  { id: 'n02', type: 'verse', title: 'Light', content: 'Let there be light — seven days', verse_ref: 'GEN.1.3', created_at: 1100, updated_at: 4000, color: 'yellow' },
  { id: 'n03', type: 'verse', title: 'LXX light', content: 'φῶς — Septuagint reading', verse_ref: 'GEN.1.3', text_id: 'lxx', created_at: 1200, updated_at: 4100 },
  { id: 'n04', type: 'verse', title: 'Chapter note', content: 'Whole chapter overview', verse_ref: 'GEN.1', created_at: 1300, updated_at: 3000 },
  { id: 'n05', type: 'verse', title: 'Range', content: 'sub range', verse_ref: 'GEN.1.2.extra', created_at: 1400, updated_at: 3100 },
  { id: 'n06', type: 'verse', title: 'Psalm 10 KJV', content: 'Why standest thou afar off', verse_ref: 'PSA.10.1', created_at: 1500, updated_at: 3200 },
  { id: 'n07', type: 'verse', title: 'Psalm 9 LXX', content: 'LXX nine merges ten', verse_ref: 'PSA.9.22', text_id: 'lxx', created_at: 1600, updated_at: 3300 },
  { id: 'n08', type: 'general', title: 'Grace study', content: 'Grace is divine influence upon the heart. Titus 2:11-14', created_at: 1700, updated_at: 9000, folder_id: 'f1', pinned: 1, tags: '["grace"]' },
  { id: 'n09', type: 'general', title: '', content: 'An untitled thought about the sabbath', created_at: 1800, updated_at: 8000 },
  { id: 'n10', type: 'general', title: null, content: '', created_at: 1900, updated_at: 7000 },
  { id: 'n11', type: 'daily', title: 'Daily — 2026-11-07', content: 'Read Genesis 1', created_at: 2000, updated_at: 7500 },
  { id: 'n12', type: 'general', title: 'Daily — January 9, 2026', content: 'old style daily title', created_at: 2100, updated_at: 7400 },
  { id: 'n13', type: 'daily', title: 'Daily — 2026-11-07', content: 'a longer duplicate daily note for the same date', created_at: 2200, updated_at: 7300 },
  { id: 'n14', type: 'general', title: 'Deleted', content: 'gone', created_at: 2300, updated_at: 7200, deleted_at: 9500 },
  { id: 'n15', type: 'general', title: 'Deleted earlier', content: 'gone too', created_at: 2400, updated_at: 7100, deleted_at: 9400 },
  { id: 'n16', type: 'idiom', title: 'Idiom', content: 'eye', created_at: 2500, updated_at: 7000, idiom_term: 'evil eye', idiom_meaning: 'stingy', idiom_aliases: '["bad eye"]', idiom_auto_variants: 1, idiom_data: '{"x":1}', icon: '👁', status: 'done', imported_at: 1234 },
  { id: 'n17', type: 'verse', title: 'Enoch', content: 'Watchers', verse_ref: 'ENO.6.1', text_id: 'enoch', created_at: 2600, updated_at: 6900 },
  { id: 'n18', type: 'verse', title: 'Null tid', content: 'text_id null counts as kjva', verse_ref: 'GEN.1.10', text_id: null, created_at: 2700, updated_at: 6800 },
  { id: 'n19', type: 'general', title: 'Genesis 1:1-3 study', content: 'verse-shaped title', created_at: 2800, updated_at: 6700, ai_excluded: 1 },
].map((r) => ({ ...base, ...r }))
export const FOLDER_ROWS = [
  { id: 'f1', name: 'studies', parent_id: null, created_at: 100, ai_excluded: 0 },
  { id: 'f2', name: 'Archive', parent_id: null, created_at: 101, ai_excluded: 1 },
  { id: 'f3', name: 'b child', parent_id: 'f1', created_at: 102, ai_excluded: 0 },
]

export async function buildNotesGolden(): Promise<{ name: string; data: unknown }> {
  const db = await migratedUserDb()
  for (const f of FOLDER_ROWS) await db.run('INSERT INTO note_folders (id, name, parent_id, created_at, ai_excluded) VALUES (?, ?, ?, ?, ?)', [f.id, f.name, f.parent_id, f.created_at, f.ai_excluded])
  const cols = Object.keys(NOTE_ROWS[0]).concat(['created_at', 'updated_at']).filter((v, i, a) => a.indexOf(v) === i)
  for (const r of NOTE_ROWS) await db.run(`INSERT INTO notes (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => (r[c] ?? null) as never))
  const svc = createNotesService({ userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('unused') }, dataDb: async () => null,
    events: createServiceEvents(), now: () => 10_000, uuid: () => 'u', isDev: true, log: consoleLogger })
  const searches: unknown[] = []
  for (const q of ['light', 'grace divine', 'untitled', 'Untitled sabbath', 'seven', '7', 'Genesis 1:1-3', 'gone', 'φῶς', '"quoted"', '', 'xyz', 'eye stingy'])
    for (const mode of ['all', 'any', 'phrase'] as const) searches.push({ query: q, mode, results: (await svc.search(q, 20, mode)).map((n) => n.id) })
  const out = {
    all: await svc.getAll(), page: (await svc.getAll(3, 2)).map((n) => n.id), one: await svc.getOne('n16'), missing: await svc.getOne('nope'),
    folders: await svc.folderList(), trash: (await svc.listTrash()).map((n) => n.id), daily: await svc.getDailyDates(), searches,
    byVerse: await Promise.all([['GEN.1.3', 'kjva'], ['GEN.1.3', 'lxx'], ['PSA.10.1', 'lxx'], ['PSA.9.22', 'kjva'], ['ENO.6.1', 'enoch'], ['GEN.1.1', 'kjv']]
      .map(async ([r, t]) => ({ ref: r, textId: t, ids: (await svc.getByVerse(r, t)).map((n) => n.id) }))),
    byChapter: await Promise.all([['GEN', 1, 'kjva'], ['GEN', 1, 'lxx'], ['PSA', 9, 'lxx'], ['PSA', 10, 'kjva'], ['ENO', 6, 'enoch'], ['EXO', 1, 'kjva']]
      .map(async ([b, c, t]) => ({ bookId: b, chapter: c, textId: t, ids: (await svc.getByChapter(b as string, c as number, t as string)).map((n) => n.id),
        counts: await svc.getChapterCounts(b as string, c as number, t as string) }))),
  }
  await db.close()

  // Write script on a fresh library: create (incl. daily-date ids, default status, idempotent id), update, pin,
  // folder ops, soft delete, restore (folder gone → root). Fake clock + sequential ids.
  const wdb = await migratedUserDb()
  let clock = 50_000, n = 0
  const events: unknown[] = []
  const ev = createServiceEvents()
  ev.on('data:changed', (c) => events.push({ entity: c.entity, id: c.id ?? null, op: c.op }))
  const w = createNotesService({ userDb: wdb, textDb: async () => null, lexiconDb: async () => { throw new Error('unused') }, dataDb: async () => null,
    events: ev, now: () => clock, uuid: () => `id${++n}`, isDev: true, log: consoleLogger })
  const results: unknown[] = []
  results.push(await w.create({ title: 'First', content: 'Hello', tags: ['a'] }))
  clock += 10; results.push(await w.create({ type: 'daily', title: 'Daily — 2026-11-07', content: 'today' }))
  clock += 10; results.push(await w.create({ type: 'daily', title: 'Daily — 2026-11-07', content: 'second same day' }))
  clock += 10; results.push(await w.create({ id: 'share-1', title: 'Shared', content: 'x' }))
  clock += 10; results.push(await w.create({ id: 'share-1', title: 'Shared again', content: 'y' }))
  await wdb.run("INSERT INTO settings (key, value) VALUES ('defaultNoteStatus', '\"todo\"') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
  clock += 10; results.push(await w.create({ type: 'verse', title: 'Gen 1:1', verseRef: 'GEN.1.1', textId: 'lxx', color: 'green', idiomAliases: ['x'], idiomAutoVariants: true }))
  clock += 10; results.push(await w.create({ title: 'No status', status: null }))
  clock += 10; results.push(await w.update('id1', { title: 'First (edited)', content: 'Hello world', icon: '', status: 'done', tags: [], idiomAliases: [], idiomData: { k: 1 } }))
  clock += 10; results.push(await w.update('missing', { title: 'x' }))
  const folder = await w.folderCreate('Studies'); clock += 10; await w.folderCreate('', folder.id)
  await w.setFolder('id1', folder.id); await w.setPinned('id1', true); await w.folderRename(folder.id, 'Bible Studies')
  clock += 10; await w.delete('id1'); clock += 10
  await wdb.run('DELETE FROM note_folders WHERE id = ?', [folder.id])
  results.push(await w.restore('id1')); results.push(await w.restore('nope'))
  const writes = { results: JSON.parse(JSON.stringify(results)), events, notes: await wdb.all('SELECT * FROM notes ORDER BY id'), folders: await wdb.all('SELECT * FROM note_folders ORDER BY id') }
  await wdb.close()
  return {
    name: 'notes',
    data: {
      format: 1, generator: 'scripts/golden/notes.ts',
      sources: Object.fromEntries(['src/platform/services/notesService.ts', 'src/lib/noteUtils.ts', 'scripts/golden/notes.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      rows: NOTE_ROWS, folderRows: FOLDER_ROWS, ...out, writes,
    },
  }
}
