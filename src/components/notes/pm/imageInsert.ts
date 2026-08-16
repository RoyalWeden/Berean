import type { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from './schema'

// Shared "read an image File → insert it as an `image` node at the given position" path —
// originally only pastePlugin.ts's clipboard-paste handler, now also used by the drag-and-drop
// handler and the explicit slash-command/toolbar "Insert image" action (via a native file
// picker), so this is the one place that logic lives instead of three near-duplicates.
//
// Stored as an inline base64 data URL, same as before this was extracted — see
// electron/ipc/vault.ts's export path for where that gets rewritten to a real
// `attachments/…` file on disk when vault sync is on; this function itself has no vault
// awareness and always just inserts the data URL, kept deliberately simple.
/** Explicit "insert image" affordance (slash command / toolbar button) — a plain hidden
 *  `&lt;input type="file"&gt;` rather than Electron's native `dialog.showOpenDialog`: the
 *  browser file input hands back a real `File` object directly in the renderer, so this
 *  reuses `insertImageFile` unchanged with no IPC round-trip needed at all (paste/drop already
 *  work the same way, for the same reason). */
export function pickAndInsertImage(view: EditorView): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.style.display = 'none'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    if (file) insertImageFile(view, file)
    input.remove()
  })
  document.body.appendChild(input)
  input.click()
}

export function insertImageFile(view: EditorView, file: File, pos?: number): void {
  const reader = new FileReader()
  reader.onload = () => {
    const dataUrl = reader.result as string
    const insertAt = pos ?? view.state.selection.from
    const node = schema.nodes.image.create({ src: dataUrl, alt: file.name.replace(/\.[^.]+$/, '') })
    const tr = pos !== undefined
      ? view.state.tr.insert(insertAt, node)
      : view.state.tr.replaceSelectionWith(node)
    view.dispatch(tr.scrollIntoView())
  }
  reader.readAsDataURL(file)
}
