import { describe, it, expect, beforeEach } from 'vitest'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createNotesService } from '../notesService'

describe('notesService', () => {
  let clock: number
  let userDb: DatabaseAdapter
  let svc: ReturnType<typeof createNotesService>
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    clock = 1_700_000_000_000
    userDb = await migratedUserDb()
    const rec = recordingEvents()
    changes = rec.changes
    svc = createNotesService(makeContext({ userDb, events: rec.events, now: () => clock++ }))
  })

  // ── create ──────────────────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a verse note with verseRef + textId', async () => {
      const res = await svc.create({ type: 'verse', verseRef: 'GEN.1.1', textId: 'lxx', content: 'In the beginning...' })
      expect(res.success).toBe(true)
      expect(res.note).toMatchObject({
        type: 'verse', verseRef: 'GEN.1.1', textId: 'lxx', content: 'In the beginning...',
        color: 'blue', tags: [],
      })
      expect(changes).toEqual([{ entity: 'note', id: res.note.id, op: 'upsert' }])
    })

    it('creates a general note (no verseRef)', async () => {
      const res = await svc.create({ type: 'general', title: 'My Title', content: 'body' })
      expect(res.note).toMatchObject({ type: 'general', title: 'My Title', content: 'body', verseRef: null, textId: 'kjva' })
    })

    it('creates an idiom note with idiom_* fields', async () => {
      const res = await svc.create({
        type: 'idiom', title: 'Sleep with fathers', idiomTerm: 'slept with his fathers',
        idiomMeaning: 'died', idiomAliases: ['slept with fathers'], idiomAutoVariants: true,
      })
      expect(res.note).toMatchObject({
        type: 'idiom',
        idiomTerm: 'slept with his fathers',
        idiomMeaning: 'died',
        idiomAliases: ['slept with fathers'],
        idiomAutoVariants: true,
      })
    })

    it('defaults color to blue and tags to []', async () => {
      const res = await svc.create({})
      expect(res.note.color).toBe('blue')
      expect(res.note.tags).toEqual([])
      // No `defaultNoteStatus` setting is seeded by the migrations, so status falls back
      // through 'none' -> null -> undefined (rowToNote's `row.status ?? undefined`).
      expect(res.note.status).toBeUndefined()
    })
  })

  // ── update ──────────────────────────────────────────────────────────────────
  describe('update', () => {
    it('applies partial updates and bumps updated_at', async () => {
      const { note } = await svc.create({ title: 'Original', content: 'a', color: 'blue' })
      const createdAt = note.updatedAt
      const res = await svc.update(note.id, { title: 'Changed' })
      expect(res).toEqual({ success: true })
      const after = await svc.getOne(note.id)
      expect(after?.title).toBe('Changed')
      expect(after?.content).toBe('a') // untouched field preserved
      expect(after!.updatedAt).toBeGreaterThan(createdAt)
    })

    it('updates idiom fields', async () => {
      const { note } = await svc.create({ type: 'idiom', idiomTerm: 'term1' })
      await svc.update(note.id, { idiomTerm: 'term2', idiomMeaning: 'meaning', idiomAliases: ['a1'], idiomAutoVariants: true })
      const after = await svc.getOne(note.id)
      expect(after).toMatchObject({ idiomTerm: 'term2', idiomMeaning: 'meaning', idiomAliases: ['a1'], idiomAutoVariants: true })
    })

    it('returns an error for a missing note', async () => {
      expect(await svc.update('nope', { title: 'x' })).toEqual({ success: false, error: 'Note not found' })
    })
  })

  // ── listIdioms ──────────────────────────────────────────────────────────────
  it('listIdioms returns idiom notes ordered by term (case-insensitive), excluding trashed', async () => {
    await svc.create({ type: 'idiom', idiomTerm: 'banana idiom', idiomMeaning: 'm1' })
    const apple = await svc.create({ type: 'idiom', idiomTerm: 'apple idiom', idiomMeaning: 'm2' })
    const trashed = await svc.create({ type: 'idiom', idiomTerm: 'cherry idiom', idiomMeaning: 'm3' })
    await svc.create({ type: 'general', title: 'not an idiom' })
    await svc.delete(trashed.note.id)

    const idioms = await svc.listIdioms()
    expect(idioms.map((i) => i.term)).toEqual(['apple idiom', 'banana idiom'])
    expect(idioms.find((i) => i.id === apple.note.id)).toMatchObject({ meaning: 'm2', aliases: [], autoVariants: false })
  })

  // ── delete -> listTrash -> restore ──────────────────────────────────────────
  describe('trash lifecycle', () => {
    it('delete soft-deletes, listTrash shows it, restore undoes it', async () => {
      const { note } = await svc.create({ title: 'Trash me', content: 'x' })
      expect(await svc.delete(note.id)).toEqual({ success: true })
      expect(await svc.getOne(note.id)).toMatchObject({ deletedAt: expect.any(Number) })

      const trash = await svc.listTrash()
      expect(trash.map((n) => n.id)).toEqual([note.id])

      expect(await svc.restore(note.id)).toEqual({ success: true })
      expect((await svc.listTrash())).toEqual([])
      expect((await svc.getOne(note.id))?.deletedAt).toBeUndefined()
    })

    it('restore falls back to folder_id NULL when the note\'s folder was hard-deleted via folderDeleteDeep', async () => {
      const folder = await svc.folderCreate('Temp Folder')
      const { note } = await svc.create({ title: 'In folder', folderId: folder.id })
      // Soft-delete the note FIRST — folderDeleteDeep only touches notes with deleted_at IS NULL,
      // so this note is left with folder_id still pointing at `folder` even after the folder
      // itself is hard-deleted below.
      await svc.delete(note.id)
      await svc.folderDeleteDeep(folder.id!)

      expect(await svc.restore(note.id)).toEqual({ success: true })
      const restored = await svc.getOne(note.id)
      expect(restored?.folderId).toBeNull()
      expect(restored?.deletedAt).toBeUndefined()
    })

    it('restore returns an error for a missing note', async () => {
      expect(await svc.restore('nope')).toEqual({ success: false, error: 'Note not found' })
    })
  })

  // ── purgeTrashItem ──────────────────────────────────────────────────────────
  describe('purgeTrashItem', () => {
    it('refuses to purge a live (non-trashed) note', async () => {
      const { note } = await svc.create({ title: 'Live' })
      expect(await svc.purgeTrashItem(note.id)).toEqual({ success: false, error: 'Note is not in trash' })
      expect(await svc.getOne(note.id)).not.toBeNull()
    })

    it('permanently deletes a trashed note and its versions/collapse rows', async () => {
      const { note } = await svc.create({ title: 'Doomed', content: 'v1' })
      await svc.createVersion(note.id, 'Doomed', 'v1')
      await svc.setHeadingCollapsed(note.id, 'h1', true)
      await svc.setThreadCollapsed(note.id, 't1', true)
      await svc.delete(note.id)

      expect(await svc.purgeTrashItem(note.id)).toEqual({ success: true })
      expect(await svc.getOne(note.id)).toBeNull()
      expect(await svc.getVersions(note.id)).toEqual([])
      expect(await svc.getCollapsedHeadings(note.id)).toEqual([])
      expect(await svc.getCollapsedThreads(note.id)).toEqual([])
    })
  })

  // ── emptyTrash ──────────────────────────────────────────────────────────────
  it('emptyTrash purges every trashed note and clears their note_versions rows', async () => {
    const a = await svc.create({ title: 'A' })
    const b = await svc.create({ title: 'B' })
    const live = await svc.create({ title: 'Live' })
    await svc.createVersion(a.note.id, 'A', 'v1')
    await svc.delete(a.note.id)
    await svc.delete(b.note.id)

    const res = await svc.emptyTrash()
    expect(res.success).toBe(true)
    expect(new Set(res.purged)).toEqual(new Set([a.note.id, b.note.id]))
    expect(await svc.listTrash()).toEqual([])
    expect(await svc.getOne(live.note.id)).not.toBeNull()
    expect(await userDb.all('SELECT * FROM note_versions WHERE note_id = ?', [a.note.id])).toEqual([])
  })

  // ── folders ─────────────────────────────────────────────────────────────────
  describe('folders', () => {
    it('folderList/Create/Rename/Delete (shallow — reparents children, moves notes to root)', async () => {
      const parent = await svc.folderCreate('Parent')
      const child = await svc.folderCreate('Child', parent.id)
      const { note } = await svc.create({ title: 'In child', folderId: child.id })

      expect((await svc.folderList()).map((f) => f.name)).toEqual(['Child', 'Parent'])

      await svc.folderRename(child.id!, 'Renamed Child')
      expect((await svc.folderList()).find((f) => f.id === child.id)?.name).toBe('Renamed Child')

      await svc.folderDelete(child.id!)
      const remaining = await svc.folderList()
      expect(remaining.map((f) => f.id)).toEqual([parent.id])
      expect((await svc.getOne(note.id))?.folderId).toBeNull() // note moved to root, not deleted
    })

    it('folderDelete reparents grandchildren to the deleted folder\'s own parent', async () => {
      const grandparent = await svc.folderCreate('Grandparent')
      const parent = await svc.folderCreate('Parent', grandparent.id)
      const child = await svc.folderCreate('Child', parent.id)

      await svc.folderDelete(parent.id!)
      const list = await svc.folderList()
      expect(list.find((f) => f.id === child.id)?.parentId).toBe(grandparent.id)
    })

    it('folderDeleteDeep removes nested folders and trashes their live notes, returning trashedNotes', async () => {
      const root = await svc.folderCreate('Root')
      const child = await svc.folderCreate('Child', root.id)
      const noteInRoot = await svc.create({ title: 'In root', folderId: root.id })
      const noteInChild = await svc.create({ title: 'In child', folderId: child.id })
      const alreadyDeleted = await svc.create({ title: 'Already gone', folderId: child.id })
      await svc.delete(alreadyDeleted.note.id)

      const res = await svc.folderDeleteDeep(root.id!)
      expect(res.success).toBe(true)
      expect(new Set(res.trashedNotes.map((n) => n.id))).toEqual(new Set([noteInRoot.note.id, noteInChild.note.id]))

      const folders = await svc.folderList()
      expect(folders.find((f) => f.id === root.id || f.id === child.id)).toBeUndefined()

      expect((await svc.getOne(noteInRoot.note.id))?.deletedAt).toEqual(expect.any(Number))
      expect((await svc.getOne(noteInChild.note.id))?.deletedAt).toEqual(expect.any(Number))
      // Already-trashed note is untouched by this call (still trashed, not double-counted above).
      expect((await svc.getOne(alreadyDeleted.note.id))?.deletedAt).toEqual(expect.any(Number))
    })

    it('folderSetParent guards against cycles, including self-parenting', async () => {
      const f1 = await svc.folderCreate('F1')
      const f2 = await svc.folderCreate('F2', f1.id)

      expect(await svc.folderSetParent(f1.id!, f2.id)).toEqual({ success: false, error: 'cycle' })
      expect(await svc.folderSetParent(f1.id!, f1.id)).toEqual({ success: false, error: 'cycle' })

      expect(await svc.folderSetParent(f2.id!, null)).toEqual({ success: true })
      expect((await svc.folderList()).find((f) => f.id === f2.id)?.parentId).toBeNull()
    })
  })

  // ── setFolder / setPinned / deleteAll ───────────────────────────────────────
  it('setFolder moves a note between folders (and to root with null)', async () => {
    const folder = await svc.folderCreate('F')
    const { note } = await svc.create({ title: 'N' })
    await svc.setFolder(note.id, folder.id!)
    expect((await svc.getOne(note.id))?.folderId).toBe(folder.id)
    await svc.setFolder(note.id, null)
    expect((await svc.getOne(note.id))?.folderId).toBeNull()
  })

  it('setPinned toggles the pinned flag', async () => {
    const { note } = await svc.create({ title: 'N' })
    expect((await svc.getOne(note.id))?.pinned).toBe(false)
    await svc.setPinned(note.id, true)
    expect((await svc.getOne(note.id))?.pinned).toBe(true)
    await svc.setPinned(note.id, false)
    expect((await svc.getOne(note.id))?.pinned).toBe(false)
  })

  it('deleteAll hard-deletes every note', async () => {
    await svc.create({ title: 'A' })
    await svc.create({ title: 'B' })
    expect(await svc.deleteAll()).toEqual({ success: true })
    expect(await svc.getAll()).toEqual([])
  })

  // ── getAll ──────────────────────────────────────────────────────────────────
  it('getAll respects limit/offset and excludes trashed notes', async () => {
    const ids: string[] = []
    for (let i = 0; i < 5; i++) ids.push((await svc.create({ title: `N${i}` })).note.id)
    await svc.delete(ids[0])

    const all = await svc.getAll()
    expect(all).toHaveLength(4)
    expect(all.map((n) => n.id)).not.toContain(ids[0])
    // updated_at DESC -> most recently created first
    expect(all[0].id).toBe(ids[4])

    const page = await svc.getAll(2, 1)
    expect(page.map((n) => n.id)).toEqual([ids[3], ids[2]])
  })

  // ── getOne ──────────────────────────────────────────────────────────────────
  it('getOne returns null for a missing id', async () => {
    expect(await svc.getOne('nope')).toBeNull()
  })

  // ── getByVerse ──────────────────────────────────────────────────────────────
  describe('getByVerse', () => {
    it('returns own-translation notes for a verse, oldest first', async () => {
      const a = await svc.create({ type: 'verse', verseRef: 'GEN.1.1', content: 'first' })
      const b = await svc.create({ type: 'verse', verseRef: 'GEN.1.1', content: 'second' })
      const other = await svc.create({ type: 'verse', verseRef: 'GEN.1.2', content: 'other verse' })
      const rows = await svc.getByVerse('GEN.1.1')
      expect(rows.map((r) => r.id)).toEqual([a.note.id, b.note.id])
      expect(rows.map((r) => r.id)).not.toContain(other.note.id)
    })

    it('cross-links KJV<->LXX Psalms notes through the equivalentChapters merge mapping', async () => {
      // LXX Psalm 9 merges KJV Psalms 9 and 10 (translationChapterMap.ts) — a KJV note at
      // PSA.10.5 must show up when reading LXX PSA.9.5.
      const lxxNote = await svc.create({ type: 'verse', verseRef: 'PSA.9.5', textId: 'lxx', content: 'lxx note' })
      const kjvNote = await svc.create({ type: 'verse', verseRef: 'PSA.10.5', textId: 'kjva', content: 'kjv note' })

      const rows = await svc.getByVerse('PSA.9.5', 'lxx')
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([lxxNote.note.id, kjvNote.note.id]))
    })

    it('a custom textId (neither kjva nor lxx) is looked up literally, with no cross-linking', async () => {
      const enoch = await svc.create({ type: 'verse', verseRef: 'ENO.1.1', textId: 'enoch', content: 'enoch note' })
      await svc.create({ type: 'verse', verseRef: 'ENO.1.1', textId: 'kjva', content: 'unrelated kjva note at same ref' })
      const rows = await svc.getByVerse('ENO.1.1', 'enoch')
      expect(rows.map((r) => r.id)).toEqual([enoch.note.id])
    })
  })

  // ── search ──────────────────────────────────────────────────────────────────
  describe('search', () => {
    it('mode "all": every word must match (as a prefix)', async () => {
      const target = await svc.create({ title: 'Creation Study', content: 'In the beginning God created the heavens' })
      await svc.create({ title: 'Unrelated', content: 'something else entirely' })
      const results = await svc.search('creation beginning', 20, 'all')
      expect(results.map((r) => r.id)).toEqual([target.note.id])
    })

    it('mode "all" expands a number token to its word alternate (numberTokenAlternates)', async () => {
      const target = await svc.create({ title: 'Loaves', content: 'seven loaves and two fishes' })
      const results = await svc.search('7', 20, 'all')
      expect(results.map((r) => r.id)).toEqual([target.note.id])
    })

    it('mode "phrase" matches only the exact contiguous phrase', async () => {
      const phrase = await svc.create({ title: 'Light', content: 'let there be light, and there was light' })
      await svc.create({ title: 'Scrambled', content: 'there was light, let it be so' })
      const results = await svc.search('let there be light', 20, 'phrase')
      expect(results.map((r) => r.id)).toEqual([phrase.note.id])
    })

    it('mode "any" unions per-word matches and de-dupes a note matching multiple words', async () => {
      const appleOnly = await svc.create({ title: 'Apple', content: 'apple note' })
      const bananaOnly = await svc.create({ title: 'Banana', content: 'banana note' })
      const both = await svc.create({ title: 'Both', content: 'apple and banana note' })
      const results = await svc.search('apple banana', 20, 'any')
      expect(new Set(results.map((r) => r.id))).toEqual(new Set([appleOnly.note.id, bananaOnly.note.id, both.note.id]))
      expect(results).toHaveLength(3) // de-duped, not 4 (both would otherwise match twice)
    })

    it('finds a verse-reference-shaped title ("Genesis 1:1-3") — tokenized on the same punctuation FTS5 splits on', async () => {
      const target = await svc.create({ title: 'Genesis 1:1-3', content: 'a study note' })
      const results = await svc.search('Genesis 1:1-3', 20, 'all')
      expect(results.map((r) => r.id)).toEqual([target.note.id])
    })

    it('an "untitled" query finds blank-titled notes even though "Untitled" is never written to the DB', async () => {
      // NOTE: create({}) with no `title` stores SQL NULL (data.title ?? null — notesService.ts:179),
      // not ''. The untitled special case (untitledNoteRows) filters `WHERE title = ''` literally,
      // which does NOT match NULL — so title must be passed explicitly as '' here to exercise it;
      // a note created by omitting `title` entirely is invisible to this search special case.
      const blank = await svc.create({ title: '', content: 'no title given' })
      expect(blank.note.title).toBe('')
      const results = await svc.search('untitled', 20, 'all')
      expect(results.map((r) => r.id)).toContain(blank.note.id)
    })

    it('search excludes trashed notes', async () => {
      const { note } = await svc.create({ title: 'Findme', content: 'body' })
      await svc.delete(note.id)
      expect(await svc.search('findme', 20, 'all')).toEqual([])
    })
  })

  // ── deleteByTag / countTagRefs ──────────────────────────────────────────────
  it('deleteByTag hard-deletes every note carrying that tag and reports the count', async () => {
    const a = await svc.create({ title: 'A', tags: ['creation', 'torah'] })
    const b = await svc.create({ title: 'B', tags: ['creation'] })
    const c = await svc.create({ title: 'C', tags: ['torah'] })
    const res = await svc.deleteByTag('creation')
    expect(res).toEqual({ success: true, deleted: 2 })
    expect(await svc.getOne(a.note.id)).toBeNull()
    expect(await svc.getOne(b.note.id)).toBeNull()
    expect(await svc.getOne(c.note.id)).not.toBeNull()
  })

  it('countTagRefs counts live notes whose content contains an inline "#tag" reference', async () => {
    await svc.create({ title: 'A', content: 'see #torah-observance for context' })
    await svc.create({ title: 'B', content: 'also references #torah-observance here' })
    const trashed = await svc.create({ title: 'C', content: 'mentions #torah-observance too' })
    await svc.delete(trashed.note.id)
    await svc.create({ title: 'D', content: 'no reference here' })
    expect(await svc.countTagRefs('torah-observance')).toEqual({ count: 2 })
  })

  // ── getByChapter / getChapterCounts ─────────────────────────────────────────
  describe('getByChapter / getChapterCounts', () => {
    it('cross-links KJV<->LXX through equivalentChapters for a merge chapter (LXX Ps 9 = KJV Ps 9+10)', async () => {
      const lxxOwn = await svc.create({ type: 'verse', verseRef: 'PSA.9.3', textId: 'lxx', content: 'lxx own' })
      const kjv9 = await svc.create({ type: 'verse', verseRef: 'PSA.9.5', textId: 'kjva', content: 'kjv ps9' })
      const kjv10 = await svc.create({ type: 'verse', verseRef: 'PSA.10.7', textId: 'kjva', content: 'kjv ps10' })
      // Unrelated chapter — must not leak in.
      await svc.create({ type: 'verse', verseRef: 'PSA.11.1', textId: 'kjva', content: 'ps11' })

      const rows = await svc.getByChapter('PSA', 9, 'lxx')
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([lxxOwn.note.id, kjv9.note.id, kjv10.note.id]))

      const counts = await svc.getChapterCounts('PSA', 9, 'lxx')
      expect(counts).toEqual({ 3: 1, 5: 1, 7: 1 })
    })

    it('a custom textId is scoped literally with no cross-linking', async () => {
      const enoch = await svc.create({ type: 'verse', verseRef: 'ENO.1.1', textId: 'enoch', content: 'e1' })
      await svc.create({ type: 'verse', verseRef: 'ENO.1.1', textId: 'kjva', content: 'unrelated' })
      const rows = await svc.getByChapter('ENO', 1, 'enoch')
      expect(rows.map((r) => r.id)).toEqual([enoch.note.id])
      expect(await svc.getChapterCounts('ENO', 1, 'enoch')).toEqual({ 1: 1 })
    })

    it('non-Psalms books are an identity mapping (no cross-chapter merging)', async () => {
      const kjv = await svc.create({ type: 'verse', verseRef: 'GEN.1.1', textId: 'kjva', content: 'k' })
      const lxx = await svc.create({ type: 'verse', verseRef: 'GEN.1.1', textId: 'lxx', content: 'l' })
      const rows = await svc.getByChapter('GEN', 1, 'kjva')
      expect(new Set(rows.map((r) => r.id))).toEqual(new Set([kjv.note.id, lxx.note.id]))
    })
  })

  // ── note versions ───────────────────────────────────────────────────────────
  describe('note versions', () => {
    it('createVersion skips an identical consecutive snapshot', async () => {
      const { note } = await svc.create({ title: 'N', content: 'same' })
      const first = await svc.createVersion(note.id, 'N', 'same')
      expect(first.success).toBe(true)
      expect(first.id).toBeTruthy()
      const second = await svc.createVersion(note.id, 'N', 'same')
      expect(second).toEqual({ success: true, skipped: true })
      expect(await svc.getVersions(note.id)).toHaveLength(1)
    })

    it('getVersions is newest first', async () => {
      const { note } = await svc.create({ title: 'N', content: 'v0' })
      await svc.createVersion(note.id, 'N', 'v1')
      await svc.createVersion(note.id, 'N', 'v2')
      const versions = await svc.getVersions(note.id)
      expect(versions.map((v) => v.content)).toEqual(['v2', 'v1'])
    })

    it('restoreVersion snapshots the current content as pre-restore, then applies the version', async () => {
      const { note } = await svc.create({ title: 'N', content: 'v1' })
      const v1 = await svc.createVersion(note.id, 'N', 'v1')
      await svc.update(note.id, { content: 'v2' })

      const res = await svc.restoreVersion(note.id, v1.id!)
      expect(res).toEqual({ success: true, content: 'v1' })
      expect((await svc.getOne(note.id))?.content).toBe('v1')

      const versions = await svc.getVersions(note.id)
      expect(versions.map((v) => v.kind)).toContain('pre-restore')
      expect(versions.find((v) => v.kind === 'pre-restore')?.content).toBe('v2')
    })

    it('restoreVersion returns errors for a missing version or missing note', async () => {
      const { note } = await svc.create({ title: 'N', content: 'v1' })
      expect(await svc.restoreVersion(note.id, 'no-such-version')).toEqual({ success: false, error: 'Version not found' })
      const v1 = await svc.createVersion(note.id, 'N', 'v1')
      expect(await svc.restoreVersion('no-such-note', v1.id!)).toEqual({ success: false, error: 'Note not found' })
    })

    it('pruneNoteVersions caps history at 50, keeping the newest', async () => {
      const { note } = await svc.create({ title: 'N', content: 'v0' })
      const DAY = 24 * 60 * 60 * 1000
      const base = 1_800_000_000_000
      for (let day = 1; day <= 60; day++) {
        clock = base + day * DAY
        await svc.createVersion(note.id, 'N', `content-day-${day}`)
      }
      const versions = await svc.getVersions(note.id)
      expect(versions).toHaveLength(50)
      // Newest first; the oldest 10 days (1-10) were pruned once the cap kicked in.
      expect(versions[0].content).toBe('content-day-60')
      expect(versions[versions.length - 1].content).toBe('content-day-11')
    })
  })

  // ── heading / thread collapse persistence ───────────────────────────────────
  it('getCollapsedHeadings/setHeadingCollapsed round-trip and un-collapsing deletes the row', async () => {
    const { note } = await svc.create({ title: 'N' })
    expect(await svc.getCollapsedHeadings(note.id)).toEqual([])
    await svc.setHeadingCollapsed(note.id, 'h1', true)
    await svc.setHeadingCollapsed(note.id, 'h1', true) // INSERT OR REPLACE — no duplicate
    expect(await svc.getCollapsedHeadings(note.id)).toEqual(['h1'])
    await svc.setHeadingCollapsed(note.id, 'h1', false)
    expect(await svc.getCollapsedHeadings(note.id)).toEqual([])
  })

  it('getCollapsedThreads/setThreadCollapsed round-trip and un-collapsing deletes the row', async () => {
    const { note } = await svc.create({ title: 'N' })
    expect(await svc.getCollapsedThreads(note.id)).toEqual([])
    await svc.setThreadCollapsed(note.id, 't1', true)
    expect(await svc.getCollapsedThreads(note.id)).toEqual(['t1'])
    await svc.setThreadCollapsed(note.id, 't1', false)
    expect(await svc.getCollapsedThreads(note.id)).toEqual([])
  })
})
