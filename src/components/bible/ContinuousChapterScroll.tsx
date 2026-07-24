import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import ChapterView from './ChapterView'
import { bookName } from '@/lib/parseRef'

interface ContinuousChapterScrollProps {
  bookId: string
  chapter: number
  totalChapters: number
  showStrongs: boolean
  textId: string
  targetVerse?: number
  endVerse?: number
  hiddenAnnotations?: string[]
  findQuery?: string
  findWordMode?: 'phrase' | 'all' | 'any'
  onStrongsClick?: (num: string) => void
  onWordClick?: (word: string) => void
  onChapterChange: (chapter: number) => void
  onVersesLoaded?: () => void
  /** Fired once ChapterView has scrolled to `targetVerse`, so the parent can clear it —
   * mirrors ChapterView's own onTargetVerseConsumed. Without this, targetVerse never
   * clears in continuous-scroll mode: re-searching the same verse is a no-op (prop
   * value unchanged, effect never re-fires) and stale targetVerse can trigger an
   * unwanted scroll once the user navigates to a different chapter. */
  onTargetVerseConsumed?: () => void
  /** Flash-highlight cue after a Strong's toggle/KJV-LXX switch reflow — see ChapterView's
   *  own flashAnchor prop for what this is (independent of targetVerse/history). */
  flashAnchor?: { verse: number; nonce: number } | null
  onScroll?: (e: React.UIEvent<HTMLDivElement>) => void
  presenterBand?: { top: number; height: number } | null
  viewerPaused?: boolean
}

export interface ContinuousChapterScrollHandle {
  scrollToChapter: (ch: number, verse?: number) => void
  getScrollEl: () => HTMLDivElement | null
}

const LOAD_AHEAD = 1  // chapters to load ahead/behind beyond what's visible
// Chapters kept mounted on each side of the currently-most-visible chapter before eviction
// kicks in. Must stay greater than LOAD_AHEAD — otherwise a just-prefetched chapter would sit
// right at (or outside) the eviction boundary and get unmounted again before the visibility
// observer catches up, undoing the prefetch on the very next scroll tick.
const WINDOW_CHAPTERS = 2

export default forwardRef<ContinuousChapterScrollHandle, ContinuousChapterScrollProps>(
  function ContinuousChapterScroll(
    {
      bookId, chapter, totalChapters, showStrongs, textId,
      targetVerse, endVerse, hiddenAnnotations, findQuery, findWordMode = 'phrase',
      onStrongsClick, onWordClick, onChapterChange, onVersesLoaded, onTargetVerseConsumed, flashAnchor,
      onScroll, presenterBand, viewerPaused,
    },
    ref,
  ) {
    // Range of chapters currently rendered (contiguous)
    const [firstCh, setFirstCh] = useState(chapter)
    const [lastCh, setLastCh] = useState(chapter)
    // Chapter that is "most visible" (the one the header bar reflects)
    const [visibleCh, setVisibleCh] = useState(chapter)
    const scrollRef = useRef<HTMLDivElement>(null)
    const headingRefs = useRef<Map<number, HTMLDivElement>>(new Map())
    const initialScrollDoneRef = useRef(false)
    // Track whether we're in the middle of a programmatic chapter jump (suppresses chapter-change from observer)
    const programmaticScrollRef = useRef(false)
    const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Set to true just before calling onChapterChange so the resulting prop-update
    // (tabState.chapter ← ch) doesn't re-trigger the reset effect below.
    const ownChapterUpdateRef = useRef(false)

    // Reset only when the book changes or when the chapter was set by an external navigation
    // (reference bar, open-in-tab, etc.). Skips when the change was triggered by our own
    // IntersectionObserver callback flowing back through the parent's state.
    useEffect(() => {
      if (ownChapterUpdateRef.current) {
        ownChapterUpdateRef.current = false
        return
      }
      setFirstCh(chapter)
      setLastCh(chapter)
      setVisibleCh(chapter)
      initialScrollDoneRef.current = false
    }, [bookId, chapter])

    // IntersectionObserver: track which chapter heading is most in-view
    useEffect(() => {
      const container = scrollRef.current
      if (!container) return

      const entries = new Map<number, IntersectionObserverEntry>()
      const io = new IntersectionObserver(
        (observed) => {
          for (const e of observed) {
            const ch = Number((e.target as HTMLElement).dataset.chapter)
            if (ch) entries.set(ch, e)
          }
          if (programmaticScrollRef.current) return

          // Find the chapter whose heading has the highest intersectionRatio
          // (or, among fully-intersecting ones, the one with the smallest top)
          let best: number | null = null
          let bestRatio = -1
          let bestTop = Infinity
          entries.forEach((e, ch) => {
            if (e.isIntersecting) {
              const r = e.intersectionRatio
              const top = e.boundingClientRect.top
              if (r > bestRatio || (r === bestRatio && top < bestTop)) {
                best = ch
                bestRatio = r
                bestTop = top
              }
            }
          })

          // Fall back to the chapter whose heading is closest above the viewport top
          if (best === null) {
            let closestBelow = Infinity
            entries.forEach((e, ch) => {
              const top = e.boundingClientRect.top
              const dist = Math.abs(top)
              if (top <= 60 && dist < closestBelow) {
                closestBelow = dist
                best = ch
              }
            })
          }

          if (best !== null && best !== visibleCh) {
            ownChapterUpdateRef.current = true
            setVisibleCh(best)
            onChapterChange(best)
          }
        },
        { root: container, threshold: [0, 0.1, 0.5, 1.0], rootMargin: '0px 0px -80% 0px' },
      )

      headingRefs.current.forEach((el) => { if (el) io.observe(el) })

      return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [firstCh, lastCh, onChapterChange])

    // Load next/prev chapters when bottom/top sentinels are visible
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(e)
      const el = e.currentTarget
      const { scrollTop, scrollHeight, clientHeight } = el
      // Near bottom → load next chapter
      if (scrollHeight - scrollTop - clientHeight < clientHeight * 0.5) {
        setLastCh((prev) => Math.min(prev + LOAD_AHEAD, totalChapters))
      }
      // Near top → load previous chapter
      if (scrollTop < clientHeight * 0.3) {
        setFirstCh((prev) => Math.max(prev - LOAD_AHEAD, 1))
      }
      // Evict chapters that have scrolled far outside the window around visibleCh — without
      // this, firstCh/lastCh only ever grow and every chapter ever visited stays mounted as
      // full non-virtualized DOM for the life of the tab. Skipped during a programmatic jump
      // (scrollToChapter): visibleCh hasn't caught up to the new position yet (its observer
      // updates are suppressed for the duration), so evicting against the stale value here
      // would unmount the chapter we just jumped to.
      if (!programmaticScrollRef.current) {
        setFirstCh((prev) => {
          const minAllowed = Math.min(Math.max(1, visibleCh - WINDOW_CHAPTERS), lastCh)
          return minAllowed > prev ? minAllowed : prev
        })
        setLastCh((prev) => {
          const maxAllowed = Math.max(Math.min(totalChapters, visibleCh + WINDOW_CHAPTERS), firstCh)
          return maxAllowed < prev ? maxAllowed : prev
        })
      }
    }, [onScroll, totalChapters, visibleCh, firstCh, lastCh])

    // Public API: scroll a specific chapter's heading into view
    const scrollToChapter = useCallback((ch: number, verse?: number) => {
      setFirstCh((f) => Math.min(f, ch))
      setLastCh((l) => Math.max(l, ch))
      programmaticScrollRef.current = true
      if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current)
      programmaticScrollTimerRef.current = setTimeout(() => {
        programmaticScrollRef.current = false
      }, 800)

      // Wait a tick for React to render the new chapter if it was just added
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (verse) {
            const el = scrollRef.current?.querySelector(`[data-verse="${verse}"]`) as HTMLElement | null
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return }
          }
          const heading = headingRefs.current.get(ch)
          if (heading) {
            heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        })
      })
    }, [])

    useImperativeHandle(ref, () => ({
      scrollToChapter,
      getScrollEl: () => scrollRef.current,
    }), [scrollToChapter])

    const chapters = Array.from({ length: lastCh - firstCh + 1 }, (_, i) => firstCh + i)

    return (
      <div ref={scrollRef} className="flex-1 overflow-y-auto relative" onScroll={handleScroll}>
        {/* Presenter visible-region band */}
        {presenterBand && (
          <div
            className="absolute left-0 right-0 pointer-events-none z-[5]"
            style={{
              top: presenterBand.top,
              height: presenterBand.height,
              border: `2px solid ${viewerPaused ? 'rgba(251,191,36,0.85)' : 'rgb(var(--color-accent))'}`,
              background: viewerPaused ? 'rgba(251,191,36,0.07)' : 'rgb(var(--color-accent) / 0.06)',
              borderRadius: 6,
            }}
          >
            <span
              className="absolute top-0.5 right-1 px-1.5 text-[9px] font-bold uppercase tracking-wide rounded"
              style={{
                color: '#fff',
                background: viewerPaused ? 'rgba(251,191,36,0.95)' : 'rgb(var(--color-accent))',
              }}
            >
              {viewerPaused ? 'Presenter (paused)' : 'On presenter'}
            </span>
          </div>
        )}

        {chapters.map((ch) => (
          <div key={`${bookId}-${ch}`}>
            {/* Chapter heading divider */}
            <div
              ref={(el) => {
                if (el) headingRefs.current.set(ch, el)
                else headingRefs.current.delete(ch)
              }}
              data-chapter={ch}
              className="sticky top-0 z-10 px-8 py-2 bg-[rgb(var(--color-surface-2))] border-b border-[rgb(var(--color-surface-4))] flex items-center gap-2"
            >
              <span className="text-xs font-semibold text-[rgb(var(--color-text-muted))] uppercase tracking-wider select-none">
                {bookName(bookId)} {ch}
              </span>
            </div>

            <ChapterView
              bookId={bookId}
              chapter={ch}
              showStrongs={showStrongs}
              textId={textId}
              targetVerse={ch === chapter ? targetVerse : undefined}
              endVerse={ch === chapter ? endVerse : undefined}
              hiddenAnnotations={hiddenAnnotations}
              findQuery={findQuery}
              findWordMode={findWordMode}
              onStrongsClick={onStrongsClick}
              onWordClick={onWordClick}
              onVersesLoaded={ch === chapter ? onVersesLoaded : undefined}
              onTargetVerseConsumed={ch === chapter ? onTargetVerseConsumed : undefined}
              flashAnchor={ch === chapter ? flashAnchor : undefined}
            />
          </div>
        ))}

        {/* Bottom sentinel — ensures there's enough room to scroll */}
        <div className="h-16" />
      </div>
    )
  }
)
