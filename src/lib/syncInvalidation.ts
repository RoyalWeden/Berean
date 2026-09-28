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
 *   others (playlist, ai_chat, pdf*, youtube_user, trail_*) → their views re-read on their own
 *     change channels / on open; listed explicitly so a new entity is a deliberate decision.
 */
export const INVALIDATES: Record<string, 'notes' | 'highlights' | 'tags' | 'tabs' | 'workspaces' | 'on-open'> = {
  note: 'notes', note_folder: 'notes', note_version: 'notes',
  highlight: 'highlights',
  verse_tag: 'tags', verse_tag_member: 'tags', tag_edge: 'tags',
  session: 'tabs', tab: 'tabs', archived_group: 'tabs',
  workspace: 'workspaces',
  playlist: 'on-open', ai_chat: 'on-open', pdf: 'on-open', pdf_highlight: 'on-open', pdf_bookmark: 'on-open',
  youtube_user: 'on-open', trail_session: 'on-open', trail_node: 'on-open', trail_connection: 'on-open', trail_note: 'on-open', trail_tag: 'on-open',
}

export function applySyncInvalidation(entities: readonly string[]): void {
  const kinds = new Set(entities.map((e) => INVALIDATES[e]).filter(Boolean))
  const s = useAppStore.getState()
  if (kinds.has('notes')) { s.bumpNoteToken(); s.bumpVerseNoteToken() }
  if (kinds.has('highlights')) s.bumpHighlightToken()
  if (kinds.has('tags')) void s.refreshVerseTags()
  if (kinds.has('tabs')) void applyExternalSessions()
  if (kinds.has('workspaces')) window.workspaces?.list().then((ws) => useAppStore.getState().setSavedWorkspaces(ws)).catch(() => {})
}
