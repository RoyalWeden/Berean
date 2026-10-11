// ── Folder-tree geometry (SEP26-NOTES-MAC-002/003) ──────────────────────────────────────────
// One model for every row in the folder view: the ICON of an item at depth d sits at
// TREE_ICON_X + d·TREE_STEP, whatever the row type. A note inside a folder is one level deeper
// than the folder, so its icon is clearly to the right of the folder's icon; a subfolder and a
// sibling note line up. The three row types place their icon differently, so each converts the
// icon position into its own padding:
//   • user folder (ListRow + 20 px chevron button after 12 px leading padding): icon = 32 + indent
//   • system / virtual folder (DisclosureRow with the SAME leading geometry as a user folder —
//     a 20 px chevron box + 9 px gap, TREE_CHEVRON_BOX / TREE_GAP):              icon = indent + 29
//     (was a bare 12 px chevron + 6 px gap: system chevrons sat ~10 px right of user-folder ones)
//   • note (ListRow, icon first):                                               icon = indent
export const TREE_ICON_X = 40
export const TREE_STEP = 18
export const treeIconX = (depth: number) => TREE_ICON_X + depth * TREE_STEP
export const userFolderIndent = (depth: number) => treeIconX(depth) - 32
export const TREE_CHEVRON_BOX = 20
export const TREE_GAP = 9
// The DisclosureRow sits 4 px further in than a ListRow's chevron button at the same padding (the
// ListRow's leading wrapper starts before its own padding) — measured in the running app.
export const VIRTUAL_ROW_INSET = 4
export const virtualFolderIndent = (depth: number) => treeIconX(depth) - TREE_CHEVRON_BOX - TREE_GAP - VIRTUAL_ROW_INSET
export const noteIndent = (depth: number) => treeIconX(depth)
