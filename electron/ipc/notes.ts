import type { IpcMain } from 'electron'
import { services, userDbAdapter } from '../services'
import { withSender } from '../servicesHost'
import { moveNoteToVaultTrash, restoreNoteFromVaultTrash, purgeNoteFromVaultTrash, type NoteRow as VaultNoteRow } from './vault'
import type { NotesWordMode, NoteRow } from '../../src/platform/services/notesService'

/**
 * Thin IPC layer (Phase 1/3): every `notes:*` / `folders:*` channel delegates to the shared
 * notesService (src/platform/services/notesService.ts), which carries the SQL that used to live
 * here. Two things stay desktop-side, wrapped around the service calls exactly where the old
 * inline handlers did them:
 *
 *  - the Octarine/Obsidian vault mirror of the trash lifecycle (`moveNoteToVaultTrash` /
 *    `restoreNoteFromVaultTrash` / `purgeNoteFromVaultTrash` in electron/ipc/vault.ts) — the
 *    vault subsystem is desktop-only (docs/mobile/feature-matrix.md §4);
 *  - the cross-window `notes:changed` broadcast, which is now derived from the service's
 *    `data:changed` events by electron/servicesHost.ts; `withSender` records the originating
 *    window so it is skipped like before (it bumps its own noteChangeToken locally).
 */
type CreateData = Parameters<ReturnType<typeof services>['notes']['create']>[0]
type UpdateData = Parameters<ReturnType<typeof services>['notes']['update']>[1]

/** Raw notes row for the vault trash mirror (it wants the DB row, not the mapped Note). */
async function rawNoteRow(id: string): Promise<NoteRow | undefined> {
  return userDbAdapter().get<NoteRow>('SELECT * FROM notes WHERE id = ?', [id])
}

export function registerNotesHandlers(ipcMain: IpcMain): void {
  const notes = () => services().notes

  ipcMain.handle('notes:create', (event, data: CreateData) =>
    withSender(event.sender.id, () => notes().create(data)))

  ipcMain.handle('notes:update', (event, id: string, data: UpdateData) =>
    withSender(event.sender.id, () => notes().update(id, data)))

  ipcMain.handle('notes:listIdioms', () => notes().listIdioms())

  // Soft-delete — moves the note to Trash rather than removing it. The vault mirror gets the
  // row as it was BEFORE the delete, same as the old inline handler.
  ipcMain.handle('notes:delete', (event, id: string) =>
    withSender(event.sender.id, async () => {
      const before = await rawNoteRow(id)
      const result = await notes().delete(id)
      if (before) moveNoteToVaultTrash(before as unknown as VaultNoteRow)
      return result
    }))

  ipcMain.handle('notes:restore', (event, id: string) =>
    withSender(event.sender.id, async () => {
      const result = await notes().restore(id)
      if (result.success) {
        const after = await rawNoteRow(id)
        if (after) restoreNoteFromVaultTrash(after as unknown as VaultNoteRow)
      }
      return result
    }))

  ipcMain.handle('notes:listTrash', () => notes().listTrash())

  ipcMain.handle('notes:purgeTrashItem', (event, id: string) =>
    withSender(event.sender.id, async () => {
      const result = await notes().purgeTrashItem(id)
      if (result.success) purgeNoteFromVaultTrash(id)
      return result
    }))

  ipcMain.handle('notes:emptyTrash', (event) =>
    withSender(event.sender.id, async () => {
      const result = await notes().emptyTrash()
      for (const id of result.purged) purgeNoteFromVaultTrash(id)
      return result
    }))

  // ── Note folders (user-created, nestable) ──────────────────────────────────
  ipcMain.handle('folders:getAll', () => notes().folderList())
  ipcMain.handle('folders:create', (_event, name: string, parentId: string | null = null) => notes().folderCreate(name, parentId))
  ipcMain.handle('folders:rename', (_event, id: string, name: string) => notes().folderRename(id, name))
  ipcMain.handle('folders:delete', (_event, id: string) => notes().folderDelete(id))

  ipcMain.handle('folders:deleteDeep', (event, id: string) =>
    withSender(event.sender.id, async () => {
      const { trashedNotes, ...result } = await notes().folderDeleteDeep(id)
      for (const note of trashedNotes) moveNoteToVaultTrash(note as unknown as VaultNoteRow)
      return result
    }))

  ipcMain.handle('folders:setParent', (_event, id: string, parentId: string | null) => notes().folderSetParent(id, parentId))

  ipcMain.handle('notes:setFolder', (event, noteId: string, folderId: string | null) =>
    withSender(event.sender.id, () => notes().setFolder(noteId, folderId)))

  ipcMain.handle('notes:setPinned', (event, noteId: string, pinned: boolean) =>
    withSender(event.sender.id, () => notes().setPinned(noteId, pinned)))

  ipcMain.handle('notes:deleteAll', (event) =>
    withSender(event.sender.id, () => notes().deleteAll()))

  ipcMain.handle('notes:getAll', (_event, limit = 200, offset = 0) => notes().getAll(limit, offset))
  ipcMain.handle('notes:getByVerse', (_event, verseRef: string, textId = 'kjva') => notes().getByVerse(verseRef, textId))
  ipcMain.handle('notes:getOne', (_event, id: string) => notes().getOne(id))
  ipcMain.handle('notes:search', (_event, query: string, limit = 20, mode: NotesWordMode = 'all') => notes().search(query, limit, mode))

  ipcMain.handle('notes:deleteByTag', (event, tag: string) =>
    withSender(event.sender.id, () => notes().deleteByTag(tag)))

  ipcMain.handle('notes:countTagRefs', (_event, name: string) => notes().countTagRefs(name))
  ipcMain.handle('notes:getByChapter', (_event, bookId: string, chapter: number, textId = 'kjva') => notes().getByChapter(bookId, chapter, textId))
  ipcMain.handle('notes:getChapterCounts', (_event, bookId: string, chapter: number, textId = 'kjva') => notes().getChapterCounts(bookId, chapter, textId))

  ipcMain.handle('notes:createVersion', (_event, noteId: string, title: string, content: string, kind = 'auto') =>
    notes().createVersion(noteId, title, content, kind))
  ipcMain.handle('notes:getVersions', (_event, noteId: string) => notes().getVersions(noteId))
  ipcMain.handle('notes:restoreVersion', (event, noteId: string, versionId: string) =>
    withSender(event.sender.id, () => notes().restoreVersion(noteId, versionId)))

  ipcMain.handle('notes:getCollapsedHeadings', (_event, noteId: string) => notes().getCollapsedHeadings(noteId))
  ipcMain.handle('notes:setHeadingCollapsed', (_event, noteId: string, headingKey: string, collapsed: boolean) =>
    notes().setHeadingCollapsed(noteId, headingKey, collapsed))
  ipcMain.handle('notes:getCollapsedThreads', (_event, noteId: string) => notes().getCollapsedThreads(noteId))
  ipcMain.handle('notes:setThreadCollapsed', (_event, noteId: string, threadKey: string, collapsed: boolean) =>
    notes().setThreadCollapsed(noteId, threadKey, collapsed))
}
