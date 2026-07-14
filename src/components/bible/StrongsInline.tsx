import StrongsTooltip from './StrongsTooltip'
import { applyFindHighlight } from '@/lib/highlight'
import { RED_LETTER_CLASS } from '@/styles/highlightPalette'

export interface WordSegment { text: string; bg?: string }

interface StrongsInlineProps {
  word: string
  strongsNum: string | string[] | null
  isItalic?: boolean        // translator-supplied word (KJV italic)
  isRedLetter?: boolean     // words of Yeshua (red-letter)
  isParenthetical?: boolean // grammatical particle with no English equivalent (e.g. H853 את)
  tagged?: boolean          // true = word comes from text_tagged alignment
  /** When provided, render the word as highlight-split segments instead of a plain text node */
  wordSegments?: WordSegment[]
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  onStrongsClick?: (num: string) => void
  onWordClick?: (word: string) => void
}

export default function StrongsInline({
  word,
  strongsNum,
  isItalic = false,
  isRedLetter = false,
  isParenthetical = false,
  tagged = false,
  wordSegments,
  findQuery = '',
  findWordMode = 'phrase',
  onStrongsClick,
  onWordClick,
}: StrongsInlineProps) {
  const nums = Array.isArray(strongsNum) ? strongsNum : (strongsNum ? [strongsNum] : [])
  const wordNode = findQuery.trim() ? applyFindHighlight(word, findQuery, findWordMode) : word

  if (tagged) {
    // Parenthetical token: grammatical particle, no corresponding English word.
    // Rendered as a chip-only row with a muted parenthesised number.
    if (isParenthetical && nums.length > 0) {
      return (
        <span className="inline-flex flex-col items-start mr-0.5">
          {/* Empty word-height placeholder so the chip row aligns with adjacent chips */}
          <span className="text-[10px] leading-none opacity-0 select-none" aria-hidden>·</span>
          <StrongsTooltip
            strongsNum={nums[0]}
            onClickEntry={onStrongsClick}
            contextNote="Parenthetical — grammatical particle with no corresponding English word (e.g. H853 = את, the Hebrew direct object marker)."
          >
            <span data-strongs-chip className="text-[10px] text-[rgb(var(--color-text-muted))] font-mono opacity-50 leading-none hover:opacity-80 transition-opacity cursor-pointer">
              ({nums[0]})
            </span>
          </StrongsTooltip>
        </span>
      )
    }

    // Normal tagged word (possibly with multiple Strongs chips)
    // wordContent: either segment-split spans (char highlight) or plain wordNode (find highlight)
    const wordContent = wordSegments
      ? wordSegments.map((seg, si) => (
          <span key={si} style={seg.bg ? { backgroundColor: seg.bg, borderRadius: '2px' } : undefined}>{seg.text}</span>
        ))
      : wordNode
    // gap: '2px' (was 0, with the word span pulled up via a negative marginBottom) — the word
    // and its Strong's number sat with no breathing room at all once the trigger box-height
    // fix (StrongsTooltip.tsx) closed up the number's own oversized hoverable area; a small
    // positive gap here reads much less cramped.
    return (
      <span className="inline-flex flex-col items-start mr-0.5" style={{ gap: '2px' }}>
        <span
          className={`leading-none ${isItalic ? 'italic opacity-70' : ''}${isRedLetter ? ` ${RED_LETTER_CLASS}` : ''}`}
        >{wordContent}</span>
        {nums.length > 0 ? (
          <>
            {nums.map((num, i) => (
              <StrongsTooltip
                key={i}
                strongsNum={num}
                onClickEntry={onStrongsClick}
                contextNote={i > 0 ? "Secondary Strong's number" : undefined}
              >
                {/* The marginTop:-3 this used to carry on secondary numbers was compensating
                    for StrongsTooltip's Radix trigger span inheriting the surrounding verse
                    text's normal line-height instead of collapsing to this chip's actual size —
                    now that the trigger itself has leading-none (StrongsTooltip.tsx), the gap
                    it was correcting for is gone, and the negative margin would just overlap
                    the two numbers instead. */}
                <span
                  data-strongs-chip
                  className={`text-[9px] text-[rgb(var(--color-accent))] font-mono leading-none hover:opacity-100 transition-opacity cursor-pointer ${i > 0 ? 'opacity-35' : 'opacity-60'}`}
                >
                  {num}
                </span>
              </StrongsTooltip>
            ))}
          </>
        ) : (
          // Height placeholder — keeps word rows aligned regardless of whether they have a number
          <span className="text-[9px] leading-none opacity-0 select-none" aria-hidden>·</span>
        )}
      </span>
    )
  }

  // Fallback (no text_tagged data): word with Strong's → stacked chip
  const primaryNum = nums[0] ?? null
  if (primaryNum) {
    const wContent = wordSegments
      ? wordSegments.map((seg, si) => (
          <span key={si} style={seg.bg ? { backgroundColor: seg.bg, borderRadius: '2px' } : undefined}>{seg.text}</span>
        ))
      : wordNode
    return (
      <span className="inline-flex flex-col items-start mr-1 gap-0">
        <span className="leading-none">{wContent}</span>
        <StrongsTooltip strongsNum={primaryNum} onClickEntry={onStrongsClick}>
          <span data-strongs-chip className="text-[10px] text-[rgb(var(--color-accent))] font-mono opacity-70 leading-none hover:opacity-100 transition-opacity cursor-pointer">
            {primaryNum}
          </span>
        </StrongsTooltip>
      </span>
    )
  }

  // Fallback: italic word with no tagging
  if (isItalic) {
    const wContent = wordSegments
      ? wordSegments.map((seg, si) => (
          <span key={si} style={seg.bg ? { backgroundColor: seg.bg, borderRadius: '2px' } : undefined}>{seg.text}</span>
        ))
      : word
    return <span className="mr-[0.25em] italic opacity-70">{wContent}</span>
  }

  // Fallback: plain word — clickable to search the lexicon
  const wContent = wordSegments
    ? wordSegments.map((seg, si) => (
        <span key={si} style={seg.bg ? { backgroundColor: seg.bg, borderRadius: '2px' } : undefined}>{seg.text}</span>
      ))
    : wordNode
  return (
    <span
      className="mr-[0.25em] cursor-pointer border-b border-dashed border-[rgb(var(--color-text-muted))] hover:border-[rgb(var(--color-accent))] hover:text-[rgb(var(--color-accent))] transition-colors"
      onClick={() => onWordClick?.(word.replace(/[^a-zA-Z]/g, '').toLowerCase())}
      title="Click to search Strong's lexicon"
    >
      {wContent}
    </span>
  )
}
