import type { Note } from '@/types'
import { bookName } from '@/lib/parseRef'
import { displayChapter } from './chapterNumbering'

/**
 * One note ⇄ one Markdown file, in the vault's frontmatter dialect (electron/ipc/vault.ts
 * `noteToMarkdown`): the phone has no vault (R140), but it can export a note to Files / the
 * share sheet and import a `.md` back (R099) in the same format, so a file exported from the
 * iPhone drops into the Mac's Octarine vault unchanged and a vault file imports on the phone.
 * The Electron serializer keeps its own copy (it also handles images and highlight previews);
 * this one is renderer-safe (no Node) and covers the fields the notes table stores.
 */
const COLOR_EMOJI: Record<string, string> = {
  yellow: '🟡', orange: '🟠', amber: '🟡', red: '🔴', rose: '🔴', pink: '💗',
  violet: '🟣', purple: '🟣', indigo: '🔵', blue: '🔵', sky: '🔵', cyan: '🔵',
  teal: '🟢', green: '🟢', lime: '🟢',
}
const EMOJI_COLOR: Record<string, string> = { '🟡': 'yellow', '🟠': 'orange', '🔴': 'red', '🟢': 'green', '🔵': 'blue', '🟣': 'purple', '💗': 'pink' }

const isVerseType = (t: string | undefined) => t === 'verse' || t === 'esword' || t === 'biblegateway'

export function noteToMarkdownFile(note: Note): string {
  const typeLabel = isVerseType(note.type) ? 'verse-note' : note.type === 'daily' ? 'daily-note' : 'general-note'
  let displayTitle = note.title || 'Untitled'
  const verseProps: string[] = []
  if (isVerseType(note.type) && note.verseRef) {
    const [bookId = '', chapter = '', verse = ''] = note.verseRef.split('.')
    const ref = `${bookName(bookId)} ${chapter ? displayChapter(bookId, Number(chapter)) : chapter}:${verse}`
    displayTitle = ref
    verseProps.push(`verse: "[[${ref}]]"`, `book: ${bookName(bookId)}`, `chapter: ${chapter}`)
  }
  const dateMatch = note.type === 'daily' ? note.title?.match(/(\d{4}-\d{2}-\d{2})/) : null
  const links = [...(note.content ?? '').matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i)
  const lines = [
    '---',
    `type: ${typeLabel}`,
    note.verseRef ? `ref: ${note.verseRef}` : null,
    note.type === 'esword' ? 'source: esword' : note.type === 'biblegateway' ? 'source: biblegateway' : null,
    `title: ${JSON.stringify(displayTitle)}`,
    `created: ${new Date(note.createdAt).toISOString()}`,
    `updated: ${new Date(note.updatedAt).toISOString()}`,
    `tags: [${(note.tags ?? []).join(', ')}]`,
    note.color && note.color !== 'blue' ? `color: ${COLOR_EMOJI[note.color] ?? '🔵'}` : null,
    note.icon ? `icon: ${note.icon}` : null,
    note.status ? `status: ${note.status}` : null,
    ...verseProps,
    dateMatch ? `date: ${dateMatch[1]}` : null,
    ...(links.length ? ['links:', ...links.map((l) => `  - "[[${l}]]"`)] : []),
    `berean_id: ${note.id}`,
    note.folderId ? `folder_id: ${note.folderId}` : null,
    '---',
  ].filter((l): l is string => l !== null)
  return lines.join('\n') + '\n\n' + (note.content ?? '')
}

export interface ParsedNoteFile {
  bereanId: string | null
  type: Note['type']
  title: string
  content: string
  tags: string[]
  verseRef: string | null
  color: string | null
  icon: string | null
  status: string | null
  folderId: string | null
}

/** Parses a note file written by `noteToMarkdownFile` / the vault; plain Markdown (no
 *  frontmatter) becomes a general note titled from its first heading or line. */
export function parseNoteMarkdownFile(text: string, fallbackTitle = 'Imported note'): ParsedNoteFile {
  const normalized = text.replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const m = normalized.match(/^---\n([\s\S]*?)\n---\n?\n?([\s\S]*)$/)
  const out: ParsedNoteFile = { bereanId: null, type: 'general', title: '', content: normalized.trim(), tags: [], verseRef: null, color: null, icon: null, status: null, folderId: null }
  if (!m) {
    const heading = normalized.match(/^#\s+(.+)$/m)
    out.title = (heading?.[1] ?? normalized.split('\n').find((l) => l.trim()) ?? fallbackTitle).trim().slice(0, 200)
    if (heading) out.content = normalized.replace(heading[0], '').trim()
    return out
  }
  const fm: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (kv) fm[kv[1]] = kv[2].trim()
  }
  out.content = m[2].replace(/<!-- berean:highlight-preview -->[\s\S]*?<!-- \/berean:highlight-preview -->\n?\n?/, '').trim()
  out.bereanId = fm.berean_id || null
  const t = fm.type ?? ''
  out.type = fm.source === 'esword' ? 'esword' : fm.source === 'biblegateway' ? 'biblegateway' : t === 'verse-note' ? 'verse' : t === 'daily-note' ? 'daily' : 'general'
  let title = fm.title ?? ''
  if (title.startsWith('"')) { try { title = JSON.parse(title) as string } catch { title = title.replace(/^"|"$/g, '') } }
  out.title = title || fallbackTitle
  out.tags = (fm.tags ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  out.verseRef = fm.ref || null
  out.color = fm.color ? (EMOJI_COLOR[fm.color] ?? (/^[a-z]+$/.test(fm.color) ? fm.color : null)) : null
  out.icon = fm.icon || null
  out.status = fm.status || null
  out.folderId = fm.folder_id || null
  return out
}

/** Safe file name for a note export. */
export function noteFileName(note: Pick<Note, 'title' | 'id'>): string {
  const base = (note.title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || note.id.slice(0, 8)
  return `${base}.md`
}
