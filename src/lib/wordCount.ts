import { stripMarkdownFormatting } from './notePreviewText'

export interface WordStats {
  words: number
  minutes: number
  characters: number
}

// Word count + reading time for the note editor's persistent toolbar (Toolbar.tsx). `text` is
// expected to already be plain text pulled straight from the live ProseMirror document
// (view.state.doc.textBetween) rather than a markdown round-trip — stripMarkdownFormatting is
// still run over it defensively (cheap, idempotent on already-plain text) so any straggler
// markdown-ish characters entered as literal text (e.g. pasted `**bold**` before it's parsed
// into a mark) don't inflate the count. Reading time follows Notion's own convention: words /
// 200wpm, rounded up, minimum 1 minute once there's any content at all — an empty note reports
// 0 words / 0 minutes, not "1 min read".
export function computeWordStats(text: string): WordStats {
  const stripped = stripMarkdownFormatting(text).replace(/\s+/g, ' ').trim()
  if (!stripped) return { words: 0, minutes: 0, characters: 0 }
  const words = stripped.split(' ').length
  const minutes = Math.max(1, Math.ceil(words / 200))
  return { words, minutes, characters: stripped.length }
}
