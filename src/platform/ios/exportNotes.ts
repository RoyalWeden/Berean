import type { Note } from '../../types'
import { noteFileName, noteToMarkdownFile } from '../../lib/noteMarkdownFile'

/**
 * Emergency export (DATA-SAFE-100): every note — Trash included, in its own folder — as a
 * vault-format Markdown file (the same format the Mac writes to the Octarine vault, re-importable
 * through Notes → Import Markdown), in one dated folder handed to the share sheet (Save to Files,
 * AirDrop, …). Independent of iCloud sync: a copy the user controls if sync is ever unhealthy.
 * File names are made unique; nothing is logged but counts.
 */
export async function exportAllNotesAsMarkdown(): Promise<{ count: number; folder: string }> {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const live = (await window.notes.getNotes(100000, 0)) as Note[]
  const trashed = (await window.notes.listTrash().catch(() => [])) as Note[]
  const folder = `exports/berean-notes-${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}`
  const used = new Set<string>()
  const unique = (name: string) => {
    let n = name, i = 2
    while (used.has(n.toLowerCase())) n = name.replace(/\.md$/, ` (${i++}).md`)
    used.add(n.toLowerCase())
    return n
  }
  for (const [list, sub] of [[live, ''], [trashed, 'Trash/']] as const) {
    for (const note of list) {
      await Filesystem.writeFile({ path: `${folder}/${sub}${unique(sub + noteFileName(note)).slice(sub.length)}`, directory: Directory.Cache, data: noteToMarkdownFile(note), encoding: Encoding.UTF8, recursive: true })
    }
  }
  const { uri } = await Filesystem.getUri({ path: folder, directory: Directory.Cache })
  await Share.share({ title: 'Berean notes', files: [uri] }).catch(() => { /* cancelled */ })
  console.log(`[export] ${live.length + trashed.length} notes exported`)
  return { count: live.length + trashed.length, folder }
}
