import type { ServiceContext } from './context'

/**
 * The `settings` key/value table (JSON-encoded values) — extracted verbatim from
 * electron/ipc/settings.ts (Phase 1/3). Device-local; never synced (docs/mobile/icloud.md §5).
 */
export function createSettingsService(ctx: ServiceContext) {
  const db = () => ctx.userDb

  async function get(key: string): Promise<unknown> {
    const row = await db().get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key])
    return row ? JSON.parse(row.value) : null
  }

  async function set(key: string, value: unknown): Promise<{ success: true }> {
    await db().run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, JSON.stringify(value)])
    ctx.events.emit('data:changed', { entity: 'setting', id: key, op: 'upsert' })
    return { success: true }
  }

  async function getAll(): Promise<Record<string, unknown>> {
    const rows = await db().all<{ key: string; value: string }>('SELECT key, value FROM settings')
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]))
  }

  return { get, set, getAll }
}

export type SettingsService = ReturnType<typeof createSettingsService>
