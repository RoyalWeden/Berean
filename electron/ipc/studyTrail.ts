import type { IpcMain } from 'electron'
import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import { getBereanDb } from '../db/berean'

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
    const rows = getBereanDb().prepare('SELECT * FROM trail_sessions ORDER BY updated_at DESC').all() as TrailSessionRow[]
    return rows.map(rowToSession)
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
  }) => {
    // Deliberately NOT wrapped in try/catch: a thrown error here (e.g. a constraint violation)
    // should propagate back through ipcMain.handle's rejected promise to the renderer's own
    // .catch((err) => console.error(...)) rather than being swallowed at either end.
    const db = getBereanDb()
    const id = randomUUID()
    const now = Date.now()
    // Close out the previous anchor (if any) so its anchor_ended_at reflects when the user
    // actually left that chapter, before opening the new one.
    prep(db, `UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL`)
      .run(now, node.trailSessionId)
    prep(db, `
      INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, origin_label, translation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, node.trailSessionId, node.bookId, node.chapter, node.orderIndex, now, node.originLabel ?? null, node.translation ?? null)
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
  ipcMain.handle('studyTrail:reopenNode', (_e, nodeId: string) => {
    const db = getBereanDb()
    const now = Date.now()
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
  }) => {
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
      conn.isBranch ? 1 : 0, conn.isBranchReturn ? 1 : 0, now
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
