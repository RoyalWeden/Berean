import type { IpcMain } from 'electron'
import { services } from '../services'
import type { TagEdgeArrows } from '../../src/platform/services/tagGraphService'

export type { TagEdgeArrows }

/**
 * Thin IPC layer (Phase 1/3): every channel delegates to the shared tagGraphService
 * (src/platform/services/tagGraphService.ts), which carries the SQL that used to live here (tag
 * listing now goes through `getServices().verseTags.list()` inside that service instead of the
 * `listTags` helper this file used to import from ./verseTags).
 */
export function registerTagGraphHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('tagGraph:getGraph', () => services().tagGraph.getGraph())

  ipcMain.handle('tagGraph:createEdge', (_e, source: string, target: string) => services().tagGraph.createEdge(source, target))

  ipcMain.handle('tagGraph:updateEdge', (_e, id: string, patch: { arrows?: TagEdgeArrows; color?: string | null; dashed?: boolean; note?: string }) =>
    services().tagGraph.updateEdge(id, patch))

  ipcMain.handle('tagGraph:deleteEdge', (_e, id: string) => services().tagGraph.deleteEdge(id))

  ipcMain.handle('tagGraph:setTagPosition', (_e, tagId: string, x: number | null, y: number | null, pinned: boolean) =>
    services().tagGraph.setTagPosition(tagId, x, y, pinned))
}
