import type { DatabaseAdapter } from '../db/DatabaseAdapter'
import { placeholders } from '../db/DatabaseAdapter'
import type { ServiceContext } from './context'
import type { Services } from './index'

/**
 * Study Trail — extracted verbatim from electron/ipc/studyTrail.ts (Phase 1/3). The SQL and
 * result shapes are unchanged; only the execution is async through DatabaseAdapter, and the old
 * per-window `broadcastDataChanged()` BrowserWindow fan-out is replaced by
 * `ctx.events.emit('data:changed', …)` (electron/servicesHost.ts turns `trail_*` entities back
 * into the `studyTrail:dataChanged` broadcast, skipping the originating window via withSender).
 */

// The implicit "Loose stops" bucket — where navigation is recorded when the user has NOT
// created a session of their own. Per direct feedback: "i don't want an untitled study session
// created if i didn't create one... only i can create a session... if the user continues to
// study, then these things are just put in everything". This row exists so recording never
// silently drops, but it is filtered OUT of listSessions (so it never appears in the session
// rail) and only surfaces in the merged Everything timeline. Kept in sync with the same
// constant in src/store/studyTrailSlice.ts and re-exported from electron/ipc/studyTrail.ts.
export const LOOSE_SESSION_ID = '__loose_stops__'

// How long a rapid same-chapter-pair flip has to keep recurring, and how many times, before
// it's flagged as a revisit cluster. Tunable without touching the recorder logic in the
// renderer — this is the one place that actually queries "recent" connections.
const CLUSTER_WINDOW_MS = 5 * 60 * 1000

export interface TrailSessionRow {
  id: string; name: string; status: string; possibly_accidental: number
  recap_text: string | null; recap_user_edited: number; created_at: number; updated_at: number
  sort_order?: number | null
}
export interface TrailNodeRow {
  id: string; trail_session_id: string; book_id: string; chapter: number; order_index: number
  anchor_started_at: number; anchor_ended_at: number | null; cached_subnote: string | null; origin_label: string | null
  revisit_of_node_id: string | null; promoted_from_connection_id: string | null; translation: string | null
  cluster_id: string | null; is_topic_break: number
}
export interface TrailConnectionRow {
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
export interface TrailNoteRow {
  id: string; trail_session_id: string; kind: string; anchor_node_id: string | null
  order_index: number; title: string | null; body: string; width: number | null; height: number | null
  note_id: string | null; color: string | null; created_at: number; updated_at: number
  offset_x: number | null; offset_y: number | null
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
function rowToTrailNote(r: TrailNoteRow) {
  return {
    id: r.id, trailSessionId: r.trail_session_id, kind: r.kind as 'section' | 'annotation',
    anchorNodeId: r.anchor_node_id ?? undefined, orderIndex: r.order_index,
    title: r.title ?? undefined, body: r.body,
    width: r.width ?? undefined, height: r.height ?? undefined,
    noteId: r.note_id ?? undefined, color: r.color ?? undefined,
    offsetX: r.offset_x ?? undefined, offsetY: r.offset_y ?? undefined,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

/** Rewrites one session's order_index to a dense 0..n-1 in anchor order. Every structural session
 *  edit (merge, split, move) has to end with this: order_index is what the Map reads as spine
 *  order, and leaving gaps or duplicates after moving nodes between sessions makes two stops
 *  compare equal and render in an arbitrary order. Takes the transaction handle (or plain db)
 *  it's called with — always `tx` when invoked from inside a transaction. */
async function renumberNodes(db: DatabaseAdapter, trailSessionId: string): Promise<void> {
  const rows = await db.all<{ id: string }>(
    'SELECT id FROM trail_nodes WHERE trail_session_id = ? ORDER BY anchor_started_at, order_index',
    [trailSessionId],
  )
  for (let i = 0; i < rows.length; i++) {
    await db.run('UPDATE trail_nodes SET order_index = ? WHERE id = ?', [i, rows[i].id])
  }
}

/** Outward walk of the from_connection_id chain (a lexicon hop off a lexicon hop, a branch off a
 *  branch, …) starting from a frontier of connection ids already known to be affected. Shared by
 *  deleteNode/deleteConnection/moveNodes so a delete or move never leaves a chained-off row
 *  dangling on a parent that's gone/moved. */
async function collectChainedConnectionIds(db: DatabaseAdapter, seedIds: string[]): Promise<Set<string>> {
  let frontier = seedIds
  const all = new Set(seedIds)
  while (frontier.length > 0) {
    const rows = await db.all<{ id: string }>(
      `SELECT id FROM trail_connections WHERE from_connection_id IN (${placeholders(frontier.length)})`,
      frontier,
    )
    const next = rows.map((r) => r.id).filter((cid) => !all.has(cid))
    next.forEach((cid) => all.add(cid))
    frontier = next
  }
  return all
}

// Words that carry no topical signal — either English filler or Berean's own auto-generated
// reason-text vocabulary ("Strong's word · G26", "a search for …"), which would otherwise be the
// most common "topic" in every single thread.
const TERM_STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'was', 'were', 'are', 'his', 'her', 'its',
  'not', 'but', 'you', 'they', 'them', 'their', 'have', 'has', 'had', 'who', 'what', 'when', 'which',
  'there', 'here', 'then', 'than', 'into', 'unto', 'shall', 'will', 'would', 'about', 'also',
  'strong', 'strongs', 'word', 'search', 'cross', 'reference', 'ref', 'lookup', 'verse', 'chapter',
  'note', 'notes', 'compare', 'occurrence', 'occurrences', 'manual', 'popover', 'tab', 'switch',
])

/** The handful of words the user actually keeps writing about a topic, most frequent first. */
function topTerms(texts: string[], limit = 4): string[] {
  const freq = new Map<string, { n: number; display: string }>()
  for (const t of texts) {
    for (const raw of t.split(/[^\p{L}\p{N}']+/u)) {
      const w = raw.toLowerCase()
      // Length 4+ skips most filler without needing an exhaustive stopword list, and a purely
      // numeric token is a verse number, never a topic.
      if (w.length < 4 || TERM_STOPWORDS.has(w) || /^\d+$/.test(w)) continue
      const cur = freq.get(w)
      if (cur) cur.n += 1
      else freq.set(w, { n: 1, display: raw })
    }
  }
  return [...freq.entries()]
    .filter(([, v]) => v.n > 1)
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, limit)
    .map(([, v]) => v.display)
}

export interface TrailThreadRow {
  id: string
  kind: 'tag' | 'traced'
  label: string
  color?: string
  source: string
  stops: number
  sessions: Array<{ id: string; name: string }>
  chapters: string[]
  strongs: string[]
  words: Array<{ strongsNum: string; translit: string; gloss: string }>
  terms: string[]
  firstAt: number
  lastAt: number
}

export interface TrailSearchHit {
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

export function createStudyTrailService(ctx: ServiceContext, getServices: () => Services) {
  const db = () => ctx.userDb

  async function startSession(name: string) {
    const id = ctx.uuid()
    const now = ctx.now()
    await db().run(`INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'live', ?, ?)`, [id, name, now, now])
    const result = rowToSession((await db().get<TrailSessionRow>('SELECT * FROM trail_sessions WHERE id = ?', [id]))!)
    ctx.events.emit('data:changed', { entity: 'trail_session', id: result.id, op: 'upsert', scope: result.id })
    return result
  }

  async function pauseSession(trailSessionId: string) {
    const now = ctx.now()
    await db().run(`UPDATE trail_sessions SET status = 'paused', updated_at = ? WHERE id = ?`, [now, trailSessionId])
    await db().run(`INSERT INTO trail_paused_intervals (id, trail_session_id, paused_at) VALUES (?, ?, ?)`, [ctx.uuid(), trailSessionId, now])
    ctx.events.emit('data:changed', { entity: 'trail_session', id: trailSessionId, op: 'upsert', scope: trailSessionId })
    return { success: true }
  }

  async function resumeSession(trailSessionId: string) {
    const now = ctx.now()
    await db().run(`UPDATE trail_sessions SET status = 'live', updated_at = ? WHERE id = ?`, [now, trailSessionId])
    // Close the most recent open paused interval for this session, if any.
    await db().run(`
      UPDATE trail_paused_intervals SET resumed_at = ?
      WHERE trail_session_id = ? AND resumed_at IS NULL
      ORDER BY paused_at DESC LIMIT 1
    `, [now, trailSessionId])
    ctx.events.emit('data:changed', { entity: 'trail_session', id: trailSessionId, op: 'upsert', scope: trailSessionId })
    return { success: true }
  }

  async function renameSession(trailSessionId: string, name: string) {
    await db().run(`UPDATE trail_sessions SET name = ?, updated_at = ? WHERE id = ?`, [name, ctx.now(), trailSessionId])
    ctx.events.emit('data:changed', { entity: 'trail_session', id: trailSessionId, op: 'upsert', scope: trailSessionId })
    return { success: true }
  }

  // Marks a session 'ended' and computes possiblyAccidental for real, rather than leaving the
  // column permanently at its DEFAULT 0 (there was previously no code path that ever wrote
  // 'ended' or touched this column at all). "Accidental" = a session with at most one node,
  // zero connections, and under 30s between creation and this call — i.e. the user opened a
  // session and immediately closed it without actually studying anything.
  async function endSession(trailSessionId: string) {
    const now = ctx.now()
    await db().run(`UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL`, [now, trailSessionId])
    const session = await db().get<TrailSessionRow>('SELECT * FROM trail_sessions WHERE id = ?', [trailSessionId])
    const nodeCount = (await db().get<{ n: number }>('SELECT COUNT(*) as n FROM trail_nodes WHERE trail_session_id = ?', [trailSessionId]))!.n
    const connCount = (await db().get<{ n: number }>('SELECT COUNT(*) as n FROM trail_connections WHERE trail_session_id = ?', [trailSessionId]))!.n
    const accidental = !!session && nodeCount <= 1 && connCount === 0 && (now - session.created_at) < 30_000
    await db().run(`UPDATE trail_sessions SET status = 'ended', possibly_accidental = ?, updated_at = ? WHERE id = ?`, [accidental ? 1 : 0, now, trailSessionId])
    ctx.events.emit('data:changed', { entity: 'trail_session', id: trailSessionId, op: 'upsert', scope: trailSessionId })
    return rowToSession((await db().get<TrailSessionRow>('SELECT * FROM trail_sessions WHERE id = ?', [trailSessionId]))!)
  }

  // Deletes one session and every row that references it — no FK cascade is declared on these
  // tables (see the CREATE TABLE statements in electron/db/berean.ts), so each dependent table
  // is cleared explicitly, same shape as notesService's permanentDelete.
  async function deleteSession(trailSessionId: string) {
    await db().transaction(async (tx) => {
      await tx.run('DELETE FROM trail_connections WHERE trail_session_id = ?', [trailSessionId])
      await tx.run('DELETE FROM trail_nodes WHERE trail_session_id = ?', [trailSessionId])
      await tx.run('DELETE FROM trail_paused_intervals WHERE trail_session_id = ?', [trailSessionId])
      await tx.run('DELETE FROM trail_sessions WHERE id = ?', [trailSessionId])
    })
    ctx.events.emit('data:changed', { entity: 'trail_session', id: trailSessionId, op: 'delete' })
    return { success: true }
  }

  // Bulk variant, one transaction for the whole batch (mirrors notesService's emptyTrash).
  async function deleteSessions(trailSessionIds: string[]) {
    await db().transaction(async (tx) => {
      for (const id of trailSessionIds) {
        await tx.run('DELETE FROM trail_connections WHERE trail_session_id = ?', [id])
        await tx.run('DELETE FROM trail_nodes WHERE trail_session_id = ?', [id])
        await tx.run('DELETE FROM trail_paused_intervals WHERE trail_session_id = ?', [id])
        await tx.run('DELETE FROM trail_sessions WHERE id = ?', [id])
      }
    })
    ctx.events.emit('data:changed', { entity: 'trail_session', op: 'bulk' })
    return { success: true }
  }

  async function listSessions() {
    // Excludes the implicit "Loose stops" bucket — it must never show in the session rail.
    // `sort_order` (set by a drag in the session rail) wins where it exists; everything the user
    // hasn't hand-placed falls back to plain recency, which is what the rail used to do for all
    // of them. NULLs sort last so a single hand-placed session doesn't push the rest around.
    const rows = await db().all<TrailSessionRow>(
      'SELECT * FROM trail_sessions WHERE id != ? ORDER BY sort_order IS NULL, sort_order ASC, updated_at DESC',
      [LOOSE_SESSION_ID],
    )
    return rows.map(rowToSession)
  }

  // Every session INCLUDING the loose bucket — for the merged Everything timeline only. The
  // loose bucket is returned only when it actually holds stops, so an empty bucket never adds
  // a "Loose stops" divider to Everything for nothing.
  async function listAllSessions() {
    const rows = await db().all<TrailSessionRow>('SELECT * FROM trail_sessions ORDER BY updated_at DESC')
    const looseHasNodes = (await db().get<{ n: number }>('SELECT COUNT(*) as n FROM trail_nodes WHERE trail_session_id = ?', [LOOSE_SESSION_ID]))!.n > 0
    return rows.filter((r) => r.id !== LOOSE_SESSION_ID || looseHasNodes).map(rowToSession)
  }

  // Create (or re-activate) the implicit loose bucket and return it. Idempotent — called by the
  // renderer's ensureLiveSession() whenever navigation happens with no user session live.
  async function ensureLooseSession() {
    const now = ctx.now()
    const existing = await db().get<TrailSessionRow>('SELECT * FROM trail_sessions WHERE id = ?', [LOOSE_SESSION_ID])
    if (!existing) {
      await db().run(`INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, 'Loose stops', 'live', ?, ?)`, [LOOSE_SESSION_ID, now, now])
    } else if (existing.status !== 'live') {
      await db().run(`UPDATE trail_sessions SET status = 'live', updated_at = ? WHERE id = ?`, [now, LOOSE_SESSION_ID])
    }
    return rowToSession((await db().get<TrailSessionRow>('SELECT * FROM trail_sessions WHERE id = ?', [LOOSE_SESSION_ID]))!)
  }

  async function getSession(trailSessionId: string) {
    const session = await db().get<TrailSessionRow>('SELECT * FROM trail_sessions WHERE id = ?', [trailSessionId])
    if (!session) return null
    const nodes = await db().all<TrailNodeRow>('SELECT * FROM trail_nodes WHERE trail_session_id = ? ORDER BY order_index', [trailSessionId])
    const connections = await db().all<TrailConnectionRow>('SELECT * FROM trail_connections WHERE trail_session_id = ? ORDER BY created_at', [trailSessionId])
    // Paused intervals — returned alongside nodes/connections so the Map view can subtract
    // real pause time out of a gap's displayed duration (a 20-minute pause between two
    // chapters shouldn't visually read as "20 minutes of thinking about it").
    const pausedRows = await db().all<{ paused_at: number; resumed_at: number | null }>(
      'SELECT paused_at, resumed_at FROM trail_paused_intervals WHERE trail_session_id = ? ORDER BY paused_at',
      [trailSessionId],
    )
    const pausedIntervals = pausedRows.map((r) => ({ pausedAt: r.paused_at, resumedAt: r.resumed_at ?? undefined }))
    return { session: rowToSession(session), nodes: nodes.map(rowToNode), connections: connections.map(rowToConnection), pausedIntervals }
  }

  async function addNode(node: {
    trailSessionId: string; bookId: string; chapter: number; orderIndex: number; originLabel?: string
    translation?: string
    // Wall-clock time the user actually navigated to this chapter (captured synchronously in the
    // renderer's nav recorder). Used for BOTH this node's anchor_started_at AND the close-out of
    // the previous anchor — the arrival dwell + IPC hop otherwise stamps everything ~1.2s+ late.
    // Falls back to now for any caller that doesn't pass it.
    anchorStartedAt?: number
  }) {
    // Deliberately not caught here: a thrown error (e.g. a constraint violation) should
    // propagate back through the IPC handler's rejected promise to the renderer's own
    // .catch((err) => console.error(...)) rather than being swallowed at either end.
    const id = ctx.uuid()
    const startedAt = node.anchorStartedAt ?? ctx.now()
    // Close out the previous anchor (if any) so its anchor_ended_at reflects when the user
    // actually left that chapter (= when they navigated here), before opening the new one.
    await db().run(`UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL`, [startedAt, node.trailSessionId])
    await db().run(`
      INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, origin_label, translation)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, node.trailSessionId, node.bookId, node.chapter, node.orderIndex, startedAt, node.originLabel ?? null, node.translation ?? null])
    const result = rowToNode((await db().get<TrailNodeRow>('SELECT * FROM trail_nodes WHERE id = ?', [id]))!)
    ctx.events.emit('data:changed', { entity: 'trail_node', id: result.id, op: 'upsert', scope: result.trailSessionId })
    return result
  }

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
  async function reopenNode(nodeId: string, at?: number) {
    // `at` = when the user actually navigated back here (renderer nav-recorder time); the
    // previous anchor is closed out at that moment, not this handler's own later clock.
    const now = at ?? ctx.now()
    const node = await db().get<TrailNodeRow>('SELECT * FROM trail_nodes WHERE id = ?', [nodeId])
    if (!node) return null
    await db().run(`UPDATE trail_nodes SET anchor_ended_at = ? WHERE trail_session_id = ? AND anchor_ended_at IS NULL AND id != ?`, [now, node.trail_session_id, nodeId])
    await db().run(`UPDATE trail_nodes SET anchor_ended_at = NULL WHERE id = ?`, [nodeId])
    const result = rowToNode((await db().get<TrailNodeRow>('SELECT * FROM trail_nodes WHERE id = ?', [nodeId]))!)
    ctx.events.emit('data:changed', { entity: 'trail_node', id: result.id, op: 'upsert', scope: result.trailSessionId })
    return result
  }

  // Revisit promotion — called (see studyTrailSlice.ts's recorder) when the user is about to
  // navigate AWAY from a reopened node they'd genuinely re-engaged with (real dwell time this
  // visit, not just a bounce-through). Splits that engagement off into its own new node,
  // positioned at its real chronological spot on the spine (order_index/anchor_started_at =
  // when THIS revisit actually began, not "now") rather than leaving it permanently folded
  // into the original node's frozen first-visit position. The original node's own
  // anchor_ended_at is closed out at the revisit's start time, so its own displayed dwell
  // duration no longer double-counts time that now belongs to the promoted node.
  async function promoteRevisit(args: {
    trailSessionId: string; originalNodeId: string; bookId: string; chapter: number; activatedAt: number
    translation?: string
  }) {
    const now = ctx.now()
    const id = ctx.uuid()
    // Node-level twin of addConnection's connection-cluster detection below, but broader on
    // purpose: NOT scoped to this same chapter. A rapid A<->B oscillation alternates chapters
    // (A,B,A,B...), so two promotions of the SAME chapter are never adjacent in the spine once
    // interleaved with the other side of the bounce — clustering only same-chapter promotions
    // (like connections do, which is fine there since a connection's own row lives directly
    // under its distinct source) would produce two clusters that never render as one
    // contiguous, collapsible run. Matching ANY recent promotion in this session instead makes
    // the whole flurry (both directions) one cluster, which IS contiguous in the spine and
    // lets MapView.tsx collapse it into one "bounced N times" summary instead of N full nodes.
    let clusterId: string | null = null
    const recentNode = await db().get<{ id: string; cluster_id: string | null }>(`
      SELECT id, cluster_id FROM trail_nodes
      WHERE trail_session_id = ? AND revisit_of_node_id IS NOT NULL AND anchor_started_at > ?
      ORDER BY anchor_started_at DESC LIMIT 1
    `, [args.trailSessionId, now - CLUSTER_WINDOW_MS])
    if (recentNode) {
      clusterId = recentNode.cluster_id ?? recentNode.id
      if (!recentNode.cluster_id) {
        await db().run(`UPDATE trail_nodes SET cluster_id = ? WHERE id = ?`, [clusterId, recentNode.id])
      }
    }
    await db().transaction(async (tx) => {
      await tx.run(`UPDATE trail_nodes SET anchor_ended_at = ? WHERE id = ? AND anchor_ended_at IS NULL`, [args.activatedAt, args.originalNodeId])
      await tx.run(`
        INSERT INTO trail_nodes (id, trail_session_id, book_id, chapter, order_index, anchor_started_at, anchor_ended_at, revisit_of_node_id, translation, cluster_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, args.trailSessionId, args.bookId, args.chapter, args.activatedAt, args.activatedAt, now, args.originalNodeId, args.translation ?? null, clusterId])
    })
    const result = rowToNode((await db().get<TrailNodeRow>('SELECT * FROM trail_nodes WHERE id = ?', [id]))!)
    ctx.events.emit('data:changed', { entity: 'trail_node', id: result.id, op: 'upsert', scope: result.trailSessionId })
    return result
  }

  async function updateNodeSubnote(nodeId: string, subnote: string) {
    await db().run(`UPDATE trail_nodes SET cached_subnote = ? WHERE id = ?`, [subnote, nodeId])
    ctx.events.emit('data:changed', { entity: 'trail_node', id: nodeId, op: 'upsert' })
    return { success: true }
  }

  // Topic break (v36) — a horizontal divider on the main spine, set from the "ask why" popup's
  // "new topic" checkbox (applies to the node the user just arrived at) or edited later from
  // the Study Trail window.
  async function setNodeTopicBreak(nodeId: string, isTopicBreak: boolean) {
    await db().run(`UPDATE trail_nodes SET is_topic_break = ? WHERE id = ?`, [isTopicBreak ? 1 : 0, nodeId])
    ctx.events.emit('data:changed', { entity: 'trail_node', id: nodeId, op: 'upsert' })
    return { success: true }
  }

  // Delete a single trail node — right-click "Delete" on a bullet. Cascades to its
  // directly-attached connections (both those originating FROM it, and any same-chapter/
  // branch connections chained off one of those via from_connection_id), but leaves every OTHER
  // node/connection in the session untouched. The renderer confirms with the user first (this
  // handler itself performs no confirmation — it's a hard, immediate delete once called).
  async function deleteNode(nodeId: string) {
    await db().transaction(async (tx) => {
      const directConnIds = (await tx.all<{ id: string }>('SELECT id FROM trail_connections WHERE from_node_id = ?', [nodeId])).map((r) => r.id)
      // Chained connections (a lexicon click off a lexicon click, etc.) reference their parent
      // via from_connection_id, not from_node_id — walk the chain outward so a delete doesn't
      // leave orphaned rows dangling off a connection that no longer exists.
      const allConnIds = await collectChainedConnectionIds(tx, directConnIds)
      if (allConnIds.size > 0) {
        await tx.run(`DELETE FROM trail_connections WHERE id IN (${placeholders(allConnIds.size)})`, [...allConnIds])
      }
      await tx.run('DELETE FROM trail_nodes WHERE id = ?', [nodeId])
    })
    ctx.events.emit('data:changed', { entity: 'trail_node', id: nodeId, op: 'delete' })
    return { success: true }
  }

  // Delete a single trail CONNECTION (a branch/tangent bullet) — right-click "Delete" on a
  // ConnRow in the Study Trail window. Cascades to any connections chained off it via
  // from_connection_id (a lexicon hop off a lexicon hop, etc.), the same outward walk deleteNode
  // does, so nothing is left dangling. Nodes are never touched — only the branch(es).
  async function deleteConnection(connectionId: string) {
    const sessionId = await db().transaction(async (tx) => {
      const row = await tx.get<{ trail_session_id: string }>('SELECT trail_session_id FROM trail_connections WHERE id = ?', [connectionId])
      if (!row) return null
      // Outward chain walk — collect this connection + everything chained off it.
      const allIds = await collectChainedConnectionIds(tx, [connectionId])
      await tx.run(`DELETE FROM trail_connections WHERE id IN (${placeholders(allIds.size)})`, [...allIds])
      return row.trail_session_id
    })
    ctx.events.emit('data:changed', { entity: 'trail_connection', id: connectionId, op: 'delete', scope: sessionId ?? undefined })
    return { success: true }
  }

  // Reassign nodes (and every connection hanging off them, including chained descendants) to a
  // different session — the "change the session of the selection" half of the Study Trail
  // marquee-select feature. Target may be the implicit loose bucket. order_index is set from
  // each node's own anchor_started_at so it slots into the target session chronologically.
  async function moveNodes(nodeIds: string[], targetSessionId: string) {
    const sourceSessionIds = nodeIds.length > 0
      ? (await db().all<{ s: string }>(`SELECT DISTINCT trail_session_id AS s FROM trail_nodes WHERE id IN (${placeholders(nodeIds.length)})`, nodeIds)).map((r) => r.s)
      : []
    await db().transaction(async (tx) => {
      if (nodeIds.length === 0) return
      // Collect all connection ids reachable from these nodes (direct + chained).
      const directConnIds = (await tx.all<{ id: string }>(`SELECT id FROM trail_connections WHERE from_node_id IN (${placeholders(nodeIds.length)})`, nodeIds)).map((r) => r.id)
      const allConnIds = await collectChainedConnectionIds(tx, directConnIds)
      for (const id of nodeIds) {
        await tx.run('UPDATE trail_nodes SET trail_session_id = ?, order_index = COALESCE(anchor_started_at, order_index) WHERE id = ?', [targetSessionId, id])
      }
      if (allConnIds.size > 0) {
        await tx.run(`UPDATE trail_connections SET trail_session_id = ? WHERE id IN (${placeholders(allConnIds.size)})`, [targetSessionId, ...allConnIds])
      }
      await tx.run(`UPDATE trail_sessions SET updated_at = ? WHERE id = ?`, [ctx.now(), targetSessionId])
      // order_index above is set to the node's own anchor timestamp purely so the moved nodes
      // slot in chronologically; renumbering afterwards turns that back into a dense 0..n-1 in
      // BOTH the source and target sessions. Without it the target keeps raw millisecond indices
      // interleaved with small integers, which is what the Map reads as spine order.
      for (const sid of new Set([targetSessionId, ...sourceSessionIds])) await renumberNodes(tx, sid)
    })
    ctx.events.emit('data:changed', { entity: 'trail_node', op: 'bulk' })
    return { success: true }
  }

  async function addConnection(conn: {
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
  }) {
    const id = ctx.uuid()
    const now = ctx.now()
    const createdAt = conn.createdAt ?? now

    // Revisit-cluster detection: same destination chapter-pair, recently, more than once. The
    // recency window is still measured against real wall-clock `now` (a stale createdAt
    // shouldn't widen it), only the stored timestamp uses createdAt.
    let clusterId: string | null = null
    if (conn.toKind === 'chapter' && conn.toBookId && conn.toChapter != null) {
      const recent = await db().get<{ id: string; cluster_id: string | null }>(`
        SELECT id, cluster_id FROM trail_connections
        WHERE trail_session_id = ? AND to_kind = 'chapter' AND to_book_id = ? AND to_chapter = ?
          AND created_at > ?
        ORDER BY created_at DESC LIMIT 1
      `, [conn.trailSessionId, conn.toBookId, conn.toChapter, now - CLUSTER_WINDOW_MS])
      if (recent) {
        clusterId = recent.cluster_id ?? recent.id
        if (!recent.cluster_id) {
          await db().run(`UPDATE trail_connections SET cluster_id = ? WHERE id = ?`, [clusterId, recent.id])
        }
      }
    }

    await db().run(`
      INSERT INTO trail_connections (
        id, trail_session_id, from_node_id, to_kind, to_book_id, to_chapter, to_verse,
        to_strongs_num, to_note_id, to_video_id, clarity_tier, reason_text, reason_tags,
        weight, strongs_depth, cluster_id, origin_verse_pin_from,
        from_connection_id, chain_depth, to_verse_end, is_branch, is_branch_return, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      id, conn.trailSessionId, conn.fromNodeId, conn.toKind,
      conn.toBookId ?? null, conn.toChapter ?? null, conn.toVerse ?? null,
      conn.toStrongsNum ?? null, conn.toNoteId ?? null, conn.toVideoId ?? null,
      conn.clarityTier, conn.reasonText ?? null, conn.reasonTags ? JSON.stringify(conn.reasonTags) : null,
      conn.weight ?? 'full', conn.strongsDepth ?? null, clusterId, conn.originVersePinFrom ?? null,
      conn.fromConnectionId ?? null, conn.chainDepth ?? 0, conn.toVerseEnd ?? null,
      conn.isBranch ? 1 : 0, conn.isBranchReturn ? 1 : 0, createdAt,
    ])
    const result = rowToConnection((await db().get<TrailConnectionRow>('SELECT * FROM trail_connections WHERE id = ?', [id]))!)
    ctx.events.emit('data:changed', { entity: 'trail_connection', id: result.id, op: 'upsert', scope: result.trailSessionId })
    return result
  }

  async function markGlance(connectionId: string) {
    await db().run(`UPDATE trail_connections SET weight = 'glance' WHERE id = ?`, [connectionId])
    ctx.events.emit('data:changed', { entity: 'trail_connection', id: connectionId, op: 'upsert' })
    return { success: true }
  }

  async function updateConnectionReason(connectionId: string, update: {
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
  }) {
    const sets: string[] = []
    const vals: unknown[] = []
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
    await db().run(`UPDATE trail_connections SET ${sets.join(', ')} WHERE id = ?`, vals as (string | number | null)[])
    ctx.events.emit('data:changed', { entity: 'trail_connection', id: connectionId, op: 'upsert' })
    return { success: true }
  }

  // Delete — distinct from "Not now" (dismissPrompt): clears the user's own note content
  // entirely (user_note + ties_from/ties_to) rather than just marking the prompt as handled.
  // Auto-inferred fields (reason_text/reason_tags from the recorder, the legacy verse pins
  // captured automatically at record time) are left alone — those were never user-authored.
  async function clearConnectionNote(connectionId: string) {
    await db().run(`UPDATE trail_connections SET user_note = NULL, ties_from = NULL, ties_to = NULL WHERE id = ?`, [connectionId])
    ctx.events.emit('data:changed', { entity: 'trail_connection', id: connectionId, op: 'upsert' })
    return { success: true }
  }

  // "Not now" — never auto-reprompt this connection again; the '?' stays clickable forever
  // as the only way back to it (renderer-side, not enforced here — this just records the
  // fact of dismissal so the renderer knows not to auto-surface it again).
  async function dismissPrompt(connectionId: string) {
    await db().run(`UPDATE trail_connections SET dismissed_prompt_at = ? WHERE id = ?`, [ctx.now(), connectionId])
    ctx.events.emit('data:changed', { entity: 'trail_connection', id: connectionId, op: 'upsert' })
    return { success: true }
  }

  async function updateRecap(trailSessionId: string, recapText: string) {
    await db().run(`UPDATE trail_sessions SET recap_text = ?, recap_user_edited = 1, updated_at = ? WHERE id = ?`, [recapText, ctx.now(), trailSessionId])
    ctx.events.emit('data:changed', { entity: 'trail_session', id: trailSessionId, op: 'upsert', scope: trailSessionId })
    return { success: true }
  }

  async function getBacklinks(bookId: string, chapter: number, excludeSessionId: string) {
    const rows = await db().all<TrailConnectionRow & { session_name: string }>(`
      SELECT c.*, s.name as session_name FROM trail_connections c
      JOIN trail_sessions s ON s.id = c.trail_session_id
      WHERE c.to_book_id = ? AND c.to_chapter = ? AND c.trail_session_id != ?
      ORDER BY c.created_at DESC LIMIT 10
    `, [bookId, chapter, excludeSessionId])
    return rows.map((r) => ({ ...rowToConnection(r), sessionName: r.session_name }))
  }

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
  async function search(query: string, opts?: {
    kinds?: Array<'session' | 'stop' | 'connection' | 'note'>
    bookId?: string; since?: number; until?: number; limit?: number
  }) {
    const raw = (query ?? '').trim()
    if (!raw) return []
    const q = `%${raw.toLowerCase()}%`
    const limit = Math.min(500, opts?.limit ?? 200)
    const kinds = new Set(opts?.kinds ?? ['session', 'stop', 'connection', 'note'])
    const since = opts?.since ?? 0
    const until = opts?.until ?? Number.MAX_SAFE_INTEGER
    const out: TrailSearchHit[] = []

    if (kinds.has('session')) {
      const rows = await db().all<{ id: string; name: string; recap_text: string | null; updated_at: number }>(`
        SELECT id, name, recap_text, updated_at FROM trail_sessions
        WHERE (LOWER(name) LIKE ? OR LOWER(COALESCE(recap_text, '')) LIKE ?) AND updated_at BETWEEN ? AND ?
        ORDER BY updated_at DESC LIMIT ?
      `, [q, q, since, until, limit])
      for (const r of rows) {
        out.push({ kind: 'session', id: r.id, sessionId: r.id, sessionName: r.name, title: r.name, snippet: r.recap_text ?? undefined, at: r.updated_at })
      }
    }

    if (kinds.has('stop')) {
      const rows = await db().all<{
        id: string; trail_session_id: string; book_id: string; chapter: number
        cached_subnote: string | null; anchor_started_at: number; session_name: string
      }>(`
        SELECT n.id, n.trail_session_id, n.book_id, n.chapter, n.cached_subnote, n.anchor_started_at, s.name AS session_name
        FROM trail_nodes n JOIN trail_sessions s ON s.id = n.trail_session_id
        WHERE (LOWER(n.book_id) LIKE ? OR LOWER(COALESCE(n.cached_subnote, '')) LIKE ? OR LOWER(COALESCE(n.origin_label, '')) LIKE ?)
          AND n.anchor_started_at BETWEEN ? AND ?
          AND (? IS NULL OR n.book_id = ?)
        ORDER BY n.anchor_started_at DESC LIMIT ?
      `, [q, q, q, since, until, opts?.bookId ?? null, opts?.bookId ?? null, limit])
      for (const r of rows) {
        out.push({
          kind: 'stop', id: r.id, sessionId: r.trail_session_id, sessionName: r.session_name,
          title: `${r.book_id} ${r.chapter}`, snippet: r.cached_subnote ?? undefined,
          bookId: r.book_id, chapter: r.chapter, at: r.anchor_started_at,
        })
      }
    }

    if (kinds.has('connection')) {
      const rows = await db().all<TrailConnectionRow & { session_name: string }>(`
        SELECT c.*, s.name AS session_name FROM trail_connections c
        JOIN trail_sessions s ON s.id = c.trail_session_id
        WHERE (LOWER(COALESCE(c.reason_text, '')) LIKE ? OR LOWER(COALESCE(c.reason_tags, '')) LIKE ?
               OR LOWER(COALESCE(c.user_note, '')) LIKE ? OR LOWER(COALESCE(c.ties_from, '')) LIKE ?
               OR LOWER(COALESCE(c.ties_to, '')) LIKE ? OR LOWER(COALESCE(c.to_strongs_num, '')) LIKE ?
               OR LOWER(COALESCE(c.to_book_id, '')) LIKE ?)
          AND c.created_at BETWEEN ? AND ?
          AND (? IS NULL OR c.to_book_id = ?)
        ORDER BY c.created_at DESC LIMIT ?
      `, [q, q, q, q, q, q, q, since, until, opts?.bookId ?? null, opts?.bookId ?? null, limit])
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
      const rows = await db().all<TrailNoteRow & { session_name: string }>(`
        SELECT t.*, s.name AS session_name FROM trail_notes t
        JOIN trail_sessions s ON s.id = t.trail_session_id
        WHERE (LOWER(COALESCE(t.title, '')) LIKE ? OR LOWER(t.body) LIKE ?) AND t.updated_at BETWEEN ? AND ?
        ORDER BY t.updated_at DESC LIMIT ?
      `, [q, q, since, until, limit])
      for (const r of rows) {
        out.push({
          kind: 'note', id: r.id, sessionId: r.trail_session_id, sessionName: r.session_name,
          title: r.title || (r.kind === 'section' ? 'Section' : 'Note'), snippet: r.body || undefined,
          anchorNodeId: r.anchor_node_id ?? undefined, at: r.updated_at,
        })
      }
    }

    return out.sort((a, b) => b.at - a.at).slice(0, limit)
  }

  // Threads — "what have I been chasing", across every session.
  //
  // REWRITTEN per direct feedback: "the threads tab should be by topics and not by books or
  // whatever." Grouping by book was really just a second table of contents — it told you where you
  // had been, not what you were pursuing. A topic here is one of two things, both grounded in the
  // user's own behaviour rather than in an arbitrary taxonomy:
  //
  //   TAGGED   — a verse tag (v37) or session tag (v40). These are literally the topics Michael
  //              named himself, so they come first and are never invented.
  //   TRACED   — a connected component of chapters joined by ASSOCIATIVE moves: cross-references,
  //              hand-entered verse ties, branches, Strong's lookups. Reading Genesis 1 then
  //              Genesis 2 is not a topic; jumping Isaiah 11 → Luke 4 → Joel 2 because they kept
  //              pointing at each other is. Each component is labelled by the words the user
  //              actually wrote about it (their own notes and reason text), falling back to its
  //              busiest chapters.
  //
  // Sequential reading and tab-switching are deliberately excluded from the graph — including them
  // would connect everything to everything and collapse into one meaningless super-topic.
  async function listThreads() {
    const threads: TrailThreadRow[] = []
    const chapterLabel = (bookId: string, chapter: number) => `${bookId} ${chapter}`

    // ── Tagged topics ───────────────────────────────────────────────────────
    // A verse tag becomes a thread when the trail has actually been to any of its verses.
    const verseTagRows = await db().all<{ id: string; name: string; color: string | null; stops: number; sessions: number; first_at: number; last_at: number }>(`
      SELECT t.id, t.name, t.color,
             COUNT(DISTINCT n.id) AS stops,
             COUNT(DISTINCT n.trail_session_id) AS sessions,
             MIN(n.anchor_started_at) AS first_at, MAX(n.anchor_started_at) AS last_at
      FROM verse_tags t
      JOIN verse_tag_verse v ON v.tag_id = t.id
      JOIN trail_nodes n ON n.book_id = v.book_id AND n.chapter = v.chapter
      GROUP BY t.id HAVING stops > 0
    `)

    for (const r of verseTagRows) {
      const sessions = await db().all<{ id: string; name: string }>(`
        SELECT DISTINCT n.trail_session_id AS id, s.name AS name FROM verse_tag_verse v
        JOIN trail_nodes n ON n.book_id = v.book_id AND n.chapter = v.chapter
        JOIN trail_sessions s ON s.id = n.trail_session_id
        WHERE v.tag_id = ? ORDER BY s.updated_at DESC LIMIT 12
      `, [r.id])
      const chapters = await db().all<{ book_id: string; chapter: number }>(`
        SELECT DISTINCT n.book_id AS book_id, n.chapter AS chapter FROM verse_tag_verse v
        JOIN trail_nodes n ON n.book_id = v.book_id AND n.chapter = v.chapter
        WHERE v.tag_id = ? LIMIT 24
      `, [r.id])
      threads.push({
        id: `versetag:${r.id}`, kind: 'tag', label: r.name, color: r.color ?? undefined,
        source: 'verse tag', stops: r.stops, sessions,
        chapters: chapters.map((c) => chapterLabel(c.book_id, c.chapter)),
        strongs: [], words: [], terms: [], firstAt: r.first_at, lastAt: r.last_at,
      })
    }

    const sessionTagRows = await db().all<{ id: string; name: string; color: string | null; sessions: number }>(`
      SELECT t.id, t.name, t.color, COUNT(m.trail_session_id) AS sessions
      FROM trail_tags t LEFT JOIN trail_tag_members m ON m.tag_id = t.id
      GROUP BY t.id HAVING sessions > 0
    `)
    for (const r of sessionTagRows) {
      const rows = await db().all<{ id: string; name: string; stops: number; first_at: number | null; last_at: number | null }>(`
        SELECT s.id, s.name, COUNT(n.id) AS stops,
               MIN(n.anchor_started_at) AS first_at, MAX(n.anchor_started_at) AS last_at
        FROM trail_tag_members m
        JOIN trail_sessions s ON s.id = m.trail_session_id
        LEFT JOIN trail_nodes n ON n.trail_session_id = s.id
        WHERE m.tag_id = ? GROUP BY s.id
      `, [r.id])
      const stops = rows.reduce((n, x) => n + x.stops, 0)
      if (stops === 0) continue
      threads.push({
        id: `sessiontag:${r.id}`, kind: 'tag', label: r.name, color: r.color ?? undefined,
        source: 'session tag', stops,
        sessions: rows.map((x) => ({ id: x.id, name: x.name })),
        chapters: [], strongs: [], words: [], terms: [],
        firstAt: Math.min(...rows.map((x) => x.first_at ?? ctx.now())),
        lastAt: Math.max(...rows.map((x) => x.last_at ?? 0)),
      })
    }

    // ── Traced topics ───────────────────────────────────────────────────────
    // Only ASSOCIATIVE connections build the graph. `reason_tags` carries the origin kind, so a
    // plain read-onward ('reading') or a tab switch never links two chapters into a topic.
    const assoc = await db().all<TrailConnectionRow & { from_book_id: string; from_chapter: number }>(`
      SELECT c.*, n.book_id AS from_book_id, n.chapter AS from_chapter
      FROM trail_connections c JOIN trail_nodes n ON n.id = c.from_node_id
      WHERE (c.is_branch = 1
             OR c.to_kind = 'lexicon'
             OR COALESCE(c.ties_from, '[]') != '[]' OR COALESCE(c.ties_to, '[]') != '[]'
             OR COALESCE(c.reason_tags, '') LIKE '%cross-ref%'
             OR COALESCE(c.reason_tags, '') LIKE '%ai-lookup%')
    `)

    // Union-find over chapter keys. A lexicon connection joins every chapter that looked up that
    // same Strong's number — that's the backbone of a word study, and the single most common way a
    // topic actually forms in this app.
    const parent = new Map<string, string>()
    const find = (a: string): string => {
      let r = a
      while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!
      parent.set(a, r)
      return r
    }
    const union = (a: string, b: string) => {
      if (!parent.has(a)) parent.set(a, a)
      if (!parent.has(b)) parent.set(b, b)
      const ra = find(a); const rb = find(b)
      if (ra !== rb) parent.set(ra, rb)
    }
    const strongsAnchor = new Map<string, string>()
    for (const c of assoc) {
      const from = chapterLabel(c.from_book_id, c.from_chapter)
      if (!parent.has(from)) parent.set(from, from)
      if (c.to_kind === 'lexicon' && c.to_strongs_num) {
        const prev = strongsAnchor.get(c.to_strongs_num)
        if (prev) union(prev, from)
        else strongsAnchor.set(c.to_strongs_num, from)
      } else if (c.to_book_id && c.to_chapter != null) {
        union(from, chapterLabel(c.to_book_id, c.to_chapter))
      }
    }

    interface Bucket {
      chapters: Set<string>; strongs: Map<string, number>; sessions: Map<string, string>
      text: string[]; stops: number; firstAt: number; lastAt: number
    }
    const buckets = new Map<string, Bucket>()
    const bucketFor = (key: string): Bucket => {
      const root = find(key)
      let b = buckets.get(root)
      if (!b) {
        b = { chapters: new Set(), strongs: new Map(), sessions: new Map(), text: [], stops: 0, firstAt: Infinity, lastAt: 0 }
        buckets.set(root, b)
      }
      return b
    }
    const sessionNames = new Map((await db().all<{ id: string; name: string }>('SELECT id, name FROM trail_sessions')).map((r) => [r.id, r.name]))
    for (const c of assoc) {
      const from = chapterLabel(c.from_book_id, c.from_chapter)
      const b = bucketFor(from)
      b.chapters.add(from)
      if (c.to_kind === 'lexicon' && c.to_strongs_num) b.strongs.set(c.to_strongs_num, (b.strongs.get(c.to_strongs_num) ?? 0) + 1)
      else if (c.to_book_id && c.to_chapter != null) b.chapters.add(chapterLabel(c.to_book_id, c.to_chapter))
      b.sessions.set(c.trail_session_id, sessionNames.get(c.trail_session_id) ?? 'Session')
      // The user's own words about this jump are what the topic gets NAMED from.
      for (const t of [c.user_note, c.reason_text]) if (t) b.text.push(t)
      for (const raw of [c.ties_from, c.ties_to]) {
        if (!raw) continue
        try { for (const t of JSON.parse(raw) as string[]) b.text.push(t) } catch { /* malformed row */ }
      }
      b.stops += 1
      b.firstAt = Math.min(b.firstAt, c.created_at)
      b.lastAt = Math.max(b.lastAt, c.created_at)
    }

    // Sibling lexicon lookups through the shared registry (was `getLexiconEntry` from
    // electron/ipc/lexicon.ts).
    const lexicon = getServices().lexicon

    for (const [root, b] of buckets) {
      // A lone jump isn't a topic — it's a jump. Two or more linked chapters is the floor.
      if (b.chapters.size < 2 && b.strongs.size === 0) continue
      const terms = topTerms(b.text)
      const chapters = [...b.chapters]
      // Strong's numbers ordered by how central they are to this cluster, so the dominant word
      // gets to name it.
      const strongsSorted = [...b.strongs.entries()].sort((a, c) => c[1] - a[1]).map(([n]) => n)
      const words = await Promise.all(strongsSorted.slice(0, 4).map(async (num) => {
        const e = await lexicon.getEntry(num)
        return {
          strongsNum: num,
          translit: e?.transliteration || '',
          gloss: (e?.gloss || '').split(/[;,]/)[0].trim(),
        }
      }))

      // Naming, in order of how much it actually tells you:
      //   1. the words you kept writing about it,
      //   2. the word you kept looking up, in its own transliteration and gloss — a word study is
      //      a topic, and "rûach — wind, breath" says what it's about in a way "ISA 11 · LUK 4"
      //      never does,
      //   3. only then the passages, when there's nothing better to go on.
      let label: string
      let source: string
      if (terms.length > 0) {
        label = terms.slice(0, 2).join(' · ')
        source = 'from your notes'
      } else if (words.length > 0 && (words[0].translit || words[0].gloss)) {
        const w = words[0]
        label = [w.translit || w.strongsNum, w.gloss].filter(Boolean).join(' — ')
        source = words.length > 1 ? `word study · ${words.length} words` : 'word study'
      } else {
        label = chapters.slice(0, 2).join(' · ')
        source = 'traced connections'
      }

      threads.push({
        id: `traced:${root}`, kind: 'traced', label, source,
        stops: b.stops, sessions: [...b.sessions].map(([id, name]) => ({ id, name })),
        chapters, strongs: strongsSorted, words, terms,
        firstAt: b.firstAt === Infinity ? 0 : b.firstAt, lastAt: b.lastAt,
      })
    }

    // Most-recently-touched first — a topic you were chasing this morning matters more than one
    // with more total stops from three months ago.
    return threads.sort((a, b) => b.lastAt - a.lastAt)
  }

  // One page of sessions, newest first — keyset pagination on updated_at, mirroring historyService's
  // getPage. Everything used to load EVERY session in full on every change; this is what lets it
  // scroll infinitely instead.
  async function listSessionsPage(cursor: number | undefined, limit = 10) {
    const n = Math.min(50, Math.max(1, limit))
    const rows = cursor == null
      ? await db().all<TrailSessionRow>('SELECT * FROM trail_sessions ORDER BY updated_at DESC LIMIT ?', [n + 1])
      : await db().all<TrailSessionRow>('SELECT * FROM trail_sessions WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?', [cursor, n + 1])
    const looseHasNodes = (await db().get<{ n: number }>('SELECT COUNT(*) as n FROM trail_nodes WHERE trail_session_id = ?', [LOOSE_SESSION_ID]))!.n > 0
    const page = rows.slice(0, n).filter((r) => r.id !== LOOSE_SESSION_ID || looseHasNodes)
    return {
      sessions: page.map(rowToSession),
      nextCursor: rows.length > n ? rows[n - 1].updated_at : undefined,
    }
  }

  // ── Collapse state (v38) ──────────────────────────────────────────────────
  // A missing row means "expanded", so nothing needs seeding and a cleared table just re-opens
  // everything. Scopes: 'branch' (a connection id), 'section' (a trail_notes id), 'session' and
  // 'day' (Everything's own groupings).
  async function getCollapse(scope?: string) {
    const rows = scope
      ? await db().all<{ scope: string; key: string }>('SELECT scope, key FROM trail_collapse WHERE collapsed = 1 AND scope = ?', [scope])
      : await db().all<{ scope: string; key: string }>('SELECT scope, key FROM trail_collapse WHERE collapsed = 1')
    return rows.map((r) => `${r.scope}:${r.key}`)
  }

  async function setCollapse(scope: string, key: string, collapsed: boolean) {
    if (collapsed) {
      await db().run(`INSERT INTO trail_collapse (scope, key, collapsed, updated_at) VALUES (?, ?, 1, ?)
                ON CONFLICT(scope, key) DO UPDATE SET collapsed = 1, updated_at = excluded.updated_at`, [scope, key, ctx.now()])
    } else {
      // Deleted rather than stored as collapsed=0 — "expanded" is the default, so an absent row
      // says it just as well and the table stays proportional to what's actually folded away.
      await db().run('DELETE FROM trail_collapse WHERE scope = ? AND key = ?', [scope, key])
    }
    // The old desktop handler never broadcast this over BrowserWindow (collapse state was
    // considered too minor to push live) — but `trail_collapse` is one of the entities the
    // extraction guide (docs/mobile/service-extraction-guide.md rule 6) lists explicitly for
    // data:changed, since that event now also feeds the cross-device sync journal, not just the
    // desktop cross-window broadcast. Emitting here is therefore an intentional behavior
    // addition, not a preserved one.
    ctx.events.emit('data:changed', { entity: 'trail_collapse', id: `${scope}:${key}`, op: 'upsert' })
    return { success: true }
  }

  // ── Trail notes / sections (v39) ──────────────────────────────────────────
  async function listNotes(trailSessionId?: string) {
    const rows = trailSessionId
      ? await db().all<TrailNoteRow>('SELECT * FROM trail_notes WHERE trail_session_id = ? ORDER BY order_index, created_at', [trailSessionId])
      : await db().all<TrailNoteRow>('SELECT * FROM trail_notes ORDER BY created_at DESC')
    return rows.map(rowToTrailNote)
  }

  async function createNote(input: {
    trailSessionId: string; kind?: 'section' | 'annotation'; anchorNodeId?: string
    title?: string; body?: string; color?: string; noteId?: string; orderIndex?: number
  }) {
    const now = ctx.now()
    const id = ctx.uuid()
    await db().run(`INSERT INTO trail_notes
      (id, trail_session_id, kind, anchor_node_id, order_index, title, body, color, note_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      id, input.trailSessionId, input.kind ?? 'annotation', input.anchorNodeId ?? null,
      input.orderIndex ?? 0, input.title ?? null, input.body ?? '', input.color ?? null,
      input.noteId ?? null, now, now,
    ])
    ctx.events.emit('data:changed', { entity: 'trail_note', id, op: 'upsert', scope: input.trailSessionId })
    return rowToTrailNote((await db().get<TrailNoteRow>('SELECT * FROM trail_notes WHERE id = ?', [id]))!)
  }

  async function updateNote(id: string, patch: Partial<{
    kind: string; anchorNodeId: string | null; orderIndex: number; title: string | null
    body: string; width: number | null; height: number | null; noteId: string | null; color: string | null
    offsetX: number | null; offsetY: number | null
  }>) {
    const COLUMN: Record<string, string> = {
      kind: 'kind', anchorNodeId: 'anchor_node_id', orderIndex: 'order_index', title: 'title',
      body: 'body', width: 'width', height: 'height', noteId: 'note_id', color: 'color',
      offsetX: 'offset_x', offsetY: 'offset_y',
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
    vals.push(ctx.now(), id)
    await db().run(`UPDATE trail_notes SET ${sets.join(', ')} WHERE id = ?`, vals as (string | number | null)[])
    const row = await db().get<TrailNoteRow>('SELECT * FROM trail_notes WHERE id = ?', [id])
    if (row) ctx.events.emit('data:changed', { entity: 'trail_note', id, op: 'upsert', scope: row.trail_session_id })
    return { success: true }
  }

  async function deleteNote(id: string) {
    const row = await db().get<{ trail_session_id: string }>('SELECT trail_session_id FROM trail_notes WHERE id = ?', [id])
    await db().run('DELETE FROM trail_notes WHERE id = ?', [id])
    // Its collapse state goes with it, otherwise a recycled id would inherit a stale fold.
    await db().run(`DELETE FROM trail_collapse WHERE scope = 'section' AND key = ?`, [id])
    if (row) ctx.events.emit('data:changed', { entity: 'trail_note', id, op: 'delete', scope: row.trail_session_id })
    return { success: true }
  }

  // ── Session tags (v40) ────────────────────────────────────────────────────
  async function listTags() {
    const tags = await db().all<{ id: string; name: string; color: string | null; sort_order: number | null }>(
      'SELECT * FROM trail_tags ORDER BY sort_order IS NULL, sort_order, name COLLATE NOCASE',
    )
    const members = await db().all<{ tag_id: string; trail_session_id: string }>('SELECT tag_id, trail_session_id FROM trail_tag_members')
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
  }

  async function createTag(name: string, color?: string) {
    const existing = await db().get<{ id: string }>('SELECT * FROM trail_tags WHERE name = ? COLLATE NOCASE', [name])
    if (existing) return { id: existing.id }
    const id = ctx.uuid()
    await db().run('INSERT INTO trail_tags (id, name, color, created_at) VALUES (?, ?, ?, ?)', [id, name.trim(), color ?? null, ctx.now()])
    ctx.events.emit('data:changed', { entity: 'trail_tag', id, op: 'upsert' })
    return { id }
  }

  async function updateTag(id: string, patch: { name?: string; color?: string | null; sortOrder?: number | null }) {
    if (patch.name != null) await db().run('UPDATE trail_tags SET name = ? WHERE id = ?', [patch.name.trim(), id])
    if ('color' in patch) await db().run('UPDATE trail_tags SET color = ? WHERE id = ?', [patch.color ?? null, id])
    if ('sortOrder' in patch) await db().run('UPDATE trail_tags SET sort_order = ? WHERE id = ?', [patch.sortOrder ?? null, id])
    ctx.events.emit('data:changed', { entity: 'trail_tag', id, op: 'upsert' })
    return { success: true }
  }

  async function deleteTag(id: string) {
    // ON DELETE CASCADE handles the members on a connection that has foreign_keys enabled, but
    // deleting explicitly makes this independent of that pragma.
    await db().run('DELETE FROM trail_tag_members WHERE tag_id = ?', [id])
    await db().run('DELETE FROM trail_tags WHERE id = ?', [id])
    ctx.events.emit('data:changed', { entity: 'trail_tag', id, op: 'delete' })
    return { success: true }
  }

  async function setSessionTags(trailSessionId: string, tagIds: string[]) {
    await db().transaction(async (tx) => {
      await tx.run('DELETE FROM trail_tag_members WHERE trail_session_id = ?', [trailSessionId])
      const now = ctx.now()
      for (const t of tagIds) await tx.run('INSERT OR IGNORE INTO trail_tag_members (tag_id, trail_session_id, created_at) VALUES (?, ?, ?)', [t, trailSessionId, now])
    })
    ctx.events.emit('data:changed', { entity: 'trail_tag', op: 'bulk', id: trailSessionId, scope: trailSessionId })
    return { success: true }
  }

  // ── Session merge / split / reorder ───────────────────────────────────────
  // All three are order_index rewrites plus a trail_session_id move, in one transaction so a
  // half-applied merge can never leave nodes orphaned between two sessions.
  async function mergeSessions(intoId: string, fromId: string) {
    if (intoId === fromId) return { success: false, error: 'same session' }
    await db().transaction(async (tx) => {
      await tx.run('UPDATE trail_nodes SET trail_session_id = ? WHERE trail_session_id = ?', [intoId, fromId])
      await tx.run('UPDATE trail_connections SET trail_session_id = ? WHERE trail_session_id = ?', [intoId, fromId])
      await tx.run('UPDATE trail_notes SET trail_session_id = ? WHERE trail_session_id = ?', [intoId, fromId])
      await renumberNodes(tx, intoId)
      // The loose bucket is structural — it always exists and is re-provisioned on demand — so
      // merging OUT of it empties it rather than deleting the row.
      if (fromId !== LOOSE_SESSION_ID) await tx.run('DELETE FROM trail_sessions WHERE id = ?', [fromId])
      await tx.run('UPDATE trail_sessions SET updated_at = ? WHERE id = ?', [ctx.now(), intoId])
    })
    ctx.events.emit('data:changed', { entity: 'trail_session', op: 'bulk' })
    return { success: true }
  }

  /** Everything from `atNodeId` onward (by order_index) becomes a new session. */
  async function splitSession(trailSessionId: string, atNodeId: string, name?: string) {
    const pivot = await db().get<{ order_index: number; anchor_started_at: number }>('SELECT order_index, anchor_started_at FROM trail_nodes WHERE id = ?', [atNodeId])
    if (!pivot) return { success: false, error: 'node not found' }
    const newId = ctx.uuid()
    await db().transaction(async (tx) => {
      const now = ctx.now()
      await tx.run(`INSERT INTO trail_sessions (id, name, status, created_at, updated_at) VALUES (?, ?, 'paused', ?, ?)`, [newId, name?.trim() || 'Split session', now, now])
      await tx.run('UPDATE trail_nodes SET trail_session_id = ? WHERE trail_session_id = ? AND order_index >= ?', [newId, trailSessionId, pivot.order_index])
      // Connections move with the node they hang off — matched on from_node_id rather than a
      // timestamp, so a connection recorded slightly out of order still follows its own stop.
      await tx.run(`UPDATE trail_connections SET trail_session_id = ?
                WHERE trail_session_id = ? AND from_node_id IN (SELECT id FROM trail_nodes WHERE trail_session_id = ?)`, [newId, trailSessionId, newId])
      await tx.run('UPDATE trail_notes SET trail_session_id = ? WHERE trail_session_id = ? AND anchor_node_id IN (SELECT id FROM trail_nodes WHERE trail_session_id = ?)', [newId, trailSessionId, newId])
      await renumberNodes(tx, trailSessionId)
      await renumberNodes(tx, newId)
    })
    ctx.events.emit('data:changed', { entity: 'trail_session', id: newId, op: 'upsert' })
    return { success: true, id: newId }
  }

  async function reorderSessions(orderedIds: string[]) {
    await db().transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.run('UPDATE trail_sessions SET sort_order = ? WHERE id = ?', [i, orderedIds[i]])
      }
    })
    ctx.events.emit('data:changed', { entity: 'trail_session', op: 'bulk' })
    return { success: true }
  }

  return {
    startSession, pauseSession, resumeSession, renameSession, endSession, deleteSession, deleteSessions,
    listSessions, listAllSessions, ensureLooseSession, getSession,
    addNode, reopenNode, promoteRevisit, updateNodeSubnote, setNodeTopicBreak, deleteNode, deleteConnection, moveNodes,
    addConnection, markGlance, updateConnectionReason, clearConnectionNote, dismissPrompt, updateRecap,
    getBacklinks, search, listThreads, listSessionsPage,
    getCollapse, setCollapse,
    listNotes, createNote, updateNote, deleteNote,
    listTags, createTag, updateTag, deleteTag, setSessionTags,
    mergeSessions, splitSession, reorderSessions,
  }
}

export type StudyTrailService = ReturnType<typeof createStudyTrailService>
