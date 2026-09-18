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
      {/* Plain text, not a tinted RefChip — this is the entry's own identity (like a document
          title), not a scannable cross-reference among many; a small colored pill read as
          "highlighted" rather than as the heading it is. */}
      <span className="text-subhead font-mono font-semibold text-text-primary flex-shrink-0">{strongsNum}</span>
      <LangBadge num={strongsNum} />
      {lemma && <span className="text-body font-medium text-text-primary font-lemma truncate" dir="rtl">{lemma}</span>}
      {actions && <div className="ml-auto flex items-center gap-0.5 flex-shrink-0">{actions}</div>}
    </div>
  )
}

/** Section label for lexicon groups (Definition, Derivation, Occurrences…) — SectionHeader alias. */
export const LexiconSectionLabel = SectionHeader

/** One verse occurrence: ref chip + badges on their own line, verse text wrapped to up to 3
 *  lines below (a real <button>, not a fixed-height ListRow — a verse quote needs room to
 *  breathe, not a single truncated line). Ref and text share the app's system font (`RefChip
 *  mono={false}`) so the row reads as one paragraph rather than a code-like tag next to prose. */
export function OccurrenceRow({
  refLabel, badges, text, onClick, onContextMenu, className,
}: {
  refLabel: ReactNode
  /** Small neutral badges shown beside the ref chip (LXX source, match count…). */
  badges?: ReactNode
  text: ReactNode
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cx(
        'focus-ring w-full text-left flex flex-col gap-1 rounded-card px-2.5 py-2 cursor-pointer',
        'hover:bg-lift-2 active:bg-lift-3 transition-colors duration-fast',
        className,
      )}
    >
      <span className="flex items-center gap-1 flex-wrap">
        <RefChip size="xs" mono={false}>{refLabel}</RefChip>
        {badges}
      </span>
      <span className="block text-footnote text-text-secondary leading-relaxed line-clamp-3">{text}</span>
    </button>
  )
}

/** One derived/related term: number chip leading, lemma + transliteration as title, gloss as subtitle. */
export function DerivedTermRow({
  strongsNum, lemma, transliteration, gloss, onClick, onContextMenu, dense = true, selected, className,
}: {
  strongsNum: string
  lemma?: string | null
  transliteration?: string | null
  gloss?: string | null
  onClick?: (e: React.MouseEvent) => void
  onContextMenu?: (e: React.MouseEvent) => void
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
      onContextMenu={onContextMenu}
      dense={dense}
      className={className}
    />
  )
}
