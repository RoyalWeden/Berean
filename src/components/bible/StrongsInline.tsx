import { memo, type CSSProperties } from 'react'
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

function StrongsInline({
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

  // Strong's number "chips" are rendered ABSOLUTELY POSITIONED in the leading gap under each
  // word (position:relative on the inline word wrapper; the chip stack is `top:100%`, nudged up
  // with a negative marginTop). They contribute ZERO layout, so toggling Strong's on/off never
  // reflows the verse text — the words stay exactly where they are while the numbers slide out
  // from under them (see .strongs-chip-abs in global.css). Line spacing is the only thing that
  // then changes, animated separately by VerseRow.
  const CHIP_STACK = 'strongs-chip-abs absolute left-0 flex flex-col items-start'
  // marginTop nudged from -0.32em toward the baseline so the numbers sit a touch lower —
  // clear of the verse word directly above them.
  const CHIP_STACK_STYLE: CSSProperties = { top: '100%', marginTop: '-0.12em', lineHeight: 1, gap: '2px' }
  // Translucent pill so a Strong's number reads as its own distinct element, not stray text.
  const CHIP_BASE = 'font-mono leading-none rounded-[3px] px-1 py-px transition-colors cursor-pointer'
  const chipPrimary = `${CHIP_BASE} text-[9px] text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/12 hover:bg-[rgb(var(--color-accent))]/22`
  const chipSecondary = `${CHIP_BASE} text-[9px] text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/12 hover:bg-[rgb(var(--color-accent))]/22 opacity-55`
  const chipParen = `${CHIP_BASE} text-[10px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4))]/60 hover:bg-[rgb(var(--color-surface-4))]/90`

  if (tagged) {
    // Parenthetical token: grammatical particle, no corresponding English word — an invisible
    // word-width anchor carries the absolute chip.
    if (isParenthetical && nums.length > 0) {
      return (
        <span className="relative">
          <span className="opacity-0 select-none" aria-hidden>·</span>
          <span data-strongs-chip-abs className={CHIP_STACK} style={CHIP_STACK_STYLE}>
            <StrongsTooltip
              strongsNum={nums[0]}
              onClickEntry={onStrongsClick}
              contextNote="Parenthetical — grammatical particle with no corresponding English word (e.g. H853 = את, the Hebrew direct object marker)."
            >
              <span data-strongs-chip className={chipParen}>
                ({nums[0]})
              </span>
            </StrongsTooltip>
          </span>
        </span>
      )
    }

    const wordContent = wordSegments
      ? wordSegments.map((seg, si) => (
          <span key={si} className="transition-colors duration-150 ease-out" style={{ backgroundColor: seg.bg ?? 'transparent', borderRadius: '2px' }}>{seg.text}</span>
        ))
      : wordNode
    const wordCls = `${isItalic ? 'italic opacity-70' : ''}${isRedLetter ? ` ${RED_LETTER_CLASS}` : ''}`.trim()

    // No number on this word — just the plain inline word, no wrapper needed.
    if (nums.length === 0) {
      return wordCls ? <span className={wordCls}>{wordContent}</span> : <>{wordContent}</>
    }

    return (
      <span className="relative">
        <span className={wordCls}>{wordContent}</span>
        <span data-strongs-chip-abs className={CHIP_STACK} style={CHIP_STACK_STYLE}>
          {nums.map((num, i) => (
            <StrongsTooltip
              key={i}
              strongsNum={num}
              onClickEntry={onStrongsClick}
              contextNote={i > 0 ? "Secondary Strong's number" : undefined}
            >
              <span data-strongs-chip className={i > 0 ? chipSecondary : chipPrimary}>
                {num}
              </span>
            </StrongsTooltip>
          ))}
        </span>
      </span>
    )
  }

  // Fallback (no text_tagged data): word with Strong's → absolute chip under it
  const primaryNum = nums[0] ?? null
  if (primaryNum) {
    const wContent = wordSegments
      ? wordSegments.map((seg, si) => (
          <span key={si} className="transition-colors duration-150 ease-out" style={{ backgroundColor: seg.bg ?? 'transparent', borderRadius: '2px' }}>{seg.text}</span>
        ))
      : wordNode
    return (
      <span className="relative">
        <span>{wContent}</span>
        <span data-strongs-chip-abs className={CHIP_STACK} style={CHIP_STACK_STYLE}>
          <StrongsTooltip strongsNum={primaryNum} onClickEntry={onStrongsClick}>
            <span data-strongs-chip className={chipPrimary}>
              {primaryNum}
            </span>
          </StrongsTooltip>
        </span>
      </span>
    )
  }

  // Fallback: italic word with no tagging
  if (isItalic) {
    const wContent = wordSegments
      ? wordSegments.map((seg, si) => (
          <span key={si} className="transition-colors duration-150 ease-out" style={{ backgroundColor: seg.bg ?? 'transparent', borderRadius: '2px' }}>{seg.text}</span>
        ))
      : word
    return <span className="mr-[0.25em] italic opacity-70">{wContent}</span>
  }

  // Fallback: plain word — clickable to search the lexicon
  const wContent = wordSegments
    ? wordSegments.map((seg, si) => (
        <span key={si} className="transition-colors duration-150 ease-out" style={{ backgroundColor: seg.bg ?? 'transparent', borderRadius: '2px' }}>{seg.text}</span>
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

// Instantiated once per word for every Strong's-tagged verse — memo keeps a full chapter's
// worth of these from re-rendering when only a sibling word's highlight/find state changes.
export default memo(StrongsInline)
