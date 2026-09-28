import { describe, it, expect, beforeEach } from 'vitest'
import { makeContext, migratedUserDb, recordingEvents } from '../../db/__tests__/testDb'
import { createVerseTagsService, expandRanges } from '../verseTagsService'
import type { DatabaseAdapter } from '../../db/DatabaseAdapter'

describe('verseTagsService', () => {
  let userDb: DatabaseAdapter
  let svc: ReturnType<typeof createVerseTagsService>
  let changes: ReturnType<typeof recordingEvents>['changes']

  beforeEach(async () => {
    userDb = await migratedUserDb()
    const rec = recordingEvents()
    changes = rec.changes
    svc = createVerseTagsService(makeContext({ userDb, events: rec.events }))
  })

  it('expandRanges: spans expand inclusive, whole chapters emit a verse=0 sentinel, and a pathological span is capped at 400 verses', () => {
    expect(expandRanges([{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 3 }] }])).toEqual([
      { bookId: 'GEN', chapter: 1, verse: 1 }, { bookId: 'GEN', chapter: 1, verse: 2 }, { bookId: 'GEN', chapter: 1, verse: 3 },
    ])
    expect(expandRanges([{ bookId: 'GEN', chapter: 1, whole: true }])).toEqual([{ bookId: 'GEN', chapter: 1, verse: 0 }])
    const guarded = expandRanges([{ bookId: 'PSA', chapter: 119, spans: [{ s: 1, e: 9999 }] }])
    expect(guarded).toHaveLength(401) // MAX_SPAN_EXPANSION=400 caps e at s+400, inclusive of s
    expect(guarded[guarded.length - 1]).toEqual({ bookId: 'PSA', chapter: 119, verse: 401 })
  })

  it('create dedupes by name case-insensitively and auto-assigns a distinct color_slot 0..11', async () => {
    let list: Awaited<ReturnType<typeof svc.list>> = []
    for (let i = 0; i < 12; i++) list = await svc.create(`Tag${i}`)
    expect(list).toHaveLength(12)
    expect(list.map((t) => t.colorSlot).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])

    const dup = await svc.create('tag0') // case-insensitive dupe of 'Tag0'
    expect(dup).toHaveLength(12) // no new tag created
    expect(dup.filter((t) => t.name.toLowerCase() === 'tag0')).toHaveLength(1)
  })

  it('list orders by sort_order then name NOCASE, and reports member/verse/chapter counts', async () => {
    await svc.create('cherry')
    await svc.create('Apple')
    const alpha = await svc.create('banana')
    expect(alpha.map((t) => t.name)).toEqual(['Apple', 'banana', 'cherry'])

    const [apple, banana, cherry] = alpha
    await svc.addMembers({ tagIds: [apple.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 2 }] }], label: 'Gen 1:1-2' })
    const withCounts = await svc.addMembers({ tagIds: [apple.id], ranges: [{ bookId: 'GEN', chapter: 2, whole: true }], label: 'Gen 2', kind: 'chapter' })
    const appleCounts = withCounts.find((t) => t.id === apple.id)!
    expect(appleCounts.memberCount).toBe(2)
    expect(appleCounts.verseCount).toBe(2)
    expect(appleCounts.chapterCount).toBe(1)

    const reordered = await svc.reorder([cherry.id, apple.id, banana.id])
    expect(reordered.map((t) => t.name)).toEqual(['cherry', 'Apple', 'banana'])
    expect(changes.some((c) => c.entity === 'verse_tag' && c.op === 'bulk')).toBe(true)
  })

  it('rename, setColor, and setColorSlot (clamping 0..11 and clearing the literal color)', async () => {
    const [tag] = await svc.create('Original')
    await svc.rename(tag.id, '  Renamed  ')
    expect((await svc.list())[0].name).toBe('Renamed')

    await svc.setColor(tag.id, '#ff0000')
    expect((await svc.list())[0].color).toBe('#ff0000')

    const afterHigh = await svc.setColorSlot(tag.id, 99) // out of range, clamps to 11
    expect(afterHigh[0].colorSlot).toBe(11)
    expect(afterHigh[0].color).toBeNull() // setColorSlot clears any literal color override

    await svc.setColor(tag.id, '#00ff00')
    const afterLow = await svc.setColorSlot(tag.id, -5) // clamps to 0
    expect(afterLow[0].colorSlot).toBe(0)
    expect(afterLow[0].color).toBeNull()

    expect(changes.filter((c) => c.entity === 'verse_tag' && c.op === 'upsert')).toHaveLength(6)
  })

  it('addMembers: tagIds + newTagNames together, spans and whole-chapter ranges, and events', async () => {
    const [existing] = await svc.create('Existing')
    changes.length = 0

    const afterAdd = await svc.addMembers({
      tagIds: [existing.id],
      newTagNames: ['Brand New'],
      ranges: [
        { bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 3 }] },
        { bookId: 'GEN', chapter: 2, whole: true },
      ],
      label: 'Gen 1:1-3, Gen 2',
    })
    expect(afterAdd.map((t) => t.name).sort()).toEqual(['Brand New', 'Existing'])
    const brandNew = afterAdd.find((t) => t.name === 'Brand New')!
    expect(brandNew.memberCount).toBe(1)
    expect(brandNew.verseCount).toBe(3)
    expect(brandNew.chapterCount).toBe(1)
    expect(afterAdd.find((t) => t.id === existing.id)!.memberCount).toBe(1)

    // one 'verse_tag' upsert for the freshly-created tag, plus one 'verse_tag_member' upsert per touched member
    expect(changes).toHaveLength(3)
    expect(changes.filter((c) => c.entity === 'verse_tag_member' && c.op === 'upsert')).toHaveLength(2)
    expect(changes.filter((c) => c.entity === 'verse_tag' && c.op === 'upsert')).toHaveLength(1)
  })

  it('removeMember deletes the member and its expanded verse rows', async () => {
    const [tag] = await svc.create('Removable')
    await svc.addMembers({ tagIds: [tag.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 1 }] }], label: 'Gen 1:1' })
    const members = await svc.getMembers([tag.id])
    expect(members).toHaveLength(1)

    await svc.removeMember(members[0].memberId)
    expect(await svc.getMembers([tag.id])).toEqual([])
    expect((await svc.list()).find((t) => t.id === tag.id)!.memberCount).toBe(0)
    expect(changes.some((c) => c.entity === 'verse_tag_member' && c.op === 'delete')).toBe(true)
  })

  it('updateMemberRanges rebuilds verse rows, updates kind only when given, and no-ops for an unknown member', async () => {
    const [tag] = await svc.create('Updatable')
    await svc.addMembers({ tagIds: [tag.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 1 }] }], label: 'Gen 1:1', kind: 'verses' })
    const [member] = await svc.getMembers([tag.id])

    await svc.updateMemberRanges(member.memberId, [{ bookId: 'GEN', chapter: 3, whole: true }], 'Gen 3', 'chapter')
    const [updated] = await svc.getMembers([tag.id])
    expect(updated.kind).toBe('chapter')
    expect(updated.wholeChapters).toEqual([{ bookId: 'GEN', chapter: 3 }])
    expect(updated.verses).toEqual([])

    // omitting `kind` leaves the stored kind unchanged
    await svc.updateMemberRanges(member.memberId, [{ bookId: 'GEN', chapter: 4, spans: [{ s: 5, e: 5 }] }], 'Gen 4:5')
    const [updated2] = await svc.getMembers([tag.id])
    expect(updated2.kind).toBe('chapter')
    expect(updated2.verses).toEqual([{ bookId: 'GEN', chapter: 4, verse: 5 }])

    // unknown member id is a silent no-op that still returns the current list
    const list = await svc.updateMemberRanges('does-not-exist', [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 1 }] }], 'x')
    expect(list.find((t) => t.id === tag.id)).toBeTruthy()
  })

  it('getForChapter groups verse-level tags by verse and whole-chapter tags separately, both alphabetised', async () => {
    const [faith] = await svc.create('Faith')
    await svc.addMembers({ tagIds: [faith.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 1 }] }], label: 'Gen 1:1' })
    const afterCreation = await svc.create('Creation')
    const creation = afterCreation.find((t) => t.name === 'Creation')!
    await svc.addMembers({ tagIds: [creation.id], ranges: [{ bookId: 'GEN', chapter: 1, whole: true }], label: 'Gen 1', kind: 'chapter' })

    const { verseTags, chapterTags } = await svc.getForChapter('GEN', 1)
    expect(verseTags[1].map((t) => t.name)).toEqual(['Faith'])
    expect(chapterTags.map((t) => t.name)).toEqual(['Creation'])
    expect(await svc.getForChapter('GEN', 99)).toEqual({ verseTags: {}, chapterTags: [] })
  })

  it('getMembers returns ranges plus expanded verses/wholeChapters per member', async () => {
    const [tag] = await svc.create('Combo')
    await svc.addMembers({
      tagIds: [tag.id],
      ranges: [
        { bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 3 }] },
        { bookId: 'GEN', chapter: 2, whole: true },
      ],
      label: 'Combo range',
    })
    const [detail] = await svc.getMembers([tag.id])
    expect(detail.tagName).toBe('Combo')
    expect(detail.label).toBe('Combo range')
    expect(detail.verses).toEqual([
      { bookId: 'GEN', chapter: 1, verse: 1 }, { bookId: 'GEN', chapter: 1, verse: 2 }, { bookId: 'GEN', chapter: 1, verse: 3 },
    ])
    expect(detail.wholeChapters).toEqual([{ bookId: 'GEN', chapter: 2 }])
    expect(await svc.getMembers([])).toEqual([])
  })

  it('merge moves members and verse rows onto the surviving tag, and re-points/cleans up tag_edges', async () => {
    const a = (await svc.create('TagA')).find((t) => t.name === 'TagA')!
    const b = (await svc.create('TagB')).find((t) => t.name === 'TagB')!
    const c = (await svc.create('TagC')).find((t) => t.name === 'TagC')!

    await svc.addMembers({ tagIds: [a.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 2 }] }], label: 'A range' })
    await svc.addMembers({ tagIds: [b.id], ranges: [{ bookId: 'GEN', chapter: 2, spans: [{ s: 1, e: 1 }] }], label: 'B range' })

    // Build the edge graph directly with SQL — merge() re-points/cleans these up in ways the
    // service's own createEdge() (one edge per pair) can't set up in a single call.
    const now = Date.now()
    const mkEdge = (id: string, source: string, target: string) =>
      userDb.run(
        `INSERT INTO tag_edges (id, source_tag_id, target_tag_id, arrows, color, dashed, note, created_at, updated_at) VALUES (?,?,?,'none',NULL,0,'',?,?)`,
        [id, source, target, now, now],
      )
    await mkEdge('e-ac', a.id, c.id) // repoint collides with e-bc below -> IGNORE drops it -> leftover cleanup deletes it
    await mkEdge('e-ca', c.id, a.id) // repoints cleanly to (c, b)
    await mkEdge('e-ab', a.id, b.id) // repoints to (b, b) -> self-loop -> deleted
    await mkEdge('e-bc', b.id, c.id) // untouched by the merge, survives as-is

    changes.length = 0
    const merged = await svc.merge(a.id, b.id)
    expect(merged.find((t) => t.id === a.id)).toBeUndefined() // A is gone
    const bAfter = merged.find((t) => t.id === b.id)!
    expect(bAfter.memberCount).toBe(2) // B's own member + A's reassigned member
    expect(bAfter.verseCount).toBe(3) // GEN 1:1-2 (from A) + GEN 2:1 (from B), all distinct

    const edges = await userDb.all<{ source_tag_id: string; target_tag_id: string }>(
      'SELECT source_tag_id, target_tag_id FROM tag_edges ORDER BY rowid',
    )
    expect(edges).toEqual([
      { source_tag_id: c.id, target_tag_id: b.id }, // e-ca, repointed
      { source_tag_id: b.id, target_tag_id: c.id }, // e-bc, untouched
    ])

    expect(changes).toEqual(expect.arrayContaining([
      { entity: 'verse_tag', id: a.id, op: 'delete', scope: undefined },
      { entity: 'verse_tag', id: b.id, op: 'upsert', scope: undefined },
    ]))
  })

  it('delete: notFound for an unknown id, blocked when a note references #name unless forced, and cascades members via FK', async () => {
    expect(await svc.delete('missing-id')).toEqual({ deleted: false, notFound: true })

    const [faith] = await svc.create('Faith')
    await svc.addMembers({ tagIds: [faith.id], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 1 }] }], label: 'Gen 1:1' })
    await userDb.run('INSERT INTO notes (id, content, created_at, updated_at) VALUES (?,?,?,?)', ['note1', 'Reflecting on #Faith today', Date.now(), Date.now()])

    const blocked = await svc.delete(faith.id)
    expect(blocked).toMatchObject({ deleted: false, blocked: true, noteRefCount: 1, name: 'Faith' })
    expect((await svc.list()).some((t) => t.id === faith.id)).toBe(true) // still present

    const forced = await svc.delete(faith.id, true)
    expect(forced.deleted).toBe(true)
    expect((forced as { list: Array<{ id: string }> }).list.some((t) => t.id === faith.id)).toBe(false)

    const membersLeft = await userDb.all('SELECT * FROM verse_tag_members WHERE tag_id = ?', [faith.id])
    expect(membersLeft).toHaveLength(0) // cascaded via the verse_tag_members -> verse_tags FK

    expect(changes.some((c) => c.entity === 'verse_tag' && c.id === faith.id && c.op === 'delete')).toBe(true)
  })
})
