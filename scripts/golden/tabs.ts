/**
 * Tabs / sessions golden (M3-04 + M6): tabFields split/merge/stableJson, tabPersistence buildSnapshot /
 * hydrateFromRows / assignOrderKeys, and createSessionsService replaying a fixed operation script on a
 * freshly migrated in-memory berean.db with a fake clock (table dumps + emitted data:changed events).
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mergeTabState, splitTabState, stableJson } from '../../src/platform/sync/tabFields'
import { assignOrderKeys, buildSnapshot, hydrateFromRows } from '../../src/store/tabPersistence'
import { createSessionsService } from '../../src/platform/services/sessionsService'
import { migratedUserDb } from '../../src/platform/db/__tests__/testDb'
import { consoleLogger, createServiceEvents } from '../../src/platform/services/context'
import type { TabType } from '../../src/types'

const ROOT = resolve(__dirname, '../..')

const states: Array<[TabType, Record<string, unknown>]> = [
  ['bible', { bookId: 'JHN', chapter: 3, verse: 16, translation: 'kjva', showStrongs: true, scrollPosition: 120.5, targetVerse: 16, rightPanelOpen: true, rightPanelWidth: 380,
    compareMode: true, compareColumns: [{ textId: 'lxx', bookId: 'GEN', chapter: 1, scrollPos: { verseNum: 3, frac: 0.25 } }, { textId: 'kjva', bookId: 'GEN', chapter: 1 }],
    hiddenAnnotations: ['lxx_supply'], scriptureLayout: 'study-grid', rightPanelTab: 'lexicon', rightPanelScrollTops: { notes: 10 }, unknownFutureField: { a: 1 } }],
  ['bible', { bookId: 'GEN', chapter: 1, translation: 'lxx', showStrongs: false, scrollPosition: 0, compareColumns: [{ textId: 'kjva', bookId: 'GEN', chapter: 1 }] }],
  ['note', { noteId: 'n1', isNew: false, scrollTop: 40, cursorPos: 7, homeView: { noteSearch: 'grace', noteSearchWordMode: 'all', noteFilter: 'all', statusFilter: 'all', noteSort: 'updated', viewMode: 'list', expandAll: false, previewNoteId: 'n2', previewFolderId: null } }],
  ['lexicon', { strongsNum: 'G5485', scrollTop: 3, searchQuery: 'grace', searchLang: 'G', lexHistory: [{ kind: 'entry', strongsNum: 'G5485' }, { kind: 'search', query: 'love', lang: 'all' }] }],
  ['youtube', { videoId: 'abc', playlistId: null, youtubeLayout: 'side-right', panelA: { type: 'notes', noteId: 'n1' }, panelB: null, scrollTop: 9 }],
  ['search', { query: 'in the beginning', results: [{ x: 1 }], scrollTop: 5, scope: 'all', preview: true }],
  ['pdf', { pdfId: 'p1', title: 'Doc', page: 4, scrollTop: 300 }],
  ['tags', { selectedTagId: 't1' }], ['history', { category: 'all', studyOnly: true }], ['settings', { section: 'display', settingsRoute: 'display/fonts' }],
  ['calendar', { month: '2026-11', selected: '2026-11-07' }], ['note', {}], ['bible', { compareColumns: null, homeView: 1 }],
]

export async function buildTabsGolden(): Promise<{ name: string; data: unknown }> {
  const split = states.map(([type, state]) => { const s = splitTabState(type, state as never); return { type, state, sync: s.sync, local: s.local, merged: mergeTabState(type, s.sync, s.local), syncJson: stableJson(s.sync), localJson: stableJson(s.local) } })
  const stable = [{ b: 1, a: [{ d: 2, c: undefined }], '2': 0 }, null, [1, 'x'], { z: { y: { x: 1 } } }].map((v) => ({ value: v === null ? null : JSON.parse(JSON.stringify(v)), json: stableJson(v) }))
  const orderKeys = [
    { ids: ['a', 'b', 'c'], existing: {} }, { ids: ['a', 'x', 'b'], existing: { a: 'a0', b: 'a1' } }, { ids: ['b', 'a'], existing: { a: 'a0', b: 'a1' } },
    { ids: ['n', 'a', 'm', 'b', 'o'], existing: { a: 'a0', b: 'a5' } }, { ids: [], existing: {} },
  ].map((c) => ({ ...c, result: Object.fromEntries(assignOrderKeys(c.ids, new Map(Object.entries(c.existing)))) }))

  const tab = (id: string, spaceId: string, type: TabType, title: string, state: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ id, spaceId, type, title, state, ...extra })
  const storeState = {
    currentSessionId: 's1',
    tabs: { scripture: [tab('t1', 'scripture', 'bible', 'John 3', states[0][1]), tab('t2', 'scripture', 'bible', 'Genesis 1', states[1][1], { isPinned: true })], notes: [tab('t3', 'notes', 'note', 'Grace', states[2][1])],
      lexicon: [tab('t4', 'lexicon', 'lexicon', 'G5485', states[3][1], { originTabId: 't1', originSpaceId: 'scripture' })], youtube: [], search: [] },
    activeTabId: { scripture: 't2', notes: 't3', lexicon: 't4', youtube: null, search: null },
    sessions: [
      { id: 's1', name: 'Study', tabs: {}, activeTabId: {} },
      { id: 's2', name: 'Torah', icon: '📜', tabFilter: 'scripture', tabs: { scripture: [tab('t5', 'scripture', 'bible', 'Exodus 20', { bookId: 'EXO', chapter: 20, translation: 'kjva', showStrongs: false, scrollPosition: 0 })], notes: [], lexicon: [], youtube: [], search: [] }, activeTabId: { scripture: 't5' } },
    ],
    sessionDisplayOrders: { s1: ['t3', 't1', 'ghost'] },
    archivedGroups: [{ id: 'g1', label: 'Old', archivedAt: 1700000000000, tabs: [tab('t9', 'scripture', 'bible', 'Ruth 1', { bookId: 'RUT', chapter: 1 })] }],
  }
  const built = buildSnapshot(storeState as never)
  const snapshot = JSON.parse(JSON.stringify(built.snapshot))

  // Service script on a migrated in-memory database, fake clock.
  const db = await migratedUserDb()
  let clock = 1_800_000_000_000
  const events: unknown[] = []
  const ev = createServiceEvents()
  ev.on('data:changed', (c) => events.push({ entity: c.entity, id: c.id, op: c.op }))
  const svc = createSessionsService({ userDb: db, textDb: async () => null, lexiconDb: async () => { throw new Error('unused') }, dataDb: async () => null,
    events: ev, now: () => clock, uuid: () => 'uuid', isDev: true, log: consoleLogger })
  const dumps: unknown[] = []
  const dump = async (label: string) => dumps.push({ label,
    sessions: await db.all('SELECT * FROM sessions ORDER BY id'), tabs: await db.all('SELECT * FROM tabs ORDER BY id'),
    archived: await db.all('SELECT * FROM archived_groups ORDER BY id'), local: await db.all('SELECT * FROM session_local_state ORDER BY session_id'),
    listSessions: await svc.listSessions(), listTabs: await svc.listTabs(), listTabsS1: await svc.listTabs('s1'), groups: await svc.listArchivedGroups(),
    localS1: await svc.getLocalState('s1'), hasAny: await svc.hasAny() })
  await dump('empty')
  clock += 1000; const d1 = await svc.applySnapshot(built.snapshot); await dump('snapshot')
  clock += 1000; const d2 = await svc.applySnapshot(built.snapshot); await dump('same snapshot (no churn)')
  await svc.setLocalState('s1', built.localState.get('s1')!)
  clock += 1000
  const t1 = built.snapshot.tabs.find((t) => t.id === 't1')!
  await svc.upsertTab({ ...t1, local_state_json: '{"scrollPosition":999}' }); await dump('local-only change keeps updated_at')
  clock += 1000; await svc.upsertTab({ ...t1, title: 'John 3 (KJV)' }); await dump('synced change bumps updated_at')
  clock += 1000; await svc.upsertSession({ id: 's3', name: 'New', icon: null, tab_filter: null, order_key: 'a5' }); await dump('new session')
  clock += 1000; await svc.deleteTab('t2'); await dump('tab tombstoned')
  clock += 1000; await svc.deleteSession('s2'); await dump('session + its tabs tombstoned')
  clock += 1000; const smaller = { ...built.snapshot, tabs: built.snapshot.tabs.filter((t) => t.id !== 't4'), archivedGroups: [] }
  const d3 = await svc.applySnapshot(smaller); await dump('snapshot drops t4 and g1')
  clock += 1000; const d4 = await svc.applySnapshot(built.snapshot); await dump('resurrect')
  clock += 10_000; const purged = await svc.purgeTombstones(5000); await dump('purged')
  await svc.setLocalState('s1', { scripture: 't1', notes: null }); const local2 = await svc.getLocalState('s1')
  const rows = { sessions: await db.all('SELECT * FROM sessions'), tabs: await db.all('SELECT * FROM tabs'), groups: await db.all('SELECT * FROM archived_groups') }
  const hydrated = hydrateFromRows(rows.sessions as never, rows.tabs as never, rows.groups as never, new Map([['s1', local2 as Record<string, string | null>]]))
  await db.close()
  return {
    name: 'tabs',
    data: {
      format: 1, generator: 'scripts/golden/tabs.ts',
      sources: Object.fromEntries(['src/platform/sync/tabFields.ts', 'src/store/tabPersistence.ts', 'src/platform/services/sessionsService.ts', 'scripts/golden/tabs.ts']
        .map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
      split, stable, orderKeys, storeState, snapshot, localState: Object.fromEntries(built.localState), keys: { sessions: Object.fromEntries(built.keys.sessions), tabs: Object.fromEntries(built.keys.tabs), display: Object.fromEntries(built.keys.display) },
      diffs: [d1, d2, d3, d4], purged, events, dumps, hydrated: JSON.parse(JSON.stringify({ ...hydrated, keys: undefined })),
    },
  }
}
