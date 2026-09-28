/**
 * Guards that keep a note being edited inside the verse sheet alive (NOTES-IOS-002). The verse
 * sheet has two "transient" close paths — a long-press text selection collapsing, and the reader
 * leaving its chapter — and neither may fire because of what happens INSIDE the sheet.
 */

/** The node (a selection anchor) is inside a sheet or an editable field — a caret or selection
 *  there belongs to that surface, never to the reader's text selection. */
export function isInOwnSurface(node: Node | null | undefined): boolean {
  const el = node instanceof Element ? node : node?.parentElement
  return !!el?.closest?.('.mobile-sheet, [contenteditable="true"], input, textarea')
}

/** Focus is in an editable field inside a sheet (a note editor, a title field). */
export function isEditingInSheet(): boolean {
  const el = document.activeElement as HTMLElement | null
  return !!el?.closest?.('.mobile-sheet') && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')
}
