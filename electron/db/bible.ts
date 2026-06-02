import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'

type DB = InstanceType<typeof Database>

const dbCache = new Map<string, DB>()

const TEXT_FILES: Record<string, string> = {
  kjva:          'kjva.db',
  kjv:           'kjv.db',
  lxx:           'lxx_brenton.db',
  enoch:         'enoch.db',
  jubilees:      'jubilees.db',
  apoc_elijah:   'apoc_elijah.db',
  recog_clement: 'recog_clement.db',
  hermas:        'hermas.db',
  asc_isaiah:    'asc_isaiah.db',
  ep_barnabas:   'ep_barnabas.db',
  t12p:          't12p.db',
  gad:           'gad.db',
  t_job:         't_job.db',
  '1clement':    '1clement.db',
  apoc_abraham:  'apoc_abraham.db',
}

function dataPath(filename: string): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'data', filename)
  }
  // Dev: __dirname = out/main/, data/ is two levels up at project root
  return join(__dirname, '../../data', filename)
}

export function getTextDb(textId: string): DB | null {
  if (dbCache.has(textId)) return dbCache.get(textId)!

  const filename = TEXT_FILES[textId]
  if (!filename) return null

  const path = dataPath(filename)
  if (!existsSync(path)) {
    console.warn(`[bible-db] not found: ${path}`)
    return null
  }

  const db = new Database(path, { readonly: true })
  dbCache.set(textId, db)
  return db
}

export function closeAllTextDbs(): void {
  for (const db of dbCache.values()) db.close()
  dbCache.clear()
}
