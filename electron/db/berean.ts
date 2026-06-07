import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

// Merge YouTube seed data from the bundled youtube_seed.db into the user's
// berean.db. Uses INSERT OR IGNORE so existing user data is never overwritten.
// Runs once (tracked by the 'youtubeSeedVersion' setting) so re-installs or
// app updates can push a refreshed seed by bumping the seed version number.
export function mergeYouTubeSeed(db: DB): void {
  const SEED_VERSION = 1 // bump this when youtube_seed.db is regenerated

  // Check if already seeded at this version
  const row = db.prepare("SELECT value FROM settings WHERE key='youtubeSeedVersion'").get() as { value: string } | undefined
  if (row && parseInt(row.value ?? '0') >= SEED_VERSION) return

  const seedPath = app.isPackaged
    ? join(process.resourcesPath, 'data', 'youtube_seed.db')
    : join(app.getAppPath(), 'data', 'youtube_seed.db')

  if (!existsSync(seedPath)) {
    console.log('[berean-db] youtube_seed.db not found, skipping seed')
    return
  }

  try {
    db.exec(`ATTACH '${seedPath.replace(/'/g, "''")}' AS seed`)

    const result = db.transaction(() => {
      const videos = db.prepare(`
        INSERT OR IGNORE INTO youtube_videos
          (video_id, title, published, channel_name, channel_handle,
           thumbnail_url, type, is_live_now, fetched_at,
           duration_seconds, is_starred, description)
        SELECT
          video_id, title, published, channel_name, channel_handle,
          thumbnail_url, type, is_live_now, fetched_at,
          duration_seconds, is_starred, description
        FROM seed.youtube_videos
      `).run()

      const syncs = db.prepare(`
        INSERT OR IGNORE INTO youtube_sync (channel_handle, last_full_sync, last_refresh)
        SELECT channel_handle, last_full_sync, last_refresh FROM seed.youtube_sync
      `).run()

      return { videos: videos.changes, syncs: syncs.changes }
    })()

    db.exec('DETACH seed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('youtubeSeedVersion', ?)").run(String(SEED_VERSION))
    console.log(`[berean-db] youtube seed merged: ${result.videos} videos, ${result.syncs} channels`)
  } catch (err) {
    try { db.exec('DETACH seed') } catch { /* ignore */ }
    console.error('[berean-db] youtube seed merge failed:', err)
  }
}

type DB = InstanceType<typeof Database>

let _db: DB | null = null

export function getBereanDb(): DB {
  if (_db) return _db

  const userDataPath = app.getPath('userData')
  if (!existsSync(userDataPath)) mkdirSync(userDataPath, { recursive: true })

  const dbPath = join(userDataPath, 'berean.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  runMigrations(db)

  _db = db
  return db
}

export function closeBereanDb(): void {
  _db?.close()
  _db = null
}

const MIGRATIONS: Array<{ version: number; up: (db: DB) => void }> = [
  {
    version: 1,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notes (
          id         TEXT PRIMARY KEY,
          type       TEXT NOT NULL DEFAULT 'general',
          title      TEXT,
          content    TEXT NOT NULL DEFAULT '',
          verse_ref  TEXT,
          color      TEXT NOT NULL DEFAULT 'blue',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          tags       TEXT NOT NULL DEFAULT '[]'
        );
        CREATE INDEX IF NOT EXISTS idx_notes_verse ON notes(verse_ref);
        CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

        CREATE TABLE IF NOT EXISTS highlights (
          id         TEXT PRIMARY KEY,
          text_id    TEXT NOT NULL,
          book_id    TEXT NOT NULL,
          chapter    INTEGER NOT NULL,
          verse_num  INTEGER NOT NULL,
          start_word INTEGER,
          end_word   INTEGER,
          color      TEXT NOT NULL,
          label      TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_highlights_verse ON highlights(text_id, book_id, chapter, verse_num);

        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspaces (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          layout_json TEXT NOT NULL,
          created_at  INTEGER NOT NULL
        );
      `)

      // Seed default settings
      const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      const defaults: Record<string, unknown> = {
        defaultText:           'kjva',
        showStrongs:           false,
        showStrongsTooltips:   true,
        strongsClickOpensTab:  true,
        fontSize:              16,
        lineHeight:            'comfortable',
        vaultPath:             '',
        vaultSync:             false,
        noteOpenBehavior:      'right-panel',
        verseIndicatorPos:     'right',
        crossTextHighlights:   false,
      }
      for (const [k, v] of Object.entries(defaults)) {
        insertSetting.run(k, JSON.stringify(v))
      }
    }
  },
  {
    version: 2,
    up: (db) => {
      db.exec(`ALTER TABLE highlights ADD COLUMN start_char INTEGER; ALTER TABLE highlights ADD COLUMN end_char INTEGER;`)
    }
  },
  {
    version: 3,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS youtube_videos (
          video_id       TEXT PRIMARY KEY,
          title          TEXT NOT NULL,
          published      TEXT NOT NULL,
          channel_name   TEXT NOT NULL,
          channel_handle TEXT NOT NULL,
          thumbnail_url  TEXT NOT NULL,
          type           TEXT NOT NULL,
          is_live_now    INTEGER NOT NULL DEFAULT 0,
          fetched_at     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_yt_handle   ON youtube_videos(channel_handle);
        CREATE INDEX IF NOT EXISTS idx_yt_published ON youtube_videos(published DESC);

        CREATE TABLE IF NOT EXISTS youtube_sync (
          channel_handle TEXT PRIMARY KEY,
          last_full_sync TEXT,
          last_refresh   TEXT
        );
      `)
    }
  },
  {
    version: 4,
    up: (db) => {
      db.exec(`ALTER TABLE youtube_videos ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0`)
    }
  },
  {
    version: 5,
    up: (db) => {
      db.exec(`ALTER TABLE youtube_videos ADD COLUMN is_starred INTEGER NOT NULL DEFAULT 0`)
      db.exec(`ALTER TABLE youtube_videos ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
      db.exec(`
        CREATE TABLE IF NOT EXISTS youtube_watch_history (
          video_id         TEXT PRIMARY KEY,
          position_seconds REAL NOT NULL DEFAULT 0,
          last_watched     TEXT NOT NULL,
          title            TEXT NOT NULL DEFAULT '',
          channel_name     TEXT NOT NULL DEFAULT '',
          thumbnail_url    TEXT NOT NULL DEFAULT ''
        )
      `)
    }
  },
  {
    // Canonicalise verse_refs for BibleGateway / e-Sword imported notes.
    // Old imports stored human-readable strings like "Matthew 24:32" or
    // "1 Corinthians 13:4" in verse_ref. The app expects the canonical
    // dot-separated format "MAT.24.32" / "1CO.13.4".
    version: 6,
    up: (db) => {
      const BG_NAME_TO_ID: Record<string, string> = {
        'genesis':'GEN','exodus':'EXO','leviticus':'LEV','numbers':'NUM','deuteronomy':'DEU',
        'joshua':'JOS','judges':'JDG','ruth':'RUT',
        '1 samuel':'1SA','2 samuel':'2SA','i samuel':'1SA','ii samuel':'2SA',
        '1 kings':'1KI','2 kings':'2KI','i kings':'1KI','ii kings':'2KI',
        '1 chronicles':'1CH','2 chronicles':'2CH','i chronicles':'1CH','ii chronicles':'2CH',
        'ezra':'EZR','nehemiah':'NEH','esther':'EST','job':'JOB','psalms':'PSA','psalm':'PSA',
        'proverbs':'PRO','ecclesiastes':'ECC','song of solomon':'SNG','song of songs':'SNG',
        'isaiah':'ISA','jeremiah':'JER','lamentations':'LAM','ezekiel':'EZK','daniel':'DAN',
        'hosea':'HOS','joel':'JOL','amos':'AMO','obadiah':'OBA','jonah':'JON','micah':'MIC',
        'nahum':'NAM','habakkuk':'HAB','zephaniah':'ZEP','haggai':'HAG','zechariah':'ZEC','malachi':'MAL',
        'matthew':'MAT','mark':'MRK','luke':'LUK','john':'JHN','acts':'ACT','romans':'ROM',
        '1 corinthians':'1CO','2 corinthians':'2CO','i corinthians':'1CO','ii corinthians':'2CO',
        'galatians':'GAL','ephesians':'EPH','philippians':'PHP','colossians':'COL',
        '1 thessalonians':'1TH','2 thessalonians':'2TH','i thessalonians':'1TH','ii thessalonians':'2TH',
        '1 timothy':'1TI','2 timothy':'2TI','i timothy':'1TI','ii timothy':'2TI',
        'titus':'TIT','philemon':'PHM','hebrews':'HEB','james':'JAS',
        '1 peter':'1PE','2 peter':'2PE','i peter':'1PE','ii peter':'2PE',
        '1 john':'1JN','2 john':'2JN','3 john':'3JN','i john':'1JN','ii john':'2JN','iii john':'3JN',
        'jude':'JUD','revelation':'REV','revelations':'REV',
        'tobit':'TOB','judith':'JDT','wisdom of solomon':'WIS','sirach':'SIR',
        'baruch':'BAR','1 maccabees':'1MA','2 maccabees':'2MA',
        '1 esdras':'1ES','2 esdras':'2ES',
      }

      function toCanonical(ref: string): string | null {
        const raw = ref.trim().replace(/[–—]/g, '-')
        // Already canonical if it matches "BOOKID.chapter.verse"
        if (/^[A-Z0-9]{2,5}\.\d+(\.\d+)?$/.test(raw)) return null // already good
        const m = raw.match(/^((?:\d\s+)?[A-Za-z][A-Za-z\s]+?)\s+(\d+)(?::(\d+)(?:-\d+)?)?$/i)
        if (!m) return null
        const bookRaw = m[1].trim().toLowerCase().replace(/\s+/g, ' ')
        const chapter = parseInt(m[2])
        const verse = m[3] ? parseInt(m[3]) : undefined
        const bookId = BG_NAME_TO_ID[bookRaw]
        if (!bookId || isNaN(chapter)) return null
        return verse ? `${bookId}.${chapter}.${verse}` : `${bookId}.${chapter}`
      }

      // Fetch all imported notes that have a verse_ref set
      const rows = db.prepare(
        `SELECT id, verse_ref FROM notes WHERE (tags LIKE '%biblegateway%' OR tags LIKE '%esword%') AND verse_ref IS NOT NULL AND verse_ref != ''`
      ).all() as Array<{ id: string; verse_ref: string }>

      const update = db.prepare('UPDATE notes SET verse_ref = ? WHERE id = ?')
      let fixed = 0
      for (const { id, verse_ref } of rows) {
        const canonical = toCanonical(verse_ref)
        if (canonical) { update.run(canonical, id); fixed++ }
      }
      console.log(`[berean-db] v6: canonicalised ${fixed} imported note verse_refs`)
    }
  },
  {
    // Strip the "---\n*Imported from BibleGateway/e-Sword on <date>*" footer that
    // was previously appended to imported note content. The footer is now rendered
    // as a separate collapsed UI element and should not live in the editable text.
    version: 7,
    up: (db) => {
      const rows = db.prepare(
        `SELECT id, content FROM notes WHERE (tags LIKE '%biblegateway%' OR tags LIKE '%esword%') AND content LIKE '%Imported from%'`
      ).all() as Array<{ id: string; content: string }>

      const update = db.prepare('UPDATE notes SET content = ? WHERE id = ?')
      let fixed = 0
      for (const { id, content } of rows) {
        // Strip "---\n*Imported from BibleGateway/e-Sword on <date>*" and any variants
        const cleaned = content
          .replace(/\n\n---\n\*Imported from (?:BibleGateway|e-Sword)[^*]*\*\s*$/s, '')
          .trimEnd()
        if (cleaned !== content) { update.run(cleaned, id); fixed++ }
      }
      console.log(`[berean-db] v7: stripped import footers from ${fixed} notes`)
    }
  },
  {
    // Add imported_at column to notes. For new BG/eSword imports this is set to
    // the actual Berean import time (Date.now()). Existing imported notes that
    // already had their footer stripped by v7 get NULL (date unrecoverable).
    version: 8,
    up: (db) => {
      db.exec(`ALTER TABLE notes ADD COLUMN imported_at INTEGER`)
      console.log(`[berean-db] v8: added imported_at column to notes`)
    }
  },
  {
    // Persistent history table (replaces Zustand/localStorage storage)
    // + state_json column on workspaces for full snapshot save/restore
    // + onboarding tracking in settings
    version: 9,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id            TEXT PRIMARY KEY,
          type          TEXT NOT NULL,
          title         TEXT NOT NULL,
          timestamp     INTEGER NOT NULL,
          session_id    TEXT,
          session_name  TEXT,
          book_id       TEXT,
          chapter       INTEGER,
          verse         INTEGER,
          note_id       TEXT,
          strongs_num   TEXT,
          video_id      TEXT,
          query         TEXT,
          parent_id     TEXT,
          import_source TEXT,
          import_count  INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_history_ts ON history(timestamp DESC);
      `)
      // Add state snapshot column to workspaces (safe to ignore if already exists — shouldn't be)
      try { db.exec(`ALTER TABLE workspaces ADD COLUMN state_json TEXT`) } catch {}
      // Onboarding flag
      db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('onboardingCompleted', 'false')
      console.log('[berean-db] v9: history table, workspaces.state_json, onboarding setting')
    }
  },
  {
    // Note folders: user-created, nestable. System folders (Daily/eSword/BibleGateway)
    // are virtual (computed from note type/tags), not stored here.
    version: 10,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS note_folders (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          parent_id  TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_note_folders_parent ON note_folders(parent_id);
      `)
      try { db.exec(`ALTER TABLE notes ADD COLUMN folder_id TEXT`) } catch {}
      console.log('[berean-db] v10: note_folders table + notes.folder_id')
    }
  },
  {
    version: 11,
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pdfs (
          id          TEXT PRIMARY KEY,
          title       TEXT NOT NULL,
          filename    TEXT NOT NULL,
          page_count  INTEGER NOT NULL DEFAULT 0,
          file_size   INTEGER NOT NULL DEFAULT 0,
          imported_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pdf_highlights (
          id          TEXT PRIMARY KEY,
          pdf_id      TEXT NOT NULL,
          page        INTEGER NOT NULL,
          rects_json  TEXT NOT NULL,
          color       TEXT NOT NULL,
          text        TEXT NOT NULL DEFAULT '',
          note        TEXT,
          created_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pdf_hl_pdf ON pdf_highlights(pdf_id);
      `)
      console.log('[berean-db] v11: pdfs + pdf_highlights tables')
    }
  },
  {
    version: 12,
    up: (db) => {
      // Per-note version history (Google-Docs-style snapshots).
      db.exec(`
        CREATE TABLE IF NOT EXISTS note_versions (
          id         TEXT PRIMARY KEY,
          note_id    TEXT NOT NULL,
          title      TEXT,
          content    TEXT NOT NULL DEFAULT '',
          kind       TEXT NOT NULL DEFAULT 'auto',
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_note_versions_note ON note_versions(note_id, created_at DESC);
      `)
      // Translation a verse note is attached to (mirrors highlights.text_id). Existing
      // notes default to 'kjva'.
      const cols = db.prepare(`PRAGMA table_info(notes)`).all() as Array<{ name: string }>
      if (!cols.some(c => c.name === 'text_id')) {
        db.exec(`ALTER TABLE notes ADD COLUMN text_id TEXT DEFAULT 'kjva'`)
      }
      console.log('[berean-db] v12: note_versions table + notes.text_id column')
    }
  }
]

function runMigrations(db: DB): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)`)

  const row = db.prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number | null }
  const current = row.v ?? 0

  for (const migration of MIGRATIONS) {
    if (migration.version > current) {
      db.transaction(() => {
        migration.up(db)
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(migration.version)
      })()
      console.log(`[berean-db] migrated to v${migration.version}`)
    }
  }
}
