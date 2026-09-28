import { useSyncExternalStore } from 'react'
import type { Note, NoteFolder } from '@/types'
import { systemFolderOf, type SystemKey } from '@/lib/noteMovability'
import { groupByRecency } from '@/lib/noteRecency'
import { displayNoteTitle } from '@/lib/noteTitle'
import { groupNotes, sortNotes, type NoteGrouping, type NoteSortMode } from './noteGrouping'

/**
 * Notes Home model (NOTES-HOME-001…) — the pure half of the iPhone's folder-first Notes, shaped
 * after Apple Notes: a Folders home (All Notes · Berean's system folders · your folder tree ·
 * Trash) and a folder view (subfolders, Pinned, then recency sections). No React, no I/O, so every
 * rule here is unit-tested (src/mobile/notes/__tests__/notesHomeModel.test.ts).
 *
 * Location is tab state (`listFolderId`), so back / forward and the tab card restore it:
 *   null / undefined   the Folders home
 *   'all'              All Notes (every note — cannot be renamed or deleted)
 *   'sys:<key>'        a system folder (Daily Notes, Verse Notes, e-Sword, BibleGateway) — the
 *                      desktop's virtual folders; notes filed into a user folder leave them
 *   <folder id>        a user folder
 */
export type FolderLocation = null | 'all' | `sys:${SystemKey}` | string

export const SYSTEM_FOLDERS: Array<{ key: SystemKey; name: string; icon: string }> = [
  { key: 'daily', name: 'Daily Notes', icon: 'daily' },
  { key: 'verse', name: 'Verse Notes', icon: 'verse' },
  { key: 'esword', name: 'e-Sword', icon: 'import' },
  { key: 'biblegateway', name: 'BibleGateway', icon: 'import' },
]

export const isSystemLocation = (loc: FolderLocation): loc is `sys:${SystemKey}` => typeof loc === 'string' && loc.startsWith('sys:')

// ── folder tree ─────────────────────────────────────────────────────────────────────────────
export interface FolderNode {
  folder: NoteFolder
  depth: number
  children: FolderNode[]
  /** Notes filed directly in this folder. */
  direct: number
  /** Notes in this folder and every subfolder — the count a folder row shows. */
  total: number
}

/** Folders as a tree (siblings A–Z), with counts. A folder whose parent is missing becomes a root;
 *  a parent cycle (corrupt data) is cut so every folder appears exactly once. */
export function buildFolderTree(folders: readonly NoteFolder[], notes: readonly Note[]): FolderNode[] {
  const direct = new Map<string, number>()
  for (const n of notes) if (n.folderId) direct.set(n.folderId, (direct.get(n.folderId) ?? 0) + 1)
  const ids = new Set(folders.map((f) => f.id))
  const kids = new Map<string | null, NoteFolder[]>()
  for (const f of folders) {
    const p = f.parentId && ids.has(f.parentId) && f.parentId !== f.id ? f.parentId : null
    const list = kids.get(p) ?? []
    list.push(f); kids.set(p, list)
  }
  const placed = new Set<string>()
  const build = (parent: string | null, depth: number): FolderNode[] =>
    (kids.get(parent) ?? [])
      .filter((f) => !placed.has(f.id))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
      .map((f) => {
        placed.add(f.id)
        const children = depth < 20 ? build(f.id, depth + 1) : []
        const d = direct.get(f.id) ?? 0
        return { folder: f, depth, children, direct: d, total: d + children.reduce((s, c) => s + c.total, 0) }
      })
  const roots = build(null, 0)
  // Folders only reachable through a cycle: attach them at the root.
  for (const f of folders) if (!placed.has(f.id)) { placed.add(f.id); const d = direct.get(f.id) ?? 0; roots.push({ folder: f, depth: 0, children: [], direct: d, total: d }) }
  return roots
}

export function findFolderNode(tree: readonly FolderNode[], id: string): FolderNode | null {
  for (const n of tree) { if (n.folder.id === id) return n; const hit = findFolderNode(n.children, id); if (hit) return hit }
  return null
}

/** The folder and all its descendants' ids (a folder cannot be moved into any of these). */
export function subtreeIds(node: FolderNode): Set<string> {
  const out = new Set<string>([node.folder.id])
  const walk = (n: FolderNode) => { for (const c of n.children) { out.add(c.folder.id); walk(c) } }
  walk(node)
  return out
}

/** The tree flattened in display order, skipping the children of collapsed folders. */
export function visibleFolderRows(tree: readonly FolderNode[], expanded: ReadonlySet<string>): FolderNode[] {
  const out: FolderNode[] = []
  const walk = (nodes: readonly FolderNode[]) => { for (const n of nodes) { out.push(n); if (n.children.length && expanded.has(n.folder.id)) walk(n.children) } }
  walk(tree)
  return out
}

export function folderPathLabel(id: string | null | undefined, folders: readonly NoteFolder[]): string | null {
  if (!id) return null
  const parts: string[] = []
  let f = folders.find((x) => x.id === id)
  for (let i = 0; f && i < 20; i++) { parts.unshift(f.name); f = f.parentId ? folders.find((x) => x.id === f!.parentId) : undefined }
  return parts.length ? parts.join(' / ') : null
}

// ── which notes a location shows ──────────────────────────────────────────────────────────
export function notesAt(loc: FolderLocation, notes: readonly Note[]): Note[] {
  if (loc === 'all') return [...notes]
  if (isSystemLocation(loc)) { const key = loc.slice(4); return notes.filter((n) => !n.folderId && systemFolderOf(n) === key) }
  if (!loc) return []
  return notes.filter((n) => n.folderId === loc)
}

export function systemFolderCounts(notes: readonly Note[]): Record<SystemKey, number> {
  const out: Record<SystemKey, number> = { daily: 0, verse: 0, esword: 0, biblegateway: 0 }
  for (const n of notes) { if (n.folderId) continue; const k = systemFolderOf(n); if (k) out[k]++ }
  return out
}

export function locationTitle(loc: FolderLocation, folders: readonly NoteFolder[]): string {
  if (!loc) return 'Folders'
  if (loc === 'all') return 'All Notes'
  if (isSystemLocation(loc)) return SYSTEM_FOLDERS.find((s) => `sys:${s.key}` === loc)?.name ?? 'Notes'
  return folders.find((f) => f.id === loc)?.name ?? 'Folder'
}

/** Where ‹ goes from a location: a subfolder → its parent folder; anything else → the Folders home. */
export function parentLocation(loc: FolderLocation, folders: readonly NoteFolder[]): FolderLocation {
  if (!loc || loc === 'all' || isSystemLocation(loc)) return null
  const f = folders.find((x) => x.id === loc)
  return f?.parentId && folders.some((x) => x.id === f.parentId) ? f.parentId : null
}

// ── filters kept from the former chip row (now in the folder "…" menu) ──────────────────────
export type NoteFilter = 'all' | 'scripture' | 'topic' | 'daily' | 'video' | 'pinned'
export const NOTE_FILTER_OPTIONS: Array<{ id: NoteFilter; label: string }> = [
  { id: 'all', label: 'All notes' }, { id: 'scripture', label: 'Scripture' }, { id: 'topic', label: 'Topic' },
  { id: 'daily', label: 'Daily' }, { id: 'video', label: 'Video' }, { id: 'pinned', label: 'Pinned' },
]
export function matchesFilter(n: Note, f: NoteFilter): boolean {
  switch (f) {
    case 'scripture': return n.type === 'verse'
    case 'topic': return n.type === 'general' || n.type === 'topic'
    case 'daily': return n.type === 'daily'
    case 'video': return n.type === 'video' || (n.tags ?? []).includes('video')
    case 'pinned': return !!n.pinned
    default: return true
  }
}

// ── folder view sections ───────────────────────────────────────────────────────────────────
export interface NoteSection { id: string; title: string; notes: Note[] }

/**
 * Sections of a folder view (NOTES-HOME-003): Pinned first (Apple Notes), then —
 *   sort by last edited / date created, no grouping → Today · Previous 7 Days · Previous 30 Days ·
 *     months (newest first; the year only when it is not this year), by that same date;
 *   sort by title → one "Notes" section A–Z;
 *   a grouping (status / folder / type, the desktop's board and folder views) → those sections.
 * Pinned notes are not repeated below. Within a section: the chosen sort (newest first by default).
 */
export function folderViewSections(notes: readonly Note[], opts: { sort: NoteSortMode; grouping: NoteGrouping; folders?: readonly NoteFolder[]; now: number; locale?: string }): NoteSection[] {
  const pinned = sortNotes(notes.filter((n) => n.pinned), opts.sort)
  const rest = notes.filter((n) => !n.pinned)
  const out: NoteSection[] = pinned.length ? [{ id: 'pinned', title: 'Pinned', notes: pinned }] : []
  if (opts.grouping !== 'none') {
    for (const g of groupNotes(rest, opts.grouping, opts.sort, [...(opts.folders ?? [])])) out.push({ id: `g-${g.id}`, title: g.title, notes: g.notes })
    return out
  }
  const sorted = sortNotes(rest, opts.sort)
  if (opts.sort === 'name') { if (sorted.length) out.push({ id: 'notes', title: 'Notes', notes: sorted }); return out }
  const dateOf = (n: Note) => (opts.sort === 'created' ? n.createdAt : n.updatedAt)
  for (const s of groupByRecency(sorted, dateOf, opts.now, opts.locale)) out.push({ id: s.id, title: s.label, notes: s.items })
  return out
}

// ── row content ────────────────────────────────────────────────────────────────────────────
/** The first image of a note (Markdown image or <img>), as a thumbnail source — data: URLs and
 *  http(s) only (a vault-relative path cannot be resolved from the list). */
export function firstImageSrc(content: string | null | undefined): string | null {
  if (!content) return null
  const md = /!\[[^\]]*\]\(\s*<?((?:data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+)|https?:\/\/[^\s)>]+)>?/i.exec(content)
  const html = /<img[^>]+src=["']((?:data:image\/[a-z+]+;base64,[^"']+)|https?:\/\/[^"']+)["']/i.exec(content)
  const hits = [md, html].filter(Boolean) as RegExpExecArray[]
  if (!hits.length) return null
  return hits.sort((a, b) => a.index - b.index)[0][1]
}

/** Plain-text preview of a note body: Markdown, images and the leading title line removed. */
export function notePreviewText(n: Pick<Note, 'title' | 'content'>, strip: (s: string) => string, max = 140): string {
  let body = (n.content ?? '').replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/<img[^>]*>/gi, ' ')
  body = strip(body).replace(/\s+/g, ' ').trim()
  const title = displayNoteTitle(n.title, '')
  if (title && body.toLowerCase().startsWith(title.toLowerCase())) body = body.slice(title.length).trim()
  return body.slice(0, max)
}

// ── unified search (notes + folders) ──────────────────────────────────────────────────────────
/** Folders whose name (or path) matches — the folder half of the Notes search. */
export function matchFolders(q: string, folders: readonly NoteFolder[]): NoteFolder[] {
  const t = q.trim().toLowerCase()
  if (!t) return []
  return folders
    .filter((f) => f.name.toLowerCase().includes(t))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(t)) - Number(!b.name.toLowerCase().startsWith(t)) || a.name.localeCompare(b.name))
}

// ── persisted presentation (device-local) ────────────────────────────────────────────────────
export type NotesLayout = 'list' | 'gallery'
export interface NotesHomePrefs { layout: NotesLayout; expandedFolders: string[] }
const PREFS_KEY = 'berean.notesHome.v1'
const DEFAULT_PREFS: NotesHomePrefs = { layout: 'list', expandedFolders: [] }
function readPrefs(): NotesHomePrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<NotesHomePrefs> | null
    return { layout: raw?.layout === 'gallery' ? 'gallery' : 'list', expandedFolders: Array.isArray(raw?.expandedFolders) ? raw!.expandedFolders.filter((x) => typeof x === 'string') : [] }
  } catch { return DEFAULT_PREFS }
}
let prefs: NotesHomePrefs | null = null
const prefListeners = new Set<() => void>()
export const notesHomePrefs = {
  get: (): NotesHomePrefs => (prefs ??= readPrefs()),
  set(patch: Partial<NotesHomePrefs>) {
    prefs = { ...notesHomePrefs.get(), ...patch }
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)) } catch { /* private mode: session only */ }
    for (const l of prefListeners) l()
  },
  subscribe(l: () => void) { prefListeners.add(l); return () => { prefListeners.delete(l) } },
  /** Tests only. */
  __reset() { prefs = null },
}
export function useNotesHomePrefs(): NotesHomePrefs {
  return useSyncExternalStore(notesHomePrefs.subscribe, notesHomePrefs.get, notesHomePrefs.get)
}

/** Collapsed sections of folder views, for this session (Apple Notes: sections start expanded). */
const collapsed = new Set<string>()
export const sectionCollapse = {
  isCollapsed: (loc: FolderLocation, id: string) => collapsed.has(`${loc ?? ''}|${id}`),
  toggle: (loc: FolderLocation, id: string) => { const k = `${loc ?? ''}|${id}`; if (collapsed.has(k)) collapsed.delete(k); else collapsed.add(k) },
  __reset: () => collapsed.clear(),
}
