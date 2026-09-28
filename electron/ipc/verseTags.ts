import type { IpcMain } from 'electron'
import { services } from '../services'
import type { TagRange } from '../../src/platform/services/verseTagsService'

export type { TagRange }

/**
 * Thin IPC layer (Phase 1/3): every channel delegates to the shared verseTagsService
 * (src/platform/services/verseTagsService.ts), which carries the SQL that used to live here.
 * `listTags` (formerly exported here for electron/ipc/tagGraph.ts) is gone — tagGraph now reads
 * tags through the shared service registry (`getServices().verseTags.list()`), and nothing else
 * imported it (grepped before removing).
 */
export function registerVerseTagHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('verseTags:list', () => services().verseTags.list())

  ipcMain.handle('verseTags:create', (_e, name: string, color?: string | null) => services().verseTags.create(name, color))

  ipcMain.handle('verseTags:rename', (_e, id: string, name: string) => services().verseTags.rename(id, name))

  ipcMain.handle('verseTags:setColor', (_e, id: string, color: string | null) => services().verseTags.setColor(id, color))

  ipcMain.handle('verseTags:setColorSlot', (_e, id: string, slot: number) => services().verseTags.setColorSlot(id, slot))

  ipcMain.handle('verseTags:reorder', (_e, orderedIds: string[]) => services().verseTags.reorder(orderedIds))

  ipcMain.handle('verseTags:merge', (_e, fromId: string, intoId: string) => services().verseTags.merge(fromId, intoId))

  ipcMain.handle('verseTags:delete', (_e, id: string, force = false) => services().verseTags.delete(id, force))

  ipcMain.handle('verseTags:addMembers', (_e, args: {
    tagIds?: string[]; newTagNames?: string[]; ranges: TagRange[]; label: string; kind?: 'verses' | 'chapter'
  }) => services().verseTags.addMembers(args))

  ipcMain.handle('verseTags:removeMember', (_e, memberId: string) => services().verseTags.removeMember(memberId))

  ipcMain.handle('verseTags:updateMemberRanges', (_e, memberId: string, ranges: TagRange[], label: string, kind?: 'verses' | 'chapter') =>
    services().verseTags.updateMemberRanges(memberId, ranges, label, kind))

  ipcMain.handle('verseTags:getForChapter', (_e, bookId: string, chapter: number) => services().verseTags.getForChapter(bookId, chapter))

  ipcMain.handle('verseTags:getMembers', (_e, tagIds: string[]) => services().verseTags.getMembers(tagIds))
}
