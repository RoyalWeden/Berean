import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { Verse } from '@/types'
import { buildVerseStudyTokens } from '@/lib/verseUtils'
import { CrossRefList, CrossRefSourcePicker } from './CrossRefsSheet'
import type { CrossRefSourceId, XRef } from './useVerseCrossRefs'

export { shortRefLabel } from './CrossRefsSheet'

/**
 * One verse with each word's Strong's numbers as tappable superscripts (the verse sheet's
 * Strong's mode and study view). Same visual scale as the reader's inline Strong's numbers.
 */
export function StrongsVerse({ verse, textId, onStrongs }: { verse: Verse; textId: string; onStrongs: (num: string) => void }) {
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const tokens = useMemo(
    () => buildVerseStudyTokens(verse.text, (verse as Verse & { text_tagged?: string | null }).text_tagged, textId, wordReplacerEnabled, wordReplacerRules),
    [verse, textId, wordReplacerEnabled, wordReplacerRules],
  )
  return (
    <p className="mobile-study-verse" lang="en">
      {tokens.map((t, i) => (
        <React.Fragment key={i}>
          <span className={`${t.isRedLetter ? 'mobile-study-red' : ''}${t.isItalic ? ' mobile-study-italic' : ''}`}>{t.word}</span>
          {t.strongs.map((n) => {
            const num = n.replace(/[()]/g, '')
            return <button key={n} type="button" className="mobile-study-strongs" onClick={() => onStrongs(num)} aria-label={`Strong's ${num}`}>{n}</button>
          })}
          {' '}
        </React.Fragment>
      ))}
    </p>
  )
}

/**
 * The verse sheet's study view (e-Sword-inspired): the verse with its Strong's numbers (unless
 * the sheet already shows it — Strong's mode), then its cross references as dense links with the
 * source picker (TSK/e · Classic · My Notes).
 */
export function VerseStudy({ verse, textId, showVerse = true, onStrongs, onNavigate }: {
  verse: Verse
  textId: string
  showVerse?: boolean
  onStrongs: (num: string) => void
  onNavigate: (r: XRef, source: CrossRefSourceId, intent: 'current-tab' | 'new-tab') => void
}) {
  return (
    <div className="mobile-study">
      {showVerse && <StrongsVerse verse={verse} textId={textId} onStrongs={onStrongs} />}
      {/* No "Cross references" heading (TEST25-VERSE-001): the source switch says what this is. */}
      <div className="mobile-study-refs-head is-bare" role="group" aria-label="Cross references">
        <CrossRefSourcePicker />
      </div>
      <CrossRefList bookId={verse.book_id} chapter={verse.chapter} verses={[verse.verse_num]} textId={textId} onNavigate={onNavigate} />
    </div>
  )
}
