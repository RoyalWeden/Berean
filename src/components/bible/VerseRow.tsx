import StrongsInline from './StrongsInline'
import VerseIndicator from './VerseIndicator'
import type { Verse } from '@/types'

interface VerseRowProps {
  verse: Verse
  showStrongs: boolean
}

export default function VerseRow({ verse, showStrongs }: VerseRowProps) {
  const words = verse.text.split(' ')

  return (
    <div className="flex gap-3 mb-4 group leading-relaxed">
      {/* Verse number badge */}
      <button
        className="
          flex-shrink-0 w-7 text-right text-xs font-medium
          text-[rgb(var(--color-text-muted))] hover:text-[rgb(var(--color-accent))]
          pt-0.5 cursor-default select-none transition-colors
        "
        title={`Verse ${verse.verse_num}`}
      >
        {verse.verse_num}
      </button>

      {/* Verse text */}
      <div className="flex-1 text-[rgb(var(--color-text-primary))] text-base" style={{ lineHeight: 'var(--line-height-comfortable)' }}>
        {showStrongs ? (
          <span>
            {words.map((word, i) => (
              <StrongsInline key={i} word={word} strongsNum={null} />
            ))}
          </span>
        ) : (
          <span>{verse.text}</span>
        )}
      </div>

      {/* Note/highlight indicator */}
      {(verse.hasNote || verse.hasHighlight) && (
        <VerseIndicator hasNote={verse.hasNote} hasHighlight={verse.hasHighlight} />
      )}
    </div>
  )
}
