import type { IpcMain } from 'electron'
import { services } from '../services'
import type { PlaylistItemInput } from '../../src/platform/services/playlistsService'

export type { PlaylistItemInput }

/**
 * Thin IPC layer (Phase 1/3): every channel delegates to the shared playlistsService
 * (src/platform/services/playlistsService.ts), which carries the SQL that used to live here.
 */
export function registerPlaylistsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('playlists:list', () => services().playlists.list())

  // Creates a new named playlist, or overwrites an existing one's items + updated_at when
  // existingId is passed (used by "Save as playlist" when re-saving over the current queue's
  // originating playlist rather than always forking a new one).
  ipcMain.handle('playlists:save', (_e, name: string, items: PlaylistItemInput[], existingId?: string) =>
    services().playlists.save(name, items, existingId))

  ipcMain.handle('playlists:rename', (_e, id: string, name: string) => services().playlists.rename(id, name))

  ipcMain.handle('playlists:delete', (_e, id: string) => services().playlists.delete(id))
}
