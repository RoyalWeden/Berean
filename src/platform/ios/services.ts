import { createServiceEvents, consoleLogger, defaultUuid, type ServiceContext } from '../services/context'
import { createServices, type Services } from '../services'
import { runMigrations } from '../db/bereanMigrations'
import { CapacitorSqliteAdapter } from './capacitorSqliteAdapter'
import { BereanSQLite } from './plugins'
import { mergeYoutubeIndex } from '../services/youtubeIndexMerge'
import type { DatabaseAdapter } from '../db/DatabaseAdapter'

/**
 * iOS host for the shared services (docs/mobile/architecture.md §3–4): the same registry the
 * Electron main process builds in electron/servicesHost.ts, over the BereanSQLite plugin instead
 * of better-sqlite3. Bundled text/lexicon/cross-ref DBs open read-only in place from the app
 * bundle; berean.db lives in Application Support and runs the shared migration history.
 */

/** textId → bundled file, identical to electron/db/bible.ts's TEXT_FILES. */
export const TEXT_FILES: Record<string, string> = {
  kjva: 'kjva.db',
  kjv: 'kjv.db',
  lxx: 'lxx_brenton.db',
  enoch: 'enoch.db',
  jubilees: 'jubilees.db',
  apoc_elijah: 'apoc_elijah.db',
  recog_clement: 'recog_clement.db',
  hermas: 'hermas.db',
  hermas_taylor: 'hermas_taylor.db',
  asc_isaiah: 'asc_isaiah.db',
  ep_barnabas: 'ep_barnabas.db',
  t12p: 't12p.db',
  gad: 'gad.db',
  t_job: 't_job.db',
  '1clement': '1clement.db',
  apoc_abraham: 'apoc_abraham.db',
  didache_hoole: 'didache_hoole.db',
  t_jacob: 't_jacob.db',
  '2baruch': '2baruch.db',
}

const bundlePath = (file: string) => `bundle:data/${file}`

let _services: Services | null = null
let _ctx: ServiceContext | null = null
let _initPromise: Promise<Services> | null = null

const textAdapters = new Map<string, Promise<DatabaseAdapter | null>>()
const lexAdapters = new Map<'H' | 'G', Promise<DatabaseAdapter>>()
const dataAdapters = new Map<string, Promise<DatabaseAdapter | null>>()

async function openBundled(file: string, label: string): Promise<DatabaseAdapter | null> {
  const info = await BereanSQLite.fileInfo({ path: bundlePath(file) })
  if (!info.exists) {
    console.warn(`[ios-services] bundled database missing: ${file}`)
    return null
  }
  return CapacitorSqliteAdapter.open(bundlePath(file), { readOnly: true, label })
}

export async function initIosServices(): Promise<Services> {
  if (_services) return _services
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    const userDb = await CapacitorSqliteAdapter.open('appsupport:berean.db', { label: 'berean.db' })
    // Before an upgrade migrates berean.db: integrity check (a damaged file is never migrated) and
    // a consistent backup, newest 3 kept (DATA-SAFE-070).
    const applied = await runMigrations(userDb, undefined, {
      beforeMigrate: async (from, to) => { const p = await userDb.backup(`berean-v${from}-to-v${to}-${Date.now()}.db`, 3); console.log(`[ios-services] backup before migration: ${p}`) },
      onBackupFailed: (err) => console.warn('[ios-services] backup before migration failed', err),
    })
    if (applied.length) console.log(`[ios-services] berean.db migrated: applied v${applied.join(', v')}`)

    const ctx: ServiceContext = {
      userDb,
      textDb: (textId) => {
        const file = TEXT_FILES[textId]
        if (!file) return Promise.resolve(null)
        let p = textAdapters.get(textId)
        if (!p) { p = openBundled(file, `text:${textId}`); textAdapters.set(textId, p) }
        return p
      },
      lexiconDb: (lang) => {
        let p = lexAdapters.get(lang)
        if (!p) {
          p = openBundled(lang === 'H' ? 'strongs_hebrew.db' : 'strongs_greek.db', `lexicon:${lang}`)
            .then((a) => { if (!a) throw new Error(`lexicon database missing for ${lang}`); return a })
          lexAdapters.set(lang, p)
        }
        return p
      },
      dataDb: (name) => {
        let p = dataAdapters.get(name)
        if (!p) { p = openBundled(`${name}.db`, `data:${name}`); dataAdapters.set(name, p) }
        return p
      },
      events: createServiceEvents(),
      now: () => Date.now(),
      uuid: defaultUuid,
      isDev: import.meta.env.DEV,
      log: consoleLogger,
    }
    _ctx = ctx
    _services = createServices(ctx)
    // YouTube index (D-007): videos + channel rows + transcript metadata, merged once per seed
    // version like desktop's mergeYouTubeSeed. Missing on a build without the generated file —
    // the YouTube space then simply starts empty, never fails to boot.
    // Runs in the BACKGROUND (perf pass 2026-10-05): it used to be awaited here, so a new seed
    // version delayed the first Scripture paint by the whole merge. The adapter queues every
    // outside statement behind the merge's transaction, so a YouTube read during it just waits.
    void (async () => {
      try {
        const info = await BereanSQLite.fileInfo({ path: bundlePath('youtube_index.db') })
        if (info.exists) {
          const r = await mergeYoutubeIndex(userDb, bundlePath('youtube_index.db'))
          if (r.merged) console.log(`[ios-services] youtube index merged (seed v${r.seedVersion})`)
        } else console.warn('[ios-services] youtube_index.db not bundled — run scripts/data/split-youtube-seed.mjs')
      } catch (err) { console.warn('[ios-services] youtube index merge failed', err) }
    })()
    return _services
  })()
  return _initPromise
}

export function iosServices(): Services {
  if (!_services) throw new Error('iosServices() called before initIosServices() resolved')
  return _services
}

export function iosServiceContext(): ServiceContext {
  if (!_ctx) throw new Error('iosServiceContext() called before initIosServices() resolved')
  return _ctx
}
