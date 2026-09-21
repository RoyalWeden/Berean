import { ChevronRight, Tag as TagIcon } from 'lucide-react'
import { resolveTagColor } from '@/lib/tagPalette'
import { Badge, ListRow, RefChip } from '@/components/ui'
import { VerseCopyMenu, useVerseCopyMenu } from './VerseCopyMenu'

export interface TaggedVerseRow {
  bookId: string
  chapter: number
  verse: number
  text: string
}

export interface TaggedVerseGroup {
  key: string
  /** Full human reference, e.g. "Deuteronomy 32:3-4,6". */
  label: string
  tagName?: string
  /** Tag colour source — pass the tag ({ color, colorSlot }) or leave undefined for no chip. */
  tagColor?: { color?: string | null; colorSlot?: number | null } | null
  kind?: 'verses' | 'chapter'
  rows: TaggedVerseRow[]
  /** Show a "…open the chapter to read the rest" note (whole-chapter members). */
  truncatedNote?: boolean
}

/**
 * Renders tagged-verse groups with the SAME visual language as an Advanced Scripture Search
 * result group: a bordered card whose header carries the full reference (the role the
 * `chapter:verse` pill plays for a single result), and whose body stacks each verse exactly like
 * the search view's "±N verses" context mode (mono verse number, `text-subhead leading-relaxed`).
 * Used by the Tag graph inspector and by Advanced Search's tag-filter listing so the two match.
 */
export default function TaggedVerseList({
  groups, onNavigate, outerMargin = true,
}: {
  groups: TaggedVerseGroup[]
  onNavigate: (bookId: string, chapter: number, verse: number) => void
  /** Search view wants `mx-2` cards; the narrow side panel wants edge-to-edge. */
  outerMargin?: boolean
}) {
  const ctx = useVerseCopyMenu()
  const mx = outerMargin ? 'mx-2' : ''

  return (
    <div className="flex flex-col gap-1.5 py-1">
      {groups.map((g) => {
        const first = g.rows[0]
        return (
          <div
            key={g.key}
            className={`${mx} rounded-card border border-separator bg-surface-2 overflow-hidden`}
          >
            <ListRow
              onClick={() => first && onNavigate(first.bookId, first.chapter, first.verse)}
              leading={<RefChip size="lg" mono={false} className="px-2 py-1">{g.label}</RefChip>}
              title={
                <span className="flex items-center gap-2">
                  {g.tagName && (
                    <span className="inline-flex items-center gap-1 text-caption2 px-1.5 py-0.5 rounded-chip bg-surface-4 text-text-secondary">
                      {/* Status dot (pill taxonomy: rounded-full → Badge dot) — the tag's own
                          arbitrary slot colour overrides Badge's fixed tone palette via style,
                          same technique as the edition dots above. */}
                      <Badge variant="dot" tone="neutral" label={g.tagName} style={{ backgroundColor: resolveTagColor(g.tagColor ?? undefined) }} />
                      {g.tagName}
                    </span>
                  )}
                  {g.kind === 'chapter' && (
                    <span className="inline-flex items-center gap-1 text-caption2 text-text-muted">
                      <TagIcon size={9} /> whole chapter
                    </span>
                  )}
                </span>
              }
              trailing={<ChevronRight size={14} className="text-text-muted" />}
            />

            <div className="px-3 pb-2 pt-0.5 flex flex-col gap-0.5">
              {g.rows.map((v) => (
                <ListRow
                  key={`${v.bookId}.${v.chapter}.${v.verse}`}
                  // Not `dense`: that pins the row to a fixed 28px, and a wrapped verse then
                  // spilled over its neighbours (the ref chip above rendered on top of the text).
                  titleClamp="none"
                  titleSize="subhead"
                  buttonClassName="py-1 items-start"
                  onClick={() => onNavigate(v.bookId, v.chapter, v.verse)}
                  onContextMenu={(e) => ctx.open(e, { bookId: v.bookId, chapter: v.chapter, verse: v.verse, text: v.text })}
                  leading={<span className="font-mono text-caption2 text-text-quaternary w-6 text-right pt-1">{v.verse}</span>}
                  title={<span className="leading-relaxed text-text-primary">{v.text || '…'}</span>}
                />
              ))}
              {g.truncatedNote && (
                <p className="text-caption2 text-text-muted pl-7 pt-0.5">…open the chapter to read the rest</p>
              )}
            </div>
          </div>
        )
      })}
      <VerseCopyMenu target={ctx.target} onClose={ctx.close} />
    </div>
  )
}
