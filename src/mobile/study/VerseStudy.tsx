import React, { useEffect, useMemo, useState } from 'react'
import { useAppStore } from '@/store'
import type { Verse } from '@/types'
import type { TSKeGroup } from '@/types/electron'
import { buildVerseStudyTokens } from '@/lib/verseUtils'
import { bookChapterVerseLabel, bookName } from '@/lib/parseRef'
import { Segmented } from '../settings/SettingsPage'

interface Ref { bookId: string; chapter: number; verse: number; endVerse: number | null; text: string; votes?: number }

/** Short "Num 1:21" label for dense cross-reference lists. */
export function shortRefLabel(r: { bookId: string; chapter: number; verse: number; endVerse?: number | null }): string {
  const full = bookName(r.bookId)
  const short = full.replace(/^(\d)\s+/, '$1 ').split(' ').map((w, i, a) => (i === a.length - 1 && !/^\d/.test(w) ? w.slice(0, 3) : w)).join(' ')
  return `${short} ${r.chapter}:${r.verse}${r.endVerse && r.endVerse !== r.verse ? `–${r.endVerse}` : ''}`
}

/**
 * The verse sheet's study view (TEST-043 / TEST-044, e-Sword-inspired): the verse with each word's
 * Strong's numbers as compact tappable superscripts, then its cross references as a dense list of
 * reference links (source pickable: TSKe / Classic — the same sources as the desktop side panel).
 * Tapping a number opens the Strong's sheet; tapping a reference navigates the current tab (the
 * shared navigateToVerse, so an LXX → New Testament reference opens in KJV).
 */
export function VerseStudy({ verse, textId, onStrongs, onNavigate }: {
  verse: Verse
  textId: string
  onStrongs: (num: string) => void
  onNavigate: (r: Ref, source: 'tske' | 'classic') => void
}) {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const tokens = useMemo(
    () => buildVerseStudyTokens(verse.text, (verse as Verse & { text_tagged?: string | null }).text_tagged, textId, wordReplacerEnabled, wordReplacerRules),
    [verse, textId, wordReplacerEnabled, wordReplacerRules],
  )
  const hasStrongs = tokens.some((t) => t.strongs.length > 0)
  const source = useAppStore((s) => s.crossRefSource)
  const setSource = useAppStore((s) => s.setCrossRefSource)
  const mode: 'tske' | 'classic' = source === 'classic' ? 'classic' : 'tske'
  const [classic, setClassic] = useState<Ref[] | null>(null)
  const [tske, setTske] = useState<TSKeGroup[] | null>(null)
  useEffect(() => {
    let alive = true
    setClassic(null); setTske(null)
    window.crossrefs.getForVerse(verse.book_id, verse.chapter, verse.verse_num, textId).then((r) => { if (alive) setClassic(r.refs) }).catch(() => { if (alive) setClassic([]) })
    window.crossrefs.getTSKeForVerse(verse.book_id, verse.chapter, verse.verse_num, textId).then((r) => { if (alive) setTske(r.groups) }).catch(() => { if (alive) setTske([]) })
    return () => { alive = false }
  }, [verse.book_id, verse.chapter, verse.verse_num, textId])

  const refs = mode === 'classic' ? classic : tske
  return (
    <div className="mobile-study">
      {hasStrongs && (
        <p className="mobile-study-verse" lang="en">
          <span className="mobile-study-tag">({textId.toUpperCase()}+)</span>{' '}
          {tokens.map((t, i) => (
            <React.Fragment key={i}>
              <span className={`${t.isRedLetter ? 'mobile-study-red' : ''}${t.isItalic ? ' mobile-study-italic' : ''}`}>{t.word}</span>
              {t.strongs.map((n) => {
                const num = n.replace(/[()]/g, '')
                return (
                  <button key={n} type="button" className="mobile-study-strongs" onClick={() => onStrongs(num)} aria-label={`Strong's ${num}`}>{n}</button>
                )
              })}
              {' '}
            </React.Fragment>
          ))}
        </p>
      )}
      <div className="mobile-study-refs-head">
        <span>Cross references</span>
        <Segmented value={mode} options={[['tske', 'TSKe'], ['classic', 'Classic']]} onChange={(v) => setSource(v as 'tske' | 'classic')} />
      </div>
      {refs === null ? <div className="mobile-muted mobile-study-pad">Loading…</div>
        : refs.length === 0 ? <div className="mobile-muted mobile-study-pad">No cross references for {bookChapterVerseLabel(verse.book_id, verse.chapter, verse.verse_num)}.</div>
        : mode === 'classic' ? (
          <p className="mobile-study-refs">
            {(refs as Ref[]).map((r, i) => (
              <React.Fragment key={i}>
                <button type="button" className="mobile-study-ref" onClick={() => onNavigate(r, 'classic')}>{shortRefLabel(r)}</button>{i < (refs as Ref[]).length - 1 ? ', ' : ''}
              </React.Fragment>
            ))}
          </p>
        ) : (
          (refs as TSKeGroup[]).map((g, gi) => (
            <p key={gi} className="mobile-study-refs">
              {g.heading && <span className="mobile-study-refs-heading">{g.heading}{g.isReciprocal ? ' ↺' : ''} </span>}
              {g.refs.map((r, i) => (
                <React.Fragment key={i}>
                  <button type="button" className="mobile-study-ref" onClick={() => onNavigate(r as Ref, 'tske')}>{shortRefLabel(r as Ref)}</button>{i < g.refs.length - 1 ? ', ' : ''}
                </React.Fragment>
              ))}
            </p>
          ))
        )}
    </div>
  )
}
