import Database from 'better-sqlite3'
import { join } from 'path'
import { app } from 'electron'
import { is } from '@electron-toolkit/utils'

let hebrewDb: Database.Database | null = null
let greekDb: Database.Database | null = null

function dataPath(filename: string): string {
  return is.dev
    ? join(process.cwd(), 'data', filename)
    : join(process.resourcesPath, 'data', filename)
}

export function getHebrewDb(): Database.Database {
  if (!hebrewDb) {
    hebrewDb = new Database(dataPath('strongs_hebrew.db'), { readonly: true })
    // WAL mode needs write access to the DB directory for .db-shm files.
    // The packaged app's Resources/data/ is read-only on Windows and in the
    // Mac App Store sandbox, so only enable WAL in dev.
    if (!app.isPackaged) hebrewDb.pragma('journal_mode = WAL')
  }
  return hebrewDb
}

export function getGreekDb(): Database.Database {
  if (!greekDb) {
    greekDb = new Database(dataPath('strongs_greek.db'), { readonly: true })
    if (!app.isPackaged) greekDb.pragma('journal_mode = WAL')
  }
  return greekDb
}

export function closeLexiconDbs(): void {
  hebrewDb?.close()
  greekDb?.close()
  hebrewDb = null
  greekDb = null
}
