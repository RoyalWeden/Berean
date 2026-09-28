import { useAppStore } from '@/store'
import { applyExternalSessions } from '@/store/tabPersistenceRuntime'

/**
 * Database → UI invalidation after the sync engine applied remote changes (DATA-SYNC-009) — the
 * ONE map both apps use (desktop App.tsx, iPhone MobileApp.tsx) for `sync.onApplied`.
 *
 * The database is the source of truth; this only tells the views that read it to read again.
 * Every synced entity kind must appear here (tests enforce it against SYNCED_ENTITY_KINDS):
 *
 *   note, note_folder, note_version → noteChangeToken (lists, folders, open note via its host's
 *                                     external-update policy, calendar dots, trash, previews)
 *                                     + verseNoteToken (reader verse-note indicators)
 *   highlight                       → highlightChangeToken (reader, compare, previews)
 *   verse_tag, verse_tag_member, tag_edge → verse tags reloaded
 *   session, tab, archived_group    → tab mirror re-hydrated (on-screen tab held — DATA-TAB-001)
 *   workspace                       → saved workspaces reloaded
 *   playlist                        → dataEpochs.playlists (queue / playlist lists re-read)
 *   pdf, pdf_highlight, pdf_bookmark → dataEpochs.pdfs (library lists re-read)
 *   youtube_user                    → dataEpochs.youtube (stars + resume positions re-read)
 *   ai_chat                         → dataEpochs.aiChats
 *   trail_*                         → live already: the trail's own change channel fires for
 *                                     remote applies too (services emit data:changed remote)
 * Every entity is listed explicitly so a new one is a deliberate decision. No view needs to be
 * reopened, and nothing polls (DATA-LIVE-002).
 */
export const INVALIDATES: Record<string, 'notes' | 'highlights' | 'tags' | 'tabs' | 'workspaces' | 'playlists' | 'pdfs' | 'youtube' | 'aiChats' | 'trail'> = {
  note: 'notes', note_folder: 'notes', note_version: 'notes',
  highlight: 'highlights',
  verse_tag: 'tags', verse_tag_member: 'tags', tag_edge: 'tags',
  session: 'tabs', tab: 'tabs', archived_group: 'tabs',
  workspace: 'workspaces',
  playlist: 'playlists', ai_chat: 'aiChats', pdf: 'pdfs', pdf_highlight: 'pdfs', pdf_bookmark: 'pdfs',
  youtube_user: 'youtube', trail_session: 'trail', trail_node: 'trail', trail_connection: 'trail', trail_note: 'trail', trail_tag: 'trail',
}

export function applySyncInvalidation(entities: readonly string[]): void {
  const kinds = new Set(entities.map((e) => INVALIDATES[e]).filter(Boolean))
  const s = useAppStore.getState()
  if (kinds.has('notes')) { s.bumpNoteToken(); s.bumpVerseNoteToken() }
  if (kinds.has('highlights')) s.bumpHighlightToken()
  if (kinds.has('tags')) void s.refreshVerseTags()
  if (kinds.has('tabs')) void applyExternalSessions()
  for (const k of ['playlists', 'pdfs', 'youtube', 'aiChats'] as const) if (kinds.has(k)) s.bumpDataEpoch(k)
  if (kinds.has('workspaces')) window.workspaces?.list().then((ws) => useAppStore.getState().setSavedWorkspaces(ws)).catch(() => {})
}
