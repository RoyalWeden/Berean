import type { ServiceContext } from './context'
import {
  DEFAULT_PROFILE_ID, defaultProfileConfig, sanitizeProfileConfig,
  type StudyProfile, type StudyProfileConfig,
} from '../../lib/research/studyProfile'

/**
 * Study profiles (spec §7.1): stored in `study_profiles` (schema v49), synced over iCloud like
 * sessions (tombstoned). The neutral Default profile always exists and can't be deleted; which
 * profile is active is a device-local preference (the renderer store), not part of the row.
 */
interface Row { id: string; name: string; config: string; created_at: string; updated_at: string; deleted_at: string | null }

function toProfile(r: Row): StudyProfile {
  let parsed: unknown = {}
  try { parsed = JSON.parse(r.config) } catch { /* damaged row → defaults */ }
  return { id: r.id, name: r.name, config: sanitizeProfileConfig(parsed), createdAt: r.created_at, updatedAt: r.updated_at }
}

export function createStudyProfilesService(ctx: ServiceContext) {
  const db = () => ctx.userDb
  const iso = () => new Date(ctx.now()).toISOString()
  const changed = (id: string, op: 'upsert' | 'delete' = 'upsert') => ctx.events.emit('data:changed', { entity: 'study_profile', id, op })

  async function ensureDefault(): Promise<void> {
    const row = await db().get<{ id: string }>('SELECT id FROM study_profiles WHERE id = ?', [DEFAULT_PROFILE_ID])
    if (row) return
    const now = iso()
    await db().run('INSERT OR IGNORE INTO study_profiles (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [DEFAULT_PROFILE_ID, 'Default', JSON.stringify(defaultProfileConfig()), now, now])
    changed(DEFAULT_PROFILE_ID)
  }

  async function list(): Promise<StudyProfile[]> {
    await ensureDefault()
    const rows = await db().all<Row>('SELECT * FROM study_profiles WHERE deleted_at IS NULL ORDER BY (id = ?) DESC, name COLLATE NOCASE', [DEFAULT_PROFILE_ID])
    return rows.map(toProfile)
  }

  async function get(id: string): Promise<StudyProfile | null> {
    if (id === DEFAULT_PROFILE_ID) await ensureDefault()
    const row = await db().get<Row>('SELECT * FROM study_profiles WHERE id = ? AND deleted_at IS NULL', [id])
    return row ? toProfile(row) : null
  }

  /** The profile to use: the requested one if it still exists, else Default. */
  async function resolve(id: string | null | undefined): Promise<StudyProfile> {
    return (id ? await get(id) : null) ?? (await get(DEFAULT_PROFILE_ID))!
  }

  async function create(name: string, config?: Partial<StudyProfileConfig>): Promise<StudyProfile> {
    const id = ctx.uuid()
    const now = iso()
    const cfg = sanitizeProfileConfig({ ...defaultProfileConfig(), ...(config ?? {}) })
    await db().run('INSERT INTO study_profiles (id, name, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim().slice(0, 80) || 'Untitled profile', JSON.stringify(cfg), now, now])
    changed(id)
    return (await get(id))!
  }

  async function update(id: string, patch: { name?: string; config?: Partial<StudyProfileConfig> }): Promise<StudyProfile | null> {
    const cur = await get(id)
    if (!cur) return null
    const name = patch.name !== undefined ? (patch.name.trim().slice(0, 80) || cur.name) : cur.name
    const config = patch.config ? sanitizeProfileConfig({ ...cur.config, ...patch.config }) : cur.config
    await db().run('UPDATE study_profiles SET name = ?, config = ?, updated_at = ? WHERE id = ?', [name, JSON.stringify(config), iso(), id])
    changed(id)
    return get(id)
  }

  async function duplicate(id: string): Promise<StudyProfile | null> {
    const cur = await get(id)
    return cur ? create(`${cur.name} copy`, cur.config) : null
  }

  /** Deletes (tombstones) a profile. Default can't be deleted. */
  async function remove(id: string): Promise<{ success: boolean }> {
    if (id === DEFAULT_PROFILE_ID) return { success: false }
    const now = iso()
    const r = await db().run('UPDATE study_profiles SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, id])
    if (r.changes) changed(id, 'delete')
    return { success: r.changes > 0 }
  }

  return { list, get, resolve, create, update, duplicate, remove }
}

export type StudyProfilesService = ReturnType<typeof createStudyProfilesService>
