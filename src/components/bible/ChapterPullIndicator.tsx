import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { bookName } from '@/lib/parseRef'
import type { Verse } from '@/types'
import { CHAPTER_PULL, type ChapterPullState } from './useChapterPullNav'

type Ref = { bookId: string; chapter: number } | null

/**
 * Feedback for the rubber-band chapter navigation (see useChapterPullNav). Render it inside a
 * `position: relative` wrapper around the paged scripture scroll container: it fills the gap the
 * pull opens, so it never overlaps live text.
 *
 * Pulling UP previews the END of the previous chapter and pulling DOWN previews the START of the
 * next, matching where the reader actually lands.
 */
export default function ChapterPullIndicator({
  state, prevRef, nextRef, textId,
}: {
  state: ChapterPullState
  prevRef: Ref
  nextRef: Ref
  textId: string
}) {
  const isPrev = state.dir === 'prev'
  const isNext = state.dir === 'next'
  const targetRef = isPrev ? prevRef : isNext ? nextRef : null

  const [preview, setPreview] = useState<{ key: string; verses: Verse[] } | null>(null)
  useEffect(() => {
    if (!targetRef) return
    const key = `${targetRef.bookId}:${targetRef.chapter}:${textId}`
    if (preview?.key === key) return
    let cancelled = false
    window.bible.queryChapter(targetRef.bookId, targetRef.chapter, textId)
      .then((verses: Verse[]) => { if (!cancelled) setPreview({ key, verses }) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [targetRef?.bookId, targetRef?.chapter, textId]) // eslint-disable-line react-hooks/exhaustive-deps

  // The content stretches from the first pixel, but the banner waits until the pull is clearly
  // intentional — so a stray nudge past the end doesn't flash UI at the reader.
  if (!state.dir || !targetRef) return null
  // A gesture that began mid-chapter still rubber-bands, but it can't turn the page — showing a
  // "keep pulling" banner for something that will never happen would be a lie.
  if (!state.canCommit) return null
  if (state.offset < CHAPTER_PULL.INDICATOR_AT && !state.committing) return null

  const label = `${bookName(targetRef.bookId)} ${targetRef.chapter}`
  const ready = state.progress >= 1 || state.committing
  // Fade in across the first stretch past INDICATOR_AT — and back out again as the band relaxes,
  // since this is driven straight off the live offset rather than mounting/unmounting.
  const fade = state.committing
    ? 1
    : Math.max(0, Math.min(1, (state.offset - CHAPTER_PULL.INDICATOR_AT) / CHAPTER_PULL.INDICATOR_FADE))
  const textOpacity = 0.25 + 0.75 * state.progress

  const previewVerses = preview?.verses ?? []
  const shown = isPrev ? previewVerses.slice(-6) : previewVerses.slice(0, 6)

  const banner = (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs"
      style={{
        background: ready ? 'rgb(var(--color-accent) / 0.16)' : 'rgb(var(--color-surface-2) / 0.92)',
        borderBottom: isPrev ? undefined : '1px solid rgb(var(--color-surface-4))',
        borderTop: isPrev ? '1px solid rgb(var(--color-surface-4))' : undefined,
      }}
    >
      {isPrev ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
      <span
        className="font-semibold"
        style={{ color: ready ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-secondary))' }}
      >
        {label}
      </span>
      <span className="text-[rgb(var(--color-text-muted))]">
        {state.committing ? 'opening…' : ready ? 'let go to open' : 'keep pulling'}
      </span>
      <span className="ml-auto h-1 w-24 overflow-hidden rounded-full" style={{ background: 'rgb(var(--color-surface-4))' }}>
        <span
          className="block h-full rounded-full"
          style={{
            width: `${Math.round(state.progress * 100)}%`,
            background: ready ? 'rgb(var(--color-accent))' : 'rgb(var(--color-text-muted))',
          }}
        />
      </span>
    </div>
  )

  const previewBlock = (
    <div
      className="flex-1 overflow-hidden px-4 text-[0.9em] leading-relaxed"
      style={{
        color: 'rgb(var(--color-text-primary))',
        opacity: textOpacity,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: isPrev ? 'flex-end' : 'flex-start',
        maskImage: isPrev
          ? 'linear-gradient(to top, #000 40%, transparent)'
          : 'linear-gradient(to bottom, #000 40%, transparent)',
      }}
    >
      {shown.map((v) => (
        <span key={v.verse_num}>
          <sup className="mr-0.5 text-[0.7em] text-[rgb(var(--color-text-muted))]">{v.verse_num}</sup>
          {v.text}{' '}
        </span>
      ))}
    </div>
  )

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30 flex flex-col overflow-hidden"
      style={{
        [isPrev ? 'top' : 'bottom']: 0,
        height: state.offset,
        opacity: fade,
        background: 'rgb(var(--color-surface-3))',
      }}
    >
      {isPrev ? <>{previewBlock}{banner}</> : <>{banner}{previewBlock}</>}
    </div>
  )
}
