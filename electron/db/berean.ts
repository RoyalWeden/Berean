import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, existsSync } from 'fs'

// Merge YouTube seed data from the bundled youtube_seed.db into the user's
// berean.db. Uses INSERT OR IGNORE so existing user data is never overwritten.
// Runs once (tracked by the 'youtubeSeedVersion' setting) so re-installs or
// app updates can push a refreshed seed by bumping the seed version number.
export function mergeYouTubeSeed(db: DB): void {
  const SEED_VERSION = 2 // bump this when youtube_seed.db is regenerated (v2 adds transcripts)

  // Check if already seeded at this version
  const row = db.prepare("SELECT value FROM settings WHERE key='youtubeSeedVersion'").get() as { value: string } | undefined
  if (row && parseInt(row.value ?? '0') >= SEED_VERSION) return

  const seedPath = app.isPackaged
    ? join(process.resourcesPath, 'data', 'youtube_seed.db')
    : join(app.getAppPath(), 'data', 'youtube_seed.db')

  if (!existsSync(seedPath)) {
    return
  }

  try {
    db.exec(`ATTACH '${seedPath.replace(/'/g, "''")}' AS seed`)

    db.transaction(() => {
      db.prepare(`
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

      db.prepare(`
        INSERT OR IGNORE INTO youtube_sync (channel_handle, last_full_sync, last_refresh)
        SELECT channel_handle, last_full_sync, last_refresh FROM seed.youtube_sync
      `).run()

      // Transcripts (only present in seed v2+). Guard against an older seed that lacks them.
      const hasTranscripts = db.prepare(
        "SELECT name FROM seed.sqlite_master WHERE type='table' AND name='youtube_transcripts'"
      ).get() as { name: string } | undefined

      if (hasTranscripts) {
        // Metadata rows FIRST — youtube_transcript_segments.video_id REFERENCES
        // youtube_transcripts(video_id) and foreign_keys=ON (see getBereanDb below), so
        // inserting segments before their parent row exists violates the FK constraint and
        // aborts the whole transaction. (Previously segments were inserted first here, which
        // silently rolled back this entire merge — and re-attempted and re-failed on every
        // single app launch, since youtubeSeedVersion below is only ever reached on success.)
        db.prepare(`
          INSERT OR IGNORE INTO youtube_transcripts
            (video_id, lang, source, fetched_at, segment_count, duration_ms, error)
          SELECT video_id, lang, source, fetched_at, segment_count, duration_ms, error
          FROM seed.youtube_transcripts
        `).run()

        // Then segments, gated on youtube_transcript_segments itself (not youtube_transcripts —
        // that table was just populated with EVERY seed video_id above, so gating on it here
        // would skip every row). Checking segments directly still correctly skips videos the
        // user already had transcript content for from an earlier seed merge. We omit the
        // explicit segment `id` so SQLite assigns fresh rowids and the FTS5 AFTER-INSERT
        // trigger indexes each row.
        db.prepare(`
          INSERT INTO youtube_transcript_segments (video_id, start_ms, dur_ms, text)
          SELECT s.video_id, s.start_ms, s.dur_ms, s.text
          FROM seed.youtube_transcript_segments s
          WHERE s.video_id NOT IN (SELECT DISTINCT video_id FROM youtube_transcript_segments)
        `).run()
      }
    })()

    db.exec('DETACH seed')
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('youtubeSeedVersion', ?)").run(String(SEED_VERSION))
  } catch (err) {
    console.error('[mergeYouTubeSeed] failed, rolled back:', err)
    try { db.exec('DETACH seed') } catch { /* ignore */ }
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
    }
  },
  {
    // Add imported_at column to notes. For new BG/eSword imports this is set to
    // the actual Berean import time (Date.now()). Existing imported notes that
    // already had their footer stripped by v7 get NULL (date unrecoverable).
    version: 8,
    up: (db) => {
      db.exec(`ALTER TABLE notes ADD COLUMN imported_at INTEGER`)
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
    }
  },
  {
    version: 13,
    up: (db) => {
      db.exec(`
        -- Transcript metadata (one row per video)
        CREATE TABLE IF NOT EXISTS youtube_transcripts (
          video_id      TEXT PRIMARY KEY,
          lang          TEXT NOT NULL DEFAULT 'en',
          source        TEXT NOT NULL DEFAULT 'timedtext',
          fetched_at    INTEGER NOT NULL,
          segment_count INTEGER NOT NULL DEFAULT 0,
          duration_ms   INTEGER NOT NULL DEFAULT 0,
          error         TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_yt_transcripts_fetched
          ON youtube_transcripts(fetched_at DESC);

        -- Individual caption cues
        CREATE TABLE IF NOT EXISTS youtube_transcript_segments (
          id       INTEGER PRIMARY KEY,
          video_id TEXT NOT NULL
            REFERENCES youtube_transcripts(video_id) ON DELETE CASCADE,
          start_ms INTEGER NOT NULL,
          dur_ms   INTEGER NOT NULL DEFAULT 0,
          text     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_yt_seg_video
          ON youtube_transcript_segments(video_id, start_ms);

        -- FTS5 content-table (index only; triggers keep in sync with segments)
        CREATE VIRTUAL TABLE IF NOT EXISTS youtube_transcripts_fts USING fts5(
          text,
          content='youtube_transcript_segments',
          content_rowid='id',
          tokenize='unicode61'
        );

        -- Keep FTS5 in sync with segment rows
        CREATE TRIGGER IF NOT EXISTS yt_seg_ai
        AFTER INSERT ON youtube_transcript_segments BEGIN
          INSERT INTO youtube_transcripts_fts(rowid, text)
          VALUES (new.id, new.text);
        END;

        CREATE TRIGGER IF NOT EXISTS yt_seg_ad
        AFTER DELETE ON youtube_transcript_segments BEGIN
          INSERT INTO youtube_transcripts_fts(youtube_transcripts_fts, rowid, text)
          VALUES ('delete', old.id, old.text);
        END;

        CREATE TRIGGER IF NOT EXISTS yt_seg_au
        AFTER UPDATE ON youtube_transcript_segments BEGIN
          INSERT INTO youtube_transcripts_fts(youtube_transcripts_fts, rowid, text)
          VALUES ('delete', old.id, old.text);
          INSERT INTO youtube_transcripts_fts(rowid, text)
          VALUES (new.id, new.text);
        END;
      `)

      // Seed transcript feature defaults
      const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)')
      ins.run('transcriptAutoFetch', 'true')
      ins.run('transcriptStorageLimitMb', '200')

      console.log('[berean-db] v13: youtube_transcripts + FTS5 + triggers + setting seeds')
    }
  },
  {
    version: 14,
    up(db) {
      try { db.exec(`ALTER TABLE notes ADD COLUMN idiom_term TEXT`) } catch {}
      try { db.exec(`ALTER TABLE notes ADD COLUMN idiom_meaning TEXT`) } catch {}
      console.log('[berean-db] v14: idiom_term + idiom_meaning columns on notes')
    }
  },
  {
    version: 15,
    up(db) {
      try { db.exec(`ALTER TABLE notes ADD COLUMN idiom_aliases TEXT`) } catch {}
      console.log('[berean-db] v15: idiom_aliases column on notes')
    }
  },
  {
    version: 16,
    up(db) {
      try { db.exec(`ALTER TABLE notes ADD COLUMN idiom_auto_variants INTEGER DEFAULT 0`) } catch {}
      console.log('[berean-db] v16: idiom_auto_variants column on notes')
    }
  },
  {
    version: 17,
    up(db) {
      // Structured idiom fields (JSON): { examples: string[], explanation, compare: string[], verses: string[] }
      try { db.exec(`ALTER TABLE notes ADD COLUMN idiom_data TEXT`) } catch {}
      console.log('[berean-db] v17: idiom_data column on notes')
    }
  },
  {
    // FTS5 full-text index over notes(title, content) to replace the unindexed
    // `title LIKE '%q%' OR content LIKE '%q%'` full-table scan in notes:search.
    // External-content table (index only) kept in sync by triggers, mirroring the
    // youtube_transcripts_fts pattern. `rebuild` backfills every existing note in
    // one shot, so upgraded databases with pre-existing notes get indexed here.
    //
    // NOTE: version 18 was already consumed by an unrelated migration on another
    // branch (Octarine vault integration) that ran against the same shared dev
    // database, so this migration is stamped 19 instead to avoid being silently
    // skipped by the `migration.version > current` guard below.
    version: 19,
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
          title,
          content,
          content='notes',
          content_rowid='rowid',
          tokenize='unicode61'
        );

        CREATE TRIGGER IF NOT EXISTS notes_ai
        AFTER INSERT ON notes BEGIN
          INSERT INTO notes_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_ad
        AFTER DELETE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
        END;

        CREATE TRIGGER IF NOT EXISTS notes_au
        AFTER UPDATE ON notes BEGIN
          INSERT INTO notes_fts(notes_fts, rowid, title, content)
          VALUES ('delete', old.rowid, old.title, old.content);
          INSERT INTO notes_fts(rowid, title, content)
          VALUES (new.rowid, new.title, new.content);
        END;
      `)
      // Backfill existing notes into the index (idempotent full rebuild).
      db.exec(`INSERT INTO notes_fts(notes_fts) VALUES('rebuild')`)
      console.log('[berean-db] v19: notes_fts FTS5 + triggers + backfill')
    }
  },
  {
    // Lifecycle-tracking status for notes: 'started' | 'in-progress' | 'complete' |
    // 'make-video' | 'archive' | NULL (no status — most notes aren't expected to use this).
    version: 20,
    up(db) {
      try { db.exec(`ALTER TABLE notes ADD COLUMN status TEXT`) } catch {}
      console.log('[berean-db] v20: status column on notes')
    }
  },
  {
    // AI Scripture Lookup — saved chats. Each chat is a JSON-encoded array of
    // messages (see electron/ipc/aiLookup.ts's ChatMessage shape); the floating
    // panel's own open/position/commentary-toggle state lives in the renderer's
    // persisted zustand store instead, not here.
    version: 21,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_chats (
          id         TEXT PRIMARY KEY,
          title      TEXT NOT NULL,
          messages   TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_ai_chats_updated ON ai_chats(updated_at DESC);
      `)
      console.log('[berean-db] v21: ai_chats table')
    }
  },
  {
    // Notes trash: soft-delete instead of immediate permanent removal. `deleted_at` is a
    // Unix-ms timestamp, NULL for a normal (non-trashed) note — every existing note-listing
    // query gets a `deleted_at IS NULL` filter added alongside this (see electron/ipc/notes.ts).
    // Folders themselves are NOT soft-deleted (folders:deleteDeep still hard-deletes the folder
    // rows) — only notes go to trash, deliberately narrower scope; a note whose folder was
    // hard-deleted restores to root (folder_id NULL) instead of a now-nonexistent folder.
    version: 22,
    up(db) {
      try { db.exec(`ALTER TABLE notes ADD COLUMN deleted_at INTEGER`) } catch {}
      db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_deleted_at ON notes(deleted_at)`)
      console.log('[berean-db] v22: deleted_at column on notes (trash)')
    }
  },
  {
    // Page icon: a single emoji shown next to a note's title (list row, board card, editor
    // header) — purely decorative, same spirit as `color`. NULL/undefined = no icon, falls
    // back to a default glyph in NoteIcon.tsx.
    version: 23,
    up(db) {
      try { db.exec(`ALTER TABLE notes ADD COLUMN icon TEXT`) } catch {}
      console.log('[berean-db] v23: icon column on notes')
    }
  },
  {
    // Persisted heading-collapse state (notes editor, round 12 item 6) — headingCollapse.ts's
    // comment used to say this was PURE EPHEMERAL UI STATE, never persisted; this table is
    // what lifts that limit. Deliberately NOT stored in the note's own markdown content (that
    // would break lossless Obsidian round-trip — see NoteEditorPM.tsx's dispatchTransaction,
    // which re-serializes markdown on every keystroke and writes it straight to the vault).
    // `heading_key` is a caller-computed stable identity (level + text + an ordinal for
    // duplicate headings — see headingCollapse.ts's computeHeadingKey), NOT a raw document
    // position: positions shift on every edit anywhere earlier in the note, so they can't
    // survive being written out and read back on a later session. No foreign key to `notes`
    // — a row whose note (or whose heading) no longer exists is simply never matched back to
    // a live position at load time (electron/ipc/notes.ts's notes:getCollapsedHeadings /
    // NoteEditorPM.tsx's load-time translation), the "degrade silently" behavior the task
    // brief calls for, rather than something that needs active enforcement here.
    version: 24,
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS note_heading_collapse (
          note_id     TEXT NOT NULL,
          heading_key TEXT NOT NULL,
          collapsed   INTEGER NOT NULL DEFAULT 1,
          PRIMARY KEY (note_id, heading_key)
        );
      `)
      console.log('[berean-db] v24: note_heading_collapse table')
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
    }
  }
}
