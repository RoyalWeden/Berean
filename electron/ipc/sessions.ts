import type { IpcMain } from 'electron'
import { services } from '../services'
import type { SessionsSnapshot, SessionUpsert, TabUpsert } from '../../src/platform/services/sessionsService'

/**
 * Sessions/tabs persistence (docs/mobile/decisions.md D-006): thin IPC delegate to the shared
 * sessionsService. The renderer's src/store/tabPersistence.ts mirrors the zustand store into
 * these rows and hydrates from them at startup.
 */
export function registerSessionsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('sessions:hasAny', () => services().sessions.hasAny())
  ipcMain.handle('sessions:listSessions', () => services().sessions.listSessions())
  ipcMain.handle('sessions:listTabs', (_e, sessionId?: string) => services().sessions.listTabs(sessionId))
  ipcMain.handle('sessions:listArchivedGroups', () => services().sessions.listArchivedGroups())
  ipcMain.handle('sessions:getLocalState', (_e, sessionId: string) => services().sessions.getLocalState(sessionId))
  ipcMain.handle('sessions:setLocalState', (_e, sessionId: string, activeTab: Record<string, string | null>) => services().sessions.setLocalState(sessionId, activeTab))
  ipcMain.handle('sessions:applySnapshot', (_e, snap: SessionsSnapshot) => services().sessions.applySnapshot(snap))
  ipcMain.handle('sessions:upsertSession', (_e, s: SessionUpsert) => services().sessions.upsertSession(s))
  ipcMain.handle('sessions:upsertTab', (_e, t: TabUpsert) => services().sessions.upsertTab(t))
  ipcMain.handle('sessions:deleteSession', (_e, id: string) => services().sessions.deleteSession(id))
  ipcMain.handle('sessions:deleteTab', (_e, id: string) => services().sessions.deleteTab(id))
}
