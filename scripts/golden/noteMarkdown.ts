/** Note ⇄ Markdown file golden (M7-01): src/lib/noteMarkdownFile.ts over synthetic notes and hand-written files. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Note } from '../../src/types'
import { noteToMarkdownFile, parseNoteMarkdownFile, noteFileName } from '../../src/lib/noteMarkdownFile'

const ROOT = resolve(__dirname, '../..')
const n = (o: Partial<Note> & { id: string }): Note => ({ type: 'general', title: '', content: '', verseRef: null, color: 'blue', createdAt: 1762560000000, updatedAt: 1762563723456, tags: [], ...o } as Note)

export const MARKDOWN_NOTES: Note[] = [
  n({ id: 'm01', type: 'verse', title: 'Creation', content: 'In the beginning Yehovah created. See [[Exod 20:11]] and [[Exod 20:11]], [[Gen 2:3]].', verseRef: 'GEN.1.1', tags: ['creation', 'torah'] }),
  n({ id: 'm02', type: 'verse', title: 'Psalm', content: 'body', verseRef: 'PSA.23.1', color: 'yellow', icon: '📖', status: 'draft', folderId: 'f1' }),
  n({ id: 'm03', type: 'esword', title: 'Imported', content: '', verseRef: 'JHN.3.16', color: 'teal' }),
  n({ id: 'm04', type: 'biblegateway', title: 'BG', content: 'x', verseRef: 'ROM.6', color: 'mauve' }),
  n({ id: 'm05', type: 'verse', title: 'Shifted', content: '', verseRef: 'RCL3.12.4' }),
  n({ id: 'm06', type: 'daily', title: 'Daily — 2026-11-07', content: '## Reading\n\n- Exodus 20', aiExcluded: true }),
  n({ id: 'm07', type: 'general', title: 'Quote "marks" \\ and ü — ✓', content: '[[[nested]] [[a]b]] [[\n]] [[ok]]', color: '' }),
  n({ id: 'm08', type: 'general', title: '', content: 'untitled', tags: ['a b', 'c'] }),
  n({ id: 'm09', type: 'daily', title: 'no date', content: '' }),
  n({ id: 'm10', type: 'verse', title: 'No ref', content: 'v', verseRef: null }),
  n({ id: 'm11', type: 'verse', title: 'Odd ref', content: 'v', verseRef: 'XYZ.x' }),
  n({ id: 'm12', type: 'general', title: 'Old', content: 'c', createdAt: 0, updatedAt: 951782400999 }),
]

const FILES: string[] = [
  '---\r\ntype: verse-note\r\nref: GEN.1.1\r\ntitle: "Gen 1:1"\r\ntags: [x, , y ]\r\ncolor: 🟢\r\nberean_id: abc\r\n---\r\n\r\nBody\r\n',
  '﻿---\ntype: daily-note\ntitle: plain title\nai_excluded: true\nfolder_id: f9\n---\nno blank line',
  '---\nsource: esword\ntype: verse-note\ntitle: "unterminated\ncolor: Red\n---\n\n\n\nthree newlines',
  '---\nsource: biblegateway\ntitle: "\ncolor: teal\nicon: ✝\nstatus: done\n---\n\nx',
  '---\ntype: general-note\ntitle: ""\n---\n\n<!-- berean:highlight-preview -->\n> quoted\n<!-- /berean:highlight-preview -->\n\nAfter preview\n<!-- berean:highlight-preview -->kept<!-- /berean:highlight-preview -->',
  '---\n---\nnot frontmatter',
  '---\n\n---\nempty frontmatter',
  '---\nweird key: x\n_ok_: y\nline: a b\nline2:  c\ntitle:   spaced   \n---\nz',
  '# Heading Title\n\nParagraph one.',
  '\n\n  First line  \nsecond',
  'x# T\n# T\nrest',
  '#\nTitle on next line',
  '#   \n',
  '   \n\t\n',
  '',
  '---\ntype: verse-note\nno closing',
  '---\ntags: [solo]\ncolor: 🟠\ntype: other\n---\n\n' + 'x'.repeat(5),
]

export function buildNoteMarkdownGolden(): { name: string; data: unknown } {
  const exported = MARKDOWN_NOTES.map((note) => noteToMarkdownFile(note))
  const roundTrip = exported.map((t) => parseNoteMarkdownFile(t))
  const parsed = FILES.map((t) => ({ input: t, output: parseNoteMarkdownFile(t, 'Fallback') }))
  const names = [...MARKDOWN_NOTES, { id: 'abcdef123456', title: '  a/b\\c:d*e?f"g<h>i|j  ' }, { id: 'zz', title: '|||' }, { id: 'long', title: 'é'.repeat(100) }, { id: 'ws', title: 'a 　b\n\tc' }]
    .map((x) => noteFileName(x))
  return { name: 'note-markdown', data: { format: 1, generator: 'scripts/golden/noteMarkdown.ts',
    sources: Object.fromEntries(['src/lib/noteMarkdownFile.ts', 'scripts/golden/noteMarkdown.ts'].map((p) => [p, createHash('sha256').update(readFileSync(resolve(ROOT, p))).digest('hex')])),
    notes: MARKDOWN_NOTES, exported, roundTrip, parsed, names } }
}
