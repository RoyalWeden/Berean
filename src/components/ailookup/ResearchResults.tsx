import { memo, useState } from 'react'
import { BookOpenText, ChevronDown, ChevronRight, Info } from 'lucide-react'
import { SectionLabel } from '@/components/ui'
import { bookName, bookOrder } from '@/lib/parseRef'
import type { OccurrenceSummary, ResearchPayload, ResearchStrongsCandidate, WordTable } from '@/lib/research/payload'
import { useChatNavigate } from './chatNav'
import { ComparisonView } from './ComparisonView'

/**
 * Verified, model-free research results (spec §6.1 #3, #4, #6): grouped Strong's candidates, a
 * word-by-word tag table and exact occurrence counts. Everything shown here comes from Berean's
 * own databases; provenance is stated on each row so a count or match is never mistaken for a
 * model's opinion. Shared by every chat surface (Mac panel, chat window, iPhone).
 */

const TEXT_LABEL: Record<string, string> = { kjva: 'KJV', kjv: 'KJV', lxx: 'LXX (Brenton)' }
const textLabel = (id: string) => TEXT_LABEL[id] ?? id.toUpperCase()

/** Why this candidate was offered, in plain words. */
export function candidateProvenance(c: ResearchStrongsCandidate, term?: string): string {
  switch (c.match) {
    case 'kjv-rendering': {
      const forms = c.forms.length > 0 ? c.forms.map((f) => `“${f}”`).join(', ') : term ? `“${term}”` : 'this word'
      return `KJV renders it ${forms} in ${c.kjvRenderingCount} verse${c.kjvRenderingCount === 1 ? '' : 's'}`
    }
    case 'gloss': return `Listed among Strong's KJV renderings${term ? ` for “${term}”` : ''}`
    case 'transliteration': return `Transliteration ${c.transliteration}`
    case 'original-script': return `Lemma ${c.lemma}`
    case 'verse-token': return `Tagged on ${c.forms.map((f) => `“${f}”`).join(', ')} in the verse`
    case 'id': return `Strong's ${c.id}`
  }
}

function occurrenceText(occ: OccurrenceSummary | undefined, fallbackCount: number): string {
  if (!occ) return `${fallbackCount} per Strong's lexicon`
  const parts = occ.totals.filter((t) => t.verses > 0).map((t) => `${t.verses} ${textLabel(t.textId)} verse${t.verses === 1 ? '' : 's'}`)
  const scope = occ.bookId ? ` in ${bookName(occ.bookId)}` : ''
  return parts.length > 0 ? `Tagged in ${parts.join(' · ')}${scope}` : `Not tagged in any verse${scope}`
}

/** One compact candidate row — opens the full lexicon entry. */
function CandidateRow({ c, term, occ }: { c: ResearchStrongsCandidate; term?: string; occ?: OccurrenceSummary }) {
  const nav = useChatNavigate()
  return (
    <button type="button" className="chat-ai-row chat-strongs" title={`Open Strong's ${c.id}`}
      onClick={() => nav({ kind: 'lexicon', strongsNum: c.id })}>
      <BookOpenText size={13} className="flex-shrink-0 mt-[3px] text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline flex-wrap gap-x-2 gap-y-0.5">
          {c.lemma && <span className="chat-strongs-lemma text-text-primary">{c.lemma}</span>}
          {c.transliteration && <span className="text-caption italic text-text-secondary">{c.transliteration}</span>}
          <span className="text-caption2 font-semibold text-accent">{c.id}</span>
        </div>
        {c.gloss && <p className="text-caption text-text-primary leading-snug mt-0.5 line-clamp-2">{c.gloss}</p>}
        <p className="text-caption2 text-text-muted mt-1">
          {candidateProvenance(c, term)} · {occurrenceText(occ, c.lexiconCount)}
        </p>
      </div>
      <ChevronRight size={13} className="flex-shrink-0 self-center text-text-muted" />
    </button>
  )
}

/** Where a Strong's id is tagged, book by book (Phase 5 occurrences explorer). Counts come from the
 *  same exact SQL count as the total; a row opens the lexicon entry, whose occurrence list has the
 *  verses themselves. */
export function OccurrencesByBook({ occ }: { occ: OccurrenceSummary }) {
  const nav = useChatNavigate()
  const [open, setOpen] = useState(false)
  const rows = [...occ.byBook].filter((b) => b.verses > 0).sort((a, b) => a.textId.localeCompare(b.textId) || bookOrder(a.bookId) - bookOrder(b.bookId))
  if (rows.length < 2 || occ.bookId) return null
  const max = Math.max(...rows.map((r) => r.verses))
  const multiText = new Set(rows.map((r) => r.textId)).size > 1
  return (
    <div className="chat-occ">
      <button type="button" className="chat-crossrefs-toggle text-caption2 self-start" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {occ.id} by book · {rows.length} books
      </button>
      {open && (
        <ul className="chat-occ-list" aria-label={`${occ.id} tagged verses by book`}>
          {rows.map((r) => (
            <li key={`${r.textId}-${r.bookId}`}>
              <button type="button" className="chat-occ-row text-caption2" title={`Open Strong's ${occ.id}`}
                aria-label={`${bookName(r.bookId)}${multiText ? ` (${textLabel(r.textId)})` : ''}: ${r.verses} verse${r.verses === 1 ? '' : 's'}`}
                onClick={() => nav({ kind: 'lexicon', strongsNum: occ.id })}>
                <span className="chat-occ-book">{bookName(r.bookId)}{multiText && <span className="text-text-muted"> · {textLabel(r.textId)}</span>}</span>
                <span className="chat-occ-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, Math.round((r.verses / max) * 100))}%` }} /></span>
                <span className="chat-occ-n">{r.verses}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Best match first; further distinct lemmas behind a disclosure, grouped Hebrew / Greek (decision 8). */
function StrongsCandidates({ research }: { research: ResearchPayload }) {
  const [open, setOpen] = useState(false)
  const [best, ...rest] = research.candidates
  if (!best) return null
  const occFor = (id: string) => research.occurrences.find((o) => o.id === id)
  const hebrew = rest.filter((c) => c.lang === 'H')
  const greek = rest.filter((c) => c.lang === 'G')
  return (
    <div className="chat-ai-rows">
      <CandidateRow c={best} term={research.term} occ={occFor(best.id)} />
      {occFor(best.id) && <OccurrencesByBook occ={occFor(best.id)!} />}
      {rest.length > 0 && (
        <>
          <button type="button" className="chat-crossrefs-toggle text-caption2 self-start" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            {rest.length} more {rest.length === 1 ? 'entry' : 'entries'}{research.term ? ` for “${research.term}”` : ''}
          </button>
          {open && (
            <div className="chat-ai-rows">
              {[{ label: 'Hebrew', items: hebrew }, { label: 'Greek', items: greek }].filter((g) => g.items.length > 0).map((g) => (
                <section key={g.label} aria-label={`${g.label} entries`} className="chat-ai-rows">
                  <SectionLabel className="chat-ai-section-label">{g.label}</SectionLabel>
                  {g.items.map((c) => <CandidateRow key={c.id} c={c} term={research.term} occ={occFor(c.id)} />)}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Word-by-word Strong's table for one passage (spec §6.1 #4). Untagged words stay visible. */
function WordTableView({ table }: { table: WordTable }) {
  const nav = useChatNavigate()
  const ref = (v: number) => `${bookName(table.bookId)} ${table.chapter}:${v}`
  if (table.untaggedText) {
    return <p className="text-caption2 text-text-muted">{textLabel(table.textId)} has no Strong's tags for this passage.</p>
  }
  return (
    <div className="chat-wordtables">
      {table.verses.map((v) => (
        <section key={v.verse} className="chat-wordtable" aria-label={`${ref(v.verse)}, word by word`}>
          <div className="chat-wordtable-head text-caption">
            <span className="font-semibold text-text-primary">{ref(v.verse)}</span>
            <span className="text-meta">{textLabel(table.textId)} · {v.coverage.tagged} of {v.coverage.tokens} words tagged</span>
          </div>
          <table className="chat-wordtable-grid text-caption">
            <thead>
              <tr><th scope="col">Word</th><th scope="col">Strong's</th><th scope="col">Lemma</th><th scope="col">KJV renderings</th></tr>
            </thead>
            <tbody>
              {v.tokens.filter((t) => t.word !== '' || t.untranslated).map((t) => (
                <tr key={t.index} className={t.strongs.length === 0 ? 'is-untagged' : undefined}>
                  <td data-label="Word">
                    {t.untranslated ? <span className="text-text-muted italic">(untranslated)</span> : <span className={t.supplied ? 'italic' : undefined}>{t.word}</span>}
                    {t.supplied && <span className="sr-only"> (supplied by the translators)</span>}
                  </td>
                  <td data-label="Strong's">
                    {t.strongs.length === 0
                      ? <span className="text-text-muted">untagged</span>
                      : t.strongs.map((id) => (
                        <button key={id} type="button" className="chat-wordtable-id" onClick={() => nav({ kind: 'lexicon', strongsNum: id })}>{id}</button>
                      ))}
                  </td>
                  <td data-label="Lemma">
                    {t.entries.map((e) => (
                      <span key={e.id} className="block">
                        <span className="chat-strongs-lemma">{e.lemma}</span>
                        {e.transliteration && <span className="text-text-secondary italic"> {e.transliteration}</span>}
                      </span>
                    ))}
                  </td>
                  <td data-label="KJV renderings" className="text-text-secondary">
                    {t.entries.map((e) => <span key={e.id} className="block line-clamp-2">{e.gloss}</span>)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  )
}

/** Two or more Strong's entries side by side (spec §6.1 #5, scenario 4): sourced definitions,
 *  exact tagged-verse counts and the KJV renderings they share — attested facts, no reading. */
function StrongsComparison({ research }: { research: ResearchPayload }) {
  const nav = useChatNavigate()
  const occFor = (id: string) => research.occurrences.find((o) => o.id === id)
  const cmp = research.comparison
  return (
    <section className="chat-compare" aria-label="Strong's comparison">
      <div className="chat-compare-grid">
        {research.candidates.slice(0, 4).map((c) => (
          <article key={c.id} className="chat-compare-col">
            <button type="button" className="chat-compare-head" onClick={() => nav({ kind: 'lexicon', strongsNum: c.id })} title={`Open Strong's ${c.id}`}>
              <span className="chat-strongs-lemma text-text-primary">{c.lemma}</span>
              <span className="text-caption italic text-text-secondary">{c.transliteration}</span>
              <span className="text-caption2 font-semibold text-accent">{c.id}</span>
            </button>
            {c.definition && <p className="text-caption text-text-primary leading-snug">{c.definition.trim()}</p>}
            {c.derivation && <p className="text-caption2 text-text-muted leading-snug">From: {c.derivation.trim()}</p>}
            <p className="text-caption2 text-text-muted">{occurrenceText(occFor(c.id), c.lexiconCount)}</p>
            {cmp?.only[c.id]?.length ? (
              <p className="text-caption2 text-text-secondary"><span className="text-text-muted">Only this entry is rendered: </span>{cmp.only[c.id].join(', ')}</p>
            ) : null}
          </article>
        ))}
      </div>
      {cmp && (
        <p className="text-caption2 text-text-secondary">
          <span className="text-text-muted">KJV renderings both share: </span>{cmp.shared.length ? cmp.shared.join(', ') : 'none'}
          <span className="text-text-muted"> · from Strong's rendering lists</span>
        </p>
      )}
    </section>
  )
}

export const ResearchResults = memo(function ResearchResults({ research }: { research: ResearchPayload }) {
  const occFor = (id: string) => research.occurrences.find((o) => o.id === id)
  if (research.passageComparison) {
    return (
      <>
        <ComparisonView comparison={research.passageComparison} />
        {research.limitations.length > 0 && (
          <ul className="chat-limitations" aria-label="Limitations">
            {research.limitations.map((l, i) => <li key={i} className="text-caption2 text-text-muted flex items-start gap-1.5"><Info size={11} className="flex-shrink-0 mt-[2px]" />{l}</li>)}
          </ul>
        )}
      </>
    )
  }
  if (research.kind === 'strongs-compare' && research.candidates.length >= 2) {
    return (
      <>
        <StrongsComparison research={research} />
        {research.limitations.length > 0 && (
          <ul className="chat-limitations" aria-label="Limitations">
            {research.limitations.map((l, i) => <li key={i} className="text-caption2 text-text-muted flex items-start gap-1.5"><Info size={11} className="flex-shrink-0 mt-[2px]" />{l}</li>)}
          </ul>
        )}
      </>
    )
  }
  return (
    <>
      {research.wordTables.map((t, i) => <WordTableView key={i} table={t} />)}
      {research.wordTables.length === 0
        ? <StrongsCandidates research={research} />
        : research.candidates.length > 0 && (
          // A verse-scoped word study: the table shows the verse, the rows name the words asked about.
          <div className="chat-ai-rows">{research.candidates.map((c) => <CandidateRow key={c.id} c={c} term={research.term} occ={occFor(c.id)} />)}</div>
        )}
      {research.limitations.length > 0 && (
        <ul className="chat-limitations" aria-label="Limitations">
          {research.limitations.map((l, i) => (
            <li key={i} className="text-caption2 text-text-muted flex items-start gap-1.5"><Info size={11} className="flex-shrink-0 mt-[2px]" />{l}</li>
          ))}
        </ul>
      )}
    </>
  )
})
