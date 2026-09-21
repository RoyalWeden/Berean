import type { IpcMain } from 'electron'
import { services } from '../services'

/**
 * The implicit "Loose stops" bucket id — re-exported from studyTrailService (Phase 1/3) so
 * desktop-only modules that already import it from here keep working.
 */
export { LOOSE_SESSION_ID } from '../../src/platform/services/studyTrailService'

/**
 * Thin IPC layer (Phase 1/3): every channel delegates to the shared studyTrailService
 * (src/platform/services/studyTrailService.ts), which carries the SQL and the "push every window
 * as soon as something is written" data:changed emission that used to live here as
 * broadcastDataChanged(). No `withSender` wrapping: the old broadcastDataChanged() sent to EVERY
 * window unconditionally (including the sender's own), so — per the extraction guide's rule 7 —
 * the handlers below stay plain `services().studyTrail.xxx(...)` calls; the generic
 * cross-window broadcast in electron/servicesHost.ts still fires for every `trail_*` entity, it
 * simply never excludes a sender here (see LOOSE_SESSION_ID's exported reference above).
 */
export function registerStudyTrailHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('studyTrail:startSession', (_e, name: string) => services().studyTrail.startSession(name))
  ipcMain.handle('studyTrail:pauseSession', (_e, trailSessionId: string) => services().studyTrail.pauseSession(trailSessionId))
  ipcMain.handle('studyTrail:resumeSession', (_e, trailSessionId: string) => services().studyTrail.resumeSession(trailSessionId))
  ipcMain.handle('studyTrail:renameSession', (_e, trailSessionId: string, name: string) => services().studyTrail.renameSession(trailSessionId, name))
  ipcMain.handle('studyTrail:endSession', (_e, trailSessionId: string) => services().studyTrail.endSession(trailSessionId))
  ipcMain.handle('studyTrail:deleteSession', (_e, trailSessionId: string) => services().studyTrail.deleteSession(trailSessionId))
  ipcMain.handle('studyTrail:deleteSessions', (_e, trailSessionIds: string[]) => services().studyTrail.deleteSessions(trailSessionIds))

  ipcMain.handle('studyTrail:listSessions', () => services().studyTrail.listSessions())
  ipcMain.handle('studyTrail:listAllSessions', () => services().studyTrail.listAllSessions())
  ipcMain.handle('studyTrail:ensureLooseSession', () => services().studyTrail.ensureLooseSession())
  ipcMain.handle('studyTrail:getSession', (_e, trailSessionId: string) => services().studyTrail.getSession(trailSessionId))

  ipcMain.handle('studyTrail:addNode', (_e, node: Parameters<ReturnType<typeof services>['studyTrail']['addNode']>[0]) =>
    services().studyTrail.addNode(node))
  ipcMain.handle('studyTrail:reopenNode', (_e, nodeId: string, at?: number) => services().studyTrail.reopenNode(nodeId, at))
  ipcMain.handle('studyTrail:promoteRevisit', (_e, args: Parameters<ReturnType<typeof services>['studyTrail']['promoteRevisit']>[0]) =>
    services().studyTrail.promoteRevisit(args))
  ipcMain.handle('studyTrail:updateNodeSubnote', (_e, nodeId: string, subnote: string) => services().studyTrail.updateNodeSubnote(nodeId, subnote))
  ipcMain.handle('studyTrail:setNodeTopicBreak', (_e, nodeId: string, isTopicBreak: boolean) => services().studyTrail.setNodeTopicBreak(nodeId, isTopicBreak))
  ipcMain.handle('studyTrail:deleteNode', (_e, nodeId: string) => services().studyTrail.deleteNode(nodeId))
  ipcMain.handle('studyTrail:deleteConnection', (_e, connectionId: string) => services().studyTrail.deleteConnection(connectionId))
  ipcMain.handle('studyTrail:moveNodes', (_e, nodeIds: string[], targetSessionId: string) => services().studyTrail.moveNodes(nodeIds, targetSessionId))

  ipcMain.handle('studyTrail:addConnection', (_e, conn: Parameters<ReturnType<typeof services>['studyTrail']['addConnection']>[0]) =>
    services().studyTrail.addConnection(conn))
  ipcMain.handle('studyTrail:markGlance', (_e, connectionId: string) => services().studyTrail.markGlance(connectionId))
  ipcMain.handle('studyTrail:updateConnectionReason', (_e, connectionId: string, update: Parameters<ReturnType<typeof services>['studyTrail']['updateConnectionReason']>[1]) =>
    services().studyTrail.updateConnectionReason(connectionId, update))
  ipcMain.handle('studyTrail:clearConnectionNote', (_e, connectionId: string) => services().studyTrail.clearConnectionNote(connectionId))
  ipcMain.handle('studyTrail:dismissPrompt', (_e, connectionId: string) => services().studyTrail.dismissPrompt(connectionId))
  ipcMain.handle('studyTrail:updateRecap', (_e, trailSessionId: string, recapText: string) => services().studyTrail.updateRecap(trailSessionId, recapText))

  ipcMain.handle('studyTrail:getBacklinks', (_e, bookId: string, chapter: number, excludeSessionId: string) =>
    services().studyTrail.getBacklinks(bookId, chapter, excludeSessionId))
  ipcMain.handle('studyTrail:search', (_e, query: string, opts?: Parameters<ReturnType<typeof services>['studyTrail']['search']>[1]) =>
    services().studyTrail.search(query, opts))
  ipcMain.handle('studyTrail:listThreads', () => services().studyTrail.listThreads())
  ipcMain.handle('studyTrail:listSessionsPage', (_e, cursor: number | undefined, limit = 10) => services().studyTrail.listSessionsPage(cursor, limit))

  ipcMain.handle('studyTrail:getCollapse', (_e, scope?: string) => services().studyTrail.getCollapse(scope))
  ipcMain.handle('studyTrail:setCollapse', (_e, scope: string, key: string, collapsed: boolean) => services().studyTrail.setCollapse(scope, key, collapsed))

  ipcMain.handle('studyTrail:listNotes', (_e, trailSessionId?: string) => services().studyTrail.listNotes(trailSessionId))
  ipcMain.handle('studyTrail:createNote', (_e, input: Parameters<ReturnType<typeof services>['studyTrail']['createNote']>[0]) =>
    services().studyTrail.createNote(input))
  ipcMain.handle('studyTrail:updateNote', (_e, id: string, patch: Parameters<ReturnType<typeof services>['studyTrail']['updateNote']>[1]) =>
    services().studyTrail.updateNote(id, patch))
  ipcMain.handle('studyTrail:deleteNote', (_e, id: string) => services().studyTrail.deleteNote(id))

  ipcMain.handle('studyTrail:listTags', () => services().studyTrail.listTags())
  ipcMain.handle('studyTrail:createTag', (_e, name: string, color?: string) => services().studyTrail.createTag(name, color))
  ipcMain.handle('studyTrail:updateTag', (_e, id: string, patch: Parameters<ReturnType<typeof services>['studyTrail']['updateTag']>[1]) =>
    services().studyTrail.updateTag(id, patch))
  ipcMain.handle('studyTrail:deleteTag', (_e, id: string) => services().studyTrail.deleteTag(id))
  ipcMain.handle('studyTrail:setSessionTags', (_e, trailSessionId: string, tagIds: string[]) => services().studyTrail.setSessionTags(trailSessionId, tagIds))

  ipcMain.handle('studyTrail:mergeSessions', (_e, intoId: string, fromId: string) => services().studyTrail.mergeSessions(intoId, fromId))
  ipcMain.handle('studyTrail:splitSession', (_e, trailSessionId: string, atNodeId: string, name?: string) => services().studyTrail.splitSession(trailSessionId, atNodeId, name))
  ipcMain.handle('studyTrail:reorderSessions', (_e, orderedIds: string[]) => services().studyTrail.reorderSessions(orderedIds))
}
