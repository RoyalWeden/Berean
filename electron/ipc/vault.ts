import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import chokidar from 'chokidar'
import { getBereanDb } from '../db/berean'

function getVaultPath(): string {
  const row = getBereanDb().prepare('SELECT value FROM settings WHERE key = ?').get('vaultPath') as { value: string } | undefined
  if (!row) return ''
  const val = JSON.parse(row.value) as string
  return typeof val === 'string' ? val : ''
}

function getVaultNotesDir(): string {
  return join(getVaultPath(), 'berean-notes')
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function noteToMarkdown(note: { id: string; type: string; title: string | null; content: string; verse_ref: string | null; color: string; created_at: number; updated_at: number; tags: string }): string {
  const tags = JSON.parse(note.tags || '[]')
  const createdIso = new Date(note.created_at).toISOString()
  const updatedIso = new Date(note.updated_at).toISOString()
  const frontmatter = [
    '---',
    `type: ${note.type === 'verse' ? 'verse-note' : 'general-note'}`,
    note.verse_ref ? `ref: ${note.verse_ref}` : null,
    `title: ${JSON.stringify(note.title ?? 'Untitled')}`,
    `created: ${createdIso}`,
    `updated: ${updatedIso}`,
    `tags: [${tags.join(', ')}]`,
    `color: ${note.color ?? 'blue'}`,
    `berean_id: ${note.id}`,
    '---',
  ].filter((l) => l !== null).join('\n')
  return frontmatter + '\n\n' + (note.content ?? '')
}

function safeFilename(note: { id: string; type: string; title: string | null; verse_ref: string | null }): string {
  if (note.type === 'verse' && note.verse_ref) {
    return note.verse_ref.replace(/\./g, '_') + '.md'
  }
  const slug = (note.title ?? 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
  return `${slug || note.id.slice(0, 8)}.md`
}

let watcher: ReturnType<typeof chokidar.watch> | null = null

export function registerVaultHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('vault:syncNote', (_event, noteId: string) => {
    try {
      const row = getBereanDb().prepare('SELECT * FROM notes WHERE id = ?').get(noteId) as {
        id: string; type: string; title: string | null; content: string; verse_ref: string | null;
        color: string; created_at: number; updated_at: number; tags: string
      } | undefined
      if (!row) return { success: false, reason: 'Note not found' }

      const notesDir = getVaultNotesDir()
      const subDir = row.type === 'verse' ? join(notesDir, 'verse-notes') : join(notesDir, 'general-notes')
      ensureDir(subDir)

      const filename = safeFilename(row)
      writeFileSync(join(subDir, filename), noteToMarkdown(row), 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, reason: String(err) }
    }
  })

  ipcMain.handle('vault:readNote', (_event, title: string) => {
    try {
      const notesDir = getVaultNotesDir()
      const dirs = [join(notesDir, 'verse-notes'), join(notesDir, 'general-notes'), notesDir]
      for (const dir of dirs) {
        if (!existsSync(dir)) continue
        for (const file of readdirSync(dir)) {
          if (!file.endsWith('.md')) continue
          const content = readFileSync(join(dir, file), 'utf-8')
          if (content.includes(`title: "${title}"`) || content.includes(`title: '${title}'`)) {
            return content
          }
        }
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('vault:watch', (event) => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return { success: false, reason: 'No vault folder configured' }
      const notesDir = getVaultNotesDir()
      if (!existsSync(notesDir)) {
        ensureDir(notesDir)
        ensureDir(join(notesDir, 'verse-notes'))
        ensureDir(join(notesDir, 'general-notes'))
      }

      if (watcher) {
        watcher.close()
        watcher = null
      }

      watcher = chokidar.watch(notesDir, {
        ignoreInitial: true,
        persistent: true,
        depth: 2,
      })

      const win = BrowserWindow.fromWebContents(event.sender)

      watcher.on('change', (filePath) => {
        if (!filePath.endsWith('.md')) return
        try {
          const content = readFileSync(filePath, 'utf-8')
          // Extract berean_id from frontmatter
          const match = content.match(/^berean_id:\s*(.+)$/m)
          if (!match) return
          const noteId = match[1].trim()
          // Extract the markdown body (after second ---)
          const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/)
          const body = bodyMatch ? bodyMatch[1] : content
          getBereanDb().prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?').run(body, Date.now(), noteId)
          win?.webContents.send('vault:changed', noteId)
        } catch {
          // ignore parse errors
        }
      })

      return { success: true }
    } catch (err) {
      return { success: false, reason: String(err) }
    }
  })

  // Startup reconciliation: scan all .md files and sync any that are newer than DB
  ipcMain.handle('vault:reconcile', () => {
    try {
      const vaultPath = getVaultPath()
      if (!vaultPath) return { success: true, updated: 0, skipped: 0 }
      const notesDir = getVaultNotesDir()
      if (!existsSync(notesDir)) return { success: true, updated: 0, skipped: 0 }

      const dirs = [
        join(notesDir, 'verse-notes'),
        join(notesDir, 'general-notes'),
        notesDir,
      ]

      const db = getBereanDb()
      let updated = 0
      let skipped = 0

      for (const dir of dirs) {
        if (!existsSync(dir)) continue
        for (const file of readdirSync(dir)) {
          if (!file.endsWith('.md')) continue
          const filePath = join(dir, file)
          try {
            const content = readFileSync(filePath, 'utf-8')
            const idMatch = content.match(/^berean_id:\s*(.+)$/m)
            if (!idMatch) { skipped++; continue }
            const noteId = idMatch[1].trim()

            const dbRow = db.prepare('SELECT updated_at FROM notes WHERE id = ?').get(noteId) as { updated_at: number } | undefined
            if (!dbRow) { skipped++; continue }

            // Last-write-wins: update DB if file is meaningfully newer (>1s tolerance)
            const fileMtime = statSync(filePath).mtimeMs
            if (fileMtime > dbRow.updated_at + 1000) {
              const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/)
              const body = bodyMatch ? bodyMatch[1] : content
              db.prepare('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?')
                .run(body.trimEnd(), Date.now(), noteId)
              updated++
            } else {
              skipped++
            }
          } catch {
            skipped++
          }
        }
      }

      return { success: true, updated, skipped }
    } catch (err) {
      return { success: false, reason: String(err), updated: 0, skipped: 0 }
    }
  })
}
