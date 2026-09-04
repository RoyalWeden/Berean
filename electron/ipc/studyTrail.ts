import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'

// The implicit "Loose stops" bucket — where navigation is recorded when the user has NOT
// created a session of their own. Per direct feedback: "i don't want an untitled study session
// created if i didn't create one... only i can create a session... if the user continues to
// study, then these things are just put in everything". This row exists so recording never
// silently drops, but it is filtered OUT of listSessions (so it never appears in the session
// rail) and only surfaces in the merged Everything timeline. Kept in sync with the same
// constant in src/store/studyTrailSlice.ts.
export const LOOSE_SESSION_ID = '__loose_stops__'

// Push-based live update — per direct feedback ("make sure that the study trail auto updates
// as i am studying... want it faster / near-instant"), every window gets told IMMEDIATELY
// whenever a node/connection/session is written, instead of relying solely on the Study Trail
// window's own 2s poll (StudyTrailApp.tsx/EverythingView.tsx keep that poll too, as a cheap
// safety net — this is the fast path, not a replacement for it). Payload is just the session id
// (or undefined for a session-list-level change) — listeners re-fetch rather than trust a
// pushed snapshot, so this can't drift out of sync with the DB.
function broadcastDataChanged(trailSessionId?: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('studyTrail:dataChanged', trailSessionId)
  }
}

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
  sort_order?: number | null
}
interface TrailNodeRow {
  id: string; trail_session_id: string; book_id: string; chapter: number; order_index: number
  anchor_started_at: number; anchor_ended_at: number | null; cached_subnote: string | null; origin_label: string | null
  revisit_of_node_id: string | null; promoted_from_connection_id: string | null; translation: string | null
  cluster_id: string | null; is_topic_break: number
}
interface TrailConnectionRow {
  id: string; trail_session_id: string; from_node_id: string; to_kind: string
  to_book_id: string | null; to_chapter: number | null; to_verse: number | null
  to_strongs_num: string | null; to_note_id: string | null; to_video_id: string | null
  clarity_tier: number; reason_text: string | null; reason_tags: string | null
  verse_pin_from: number | null; verse_pin_to: number | null
  origin_verse_pin_from: number | null; origin_verse_pin_to: number | null
  weight: string; strongs_depth: string | null; cluster_id: string | null
  dismissed_prompt_at: number | null; created_at: number
  from_connection_id: string | null; chain_depth: number; to_verse_end: number | null
  ties: string | null
  user_note: string | null; ties_from: string | null; ties_to: string | null
  is_branch: number; is_branch_return: number
}

function rowToSession(r: TrailSessionRow) {
  return {
    id: r.id, name: r.name, status: r.status as 'live' | 'paused' | 'ended',
    possiblyAccidental: !!r.possibly_accidental,
    recapText: r.recap_text ?? undefined,
    recapUserEdited: !!r.recap_user_edited,
    createdAt: r.created_at, updatedAt: r.updated_at,
    sortOrder: r.sort_order ?? undefined,
  }
}
function rowToNode(r: TrailNodeRow) {
  return {
    id: r.id, trailSessionId: r.trail_session_id, bookId: r.book_id, chapter: r.chapter,
    orderIndex: r.order_index, anchorStartedAt: r.anchor_started_at,
    anchorEndedAt: r.anchor_ended_at ?? undefined,
    cachedSubnote: r.cached_subnote ?? undefined, originLabel: r.origin_label ?? undefined,
    revisitOfNodeId: r.revisit_of_node_id ?? undefined,
    promotedFromConnectionId: r.promoted_from_connection_id ?? undefined,
    translation: r.translation ?? undefined,
    clusterId: r.cluster_id ?? undefined,
    isTopicBreak: !!r.is_topic_break,
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
    originVersePinFrom: r.origin_verse_pin_from ?? undefined, originVersePinTo: r.origin_verse_pin_to ?? undefined,
    ties: r.ties ? JSON.parse(r.ties) : [],
    userNote: r.user_note ?? undefined,
    tiesFrom: r.ties_from ? JSON.parse(r.ties_from) : [],
    tiesTo: r.ties_to ? JSON.parse(r.ties_to) : [],
    weight: r.weight as 'full' | 'glance',
    strongsDepth: r.strongs_depth ?? undefined,
    clusterId: r.cluster_id ?? undefined,
    dismissedPromptAt: r.dismissed_prompt_at ?? undefined,
    createdAt: r.created_at,
    fromConnectionId: r.from_connection_id ?? undefined,
    chainDepth: r.chain_depth,
    toVerseEnd: r.to_verse_end ?? undefined,
    isBranch: !!r.is_branch,
    isBranchReturn: !!r.is_branch_return,
  }
}

// How long a rapid same-chapter-pair flip has to keep recurring, and how many times, before
// it's flagged as a revisit cluster. Tunable without touching the recorder logic in the
// renderer — this is the one place that actually queries "recent" connections.
const CLUSTER_WINDOW_MS = 5 * 60 * 1000
const CLUSTER_MIN_COUNT = 2

export function registerStudyTrailHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('studyTrail:startSession', (_e, name: string) => {
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    prep(db, `INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'live', ?, ?)`)
      .run(id, name, now, now)
    const result = rowToSession(prep(db, 'SELECT * FROM trail_sessions WHERE id = ?').get(id) as TrailSessionRow)
    broadcastDataChanged(result.id)
    return result
  })

  ipcMain.handle('studyTrail:pauseSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const now = Date.now()
    prep(db, `UPDATE trail_sessions SET status = 'paused', updated_at = ? WHERE id = ?`).run(now, trailSessionId)
    prep(db, `INSERT INTO trail_paused_intervals (id, trail_session_id, paused_at) VALUES (?, ?, ?)`)
      .run(randomUUID(), trailSessionId, now)
    broadcastDataChanged(trailSessionId)
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
    broadcastDataChanged(trailSessionId)
    return { success: true }
  })

  ipcMain.handle('studyTrail:renameSession', (_e, trailSessionId: string, name: string) => {
    prep(getBereanDb(), `UPDATE trail_sessions SET name = ?, updated_at = ? WHERE id = ?`).run(name, Date.now(), trailSessionId)
    broadcastDataChanged(trailSessionId)
    return { success: true }
  })

  // Marks a session 'ended' and computes possiblyAccidental for real, rather than leaving the
  // column permanently at its DEFAULT 0 (there was previously no code path that ever wrote
  // 'ended' or touched this column at all). "Accidental" = a session with at most one node,
  // zero connections, and under 30s between creation and this call — i.e. the user opened a
  // session and immediately closed it without actually studying anything.
  ipcMain.handle('studyTrail:endSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const now = Date.now()
    prep(db, `UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL`)
      .run(now, trailSessionId)
    const session = prep(db, 'SELECT * FROM trail_sessions WHERE id = ?').get(trailSessionId) as TrailSessionRow | undefined
    const nodeCount = (prep(db, 'SELECT COUNT(*) as n FROM trail_nodes WHERE trail_session_id = ?').get(trailSessionId) as { n: number }).n
    const connCount = (prep(db, 'SELECT COUNT(*) as n FROM trail_connections WHERE trail_session_id = ?').get(trailSessionId) as { n: number }).n
    const accidental = !!session && nodeCount <= 1 && connCount === 0 && (now - session.created_at) < 30_000
    prep(db, `UPDATE trail_sessions SET status = 'ended', possibly_accidental = ?, updated_at = ? WHERE id = ?`)
      .run(accidental ? 1 : 0, now, trailSessionId)
    broadcastDataChanged(trailSessionId)
    return rowToSession(prep(db, 'SELECT * FROM trail_sessions WHERE id = ?').get(trailSessionId) as TrailSessionRow)
  })

  // Deletes one session and every row that references it — no FK cascade is declared on these
  // tables (see the CREATE TABLE statements in electron/db/berean.ts), so each dependent table
  // is cleared explicitly, same shape as notes.ts's notes:permanentDelete.
  ipcMain.handle('studyTrail:deleteSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const del = db.transaction((id: string) => {
      prep(db, 'DELETE FROM trail_connections WHERE trail_session_id = ?').run(id)
      prep(db, 'DELETE FROM trail_nodes WHERE trail_session_id = ?').run(id)
      prep(db, 'DELETE FROM trail_paused_intervals WHERE trail_session_id = ?').run(id)
      prep(db, 'DELETE FROM trail_sessions WHERE id = ?').run(id)
    })
    del(trailSessionId)
    broadcastDataChanged()
    return { success: true }
  })

  // Bulk variant, one transaction for the whole batch (mirrors notes.ts's notes:emptyTrash).
  ipcMain.handle('studyTrail:deleteSessions', (_e, trailSessionIds: string[]) => {
    const db = getBereanDb()
    const delAll = db.transaction((ids: string[]) => {
      for (const id of ids) {
        prep(db, 'DELETE FROM trail_connections WHERE trail_session_id = ?').run(id)
        prep(db, 'DELETE FROM trail_nodes WHERE trail_session_id = ?').run(id)
        prep(db, 'DELETE FROM trail_paused_intervals WHERE trail_session_id = ?').run(id)
        prep(db, 'DELETE FROM trail_sessions WHERE id = ?').run(id)
      }
    })
    delAll(trailSessionIds)
    broadcastDataChanged()
    return { success: true }
  })

  ipcMain.handle('studyTrail:listSessions', () => {
    // Excludes the implicit "Loose stops" bucket — it must never show in the session rail.
    // `sort_order` (set by a drag in the session rail) wins where it exists; everything the user
    // hasn't hand-placed falls back to plain recency, which is what the rail used to do for all
    // of them. NULLs sort last so a single hand-placed session doesn't push the rest around.
    const rows = getBereanDb().prepare(
      'SELECT * FROM trail_sessions WHERE id != ? ORDER BY sort_order IS NULL, sort_order ASC, updated_at DESC'
    ).all(LOOSE_SESSION_ID) as TrailSessionRow[]
    return rows.map(rowToSession)
  })

  // Every session INCLUDING the loose bucket — for the merged Everything timeline only. The
  // loose bucket is returned only when it actually holds stops, so an empty bucket never adds
  // a "Loose stops" divider to Everything for nothing.
  ipcMain.handle('studyTrail:listAllSessions', () => {
    const db = getBereanDb()
    const rows = db.prepare('SELECT * FROM trail_sessions ORDER BY updated_at DESC').all() as TrailSessionRow[]
    const looseHasNodes = (db.prepare('SELECT COUNT(*) as n FROM trail_nodes WHERE trail_session_id = ?').get(LOOSE_SESSION_ID) as { n: number }).n > 0
    return rows.filter((r) => r.id !== LOOSE_SESSION_ID || looseHasNodes).map(rowToSession)
  })

  // Create (or re-activate) the implicit loose bucket and return it. Idempotent — called by the
  // renderer's ensureLiveSession() whenever navigation happens with no user session live.
  ipcMain.handle('studyTrail:ensureLooseSession', () => {
    const db = getBereanDb()
    const now = Date.now()
    const existing = db.prepare('SELECT * FROM trail_sessions WHERE id = ?').get(LOOSE_SESSION_ID) as TrailSessionRow | undefined
    if (!existing) {
      prep(db, `INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, 'Loose stops', 'live', ?, ?)`)
        .run(LOOSE_SESSION_ID, now, now)
    } else if (existing.status !== 'live') {
      prep(db, `UPDATE trail_sessions SET status = 'live', updated_at = ? WHERE id = ?`).run(now, LOOSE_SESSION_ID)
    }
    return rowToSession(db.prepare('SELECT * FROM trail_sessions WHERE id = ?').get(LOOSE_SESSION_ID) as TrailSessionRow)
  })

  ipcMain.handle('studyTrail:getSession', (_e, trailSessionId: string) => {
    const db = getBereanDb()
    const session = db.prepare('SELECT * FROM trail_sessions WHERE id = ?').get(trailSessionId) as TrailSessionRow | undefined
    if (!session) return null
    const nodes = db.prepare('SELECT * FROM trail_nodes WHERE trail_session_id = ? ORDER BY order_index').all(trailSessionId) as TrailNodeRow[]
    const connections = db.prepare('SELECT * FROM trail_connections WHERE trail_session_id = ? ORDER BY created_at').all(trailSessionId) as TrailConnectionRow[]
    // Paused intervals — returned alongside nodes/connections so the Map view can subtract
    // real pause time out of a gap's displayed duration (a 20-minute pause between two
    // chapters shouldn't visually read as "20 minutes of thinking about it").
    const pausedRows = db.prepare('SELECT paused_at, resumed_at FROM trail_paused_intervals WHERE trail_session_id = ? ORDER BY paused_at')
      .all(trailSessionId) as Array<{ paused_at: number; resumed_at: number | null }>
    const pausedIntervals = pausedRows.map((r) => ({ pausedAt: r.paused_at, resumedAt: r.resumed_at ?? undefined }))
    return { session: rowToSession(session), nodes: nodes.map(rowToNode), connections: connections.map(rowToConnection), pausedIntervals }
  })

  ipcMain.handle('studyTrail:addNode', (_e, node: {
    trailSessionId: string; bookId: string; chapter: number; orderIndex: number; originLabel?: string
    translation?: string
    // Wall-clock time the user actually navigated to this chapter (captured synchronously in the
    // renderer's nav recorder). Used for BOTH this node's anchor_started_at AND the close-out of
    // the previous anchor — the arrival dwell + IPC hop otherwise stamps everything ~1.2s+ late.
    // Falls back to now for any caller that doesn't pass it.
    anchorStartedAt?: number
  }) => {
    // Deliberately NOT wrapped in try/catch: a thrown error here (e.g. a constraint violation)
    // should propagate back through ipcMain.handle's rejected promise to the renderer's own
    // .catch((err) => console.error(...)) rather than being swallowed at either end.
    const db = getBereanDb()
    const id = randomUUID()
    const startedAt = node.anchorStartedAt ?? Date.now()
    // Close out the previous anchor (if any) so its anchor_ended_at reflects when the user
    // actually left that chapter (= when they navigated here), before opening the new one.
    prep(db, `UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL`)
      .run(startedAt, node.trailSessionId)
    prep(db, `
      INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, origin_label, translation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, node.trailSessionId, node.bookId, node.chapter, node.orderIndex, startedAt, node.originLabel ?? null, node.translation ?? null)
    const result = rowToNode(prep(db, 'SELECT * FROM trail_nodes WHERE id = ?').get(id) as TrailNodeRow)
    broadcastDataChanged(result.trailSessionId)
    return result
  })

  // Reopens an EXISTING node instead of creating a new one — the fix for "spine drift": before
  // this, returning to an already-visited chapter (e.g. clicking a Strong's occurrence that
  // lands back on a chapter you'd already read) always called addNode, permanently dragging
  // the trail's anchor through the detour with no way back. The renderer (studyTrailSlice.ts)
  // now checks its own in-memory session-node index first and calls THIS instead of addNode
  // whenever the destination book/chapter already has a node in the session — same
  // "close whatever's currently open" step as addNode, but re-activates the existing row
  // (order_index — and so its position in the spine — never changes) rather than inserting a
  // duplicate. Note: anchor_started_at is deliberately left untouched on reopen, so a node's
  // total displayed dwell time after a round trip includes the detour time in between — a
  // known simplification (tracking disjoint open/close intervals per node would need its own
  // child table) rather than a bug; see MapView's round-trip rendering, which is what actually
  // needs this to exist and not the interval accounting.
  ipcMain.handle('studyTrail:reopenNode', (_e, nodeId: string, at?: number) => {
    const db = getBereanDb()
    // `at` = when the user actually navigated back here (renderer nav-recorder time); the
    // previous anchor is closed out at that moment, not this handler's own later clock.
    const now = at ?? Date.now()
    const node = prep(db, 'SELECT * FROM trail_nodes WHERE id = ?').get(nodeId) as TrailNodeRow | undefined
    if (!node) return null
    prep(db, `UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL AND id != ?`)
      .run(now, node.trail_session_id, nodeId)
    prep(db, `UPDATE trail_nodes SET anchor_ended_at = NULL WHERE id = ?`).run(nodeId)
    const result = rowToNode(prep(db, 'SELECT * FROM trail_nodes WHERE id = ?').get(nodeId) as TrailNodeRow)
    broadcastDataChanged(result.trailSessionId)
    return result
  })

  // Revisit promotion — called (see studyTrailSlice.ts's recorder) when the user is about to
  // navigate AWAY from a reopened node they'd genuinely re-engaged with (real dwell time this
  // visit, not just a bounce-through). Splits that engagement off into its own new node,
  // positioned at its real chronological spot on the spine (order_index/anchor_started_at =
  // when THIS revisit actually began, not "now") rather than leaving it permanently folded
  // into the original node's frozen first-visit position. The original node's own
  // anchor_ended_at is closed out at the revisit's start time, so its own displayed dwell
  // duration no longer double-counts time that now belongs to the promoted node.
  ipcMain.handle('studyTrail:promoteRevisit', (_e, args: {
    trailSessionId: string; originalNodeId: string; bookId: string; chapter: number; activatedAt: number
    translation?: string
  }) => {
    const db = getBereanDb()
    const now = Date.now()
    const id = randomUUID()
    // Node-level twin of addConnection's connection-cluster detection above, but broader on
    // purpose: NOT scoped to this same chapter. A rapid A<->B oscillation alternates chapters
    // (A,B,A,B...), so two promotions of the SAME chapter are never adjacent in the spine once
    // interleaved with the other side of the bounce — clustering only same-chapter promotions
    // (like connections do, which is fine there since a connection's own row lives directly
    // under its distinct source) would produce two clusters that never render as one
    // contiguous, collapsible run. Matching ANY recent promotion in this session instead makes
    // the whole flurry (both directions) one cluster, which IS contiguous in the spine and
    // lets MapView.tsx collapse it into one "bounced N times" summary instead of N full nodes.
    let clusterId: string | null = null
    const recentNode = prep(db, `
      SELECT id, cluster_id FROM trail_nodes
      WHERE trail_session_id = ? AND revisit_of_node_id IS NOT NULL AND anchor_started_at > ?
      ORDER BY anchor_started_at DESC LIMIT 1
    `).get(args.trailSessionId, now - CLUSTER_WINDOW_MS) as { id: string; cluster_id: string | null } | undefined
    if (recentNode) {
      clusterId = recentNode.cluster_id ?? recentNode.id
      if (!recentNode.cluster_id) {
        prep(db, `UPDATE trail_nodes SET cluster_id = ? WHERE id = ?`).run(clusterId, recentNode.id)
      }
    }
    const promote = db.transaction(() => {
      prep(db, `UPDATE trail_nodes SET anchor_ended_at = ? WHERE id = ? AND anchor_ended_at IS NULL`)
        .run(args.activatedAt, args.originalNodeId)
      prep(db, `
        INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, anchor_ended_at, revisit_of_node_id, translation, cluster_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, args.trailSessionId, args.bookId, args.chapter, args.activatedAt, args.activatedAt, now, args.originalNodeId, args.translation ?? null, clusterId)
    })
    promote()
    const result = rowToNode(prep(db, 'SELECT * FROM trail_nodes WHERE id = ?').get(id) as TrailNodeRow)
    broadcastDataChanged(result.trailSessionId)
    return result
  })

  ipcMain.handle('studyTrail:updateNodeSubnote', (_e, nodeId: string, subnote: string) => {
    prep(getBereanDb(), `UPDATE trail_nodes SET cached_subnote = ? WHERE id = ?`).run(subnote, nodeId)
    broadcastDataChanged()
    return { success: true }
  })

  // Topic break (v36) — a horizontal divider on the main spine, set from the "ask why" popup's
  // "new topic" checkbox (applies to the node the user just arrived at) or edited later from
  // the Study Trail window.
  ipcMain.handle('studyTrail:setNodeTopicBreak', (_e, nodeId: string, isTopicBreak: boolean) => {
    prep(getBereanDb(), `UPDATE trail_nodes SET is_topic_break = ? WHERE id = ?`).run(isTopicBreak ? 1 : 0, nodeId)
    broadcastDataChanged()
    return { success: true }
  })

  // Delete a single trail node — right-click "Delete" on a bullet (§8 of the plan). Cascades to
  // its directly-attached connections (both those originating FROM it, and any same-chapter/
  // branch connections chained off one of those via from_connection_id), but leaves every OTHER
  // node/connection in the session untouched. The renderer confirms with the user first (this
  // handler itself performs no confirmation — it's a hard, immediate delete once called).
  ipcMain.handle('studyTrail:deleteNode', (_e, nodeId: string) => {
    const db = getBereanDb()
    const delNode = db.transaction((id: string) => {
      const directConnIds = (prep(db, 'SELECT id FROM trail_connections WHERE from_node_id = ?').all(id) as Array<{ id: string }>).map((r) => r.id)
      // Chained connections (a lexicon click off a lexicon click, etc.) reference their parent
      // via from_connection_id, not from_node_id — walk the chain outward so a delete doesn't
      // leave orphaned rows dangling off a connection that no longer exists.
      let frontier = directConnIds
      const allConnIds = new Set(directConnIds)
      while (frontier.length > 0) {
        const placeholders = frontier.map(() => '?').join(',')
        const next = (prep(db, `SELECT id FROM trail_connections WHERE from_connection_id IN (${placeholders})`).all(...frontier) as Array<{ id: string }>)
          .map((r) => r.id).filter((cid) => !allConnIds.has(cid))
        next.forEach((cid) => allConnIds.add(cid))
        frontier = next
      }
      if (allConnIds.size > 0) {
        const placeholders = [...allConnIds].map(() => '?').join(',')
        prep(db, `DELETE FROM trail_connections WHERE id IN (${placeholders})`).run(...allConnIds)
      }
      prep(db, 'DELETE FROM trail_nodes WHERE id = ?').run(id)
    })
    delNode(nodeId)
    broadcastDataChanged()
    return { success: true }
  })

  // Delete a single trail CONNECTION (a branch/tangent bullet) — right-click "Delete" on a
  // ConnRow in the Study Trail window. Cascades to any connections chained off it via
  // from_connection_id (a lexicon hop off a lexicon hop, etc.), the same outward walk deleteNode
  // does, so nothing is left dangling. Nodes are never touched — only the branch(es).
  ipcMain.handle('studyTrail:deleteConnection', (_e, connectionId: string) => {
    const db = getBereanDb()
    const del = db.transaction((id: string) => {
      const row = prep(db, 'SELECT trail_session_id FROM trail_connections WHERE id = ?').get(id) as
        { trail_session_id: string } | undefined
      if (!row) return null
      // Outward chain walk — collect this connection + everything chained off it.
      let frontier = [id]
      const allIds = new Set(frontier)
      while (frontier.length > 0) {
        const placeholders = frontier.map(() => '?').join(',')
        const next = (prep(db, `SELECT id FROM trail_connections WHERE from_connection_id IN (${placeholders})`).all(...frontier) as Array<{ id: string }>)
          .map((r) => r.id).filter((cid) => !allIds.has(cid))
        next.forEach((cid) => allIds.add(cid))
        frontier = next
      }
      const placeholders = [...allIds].map(() => '?').join(',')
      prep(db, `DELETE FROM trail_connections WHERE id IN (${placeholders})`).run(...allIds)
      return row.trail_session_id
    })
    const sessionId = del(connectionId)
    broadcastDataChanged(sessionId ?? undefined)
    return { success: true }
  })

  // Reassign nodes (and every connection hanging off them, including chained descendants) to a
  // different session — the "change the session of the selection" half of the Study Trail
  // marquee-select feature. Target may be the implicit loose bucket. order_index is set from
  // each node's own anchor_started_at so it slots into the target session chronologically.
  ipcMain.handle('studyTrail:moveNodes', (_e, nodeIds: string[], targetSessionId: string) => {
    const db = getBereanDb()
    const move = db.transaction((ids: string[], target: string) => {
      if (ids.length === 0) return
      // Collect all connection ids reachable from these nodes (direct + chained).
      const idPlaceholders = ids.map(() => '?').join(',')
      const directConnIds = (prep(db, `SELECT id FROM trail_connections WHERE from_node_id IN (${idPlaceholders})`).all(...ids) as Array<{ id: string }>).map((r) => r.id)
      let frontier = directConnIds
      const allConnIds = new Set(directConnIds)
      while (frontier.length > 0) {
        const ph = frontier.map(() => '?').join(',')
        const next = (prep(db, `SELECT id FROM trail_connections WHERE from_connection_id IN (${ph})`).all(...frontier) as Array<{ id: string }>)
          .map((r) => r.id).filter((cid) => !allConnIds.has(cid))
        next.forEach((cid) => allConnIds.add(cid))
        frontier = next
      }
      for (const id of ids) {
        prep(db, 'UPDATE trail_nodes SET trail_session_id = ?, order_index = COALESCE(anchor_started_at, order_index) WHERE id = ?').run(target, id)
      }
      if (allConnIds.size > 0) {
        const ph = [...allConnIds].map(() => '?').join(',')
        prep(db, `UPDATE trail_connections SET trail_session_id = ? WHERE id IN (${ph})`).run(target, ...allConnIds)
      }
      prep(db, `UPDATE trail_sessions SET updated_at = ? WHERE id = ?`).run(Date.now(), target)
      // order_index above is set to the node's own anchor timestamp purely so the moved nodes
      // slot in chronologically; renumbering afterwards turns that back into a dense 0..n-1 in
      // BOTH the source and target sessions. Without it the target keeps raw millisecond indices
      // interleaved with small integers, which is what the Map reads as spine order.
      for (const sid of new Set([target, ...sourceSessionIds])) renumberNodes(db, sid)
    })
    const sourceSessionIds = (nodeIds.length > 0
      ? (prep(db, `SELECT DISTINCT trail_session_id AS s FROM trail_nodes WHERE id IN (${nodeIds.map(() => '?').join(',')})`)
          .all(...nodeIds) as Array<{ s: string }>)
      : []).map((r) => r.s)
    move(nodeIds, targetSessionId)
    broadcastDataChanged()
    return { success: true }
  })

  ipcMain.handle('studyTrail:addConnection', (_e, conn: {
    trailSessionId: string; fromNodeId: string; toKind: string
    toBookId?: string; toChapter?: number; toVerse?: number
    toStrongsNum?: string; toNoteId?: string; toVideoId?: string
    clarityTier: 1 | 2 | 3; reasonText?: string; reasonTags?: string[]
    weight?: 'full' | 'glance'; strongsDepth?: string
    // Auto-captured at creation time (as opposed to originVersePinFrom/To's usual role as a
    // user-entered pin from the arrival-reason prompt) — a cross-ref click already KNOWS
    // exactly which verse on the chapter being left it came from (see NavOrigin's cross-ref
    // `fromVerse`), so there's no reason to make the user re-enter it later. Same column,
    // populated two different ways depending on how confident the origin already is.
    originVersePinFrom?: number
    // Branch chaining (v31) — when set, this connection's TRUE immediate predecessor is another
    // connection (a prior lexicon lookup, or same-chapter branch), not fromNodeId's chapter
    // directly. fromNodeId is still always required/populated (the chain's root chapter), so
    // every from_node_id-keyed query keeps working unmodified. chainDepth is 0 when there's no
    // parent connection, N+1 when there is — see studyTrailSlice.ts's currentBranchTipConnectionId.
    fromConnectionId?: string
    chainDepth?: number
    toVerseEnd?: number
    // User-marked tangent (v36) — set at capture time from the "ask why" popup's minimal
    // checkbox, or later via updateConnectionReason when reclassified from the Study Trail
    // window itself.
    isBranch?: boolean
    isBranchReturn?: boolean
    // Wall-clock time the navigation actually happened (renderer nav-recorder time), so
    // created_at — and therefore the connection's timeline position and displayed clock — is
    // when the user really jumped, not the later moment this dwell-delayed write runs. Falls
    // back to now.
    createdAt?: number
  }) => {
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    const createdAt = conn.createdAt ?? now

    // Revisit-cluster detection: same destination chapter-pair, recently, more than once. The
    // recency window is still measured against real wall-clock `now` (a stale createdAt
    // shouldn't widen it), only the stored timestamp uses createdAt.
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
        weight, strongs_depth, cluster_id, origin_verse_pin_from,
        from_connection_id, chain_depth, to_verse_end, is_branch, is_branch_return, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, conn.trailSessionId, conn.fromNodeId, conn.toKind,
      conn.toBookId ?? null, conn.toChapter ?? null, conn.toVerse ?? null,
      conn.toStrongsNum ?? null, conn.toNoteId ?? null, conn.toVideoId ?? null,
      conn.clarityTier, conn.reasonText ?? null, conn.reasonTags ? JSON.stringify(conn.reasonTags) : null,
      conn.weight ?? 'full', conn.strongsDepth ?? null, clusterId, conn.originVersePinFrom ?? null,
      conn.fromConnectionId ?? null, conn.chainDepth ?? 0, conn.toVerseEnd ?? null,
      conn.isBranch ? 1 : 0, conn.isBranchReturn ? 1 : 0, createdAt
    )
    const result = rowToConnection(prep(db, 'SELECT * FROM trail_connections WHERE id = ?').get(id) as TrailConnectionRow)
    broadcastDataChanged(result.trailSessionId)
    return result
  })

  ipcMain.handle('studyTrail:markGlance', (_e, connectionId: string) => {
    prep(getBereanDb(), `UPDATE trail_connections SET weight = 'glance' WHERE id = ?`).run(connectionId)
    broadcastDataChanged()
    return { success: true }
  })

  ipcMain.handle('studyTrail:updateConnectionReason', (_e, connectionId: string, update: {
    reasonText?: string; reasonTags?: string[]; versePinFrom?: number; versePinTo?: number
    originVersePinFrom?: number; originVersePinTo?: number
    ties?: string[]
    // Unified reason/note system (v35) — user_note is the ONLY field the note popover writes
    // to now for the user's own free-text note; reason_text stays purely the recorder's own
    // auto-inferred phrase and is never sent here by that popover anymore (still accepted as a
    // param for any other caller that legitimately wants to set it). ties_from/ties_to replace
    // the single `ties` list with the two labeled sections the popup now has.
    userNote?: string; tiesFrom?: string[]; tiesTo?: string[]
    // Editable after the fact from the Study Trail window — reclassify a tangent as having
    // been the real main branch, or mark that this connection is where a branch rejoins main.
    isBranch?: boolean; isBranchReturn?: boolean
  }) => {
    const db = getBereanDb()
    const sets: string[] = []
    const vals: any[] = []
    if (update.reasonText !== undefined) { sets.push('reason_text = ?'); vals.push(update.reasonText) }
    if (update.reasonTags !== undefined) { sets.push('reason_tags = ?'); vals.push(JSON.stringify(update.reasonTags)) }
    if (update.versePinFrom !== undefined) { sets.push('verse_pin_from = ?'); vals.push(update.versePinFrom) }
    if (update.versePinTo !== undefined) { sets.push('verse_pin_to = ?'); vals.push(update.versePinTo) }
    if (update.originVersePinFrom !== undefined) { sets.push('origin_verse_pin_from = ?'); vals.push(update.originVersePinFrom) }
    if (update.originVersePinTo !== undefined) { sets.push('origin_verse_pin_to = ?'); vals.push(update.originVersePinTo) }
    if (update.ties !== undefined) { sets.push('ties = ?'); vals.push(JSON.stringify(update.ties)) }
    if (update.userNote !== undefined) { sets.push('user_note = ?'); vals.push(update.userNote) }
    if (update.tiesFrom !== undefined) { sets.push('ties_from = ?'); vals.push(JSON.stringify(update.tiesFrom)) }
    if (update.tiesTo !== undefined) { sets.push('ties_to = ?'); vals.push(JSON.stringify(update.tiesTo)) }
    if (update.isBranch !== undefined) { sets.push('is_branch = ?'); vals.push(update.isBranch ? 1 : 0) }
    if (update.isBranchReturn !== undefined) { sets.push('is_branch_return = ?'); vals.push(update.isBranchReturn ? 1 : 0) }
    if (sets.length === 0) return { success: true }
    vals.push(connectionId)
    db.prepare(`UPDATE trail_connections SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    broadcastDataChanged()
    return { success: true }
  })

  // Delete — distinct from "Not now" (dismissPrompt): clears the user's own note content
  // entirely (user_note + ties_from/ties_to) rather than just marking the prompt as handled.
  // Auto-inferred fields (reason_text/reason_tags from the recorder, the legacy verse pins
  // captured automatically at record time) are left alone — those were never user-authored.
  ipcMain.handle('studyTrail:clearConnectionNote', (_e, connectionId: string) => {
    prep(getBereanDb(), `UPDATE trail_connections SET user_note = NULL, ties_from = NULL, ties_to = NULL WHERE id = ?`).run(connectionId)
    broadcastDataChanged()
    return { success: true }
  })

  // "Not now" — never auto-reprompt this connection again; the '?' stays clickable forever
  // as the only way back to it (renderer-side, not enforced here — this just records the
  // fact of dismissal so the renderer knows not to auto-surface it again).
  ipcMain.handle('studyTrail:dismissPrompt', (_e, connectionId: string) => {
    prep(getBereanDb(), `UPDATE trail_connections SET dismissed_prompt_at = ? WHERE id = ?`).run(Date.now(), connectionId)
    broadcastDataChanged()
    return { success: true }
  })

  ipcMain.handle('studyTrail:updateRecap', (_e, trailSessionId: string, recapText: string) => {
    prep(getBereanDb(), `UPDATE trail_sessions SET recap_text = ?, recap_user_edited = 1, updated_at = ? WHERE id = ?`)
      .run(recapText, Date.now(), trailSessionId)
    broadcastDataChanged(trailSessionId)
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

  // Search across EVERYTHING in the trail, not just connection reasons. Per direct feedback the
  // Study Trail window needs "a way to search all study trail notes and such by having an
  // additional tab ... for searching through all study trail things easily", so this covers:
  // session names and recaps, chapter stops (book id + their cached subnotes), connection reason
  // text/tags/user notes/verse ties, Strong's numbers, and the v39 sticky notes and section
  // headers. Results are typed so the Search tab can group them.
  //
  // Still literal LIKE matching, deliberately. True semantic search (finding a connection with NO
  // textual overlap with the query) needs a local embedding model; the `trail_embeddings` table
  // is the storage reserved for it and remains unused. Faking it here would be worse than not
  // having it.
  ipcMain.handle('studyTrail:search', (_e, query: string, opts?: {
    kinds?: Array<'session' | 'stop' | 'connection' | 'note'>
    bookId?: string; since?: number; until?: number; limit?: number
  }) => {
    const db = getBereanDb()
    const raw = (query ?? '').trim()
    if (!raw) return []
    const q = `%${raw.toLowerCase()}%`
    const limit = Math.min(500, opts?.limit ?? 200)
    const kinds = new Set(opts?.kinds ?? ['session', 'stop', 'connection', 'note'])
    const since = opts?.since ?? 0
    const until = opts?.until ?? Number.MAX_SAFE_INTEGER
    const out: TrailSearchHit[] = []

    if (kinds.has('session')) {
      const rows = db.prepare(`
        SELECT id, name, recap_text, updated_at FROM trail_sessions
        WHERE (LOWER(name) LIKE ? OR LOWER(COALESCE(recap_text, '')) LIKE ?) AND updated_at BETWEEN ? AND ?
        ORDER BY updated_at DESC LIMIT ?
      `).all(q, q, since, until, limit) as Array<{ id: string; name: string; recap_text: string | null; updated_at: number }>
      for (const r of rows) {
        out.push({ kind: 'session', id: r.id, sessionId: r.id, sessionName: r.name, title: r.name, snippet: r.recap_text ?? undefined, at: r.updated_at })
      }
    }

    if (kinds.has('stop')) {
      const rows = db.prepare(`
        SELECT n.id, n.trail_session_id, n.book_id, n.chapter, n.cached_subnote, n.anchor_started_at, s.name AS session_name
        FROM trail_nodes n JOIN trail_sessions s ON s.id = n.trail_session_id
        WHERE (LOWER(n.book_id) LIKE ? OR LOWER(COALESCE(n.cached_subnote, '')) LIKE ? OR LOWER(COALESCE(n.origin_label, '')) LIKE ?)
          AND n.anchor_started_at BETWEEN ? AND ?
          AND (? IS NULL OR n.book_id = ?)
        ORDER BY n.anchor_started_at DESC LIMIT ?
      `).all(q, q, q, since, until, opts?.bookId ?? null, opts?.bookId ?? null, limit) as Array<{
        id: string; trail_session_id: string; book_id: string; chapter: number
        cached_subnote: string | null; anchor_started_at: number; session_name: string
      }>
      for (const r of rows) {
        out.push({
          kind: 'stop', id: r.id, sessionId: r.trail_session_id, sessionName: r.session_name,
          title: `${r.book_id} ${r.chapter}`, snippet: r.cached_subnote ?? undefined,
          bookId: r.book_id, chapter: r.chapter, at: r.anchor_started_at,
        })
      }
    }

    if (kinds.has('connection')) {
      const rows = db.prepare(`
        SELECT c.*, s.name AS session_name FROM trail_connections c
        JOIN trail_sessions s ON s.id = c.trail_session_id
        WHERE (LOWER(COALESCE(c.reason_text, '')) LIKE ? OR LOWER(COALESCE(c.reason_tags, '')) LIKE ?
               OR LOWER(COALESCE(c.user_note, '')) LIKE ? OR LOWER(COALESCE(c.ties_from, '')) LIKE ?
               OR LOWER(COALESCE(c.ties_to, '')) LIKE ? OR LOWER(COALESCE(c.to_strongs_num, '')) LIKE ?
               OR LOWER(COALESCE(c.to_book_id, '')) LIKE ?)
          AND c.created_at BETWEEN ? AND ?
          AND (? IS NULL OR c.to_book_id = ?)
        ORDER BY c.created_at DESC LIMIT ?
      `).all(q, q, q, q, q, q, q, since, until, opts?.bookId ?? null, opts?.bookId ?? null, limit) as Array<TrailConnectionRow & { session_name: string }>
      for (const r of rows) {
        const c = rowToConnection(r)
        out.push({
          kind: 'connection', id: c.id, sessionId: c.trailSessionId, sessionName: r.session_name,
          title: c.toKind === 'lexicon' ? `Strong's ${c.toStrongsNum}` : `${c.toBookId ?? ''} ${c.toChapter ?? ''}`.trim(),
          snippet: c.userNote || c.reasonText || undefined,
          bookId: c.toBookId, chapter: c.toChapter, strongsNum: c.toStrongsNum, at: c.createdAt,
        })
      }
    }

    if (kinds.has('note')) {
      const rows = db.prepare(`
        SELECT t.*, s.name AS session_name FROM trail_notes t
        JOIN trail_sessions s ON s.id = t.trail_session_id
        WHERE (LOWER(COALESCE(t.title, '')) LIKE ? OR LOWER(t.body) LIKE ?) AND t.updated_at BETWEEN ? AND ?
        ORDER BY t.updated_at DESC LIMIT ?
      `).all(q, q, since, until, limit) as Array<TrailNoteRow & { session_name: string }>
      for (const r of rows) {
        out.push({
          kind: 'note', id: r.id, sessionId: r.trail_session_id, sessionName: r.session_name,
          title: r.title || (r.kind === 'section' ? 'Section' : 'Note'), snippet: r.body || undefined,
          anchorNodeId: r.anchor_node_id ?? undefined, at: r.updated_at,
        })
      }
    }

    return out.sort((a, b) => b.at - a.at).slice(0, limit)
  })

  // Threads — "what have I been chasing", grouped across every session. Replaces the deleted
  // Review tab, per direct feedback that Review "isnt helpful and i wouldnt use it... if there is
  // another tab, it needs to be something completely different".
  //
  // A thread is a SUBJECT, not a time span: one per book actually studied, plus one per distinct
  // Strong's number looked up. Grouping happens here rather than in the renderer so the Threads
  // tab never has to load every session's full detail the way Everything used to.
  ipcMain.handle('studyTrail:listThreads', () => {
    const db = getBereanDb()
    const byBook = db.prepare(`
      SELECT n.book_id AS key, COUNT(*) AS stops,
             MIN(n.anchor_started_at) AS first_at, MAX(n.anchor_started_at) AS last_at,
             COUNT(DISTINCT n.trail_session_id) AS sessions,
             COUNT(DISTINCT n.chapter) AS chapters
      FROM trail_nodes n GROUP BY n.book_id ORDER BY stops DESC
    `).all() as Array<{ key: string; stops: number; first_at: number; last_at: number; sessions: number; chapters: number }>

    const byStrongs = db.prepare(`
      SELECT c.to_strongs_num AS key, COUNT(*) AS stops,
             MIN(c.created_at) AS first_at, MAX(c.created_at) AS last_at,
             COUNT(DISTINCT c.trail_session_id) AS sessions
      FROM trail_connections c
      WHERE c.to_kind = 'lexicon' AND c.to_strongs_num IS NOT NULL
      GROUP BY c.to_strongs_num ORDER BY stops DESC
    `).all() as Array<{ key: string; stops: number; first_at: number; last_at: number; sessions: number }>

    const sessionsForBook = db.prepare(`
      SELECT DISTINCT n.trail_session_id AS id, s.name AS name FROM trail_nodes n
      JOIN trail_sessions s ON s.id = n.trail_session_id WHERE n.book_id = ?
      ORDER BY s.updated_at DESC LIMIT 12
    `)
    const sessionsForStrongs = db.prepare(`
      SELECT DISTINCT c.trail_session_id AS id, s.name AS name FROM trail_connections c
      JOIN trail_sessions s ON s.id = c.trail_session_id WHERE c.to_strongs_num = ?
      ORDER BY s.updated_at DESC LIMIT 12
    `)

    const threads = [
      ...byBook.map((r) => ({
        id: `book:${r.key}`, kind: 'book' as const, label: r.key, bookId: r.key,
        stops: r.stops, chapters: r.chapters, firstAt: r.first_at, lastAt: r.last_at,
        sessions: sessionsForBook.all(r.key) as Array<{ id: string; name: string }>,
      })),
      ...byStrongs.map((r) => ({
        id: `strongs:${r.key}`, kind: 'strongs' as const, label: r.key, strongsNum: r.key,
        stops: r.stops, chapters: 0, firstAt: r.first_at, lastAt: r.last_at,
        sessions: sessionsForStrongs.all(r.key) as Array<{ id: string; name: string }>,
      })),
    ]
    // Most-recently-touched first — a thread you were chasing this morning matters more than one
    // with more total stops from three months ago.
    return threads.sort((a, b) => b.lastAt - a.lastAt)
  })

  // One page of sessions, newest first — keyset pagination on updated_at, mirroring
  // electron/ipc/history.ts's getPage. Everything used to load EVERY session in full on every
  // change; this is what lets it scroll infinitely instead.
  ipcMain.handle('studyTrail:listSessionsPage', (_e, cursor: number | undefined, limit = 10) => {
    const db = getBereanDb()
    const n = Math.min(50, Math.max(1, limit))
    const rows = (cursor == null
      ? db.prepare('SELECT * FROM trail_sessions ORDER BY updated_at DESC LIMIT ?').all(n + 1)
      : db.prepare('SELECT * FROM trail_sessions WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?').all(cursor, n + 1)
    ) as TrailSessionRow[]
    const looseHasNodes = (db.prepare('SELECT COUNT(*) as n FROM trail_nodes WHERE trail_session_id = ?').get(LOOSE_SESSION_ID) as { n: number }).n > 0
    const page = rows.slice(0, n).filter((r) => r.id !== LOOSE_SESSION_ID || looseHasNodes)
    return {
      sessions: page.map(rowToSession),
      nextCursor: rows.length > n ? rows[n - 1].updated_at : undefined,
    }
  })

  // ── Collapse state (v38) ──────────────────────────────────────────────────
  // A missing row means "expanded", so nothing needs seeding and a cleared table just re-opens
  // everything. Scopes: 'branch' (a connection id), 'section' (a trail_notes id), 'session' and
  // 'day' (Everything's own groupings).
  ipcMain.handle('studyTrail:getCollapse', (_e, scope?: string) => {
    const db = getBereanDb()
    const rows = scope
      ? db.prepare('SELECT scope, key FROM trail_collapse WHERE collapsed = 1 AND scope = ?').all(scope)
      : db.prepare('SELECT scope, key FROM trail_collapse WHERE collapsed = 1').all()
    return (rows as Array<{ scope: string; key: string }>).map((r) => `${r.scope}:${r.key}`)
  })

  ipcMain.handle('studyTrail:setCollapse', (_e, scope: string, key: string, collapsed: boolean) => {
    const db = getBereanDb()
    if (collapsed) {
      prep(db, `INSERT INTO trail_collapse (scope, key, collapsed, updated_at) VALUES (?, ?, 1, ?)
                ON CONFLICT(scope, key) DO UPDATE SET collapsed = 1, updated_at = excluded.updated_at`)
        .run(scope, key, Date.now())
    } else {
      // Deleted rather than stored as collapsed=0 — "expanded" is the default, so an absent row
      // says it just as well and the table stays proportional to what's actually folded away.
      prep(db, 'DELETE FROM trail_collapse WHERE scope = ? AND key = ?').run(scope, key)
    }
    return { success: true }
  })

  // ── Trail notes / sections (v39) ──────────────────────────────────────────
  ipcMain.handle('studyTrail:listNotes', (_e, trailSessionId?: string) => {
    const db = getBereanDb()
    const rows = trailSessionId
      ? db.prepare('SELECT * FROM trail_notes WHERE trail_session_id = ? ORDER BY order_index, created_at').all(trailSessionId)
      : db.prepare('SELECT * FROM trail_notes ORDER BY created_at DESC').all()
    return (rows as TrailNoteRow[]).map(rowToTrailNote)
  })

  ipcMain.handle('studyTrail:createNote', (_e, input: {
    trailSessionId: string; kind?: 'section' | 'annotation'; anchorNodeId?: string
    title?: string; body?: string; color?: string; noteId?: string; orderIndex?: number
  }) => {
    const db = getBereanDb()
    const now = Date.now()
    const id = randomUUID()
    prep(db, `INSERT INTO trail_notes
      (id, trail_session_id, kind, anchor_node_id, order_index, title, body, color, note_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, input.trailSessionId, input.kind ?? 'annotation', input.anchorNodeId ?? null,
      input.orderIndex ?? 0, input.title ?? null, input.body ?? '', input.color ?? null,
      input.noteId ?? null, now, now,
    )
    broadcastDataChanged(input.trailSessionId)
    return rowToTrailNote(db.prepare('SELECT * FROM trail_notes WHERE id = ?').get(id) as TrailNoteRow)
  })

  ipcMain.handle('studyTrail:updateNote', (_e, id: string, patch: Partial<{
    kind: string; anchorNodeId: string | null; orderIndex: number; title: string | null
    body: string; width: number | null; height: number | null; noteId: string | null; color: string | null
  }>) => {
    const db = getBereanDb()
    const COLUMN: Record<string, string> = {
      kind: 'kind', anchorNodeId: 'anchor_node_id', orderIndex: 'order_index', title: 'title',
      body: 'body', width: 'width', height: 'height', noteId: 'note_id', color: 'color',
    }
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMN[k]
      if (!col) continue
      sets.push(`${col} = ?`)
      vals.push(v ?? null)
    }
    if (sets.length === 0) return { success: true }
    sets.push('updated_at = ?')
    vals.push(Date.now(), id)
    db.prepare(`UPDATE trail_notes SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    const row = db.prepare('SELECT * FROM trail_notes WHERE id = ?').get(id) as TrailNoteRow | undefined
    if (row) broadcastDataChanged(row.trail_session_id)
    return { success: true }
  })

  ipcMain.handle('studyTrail:deleteNote', (_e, id: string) => {
    const db = getBereanDb()
    const row = db.prepare('SELECT trail_session_id FROM trail_notes WHERE id = ?').get(id) as { trail_session_id: string } | undefined
    prep(db, 'DELETE FROM trail_notes WHERE id = ?').run(id)
    // Its collapse state goes with it, otherwise a recycled id would inherit a stale fold.
    prep(db, `DELETE FROM trail_collapse WHERE scope = 'section' AND key = ?`).run(id)
    if (row) broadcastDataChanged(row.trail_session_id)
    return { success: true }
  })

  // ── Session tags (v40) ────────────────────────────────────────────────────
  ipcMain.handle('studyTrail:listTags', () => {
    const db = getBereanDb()
    const tags = db.prepare('SELECT * FROM trail_tags ORDER BY sort_order IS NULL, sort_order, name COLLATE NOCASE')
      .all() as Array<{ id: string; name: string; color: string | null; sort_order: number | null }>
    const members = db.prepare('SELECT tag_id, trail_session_id FROM trail_tag_members')
      .all() as Array<{ tag_id: string; trail_session_id: string }>
    const bySession = new Map<string, string[]>()
    for (const m of members) {
      const list = bySession.get(m.tag_id)
      if (list) list.push(m.trail_session_id)
      else bySession.set(m.tag_id, [m.trail_session_id])
    }
    return tags.map((t) => ({
      id: t.id, name: t.name, color: t.color ?? undefined, sortOrder: t.sort_order ?? undefined,
      sessionIds: bySession.get(t.id) ?? [],
    }))
  })

  ipcMain.handle('studyTrail:createTag', (_e, name: string, color?: string) => {
    const db = getBereanDb()
    const existing = db.prepare('SELECT * FROM trail_tags WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined
    if (existing) return { id: existing.id }
    const id = randomUUID()
    prep(db, 'INSERT INTO trail_tags (id, name, color, created_at) VALUES (?, ?, ?, ?)').run(id, name.trim(), color ?? null, Date.now())
    broadcastDataChanged()
    return { id }
  })

  ipcMain.handle('studyTrail:updateTag', (_e, id: string, patch: { name?: string; color?: string | null; sortOrder?: number | null }) => {
    const db = getBereanDb()
    if (patch.name != null) prep(db, 'UPDATE trail_tags SET name = ? WHERE id = ?').run(patch.name.trim(), id)
    if ('color' in patch) prep(db, 'UPDATE trail_tags SET color = ? WHERE id = ?').run(patch.color ?? null, id)
    if ('sortOrder' in patch) prep(db, 'UPDATE trail_tags SET sort_order = ? WHERE id = ?').run(patch.sortOrder ?? null, id)
    broadcastDataChanged()
    return { success: true }
  })

  ipcMain.handle('studyTrail:deleteTag', (_e, id: string) => {
    // ON DELETE CASCADE handles the members, but foreign_keys is only ON for connections opened
    // through getBereanDb() — deleting explicitly makes that independent of the pragma.
    const db = getBereanDb()
    prep(db, 'DELETE FROM trail_tag_members WHERE tag_id = ?').run(id)
    prep(db, 'DELETE FROM trail_tags WHERE id = ?').run(id)
    broadcastDataChanged()
    return { success: true }
  })

  ipcMain.handle('studyTrail:setSessionTags', (_e, trailSessionId: string, tagIds: string[]) => {
    const db = getBereanDb()
    db.transaction(() => {
      prep(db, 'DELETE FROM trail_tag_members WHERE trail_session_id = ?').run(trailSessionId)
      const ins = prep(db, 'INSERT OR IGNORE INTO trail_tag_members (tag_id, trail_session_id, created_at) VALUES (?, ?, ?)')
      const now = Date.now()
      for (const t of tagIds) ins.run(t, trailSessionId, now)
    })()
    broadcastDataChanged(trailSessionId)
    return { success: true }
  })

  // ── Session merge / split / reorder ───────────────────────────────────────
  // All three are order_index rewrites plus a trail_session_id move, in one transaction so a
  // half-applied merge can never leave nodes orphaned between two sessions.
  ipcMain.handle('studyTrail:mergeSessions', (_e, intoId: string, fromId: string) => {
    const db = getBereanDb()
    if (intoId === fromId) return { success: false, error: 'same session' }
    db.transaction(() => {
      prep(db, 'UPDATE trail_nodes SET trail_session_id = ? WHERE trail_session_id = ?').run(intoId, fromId)
      prep(db, 'UPDATE trail_connections SET trail_session_id = ? WHERE trail_session_id = ?').run(intoId, fromId)
      prep(db, 'UPDATE trail_notes SET trail_session_id = ? WHERE trail_session_id = ?').run(intoId, fromId)
      renumberNodes(db, intoId)
      // The loose bucket is structural — it always exists and is re-provisioned on demand — so
      // merging OUT of it empties it rather than deleting the row.
      if (fromId !== LOOSE_SESSION_ID) prep(db, 'DELETE FROM trail_sessions WHERE id = ?').run(fromId)
      prep(db, 'UPDATE trail_sessions SET updated_at = ? WHERE id = ?').run(Date.now(), intoId)
    })()
    broadcastDataChanged()
    return { success: true }
  })

  /** Everything from `atNodeId` onward (by order_index) becomes a new session. */
  ipcMain.handle('studyTrail:splitSession', (_e, trailSessionId: string, atNodeId: string, name?: string) => {
    const db = getBereanDb()
    const pivot = db.prepare('SELECT order_index, anchor_started_at FROM trail_nodes WHERE id = ?')
      .get(atNodeId) as { order_index: number; anchor_started_at: number } | undefined
    if (!pivot) return { success: false, error: 'node not found' }
    const newId = randomUUID()
    db.transaction(() => {
      const now = Date.now()
      prep(db, `INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'paused', ?, ?)`)
        .run(newId, name?.trim() || 'Split session', now, now)
      prep(db, 'UPDATE trail_nodes SET trail_session_id = ? WHERE trail_session_id = ? AND order_index >= ?')
        .run(newId, trailSessionId, pivot.order_index)
      // Connections move with the node they hang off — matched on from_node_id rather than a
      // timestamp, so a connection recorded slightly out of order still follows its own stop.
      prep(db, `UPDATE trail_connections SET trail_session_id = ?
                WHERE trail_session_id = ? AND from_node_id IN (SELECT id FROM trail_nodes WHERE trail_session_id = ?)`)
        .run(newId, trailSessionId, newId)
      prep(db, 'UPDATE trail_notes SET trail_session_id = ? WHERE trail_session_id = ? AND anchor_node_id IN (SELECT id FROM trail_nodes WHERE trail_session_id = ?)')
        .run(newId, trailSessionId, newId)
      renumberNodes(db, trailSessionId)
      renumberNodes(db, newId)
    })()
    broadcastDataChanged()
    return { success: true, id: newId }
  })

  ipcMain.handle('studyTrail:reorderSessions', (_e, orderedIds: string[]) => {
    const db = getBereanDb()
    db.transaction(() => {
      const st = prep(db, 'UPDATE trail_sessions SET sort_order = ? WHERE id = ?')
      orderedIds.forEach((id, i) => st.run(i, id))
    })()
    broadcastDataChanged()
    return { success: true }
  })
}

interface TrailSearchHit {
  kind: 'session' | 'stop' | 'connection' | 'note'
  id: string
  sessionId: string
  sessionName: string
  title: string
  snippet?: string
  bookId?: string
  chapter?: number
  strongsNum?: string
  anchorNodeId?: string
  at: number
}

interface TrailNoteRow {
  id: string; trail_session_id: string; kind: string; anchor_node_id: string | null
  order_index: number; title: string | null; body: string; width: number | null; height: number | null
  note_id: string | null; color: string | null; created_at: number; updated_at: number
}

function rowToTrailNote(r: TrailNoteRow) {
  return {
    id: r.id, trailSessionId: r.trail_session_id, kind: r.kind as 'section' | 'annotation',
    anchorNodeId: r.anchor_node_id ?? undefined, orderIndex: r.order_index,
    title: r.title ?? undefined, body: r.body,
    width: r.width ?? undefined, height: r.height ?? undefined,
    noteId: r.note_id ?? undefined, color: r.color ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

/** Rewrites one session's order_index to a dense 0..n-1 in anchor order. Every structural session
 *  edit (merge, split, move) has to end with this: order_index is what the Map reads as spine
 *  order, and leaving gaps or duplicates after moving nodes between sessions makes two stops
 *  compare equal and render in an arbitrary order. */
function renumberNodes(db: any, trailSessionId: string): void {
  const rows = db.prepare('SELECT id FROM trail_nodes WHERE trail_session_id = ? ORDER BY anchor_started_at, order_index')
    .all(trailSessionId) as Array<{ id: string }>
  const st = db.prepare('UPDATE trail_nodes SET order_index = ? WHERE id = ?')
  rows.forEach((r, i) => st.run(i, r.id))
}
