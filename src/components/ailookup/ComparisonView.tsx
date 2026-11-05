import { memo } from 'react'
import { ChevronRight } from 'lucide-react'
import { bookName } from '@/lib/parseRef'
import { normalizeWord } from '@/lib/research/compareWords'
import type { ComparisonPane, PassageComparison } from '@/lib/research/payload'
import { useChatNavigate } from './chatNav'

/**
 * Translation parallel and passage comparison (spec §6.1 #7, #8): the texts themselves, side by
 * side when there is room and stacked on a phone or slim panel. Every pane names its translation
 * and corpus and its reference under that text's own numbering. A passage missing from a text is
 * an explicit pane, never a blank. "Different wording" marks only words present in one pane and
 * absent from the other, for the same reference — it claims nothing about why.
 */

const WORD_SPLIT_RE = /([\p{L}\p{M}'’-]+)/u

/** Verse text with the pane's differing words marked (a style plus a screen-reader summary). */
function PaneText({ text, differing }: { text: string; differing: Set<string> }) {
  if (differing.size === 0) return <>{text}</>
  return (
    <>
      {text.split(WORD_SPLIT_RE).map((part, i) => (i % 2 === 1 && differing.has(normalizeWord(part))
        ? <mark key={i} className="chat-diff-word" title="Different wording">{part}</mark>
        : part))}
    </>
  )
}

function Pane({ pane }: { pane: ComparisonPane }) {
  const nav = useChatNavigate()
  const differing = new Set(pane.differing ?? [])
  const first = pane.verses[0]
  const open = () => first && nav({
    kind: 'verse',
    result: { textId: pane.textId, bookId: pane.bookId, bookName: bookName(pane.bookId), chapter: first.chapter, verse: first.verse, text: first.text, source: 'named' },
  })
  return (
    <article className="chat-parallel-pane" aria-label={`${pane.reference}, ${pane.label}`}>
      <div className="chat-parallel-head">
        {first
          ? (
            <button type="button" className="chat-compare-head" title={`Open ${pane.reference} in ${pane.label}`} onClick={open}>
              <span className="text-caption font-semibold text-text-primary">{pane.reference}</span>
              <ChevronRight size={11} className="text-text-muted self-center" />
            </button>
          )
          : <span className="text-caption font-semibold text-text-primary">{pane.reference}</span>}
        <span className="text-caption2 text-text-muted">{pane.label} <span className="chat-collection-badge text-caption2">{pane.corpus}</span></span>
      </div>
      {pane.missing
        ? <p className="chat-parallel-missing text-caption text-text-muted" role="note">{pane.missing}</p>
        : (
          <p className="chat-parallel-text text-caption text-text-primary leading-snug">
            {pane.verses.map((v) => (
              <span key={`${v.chapter}:${v.verse}`}>
                <sup className="chat-parallel-num text-meta text-text-muted">{pane.verses.some((x) => x.chapter !== v.chapter) ? `${v.chapter}:${v.verse}` : v.verse}</sup>
                <PaneText text={v.text} differing={differing} />{' '}
              </span>
            ))}
          </p>
        )}
      {differing.size > 0 && <span className="sr-only">Different wording in this text: {[...differing].join(', ')}.</span>}
    </article>
  )
}

export const ComparisonView = memo(function ComparisonView({ comparison }: { comparison: PassageComparison }) {
  const marked = comparison.panes.some((p) => (p.differing?.length ?? 0) > 0)
  return (
    <section className="chat-parallel" aria-label={comparison.kind === 'translation-parallel' ? 'Translation parallel' : 'Passage comparison'}>
      <div className="chat-parallel-grid">
        {comparison.panes.map((p, i) => <Pane key={`${p.textId}-${p.reference}-${i}`} pane={p} />)}
      </div>
      {marked && <p className="text-caption2 text-text-muted">Underlined words are different wording: present in one text and not in the other.</p>}
    </section>
  )
})
