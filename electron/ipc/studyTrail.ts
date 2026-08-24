import type { IpcMain } from 'electron'
import { randomUUID } from 'crypto'
import { is } from '@electron-toolkit/utils'
import { getBereanDb } from '../db/berean'

// Terminal-visible (not devtools) logging for the "Study Trail records nothing" investigation —
// dev-only (mirrors youtube.ts's is.dev gating), always-on in dev rather than requiring a
// separate opt-in flag: main-process console output only reaches the terminal running
// `npm run dev`, which is far less noisy than devtools, so there's little cost to leaving it on.
const DEBUG = is.dev

// Prepared-statement cache, mirroring highlights.ts's pattern — every navigation potentially
// writes a connection, so this is a hot path worth not re-preparing SQL on every call.
const _stmtCache = new WeakMap<object, Map<string, any>>()
function prep(db: any, sql: string): any {
  let m = _stmtCache.get(db as object)
  if (!m) { m = new Map(); _stmtCache.set(db as object, m) }
  let s = m.get(sql)
  if (!s) { s = db.prepare(sql); m.set(sql, s) }
  return s
}

interface TrailSessionRow {
  id: string; name: string; status: string; possibly_accidental: number
  recap_text: string | null; recap_user_edited: number; created_at: number; updated_at: number
}
interface TrailNodeRow {
  id: string; trail_session_id: string; book_id: string; chapter: number; order_index: number
  anchor_started_at: number; anchor_ended_at: number | null; cached_subnote: string | null; origin_label: string | null
}
interface TrailConnectionRow {
  id: string; trail_session_id: string; from_node_id: string; to_kind: string
  to_book_id: string | null; to_chapter: number | null; to_verse: number | null
  to_strongs_num: string | null; to_note_id: string | null; to_video_id: string | null
  clarity_tier: number; reason_text: string | null; reason_tags: string | null
  verse_pin_from: number | null; verse_pin_to: number | null
  weight: string; strongs_depth: string | null; cluster_id: string | null
  dismissed_prompt_at: number | null; created_at: number
}

function rowToSession(r: TrailSessionRow) {
  return {
    id: r.id, name: r.name, status: r.status as 'live' | 'paused' | 'ended',
    possiblyAccidental: !!r.possibly_accidental,
    recapText: r.recap_text ?? undefined,
    recapUserEdited: !!r.recap_user_edited,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}
function rowToNode(r: TrailNodeRow) {
  return {
    id: r.id, trailSessionId: r.trail_session_id, bookId: r.book_id, chapter: r.chapter,
    orderIndex: r.order_index, anchorStartedAt: r.anchor_started_at,
    anchorEndedAt: r.anchor_ended_at ?? undefined,
    cachedSubnote: r.cached_subnote ?? undefined, originLabel: r.origin_label ?? undefined,
  }
}
function rowToConnection(r: TrailConnectionRow) {
  return {
    id: r.id, trailSessionId: r.trail_session_id, fromNodeId: r.from_node_id,
    toKind: r.to_kind as 'chapter' | 'lexicon' | 'note' | 'video' | 'compare',
    toBookId: r.to_book_id ?? undefined, toChapter: r.to_chapter ?? undefined, toVerse: r.to_verse ?? undefined,
    toStrongsNum: r.to_strongs_num ?? undefined, toNoteId: r.to_note_id ?? undefined, toVideoId: r.to_video_id ?? undefined,
    clarityTier: r.clarity_tier as 1 | 2 | 3,
    reasonText: r.reason_text ?? undefined,
    reasonTags: r.reason_tags ? JSON.parse(r.reason_tags) : [],
    versePinFrom: r.verse_pin_from ?? undefined, versePinTo: r.verse_pin_to ?? undefined,
    weight: r.weight as 'full' | 'glance',
    strongsDepth: r.strongs_depth ?? undefined,
    clusterId: r.cluster_id ?? undefined,
    dismissedPromptAt: r.dismissed_prompt_at ?? undefined,
    createdAt: r.created_at,
  }
}

// How long a rapid same-chapter-pair flip has to keep recurring, and how many times, before
// it's flagged as a revisit cluster. Tunable without touching the recorder logic in the
// renderer — this is the one place that actually queries "recent" connections.
const CLUSTER_WINDOW_MS = 5 * 60 * 1000
const CLUSTER_MIN_COUNT = 2

export function registerStudyTrailHandlers(ipcMain: IpcMain): void {
  if (DEBUG) console.log('[TrailDebug:main] registerStudyTrailHandlers() called — registering all studyTrail:* IPC handlers')
  ipcMain.handle('studyTrail:startSession', (_e, name: string) => {
    if (DEBUG) console.log('[TrailDebug:main] studyTrail:startSession called', { name })
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    prep(db, `INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'live', ?, ?)`)
      .run(id, name, now, now)
    const result = rowToSession(prep(db, 'SELECT * FROM trail_sessions WHERE id = ?').get(id) as TrailSessionRow)
    if (DEBUG) console.log('[TrailDebug:main] studyTrail:startSession inserted', result)
    return result
  })

  ipcMain.handle('studyTrail:pauseSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const now = Date.now()
    prep(db, `UPDATE trail_sessions SET status = 'paused', updated_at = ? WHERE id = ?`).run(now, trailSessionId)
    prep(db, `INSERT INTO trail_paused_intervals (id, trail_session_id, paused_at) VALUES (?, ?, ?)`)
      .run(randomUUID(), trailSessionId, now)
    return { success: true }
  })

  ipcMain.handle('studyTrail:resumeSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const now = Date.now()
    prep(db, `UPDATE trail_sessions SET status = 'live', updated_at = ? WHERE id = ?`).run(now, trailSessionId)
    // Close the most recent open paused interval for this session, if any.
    prep(db, `
      UPDATE trail_paused_intervals SET resumed_at = ?
      WHERE trail_session_id = ? AND resumed_at IS NULL
      ORDER BY paused_at DESC LIMIT 1
    `).run(now, trailSessionId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:renameSession', (_e, trailSessionId: string, name: string) => {
    prep(getBereanDb(), `UPDATE trail_sessions SET name = ?, updated_at = ? WHERE id = ?`).run(name, Date.now(), trailSessionId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:listSessions', () => {
    const rows = getBereanDb().prepare('SELECT * FROM trail_sessions ORDER BY updated_at DESC').all() as TrailSessionRow[]
    return rows.map(rowToSession)
  })

  ipcMain.handle('studyTrail:getSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const session = db.prepare('SELECT * FROM trail_sessions WHERE id = ?').get(trailSessionId) as TrailSessionRow | undefined
    if (!session) return null
    const nodes = db.prepare('SELECT * FROM trail_nodes WHERE trail_session_id = ? ORDER BY order_index').all(trailSessionId) as TrailNodeRow[]
    const connections = db.prepare('SELECT * FROM trail_connections WHERE trail_session_id = ? ORDER BY created_at').all(trailSessionId) as TrailConnectionRow[]
    return { session: rowToSession(session), nodes: nodes.map(rowToNode), connections: connections.map(rowToConnection) }
  })

  ipcMain.handle('studyTrail:addNode', (_e, node: {
    trailSessionId: string; bookId: string; chapter: number; orderIndex: number; originLabel?: string
  }) => {
    // Prints to the TERMINAL running `npm run dev` (this is the Electron MAIN process — not
    // devtools console), gated the same as the renderer-side [TrailDebug] logs via a global
    // this process reads once at startup — see the module-level DEBUG const below. Deliberately
    // NOT wrapped in try/catch: a thrown error here (e.g. a constraint violation) should
    // propagate back through ipcMain.handle's rejected promise to the renderer's own
    // .catch((err) => console.error(...)) rather than being swallowed at either end.
    if (DEBUG) console.log('[TrailDebug:main] studyTrail:addNode called', node)
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    // Close out the previous anchor (if any) so its anchor_ended_at reflects when the user
    // actually left that chapter, before opening the new one.
    prep(db, `UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL`)
      .run(now, node.trailSessionId)
    prep(db, `
      INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, origin_label)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, node.trailSessionId, node.bookId, node.chapter, node.orderIndex, now, node.originLabel ?? null)
    const result = rowToNode(prep(db, 'SELECT * FROM trail_nodes WHERE id = ?').get(id) as TrailNodeRow)
    if (DEBUG) console.log('[TrailDebug:main] studyTrail:addNode inserted', result)
    return result
  })

  ipcMain.handle('studyTrail:updateNodeSubnote', (_e, nodeId: string, subnote: string) => {
    prep(getBereanDb(), `UPDATE trail_nodes SET cached_subnote = ? WHERE id = ?`).run(subnote, nodeId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:addConnection', (_e, conn: {
    trailSessionId: string; fromNodeId: string; toKind: string
    toBookId?: string; toChapter?: number; toVerse?: number
    toStrongsNum?: string; toNoteId?: string; toVideoId?: string
    clarityTier: 1 | 2 | 3; reasonText?: string; reasonTags?: string[]
    weight?: 'full' | 'glance'; strongsDepth?: string
  }) => {
    if (DEBUG) console.log('[TrailDebug:main] studyTrail:addConnection called', conn)
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()

    // Revisit-cluster detection: same destination chapter-pair, recently, more than once.
    let clusterId: string | null = null
    if (conn.toKind === 'chapter' && conn.toBookId && conn.toChapter != null) {
      const recent = prep(db, `
        SELECT id, cluster_id FROM trail_connections
        WHERE trail_session_id = ? AND to_kind = 'chapter' AND to_book_id = ? AND to_chapter = ?
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 1
      `).get(conn.trailSessionId, conn.toBookId, conn.toChapter, now - CLUSTER_WINDOW_MS) as { id: string; cluster_id: string | null } | undefined
      if (recent) {
        clusterId = recent.cluster_id ?? recent.id
        if (!recent.cluster_id) {
          prep(db, `UPDATE trail_connections SET cluster_id = ? WHERE id = ?`).run(clusterId, recent.id)
        }
      }
    }

    prep(db, `
      INSERT INTO trail_connections (
        id, trail_session_id, from_node_id, to_kind, to_book_id, to_chapter, to_verse,
        to_strongs_num, to_note_id, to_video_id, clarity_tier, reason_text, reason_tags,
        weight, strongs_depth, cluster_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, conn.trailSessionId, conn.fromNodeId, conn.toKind,
      conn.toBookId ?? null, conn.toChapter ?? null, conn.toVerse ?? null,
      conn.toStrongsNum ?? null, conn.toNoteId ?? null, conn.toVideoId ?? null,
      conn.clarityTier, conn.reasonText ?? null, conn.reasonTags ? JSON.stringify(conn.reasonTags) : null,
      conn.weight ?? 'full', conn.strongsDepth ?? null, clusterId, now
    )
    const result = rowToConnection(prep(db, 'SELECT * FROM trail_connections WHERE id = ?').get(id) as TrailConnectionRow)
    if (DEBUG) console.log('[TrailDebug:main] studyTrail:addConnection inserted', result)
    return result
  })

  ipcMain.handle('studyTrail:markGlance', (_e, connectionId: string) => {
    prep(getBereanDb(), `UPDATE trail_connections SET weight = 'glance' WHERE id = ?`).run(connectionId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:updateConnectionReason', (_e, connectionId: string, update: {
    reasonText?: string; reasonTags?: string[]; versePinFrom?: number; versePinTo?: number
  }) => {
    const db = getBereanDb()
    const sets: string[] = []
    const vals: any[] = []
    if (update.reasonText !== undefined) { sets.push('reason_text = ?'); vals.push(update.reasonText) }
    if (update.reasonTags !== undefined) { sets.push('reason_tags = ?'); vals.push(JSON.stringify(update.reasonTags)) }
    if (update.versePinFrom !== undefined) { sets.push('verse_pin_from = ?'); vals.push(update.versePinFrom) }
    if (update.versePinTo !== undefined) { sets.push('verse_pin_to = ?'); vals.push(update.versePinTo) }
    if (sets.length === 0) return { success: true }
    vals.push(connectionId)
    db.prepare(`UPDATE trail_connections SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    return { success: true }
  })

  // "Not now" — never auto-reprompt this connection again; the '?' stays clickable forever
  // as the only way back to it (renderer-side, not enforced here — this just records the
  // fact of dismissal so the renderer knows not to auto-surface it again).
  ipcMain.handle('studyTrail:dismissPrompt', (_e, connectionId: string) => {
    prep(getBereanDb(), `UPDATE trail_connections SET dismissed_prompt_at = ? WHERE id = ?`).run(Date.now(), connectionId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:updateRecap', (_e, trailSessionId: string, recapText: string) => {
    prep(getBereanDb(), `UPDATE trail_sessions SET recap_text = ?, recap_user_edited = 1, updated_at = ? WHERE id = ?`)
      .run(recapText, Date.now(), trailSessionId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:getBacklinks', (_e, bookId: string, chapter: number, excludeSessionId: string) => {
    const db = getBereanDb()
    const rows = db.prepare(`
      SELECT c.*, s.name as session_name FROM trail_connections c
      JOIN trail_sessions s ON s.id = c.trail_session_id
      WHERE c.to_book_id = ? AND c.to_chapter = ? AND c.trail_session_id != ?
      ORDER BY c.created_at DESC LIMIT 10
    `).all(bookId, chapter, excludeSessionId) as Array<TrailConnectionRow & { session_name: string }>
    return rows.map((r) => ({ ...rowToConnection(r), sessionName: r.session_name }))
  })

  // Search — literal substring match over reasons/tags and (for lexicon connections) the
  // Strong's short/full definitions, joined live from the lexicon DBs. This is the real,
  // working v1 search: typing "love" already matches ἀγάπη-family entries because their
  // gloss text literally contains "love". True semantic/conceptual matching (finding a
  // connection with NO textual overlap to the query at all) needs a local embedding model
  // (trail_embeddings table above is the storage for it) — NOT implemented in this pass;
  // that's a separate, larger piece of work (bundling e.g. @xenova/transformers +
  // Xenova/all-MiniLM-L6-v2 as an offline model, an electron/lib/embeddings.ts loader, and
  // backfill/maintenance of trail_embeddings) tracked as a deferred follow-up, not something
  // to fake here.
  ipcMain.handle('studyTrail:search', (_e, query: string) => {
    const db = getBereanDb()
    const q = `%${query.toLowerCase()}%`
    const rows = db.prepare(`
      SELECT c.*, s.name as session_name FROM trail_connections c
      JOIN trail_sessions s ON s.id = c.trail_session_id
      WHERE LOWER(COALESCE(c.reason_text, '')) LIKE ? OR LOWER(COALESCE(c.reason_tags, '')) LIKE ?
      ORDER BY c.created_at DESC LIMIT 50
    `).all(q, q) as Array<TrailConnectionRow & { session_name: string }>
    return rows.map((r) => ({ ...rowToConnection(r), sessionName: r.session_name }))
  })
}
