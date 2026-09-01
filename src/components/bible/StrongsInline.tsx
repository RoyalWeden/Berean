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
  /** Word index within the verse — lets VerseRow's spacing-measure pass address this word. */
  swIdx?: number
  /** Measured extra right-margin (px) so this word's centered number pill clears the next. */
  extraGap?: number
  /** Identifies the contiguous run of words that share this exact Strong's number occurrence
   *  (a "phrase") — hovering any of them highlights the whole run. */
  phraseKey?: string
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
  swIdx,
  extraGap,
  phraseKey,
}: StrongsInlineProps) {
  const nums = Array.isArray(strongsNum) ? strongsNum : (strongsNum ? [strongsNum] : [])
  const wordNode = findQuery.trim() ? applyFindHighlight(word, findQuery, findWordMode) : word

  // Strong's number "chips" are rendered ABSOLUTELY POSITIONED in the leading gap under each
  // word (position:relative on the inline word wrapper; the chip stack is `top:100%`, nudged up
  // with a negative marginTop). They contribute ZERO layout, so toggling Strong's on/off never
  // reflows the verse text — the words stay exactly where they are while the numbers slide out
  // from under them (see .strongs-chip-abs in global.css). Line spacing is the only thing that
  // then changes, animated separately by VerseRow.
  // Chip stack: absolutely positioned, CENTERED under its word (translateX(-50%)) so the
  // pairing reads at a glance. Zero layout contribution.
  const CHIP_STACK = 'strongs-chip-abs absolute flex flex-col items-center'
  const CHIP_STACK_STYLE: CSSProperties = { top: '100%', left: '50%', transform: 'translateX(-50%)', marginTop: '-0.06em', lineHeight: 1, gap: '4px' }
  // Clearly-a-pill: translucent accent fill + faint accent border, fully rounded, real padding.
  // Dim at rest. All brightening/highlighting is driven by ChapterView's delegated hover
  // handler adding classes (.strongs-echo on every matching chip chapter-wide, .strongs-phrase-hl
  // on every word of the hovered number's contiguous phrase) — no CSS group hover, so it works
  // for multi-word phrases and cross-verse matches, not just one word.
  const CHIP_BASE = 'strongs-chip inline-flex items-center font-mono leading-none rounded-full border px-[5px] py-[1.5px] whitespace-nowrap transition-[opacity,background-color,box-shadow] duration-150 cursor-pointer'
  const CHIP_ACCENT = 'text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent)/0.15)] border-[rgb(var(--color-accent)/0.25)]'
  const chipPrimary = `${CHIP_BASE} text-[8.5px] ${CHIP_ACCENT} opacity-40`
  const chipSecondary = `${CHIP_BASE} text-[8.5px] ${CHIP_ACCENT} opacity-25`
  // Grammatical particles: dimmer still, muted colour.
  const chipParen = `${CHIP_BASE} text-[9px] text-[rgb(var(--color-text-muted))] bg-[rgb(var(--color-surface-4)/0.6)] border-[rgb(var(--color-surface-4))] opacity-30`
  // The word text — `.strongs-word` is the target the phrase-highlight class paints behind.
  const WORD_LINK = 'strongs-word rounded-[3px] transition-colors duration-150 px-[2px] -mx-[2px]'
  // Very short adjacent words ("of the", "and") would otherwise sit with their (centered) chips
  // overlapping — give just those a hair of extra trailing space. Only present while Strong's is
  // on (this component only renders then), and only on genuinely tiny words, so it's barely
  // perceptible and doesn't touch normal reading.
  // Extra trailing space comes from VerseRow's measured pass (extraGap, px) — applied only to
  // the specific words where a real overlap was detected, and cached per verse (strongsSpacing).
  const gapStyle: CSSProperties | undefined = extraGap ? { marginRight: `${extraGap}px` } : undefined

  if (tagged) {
    // Parenthetical token: grammatical particle, no corresponding English word — an invisible
    // word-width anchor carries the absolute chip.
    if (isParenthetical && nums.length > 0) {
      return (
        <span className="relative strongs-wordwrap transition-colors duration-150" data-sw-idx={swIdx} data-phrase-key={phraseKey} data-strongs-num={nums[0]}>
          <span className="opacity-0 select-none" aria-hidden>·</span>
          <span data-strongs-chip-abs className={CHIP_STACK} style={CHIP_STACK_STYLE}>
            <StrongsTooltip
              strongsNum={nums[0]}
              onClickEntry={onStrongsClick}
              contextNote="Parenthetical — grammatical particle with no corresponding English word (e.g. H853 = את, the Hebrew direct object marker)."
            >
              <span data-strongs-chip data-strongs-num={nums[0]} className={chipParen}>
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
      <span className="relative strongs-wordwrap" data-sw-idx={swIdx} data-phrase-key={phraseKey} data-strongs-num={nums[0]} style={gapStyle}>
        <span className={`${wordCls} ${WORD_LINK}`.trim()}>{wordContent}</span>
        <span data-strongs-chip-abs className={CHIP_STACK} style={CHIP_STACK_STYLE}>
          {nums.map((num, i) => (
            <StrongsTooltip
              key={i}
              strongsNum={num}
              onClickEntry={onStrongsClick}
              contextNote={i > 0 ? "Secondary Strong's number" : undefined}
            >
              <span data-strongs-chip data-strongs-num={num} className={i > 0 ? chipSecondary : chipPrimary}>
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
      <span className="relative strongs-wordwrap" data-sw-idx={swIdx} data-phrase-key={phraseKey} data-strongs-num={primaryNum} style={gapStyle}>
        <span className={WORD_LINK}>{wContent}</span>
        <span data-strongs-chip-abs className={CHIP_STACK} style={CHIP_STACK_STYLE}>
          <StrongsTooltip strongsNum={primaryNum} onClickEntry={onStrongsClick}>
            <span data-strongs-chip data-strongs-num={primaryNum} className={chipPrimary}>
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
