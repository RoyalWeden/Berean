import type { ServiceContext } from './context'

/**
 * Saved workspaces (named panel-layout + tab snapshots) — extracted verbatim from
 * electron/ipc/workspaces.ts (Phase 1/3).
 */
export interface WorkspaceSummary { id: string; name: string; created_at: number }
export interface WorkspaceRow extends WorkspaceSummary { layout_json: string; state_json: string | null }

export function createWorkspacesService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  async function list(): Promise<WorkspaceSummary[]> {
    return db().all<WorkspaceSummary>('SELECT id, name, created_at FROM workspaces ORDER BY created_at DESC')
  }

  async function save(name: string, layoutJson: string, stateJson: string): Promise<WorkspaceSummary> {
    const id = ctx.uuid()
    const now = ctx.now()
    await db().run(
      'INSERT INTO workspaces (id, name, layout_json, state_json, created_at) VALUES (?, ?, ?, ?, ?)',
      [id, name, layoutJson, stateJson, now],
    )
    ctx.events.emit('data:changed', { entity: 'workspace', id, op: 'upsert' })
    return { id, name, created_at: now }
  }

  async function load(id: string): Promise<WorkspaceRow | null> {
    return (await db().get<WorkspaceRow>('SELECT * FROM workspaces WHERE id = ?', [id])) ?? null
  }

  async function delete_(id: string): Promise<{ success: true }> {
    await db().run('DELETE FROM workspaces WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'workspace', id, op: 'delete' })
    return { success: true }
  }

  async function rename(id: string, name: string): Promise<{ success: true }> {
    await db().run('UPDATE workspaces SET name = ? WHERE id = ?', [name, id])
    ctx.events.emit('data:changed', { entity: 'workspace', id, op: 'upsert' })
    return { success: true }
  }

  return { list, save, load, delete: delete_, rename }
}

export type WorkspacesService = ReturnType<typeof createWorkspacesService>
