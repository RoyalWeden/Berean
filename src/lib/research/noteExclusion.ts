// AI note exclusion (spec §4.4, §7.3): a note is excluded when it is marked itself or when any
// folder above it is. The SQL below is the single definition every AI read path uses, so
// retrieval, ranking signals, tab context and prompts all agree on what the AI may see.

/** Folder ids excluded directly or by inheritance from an excluded ancestor. */
export const EXCLUDED_FOLDERS_CTE = `WITH RECURSIVE ai_excluded_folders(id) AS (
  SELECT id FROM note_folders WHERE ai_excluded = 1
  UNION
  SELECT f.id FROM note_folders f JOIN ai_excluded_folders x ON f.parent_id = x.id
)`

/** A WHERE fragment (starting with " AND ") keeping only AI-visible notes. `alias` is the notes
 *  table alias ("n") or empty. `cols` says which columns this database has (an un-migrated or
 *  synthetic DB without them has nothing excluded). */
export function aiVisibleNotesSql(alias: string, cols: { aiExcluded: boolean; folderId: boolean; folderAiExcluded: boolean }): string {
  const p = alias ? `${alias}.` : ''
  const parts: string[] = []
  if (cols.aiExcluded) parts.push(`COALESCE(${p}ai_excluded, 0) = 0`)
  if (cols.folderId && cols.folderAiExcluded) parts.push(`(${p}folder_id IS NULL OR ${p}folder_id NOT IN (SELECT id FROM ai_excluded_folders))`)
  return parts.length ? ` AND ${parts.join(' AND ')}` : ''
}

/** Whether a query using `aiVisibleNotesSql` needs `EXCLUDED_FOLDERS_CTE` prepended. */
export function needsExcludedFoldersCte(cols: { folderId: boolean; folderAiExcluded: boolean }): boolean {
  return cols.folderId && cols.folderAiExcluded
}
