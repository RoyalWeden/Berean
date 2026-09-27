// ── Folder-tree geometry (SEP26-NOTES-MAC-002/003) ──────────────────────────────────────────
// One model for every row in the folder view: the ICON of an item at depth d sits at
// TREE_ICON_X + d·TREE_STEP, whatever the row type. A note inside a folder is one level deeper
// than the folder, so its icon is clearly to the right of the folder's icon; a subfolder and a
// sibling note line up. The three row types place their icon differently, so each converts the
// icon position into its own padding:
//   • user folder (ListRow + 20 px chevron button after 12 px leading padding): icon = 32 + indent
//   • system / virtual folder (DisclosureRow: 12 px chevron + 6 px gap):       icon = indent + 18
//   • note (ListRow, icon first):                                               icon = indent
export const TREE_ICON_X = 40
export const TREE_STEP = 18
export const treeIconX = (depth: number) => TREE_ICON_X + depth * TREE_STEP
export const userFolderIndent = (depth: number) => treeIconX(depth) - 32
export const virtualFolderIndent = (depth: number) => treeIconX(depth) - 18
export const noteIndent = (depth: number) => treeIconX(depth)
