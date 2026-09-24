import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore, selectedVerseKey, type SelectedVerseRef } from '@/store'
import { bookChapterVerseLabel } from '@/lib/parseRef'
import { buildVerseStudyTokens, type StudyToken } from '@/lib/verseUtils'
import { RED_LETTER_CLASS } from '@/styles/highlightPalette'
import { SectionLabel } from '@/components/ui'
import { fetchVerse, sortSelection } from './VerseSelectionBar'

/** Upper bound on verses rendered at once — a whole-chapter selection stays responsive. */
export const SELECTED_VERSES_STRONGS_LIMIT = 60

interface FetchedVerse extends SelectedVerseRef { text: string; textTagged: string | null }

/** "Deuteronomy 9:4" (+ " LXX" for the Septuagint) — the per-verse heading. */
export function selectedVerseHeading(r: SelectedVerseRef): string {
  return `${bookChapterVerseLabel(r.bookId, r.chapter, r.verse)}${r.textId === 'lxx' ? ' LXX' : ''}`
}

/** Stable identity of a selection (order-insensitive) — the fetch effect keys off this so the
 *  verses are fetched once per selection change, not on every store update. */
export function selectionSignature(refs: SelectedVerseRef[]): string {
  return sortSelection(refs).map(selectedVerseKey).join(',')
}

/**
 * The side panel Lexicon tab's "Selected verses" view: every verse picked in the reader, each
 * under its own reference heading, rendered with its Strong's numbers always visible (independent
 * of the reader's Strong's toggle). Clicking a number opens that entry in the panel.
 */
export default function SelectedVersesStrongs({ refs, onStrongsClick }: {
  refs: SelectedVerseRef[]
  onStrongsClick: (strongsNum: string) => void
}) {
  const signature = selectionSignature(refs)
  const [verses, setVerses] = useState<FetchedVerse[] | null>(null)

  useEffect(() => {
    let alive = true
    const sorted = sortSelection(refs).slice(0, SELECTED_VERSES_STRONGS_LIMIT)
    setVerses(null)
    Promise.all(sorted.map((r) => fetchVerse(r).catch(() => null)))
      .then((rows) => { if (alive) setVerses(rows.filter(Boolean) as FetchedVerse[]) })
      .catch(() => { if (alive) setVerses([]) })
    return () => { alive = false }
  }, [signature]) // eslint-disable-line react-hooks/exhaustive-deps

  const overflow = refs.length - SELECTED_VERSES_STRONGS_LIMIT

  return (
    <div className="px-3 py-3" data-testid="selected-verses-strongs">
      <SectionLabel className="mb-2">{refs.length === 1 ? 'Selected verse' : `Selected verses · ${refs.length}`}</SectionLabel>
      {verses === null && <p className="text-caption text-text-muted py-2">Loading…</p>}
      {verses !== null && verses.length === 0 && <p className="text-caption text-text-muted py-2">Couldn't load the selected verses.</p>}
      {verses !== null && verses.length > 0 && (
        <div className="divide-y divide-separator-subtle">
          {verses.map((v) => (
            <SelectedVerseBlock key={selectedVerseKey(v)} verse={v} onStrongsClick={onStrongsClick} />
          ))}
        </div>
      )}
      {overflow > 0 && (
        <p className="text-caption text-text-muted pt-2">+{overflow} more selected — narrow the selection to see them here.</p>
      )}
    </div>
  )
}

export function SelectedVerseBlock({ verse, onStrongsClick }: { verse: FetchedVerse; onStrongsClick: (n: string) => void }) {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const tokens: StudyToken[] = useMemo(
    () => buildVerseStudyTokens(verse.text, verse.textTagged, verse.textId, wordReplacerEnabled, wordReplacerRules),
    [verse.text, verse.textTagged, verse.textId, wordReplacerEnabled, wordReplacerRules],
  )
  const hasNumbers = tokens.some((t) => t.strongs.length > 0)
  return (
    <section className="py-2.5 first:pt-0" aria-label={selectedVerseHeading(verse)}>
      <h3 className="text-footnote font-semibold text-text-primary mb-1">{selectedVerseHeading(verse)}</h3>
      <p className="text-subhead text-text-primary leading-[1.9]" style={{ fontFamily: 'var(--font-scripture)' }}>
        {tokens.map((t, i) => (
          <React.Fragment key={i}>
            <span className={`${t.isRedLetter ? RED_LETTER_CLASS : ''}${t.isItalic ? ' italic' : ''}`}>{t.word}</span>
            {t.strongs.map((n, j) => {
              const num = n.replace(/[()]/g, '')
              const paren = n.startsWith('(')
              return (
                <button
                  key={`${n}-${j}`}
                  type="button"
                  onClick={() => onStrongsClick(num)}
                  aria-label={`Open Strong's ${num}`}
                  className={`ml-0.5 align-[0.35em] inline-flex items-center font-mono text-micro leading-none rounded-chip border px-[4px] py-[1.5px] cursor-pointer transition-colors duration-150 focus-ring ${
                    paren
                      ? 'text-text-muted bg-surface-4/60 border-border hover:text-text-primary'
                      : 'text-accent bg-accent/10 border-accent/25 hover:bg-accent/20'
                  }`}
                >
                  {num}
                </button>
              )
            })}
            {' '}
          </React.Fragment>
        ))}
      </p>
      {!hasNumbers && <p className="text-caption2 text-text-muted mt-0.5">No Strong's tagging for this text.</p>}
    </section>
  )
}
