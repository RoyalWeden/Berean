import { bookName } from '@/lib/parseRef'
import type { TrailSessionDetail } from '@/types/studyTrail'

// Templated prose recap, built client-side from a session's nodes/connections. Only used as a
// STARTING POINT — once the user edits the rendered paragraph (see ReviewView.tsx),
// recap_user_edited flips to 1 server-side and this generator is never consulted again for
// that session (studyTrail:updateRecap is the one write path that sets that flag).
export function buildRecap(detail: TrailSessionDetail): string {
  const { nodes, connections } = detail
  if (nodes.length === 0) return 'Nothing recorded yet in this session.'
  const chapterLabel = (n: { bookId: string; chapter: number }) => `${bookName(n.bookId)} ${n.chapter}`

  const parts: string[] = [`Started at ${chapterLabel(nodes[0])}.`]
  for (let i = 1; i < nodes.length; i++) {
    const prev = nodes[i - 1]
    const conn = connections.find((c) => c.fromNodeId === prev.id && c.toBookId === nodes[i].bookId && c.toChapter === nodes[i].chapter)
    const reason = conn?.reasonText
    const glance = conn?.weight === 'glance'
    if (glance) {
      parts.push(`Glanced at ${chapterLabel(nodes[i])}${reason ? ` (${reason})` : ''}.`)
    } else {
      parts.push(`Moved to ${chapterLabel(nodes[i])}${reason ? ` — ${reason}` : ''}.`)
    }
  }
  const lexiconHits = connections.filter((c) => c.toKind === 'lexicon')
  if (lexiconHits.length > 0) {
    const words = [...new Set(lexiconHits.map((c) => c.toStrongsNum).filter(Boolean))]
    parts.push(`Looked up ${words.length} word${words.length === 1 ? '' : 's'}: ${words.join(', ')}.`)
  }
  const unresolved = connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length
  if (unresolved > 0) parts.push(`${unresolved} jump${unresolved === 1 ? '' : 's'} still without a noted reason.`)
  return parts.join(' ')
}
