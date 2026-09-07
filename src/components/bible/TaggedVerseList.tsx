import { ChevronRight, Tag as TagIcon } from 'lucide-react'
import { resolveTagColor } from '@/lib/tagPalette'
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
 * the search view's "±N verses" context mode (mono verse number, `text-[13px] leading-relaxed`).
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
            className={`${mx} rounded-lg border border-[rgb(var(--color-surface-4))] bg-[rgb(var(--color-surface-2))] overflow-hidden group`}
          >
            <button
              onClick={() => first && onNavigate(first.bookId, first.chapter, first.verse)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[rgb(var(--color-surface-3))] transition-colors cursor-pointer"
            >
              <span className="text-[10.5px] font-mono font-semibold text-[rgb(var(--color-accent))] bg-[rgb(var(--color-accent))]/10 rounded-md px-2 py-1 flex-shrink-0">
                {g.label}
              </span>
              {g.tagName && (
                <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-secondary))]">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: resolveTagColor(g.tagColor ?? undefined) }} />
                  {g.tagName}
                </span>
              )}
              {g.kind === 'chapter' && (
                <span className="inline-flex items-center gap-1 text-[10px] text-[rgb(var(--color-text-muted))]">
                  <TagIcon size={9} /> whole chapter
                </span>
              )}
              <ChevronRight size={13} className="ml-auto flex-shrink-0 text-[rgb(var(--color-text-muted))] opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>

            <div className="px-3 pb-2 pt-0.5 flex flex-col gap-0.5">
              {g.rows.map((v) => (
                <button
                  key={`${v.bookId}.${v.chapter}.${v.verse}`}
                  onClick={() => onNavigate(v.bookId, v.chapter, v.verse)}
                  onContextMenu={(e) => ctx.open(e, { bookId: v.bookId, chapter: v.chapter, verse: v.verse, text: v.text })}
                  className="w-full text-left flex gap-2 rounded px-1 -mx-1 py-0.5 hover:bg-[rgb(var(--color-surface-4))/50] transition-colors cursor-pointer"
                >
                  <span className="font-mono text-[10px] text-[rgb(var(--color-text-muted))] flex-shrink-0 pt-1 w-6 text-right opacity-70">{v.verse}</span>
                  <span className="flex-1 text-[13px] leading-relaxed text-[rgb(var(--color-text-primary))]">{v.text || '…'}</span>
                </button>
              ))}
              {g.truncatedNote && (
                <p className="text-[10px] text-[rgb(var(--color-text-muted))] pl-7 pt-0.5">…open the chapter to read the rest</p>
              )}
            </div>
          </div>
        )
      })}
      <VerseCopyMenu target={ctx.target} onClose={ctx.close} />
    </div>
  )
}
