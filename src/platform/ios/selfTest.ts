import { currentSchemaVersion, BEREAN_SCHEMA_VERSION } from '../db/bereanMigrations'
import { BereanSQLite, BereanCloud } from './plugins'
import { iosServiceContext, iosServices, TEXT_FILES } from './services'

/**
 * In-app self-test (docs/mobile/testing.md — IOS SIMULATOR / PHYSICAL IPHONE categories).
 * Exercises the real native stack end to end: BereanSQLite plugin → CapacitorSqliteAdapter →
 * shared services → migrated berean.db and the bundled read-only DBs. Each check returns a
 * pass/fail with a message and the elapsed milliseconds, so the same run doubles as the first
 * performance baseline (Phase 11 records the numbers in testing.md §6).
 *
 * Nothing here is mocked; a failing check means the phone build is broken for real users.
 */
export interface SelfTestResult { name: string; ok: boolean; ms: number; detail: string }

const BUNDLED_FILES = [
  ...Object.values(TEXT_FILES),
  'strongs_hebrew.db', 'strongs_greek.db', 'cross_references.db', 'tske_refs.db',
]

type Check = { name: string; run: () => Promise<string> }

function expect(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

export function selfTestChecks(): Check[] {
  const s = () => iosServices()
  const ctx = () => iosServiceContext()
  return [
    {
      name: 'berean.db migrated to current schema',
      run: async () => {
        const v = await currentSchemaVersion(ctx().userDb)
        expect(v === BEREAN_SCHEMA_VERSION, `schema_version is ${v}, expected ${BEREAN_SCHEMA_VERSION}`)
        const tables = await ctx().userDb.all<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
        return `v${v}, ${tables[0].n} tables`
      },
    },
    {
      name: 'bundled databases present in app bundle',
      run: async () => {
        const missing: string[] = []
        let total = 0
        for (const f of BUNDLED_FILES) {
          const info = await BereanSQLite.fileInfo({ path: `bundle:data/${f}` })
          if (!info.exists) missing.push(f)
          total += info.size
        }
        expect(missing.length === 0, `missing: ${missing.join(', ')}`)
        return `${BUNDLED_FILES.length} files, ${(total / 1048576).toFixed(1)} MB`
      },
    },
    {
      name: 'KJVA books + Genesis 1',
      run: async () => {
        const books = await s().bible.getBooks('kjva')
        expect(books.length >= 66, `only ${books.length} books`)
        expect(books[0]?.id === 'GEN', `first book is ${books[0]?.id}`)
        const rows = await s().bible.queryChapter('GEN', 1, 'kjva')
        expect(rows.length === 31, `Genesis 1 has ${rows.length} verses`)
        expect(rows[0].text.startsWith('In the beginning'), `verse 1 text: ${rows[0].text.slice(0, 40)}`)
        expect(typeof rows[0].text_tagged === 'string' && rows[0].text_tagged.includes('{H'), 'text_tagged missing Strong\'s tags')
        return `${books.length} books, 31 verses, tagged`
      },
    },
    {
      name: 'every bundled text opens and lists books',
      run: async () => {
        const out: string[] = []
        for (const id of Object.keys(TEXT_FILES)) {
          const books = await s().bible.getBooks(id)
          expect(books.length > 0, `${id}: no books`)
          out.push(`${id}:${books.length}`)
        }
        return out.join(' ')
      },
    },
    {
      name: 'FTS5 phrase search across KJVA',
      run: async () => {
        const rows = await s().bible.searchText('in the beginning', 'kjva', 'phrase')
        const keys = new Set(rows.map((r) => `${r.book_id}.${r.chapter}.${r.verse_num}`))
        expect(keys.has('GEN.1.1') && keys.has('JHN.1.1'), `hits: ${rows.length}, GEN.1.1=${keys.has('GEN.1.1')} JHN.1.1=${keys.has('JHN.1.1')}`)
        const any = await s().bible.searchText('love', 'kjva', 'all')
        expect(any.length > 100, `"love" only ${any.length} hits`)
        return `${rows.length} phrase hits, ${any.length} for "love"`
      },
    },
    {
      name: 'Strong\'s lexicon entry + occurrences (H7225)',
      run: async () => {
        const entry = await s().lexicon.getEntry('H7225')
        expect(entry, 'H7225 not found')
        const occ = await s().lexicon.getOccurrences('H7225', undefined, 50)
        expect(occ.some((o) => o.book_id === 'GEN' && o.chapter === 1 && o.verse_num === 1), 'GEN 1:1 not among H7225 occurrences')
        const g = await s().lexicon.getEntry('G3056')
        expect(g, 'G3056 not found')
        return `${JSON.stringify(entry).slice(0, 60)}… ${occ.length} occurrences`
      },
    },
    {
      name: 'cross references (native + TSKe) for Genesis 1:1',
      run: async () => {
        const st = await s().crossrefs.status()
        expect(st.hasData, 'cross_references.db not available')
        const refs = await s().crossrefs.getForVerse('GEN', 1, 1)
        expect(!refs.error && refs.refs.length > 0, `refs error=${refs.error} count=${refs.refs.length}`)
        expect(refs.refs[0].text.length > 0, 'ref text not resolved')
        const tske = await s().crossrefs.getTSKeForVerse('GEN', 1, 1)
        expect(!tske.error && tske.groups.length > 0, `tske error=${tske.error} groups=${tske.groups.length}`)
        return `${refs.refs.length} refs, ${tske.groups.length} TSKe groups`
      },
    },
    {
      name: 'notes CRUD + FTS + trash on berean.db',
      run: async () => {
        const created = await s().notes.create({ type: 'general', title: 'Self-test note', content: 'Yehovah is my shepherd' })
        expect(created.success && created.note, 'create failed')
        const id = created.note!.id
        const got = await s().notes.getOne(id)
        expect(got?.title === 'Self-test note', 'getOne mismatch')
        await s().notes.update(id, { content: 'Yehovah is my shepherd; I shall not want' })
        const found = await s().notes.search('shepherd', 10, 'all')
        expect(found.some((n) => n.id === id), 'FTS search did not find the note')
        await s().notes.delete(id)
        expect((await s().notes.listTrash()).some((n) => n.id === id), 'note not in trash')
        const purged = await s().notes.purgeTrashItem(id)
        expect(purged.success, 'purge failed')
        expect((await s().notes.getOne(id)) === null, 'note still present after purge')
        return 'create → update → search → trash → purge'
      },
    },
    {
      name: 'highlights toggle round trip',
      run: async () => {
        const a = await s().highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow', textId: 'selftest' })
        expect('created' in a && a.created, 'not created')
        const ch = await s().highlights.getChapter('GEN', 1, 'selftest')
        expect(ch[1]?.length === 1, 'highlight not listed')
        const b = await s().highlights.toggle({ bookId: 'GEN', chapter: 1, verseNum: 1, color: 'yellow', textId: 'selftest' })
        expect('removed' in b && b.removed, 'not removed')
        return 'create + remove'
      },
    },
    {
      name: 'verse tags: add member, chapter lookup, delete',
      run: async () => {
        const tags = await s().verseTags.addMembers({ newTagNames: ['self-test tag'], ranges: [{ bookId: 'GEN', chapter: 1, spans: [{ s: 1, e: 3 }] }], label: 'Gen 1:1-3' })
        const tag = tags.find((t) => t.name === 'self-test tag')
        expect(tag && tag.verseCount === 3, `verseCount=${tag?.verseCount}`)
        const forChapter = await s().verseTags.getForChapter('GEN', 1)
        expect(forChapter.verseTags[2]?.some((t) => t.id === tag!.id), 'verse 2 not tagged')
        const del = await s().verseTags.delete(tag!.id, true)
        expect(del.deleted, 'delete failed')
        return '3 verses tagged, then deleted'
      },
    },
    {
      name: 'settings round trip',
      run: async () => {
        await s().settings.set('__selftest', { ok: true, n: 1 })
        const v = await s().settings.get('__selftest') as { ok: boolean; n: number } | null
        expect(v?.ok === true && v.n === 1, `got ${JSON.stringify(v)}`)
        return 'set/get JSON'
      },
    },
    {
      name: 'transaction rollback isolates failures',
      run: async () => {
        const db = ctx().userDb
        await db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('__tx', '\"before\"')")
        await db.transaction(async (tx) => {
          await tx.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('__tx', '\"inside\"')")
          throw new Error('deliberate')
        }).catch(() => undefined)
        const row = await db.get<{ value: string }>("SELECT value FROM settings WHERE key = '__tx'")
        expect(row?.value === '"before"', `value after rollback: ${row?.value}`)
        return 'rolled back'
      },
    },
    {
      name: 'BereanCloud plugin answers (iCloud container status)',
      run: async () => {
        // Availability depends on the account signed in on this device/simulator; the check is
        // that the native plugin is registered and reports a well-formed status either way.
        const st = await BereanCloud.status()
        expect(typeof st.available === 'boolean' && typeof st.signedIn === 'boolean', `malformed status ${JSON.stringify(st)}`)
        return st.available ? `available (${st.containerId}) as "${st.deviceName}"` : `unavailable: ${st.reason}`
      },
    },
  ]
}

export async function runSelfTest(onProgress?: (r: SelfTestResult) => void): Promise<SelfTestResult[]> {
  const results: SelfTestResult[] = []
  for (const c of selfTestChecks()) {
    const t0 = performance.now()
    let r: SelfTestResult
    try {
      const detail = await c.run()
      r = { name: c.name, ok: true, ms: performance.now() - t0, detail }
    } catch (err) {
      r = { name: c.name, ok: false, ms: performance.now() - t0, detail: err instanceof Error ? err.message : String(err) }
    }
    results.push(r)
    onProgress?.(r)
    // Also to the native console so `simctl launch --console` / Xcode show the run without a UI.
    console.log(`[selftest] ${r.ok ? 'PASS' : 'FAIL'} ${r.name} (${r.ms.toFixed(0)} ms) — ${r.detail}`)
  }
  console.log(`[selftest] DONE ${results.filter((r) => r.ok).length}/${results.length} passed`)
  ;(window as unknown as { __bereanSelfTest?: SelfTestResult[] }).__bereanSelfTest = results
  return results
}
