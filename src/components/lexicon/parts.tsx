import type { ReactNode } from 'react'
import { RefChip, SectionHeader, ListRow, cx } from '@/components/ui'

/**
 * Shared lexicon-entry building blocks — used by BibleRightPanel's side-panel lexicon
 * (SidebarLexicon) today, and by lexicon/LexiconPanel.tsx eventually, so the two stop
 * re-implementing the same header/row with a different recipe for every element
 * (see docs/design-system.md audit: "the two don't read as one feature").
 */

/** Hebrew/Greek language pill next to a Strong's number. */
export function LangBadge({ num, className }: { num: string; className?: string }) {
  const isHebrew = num.toUpperCase().startsWith('H')
  return (
    <span className={cx(
      'text-caption2 font-semibold px-1.5 py-0.5 rounded-control leading-none',
      isHebrew ? 'bg-warning/20 text-warning' : 'bg-info/20 text-info',
      className,
    )}>
      {isHebrew ? 'Hebrew' : 'Greek'}
    </span>
  )
}

/** Entry header: Strong's number chip + language pill + lemma, with a trailing actions slot. */
export function LexiconEntryHeader({
  strongsNum, lemma, actions, className,
}: { strongsNum: string; lemma?: string | null; actions?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center gap-1.5 min-w-0', className)}>
      <RefChip variant="lexicon">{strongsNum}</RefChip>
      <LangBadge num={strongsNum} />
      {lemma && <span className="text-body font-medium text-text-primary font-lemma truncate" dir="rtl">{lemma}</span>}
      {actions && <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">{actions}</div>}
    </div>
  )
}

/** Section label for lexicon groups (Definition, Derivation, Occurrences…) — SectionHeader alias. */
export const LexiconSectionLabel = SectionHeader

/** One verse occurrence: ref chip leading, verse text as the row title. */
export function OccurrenceRow({
  refLabel, text, onClick, onContextMenu, dense = true, className,
}: {
  refLabel: ReactNode
  text: ReactNode
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  dense?: boolean
  className?: string
}) {
  return (
    <ListRow
      leading={<RefChip size="xs">{refLabel}</RefChip>}
      title={text}
      onClick={onClick}
      onContextMenu={onContextMenu}
      dense={dense}
      className={className}
    />
  )
}

/** One derived/related term: number chip leading, lemma + transliteration as title, gloss as subtitle. */
export function DerivedTermRow({
  strongsNum, lemma, transliteration, gloss, onClick, dense = true, selected, className,
}: {
  strongsNum: string
  lemma?: string | null
  transliteration?: string | null
  gloss?: string | null
  onClick?: (e: React.MouseEvent) => void
  dense?: boolean
  selected?: boolean
  className?: string
}) {
  return (
    <ListRow
      selected={selected}
      leading={<RefChip size="xs">{strongsNum}</RefChip>}
      title={<>
        {lemma && <span className="font-lemma" dir="rtl">{lemma}</span>}
        {lemma && transliteration && ' '}
        {transliteration && <span className="italic text-text-muted">{transliteration}</span>}
      </>}
      subtitle={gloss}
      onClick={onClick}
      dense={dense}
      className={className}
    />
  )
}
