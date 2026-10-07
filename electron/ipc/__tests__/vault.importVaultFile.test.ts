// Tests for the vault → notes import engine (electron/ipc/vault.ts): importVaultFile, its pure
// helpers (vaultRelPath / isHiddenVaultPath / vaultPathNoteId), runImportAll, vaultHasData, and
// the cross-window refresh broadcast. See CLAUDE.md §9/§17/§18 and the post-0.7.0 vault-import
// lane brief for the requirements this covers.
//
// better-sqlite3 in this repo is compiled against Electron's ABI and cannot load under plain
// Node (see lexicon.occurrences.test.ts) — so these tests run the REAL shared migration history
// (src/platform/db/bereanMigrations.ts) over node:sqlite via migratedUserDb(), then hand
// vault.ts's DB-touching functions the adapter's raw synchronous driver (.prepare().get()/.run()
// — the same shape better-sqlite3's Database exposes) wrapped with a no-op `.transaction()`.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { migratedUserDb } from '../../../src/platform/db/__tests__/testDb'
import type { SyncSqliteAdapter } from '../../db/adapters/syncSqliteAdapter'

type SentMessage = { winId: number; channel: string }
let sent: SentMessage[] = []
let fakeWindows: Array<{ webContents: { send: (ch: string) => void }; isDestroyed: () => boolean }> = []

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false, whenReady: () => Promise.resolve() },
  BrowserWindow: { getAllWindows: () => fakeWindows, fromWebContents: () => undefined },
}))
vi.mock('chokidar', () => ({ default: { watch: () => ({ on: () => {}, close: () => {} }) } }))
vi.mock('../../db/bible', () => ({ getTextDb: () => null }))
vi.mock('../powerAwareness', () => ({ getResourceMode: () => 'normal' }))

// Populated in beforeEach; the factory closes over this binding (vitest hoists the vi.mock call
// but the factory body only runs lazily, on first import of '../../db/berean').
// eslint-disable-next-line prefer-const
let fakeDb: unknown
vi.mock('../../db/berean', () => ({ getBereanDb: () => fakeDb }))

describe('vault import engine', () => {
  let vault: typeof import('../vault')
  let tmpVault: string
  let adapter: SyncSqliteAdapter

  beforeEach(async () => {
    vault = await import('../vault')
    adapter = (await migratedUserDb(`vault-import-test-${Math.random()}`)) as unknown as SyncSqliteAdapter
    const raw = adapter.raw
    fakeDb = {
      prepare: (sql: string) => raw.prepare(sql),
      transaction: (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => fn(...a),
    }
    tmpVault = mkdtempSync(join(tmpdir(), 'berean-vault-import-test-'))
    sent = []
    fakeWindows = [{ webContents: { send: (ch: string) => sent.push({ winId: 0, channel: ch }) }, isDestroyed: () => false }]
  })

  afterEach(() => {
    rmSync(tmpVault, { recursive: true, force: true })
  })

  function setVaultPath(p: string) {
    const raw = adapter.raw
    raw.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('vaultPath', JSON.stringify(p))
  }

  function noteRow(id: string): { id: string; type: string; title: string | null; content: string; verse_ref: string | null; folder_id: string | null; updated_at: number } | undefined {
    return adapter.raw.prepare('SELECT id, type, title, content, verse_ref, folder_id, updated_at FROM notes WHERE id = ?').get(id) as never
  }

  function countNotes(): number {
    return (adapter.raw.prepare('SELECT COUNT(*) as c FROM notes').get() as { c: number }).c
  }

  // ── Pure helpers ────────────────────────────────────────────────────────────

  it('vaultRelPath: normalizes to forward slashes', () => {
    const rel = vault.vaultRelPath('/vault', '/vault/sub/dir/note.md')
    expect(rel).toBe('sub/dir/note.md')
  })

  it('isHiddenVaultPath: flags dotfiles / dot-directories at any depth', () => {
    expect(vault.isHiddenVaultPath('note.md')).toBe(false)
    expect(vault.isHiddenVaultPath('folder/note.md')).toBe(false)
    expect(vault.isHiddenVaultPath('.obsidian/workspace.json')).toBe(true)
    expect(vault.isHiddenVaultPath('.trash/note.md')).toBe(true)
    expect(vault.isHiddenVaultPath('.berean/export.json')).toBe(true)
    expect(vault.isHiddenVaultPath('.git/HEAD')).toBe(true)
    expect(vault.isHiddenVaultPath('folder/.hidden/note.md')).toBe(true)
  })

  it('vaultPathNoteId: deterministic, UUID-shaped, case-insensitive, distinct per path', () => {
    const a = vault.vaultPathNoteId('Journal/2026-01-01.md')
    const b = vault.vaultPathNoteId('Journal/2026-01-01.md')
    const d = vault.vaultPathNoteId('Journal/2026-01-02.md')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(vault.vaultPathNoteId('journal/2026-01-01.md')).toBe(a) // case-insensitive
    expect(d).not.toBe(a)
  })

  // ── importVaultFile: foreign (no berean_id) files ──────────────────────────

  it('imports a plain foreign note (no frontmatter) as a general note, titled from the filename', () => {
    const filePath = join(tmpVault, 'My Thoughts.md')
    writeFileSync(filePath, 'Just some plain Markdown text, no frontmatter at all.')
    const cache = new Map<string, string>()
    const r = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    expect(r.outcome).toBe('created')
    const row = noteRow(r.noteId!)
    expect(row?.type).toBe('general')
    expect(row?.title).toBe('My Thoughts')
    expect(row?.content.trim()).toBe('Just some plain Markdown text, no frontmatter at all.')
    expect(row?.folder_id).toBeNull()
  })

  it('re-importing an unchanged foreign file is a no-op (dedupe by vault-relative path)', () => {
    const filePath = join(tmpVault, 'Note.md')
    writeFileSync(filePath, 'content one')
    const cache = new Map<string, string>()
    const first = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    expect(first.outcome).toBe('created')
    expect(countNotes()).toBe(1)

    const second = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    expect(second.outcome).toBe('unchanged')
    expect(second.noteId).toBe(first.noteId)
    expect(countNotes()).toBe(1)
  })

  it('a modified foreign note (newer mtime, different body) updates the existing row', () => {
    const filePath = join(tmpVault, 'Note.md')
    writeFileSync(filePath, 'original content')
    const cache = new Map<string, string>()
    const first = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'newer-wins')
    expect(first.outcome).toBe('created')

    // Push the existing row's updated_at far into the past, then give the file a clearly later
    // mtime, so the importer's "fileIsNewer" check (mtime > existing.updated_at + 1000) passes
    // deterministically regardless of how fast this test runs.
    adapter.raw.prepare('UPDATE notes SET updated_at = ? WHERE id = ?').run(1_000_000, first.noteId)
    writeFileSync(filePath, 'edited content')
    const future = new Date(Date.now() + 60_000)
    utimesSync(filePath, future, future)

    const second = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'newer-wins')
    expect(second.outcome).toBe('updated')
    expect(countNotes()).toBe(1)
    expect(noteRow(first.noteId!)?.content.trim()).toBe('edited content')
  })

  it('preserves nested folder structure, reusing the same note_folders chain across files', () => {
    mkdirSync(join(tmpVault, 'Old Testament', 'Genesis'), { recursive: true })
    const f1 = join(tmpVault, 'Old Testament', 'Genesis', 'Creation.md')
    const f2 = join(tmpVault, 'Old Testament', 'Genesis', 'Flood.md')
    writeFileSync(f1, 'note about creation')
    writeFileSync(f2, 'note about the flood')
    const cache = new Map<string, string>()
    const r1 = vault.importVaultFile(fakeDb as never, tmpVault, f1, cache, 'vault-wins')
    const r2 = vault.importVaultFile(fakeDb as never, tmpVault, f2, cache, 'vault-wins')
    const row1 = noteRow(r1.noteId!)
    const row2 = noteRow(r2.noteId!)
    expect(row1?.folder_id).not.toBeNull()
    expect(row1?.folder_id).toBe(row2?.folder_id) // same "Old Testament/Genesis" chain reused

    const folders = adapter.raw.prepare('SELECT id, name, parent_id FROM note_folders').all() as Array<{ id: string; name: string; parent_id: string | null }>
    expect(folders.map((f) => f.name).sort()).toEqual(['Genesis', 'Old Testament'])
    const genesis = folders.find((f) => f.name === 'Genesis')!
    const ot = folders.find((f) => f.name === 'Old Testament')!
    expect(genesis.parent_id).toBe(ot.id)
  })

  it('never resurrects a note the user trashed in Berean (deleted_at set)', () => {
    const filePath = join(tmpVault, 'Trashed.md')
    writeFileSync(filePath, 'v1')
    const cache = new Map<string, string>()
    const first = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    adapter.raw.prepare('UPDATE notes SET deleted_at = ? WHERE id = ?').run(Date.now(), first.noteId)

    writeFileSync(filePath, 'v2 — edited after trashing')
    const future = new Date(Date.now() + 60_000)
    utimesSync(filePath, future, future)
    const second = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    expect(second.outcome).toBe('skipped')
  })

  it('skips Berean-generated highlight sidecar files under Verse Notes/ (no berean_id, dotted ref)', () => {
    mkdirSync(join(tmpVault, 'Verse Notes', 'Genesis', '1'), { recursive: true })
    const filePath = join(tmpVault, 'Verse Notes', 'Genesis', '1', 'highlight.md')
    writeFileSync(filePath, '---\ntype: verse-note\nref: GEN.1.1\n---\n\nhighlighted text only')
    const cache = new Map<string, string>()
    const r = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    expect(r.outcome).toBe('skipped')
    expect(countNotes()).toBe(0)
  })

  it('skips hidden/system paths (.obsidian, .trash, .git, dotfiles)', () => {
    for (const rel of ['.obsidian/workspace.json', '.trash/old.md', '.git/config', '.DS_Store']) {
      mkdirSync(join(tmpVault, rel.split('/').slice(0, -1).join('/') || '.'), { recursive: true })
      const filePath = join(tmpVault, rel)
      writeFileSync(filePath, 'irrelevant')
      const cache = new Map<string, string>()
      const r = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
      expect(r.outcome).toBe('skipped')
    }
    expect(countNotes()).toBe(0)
  })

  // ── importVaultFile: Berean-owned (berean_id) files ────────────────────────

  it('imports a Berean-owned verse note by berean_id and resolves its verse ref', () => {
    const filePath = join(tmpVault, 'Gen_1_1_note1.md')
    writeFileSync(filePath, [
      '---',
      'type: verse-note',
      'ref: Gen 1:1',
      'created: 2025-01-15T10:30:00',
      'updated: 2025-01-15T14:22:00',
      'tags: [creation]',
      'color: blue',
      'berean_id: abc123-uuid',
      '---',
      '',
      'In the beginning...',
    ].join('\n'))
    const cache = new Map<string, string>()
    const r = vault.importVaultFile(fakeDb as never, tmpVault, filePath, cache, 'vault-wins')
    expect(r.outcome).toBe('created')
    expect(r.noteId).toBe('abc123-uuid')
    const row = noteRow('abc123-uuid')
    expect(row?.type).toBe('verse')
    expect(row?.content.trim()).toBe('In the beginning...')
  })

  // ── runImportAll / vaultHasData (full scan) ────────────────────────────────

  it('vaultHasData: false for an empty vault, true once it contains any .md file', () => {
    setVaultPath(tmpVault)
    expect(vault.vaultHasData()).toBe(false)
    writeFileSync(join(tmpVault, 'Untitled.md'), 'hello')
    expect(vault.vaultHasData()).toBe(true)
  })

  it('runImportAll on an empty vault imports nothing and still reports success', () => {
    setVaultPath(tmpVault)
    const res = vault.runImportAll()
    expect(res.success).toBe(true)
    expect(res.notesCreated ?? 0).toBe(0)
    expect(res.notesUpdated ?? 0).toBe(0)
  })

  it('runImportAll imports a single plain note recursively and broadcasts a refresh', () => {
    mkdirSync(join(tmpVault, 'Daily Notes'), { recursive: true })
    writeFileSync(join(tmpVault, 'Daily Notes', '2026-01-01.md'), '# Today\n\nSome thoughts.')
    setVaultPath(tmpVault)
    const res = vault.runImportAll()
    expect(res.success).toBe(true)
    expect(res.notesCreated).toBe(1)
    expect(countNotes()).toBe(1)
    // Requirement: after import, every window is told to refresh (renderer turns this into
    // bumpNoteToken() via window.notes.onChanged — src/App.tsx).
    expect(sent.some((m) => m.channel === 'notes:changed')).toBe(true)
  })

  it('runImportAll over ~200 nested notes imports all of them, and a second run adds zero', () => {
    const total = 200
    for (let i = 0; i < total; i++) {
      const dir = join(tmpVault, 'Bulk', `Folder ${i % 10}`)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, `Note ${i}.md`), `# Note ${i}\n\nBody text for note ${i}.`)
    }
    setVaultPath(tmpVault)
    const first = vault.runImportAll()
    expect(first.success).toBe(true)
    expect(first.notesCreated).toBe(total)
    expect(countNotes()).toBe(total)

    sent = []
    const second = vault.runImportAll()
    expect(second.success).toBe(true)
    expect(second.notesCreated ?? 0).toBe(0)
    expect(second.notesUpdated ?? 0).toBe(0)
    expect(second.notesUnchanged).toBe(total)
    expect(countNotes()).toBe(total)
  })

  it('runImportAll re-imports a Berean-exported note this DB has never seen (no restamp of unrelated fields)', () => {
    const filePath = join(tmpVault, 'General', 'Study.md')
    mkdirSync(join(tmpVault, 'General'), { recursive: true })
    writeFileSync(filePath, [
      '---',
      'type: general-note',
      'title: "Study"',
      'created: 2025-01-15T10:30:00',
      'updated: 2025-01-15T14:22:00',
      'berean_id: known-id-1',
      '---',
      '',
      'body text',
    ].join('\n'))
    setVaultPath(tmpVault)
    const res = vault.runImportAll()
    expect(res.notesCreated).toBe(1)
    expect(noteRow('known-id-1')?.title).toBe('Study')
  })
})
