// Normalizes every existing note's stored markdown through the new
// ProseMirror parse/serialize round-trip once, so notes created/edited
// under the old CodeMirror 6 editor look and behave consistently with the
// new editor (same line-break handling, same table spacing, same list
// tightness) instead of carrying forward whatever the old editor happened
// to write.
//
// Safety:
//  - Opt-in only, triggered from Settings — never runs automatically.
//  - Every note whose content actually changes gets a version snapshot of
//    the ORIGINAL content (kind: 'pre-migration') saved first, via the
//    existing version-history mechanism — giving a built-in rollback path
//    through the app's own "Version history" UI, no new mechanism needed.
//  - Idempotent: re-running is a no-op for already-migrated notes, since
//    serialize(parse(x)) === x once x has already been through the
//    round-trip. Safe to run more than once.
//  - Per-note failures (a note whose content can't be parsed/serialized
//    for any reason) are caught and reported, never allowed to abort the
//    whole batch.
//  - Never logs or reports note content — only counts and note ids.

import { parseMarkdown } from '@/components/notes/pm/parser'
import { serializeToMarkdown } from '@/components/notes/pm/serializer'
import type { Note } from '@/types'

export interface MigrationProgress {
  done: number
  total: number
}

export interface MigrationResult {
  total: number
  changed: number
  unchanged: number
  failed: number
  failedNoteIds: string[]
}

export async function migrateAllNotes(
  onProgress?: (progress: MigrationProgress) => void,
): Promise<MigrationResult> {
  const notes: Note[] = await window.notes.getNotes(1_000_000, 0)
  const result: MigrationResult = { total: notes.length, changed: 0, unchanged: 0, failed: 0, failedNoteIds: [] }

  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]
    try {
      const normalized = serializeToMarkdown(parseMarkdown(note.content ?? ''))
      if (normalized !== note.content) {
        // Snapshot the pre-migration content so it's recoverable from
        // Version History even though this migration bypasses the normal
        // debounced-save path.
        await window.notes.createNoteVersion(note.id, note.title || 'Untitled', note.content ?? '', 'pre-migration')
        await window.notes.updateNote(note.id, { content: normalized })
        result.changed++
      } else {
        result.unchanged++
      }
    } catch {
      result.failed++
      result.failedNoteIds.push(note.id)
    }
    onProgress?.({ done: i + 1, total: notes.length })
  }

  return result
}
