import { useState, useEffect, useLayoutEffect, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import { Tag as TagIcon } from 'lucide-react'
import ChapterView from './ChapterView'
import { bookName } from '@/lib/parseRef'
import { scrollVerseIntoView, VERSE_JUMP_ANIMATED_CENTER, VERSE_JUMP_ANIMATED_START } from '@/lib/scrollToVerse'
import { TagPickPopover } from '@/components/tags/TagPickPopover'
import { chapterRanges, rangesLabel } from '@/lib/verseTagRanges'
import { useAppStore } from '@/store'
import { SectionLabel, ScrollContainer, IconButton } from '@/components/ui'
import { displayChapter } from '@/lib/chapterNumbering'

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
  /** Open with this verse at this offset from the viewport top (a reading-position anchor from
   *  the paged reader or a previous translation) instead of at the chapter heading. Applied once,
   *  instantly, before the first paint of the verses. */
  initialAnchor?: { chapter: number; verse: number; offset: number } | null
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
      onScroll, presenterBand, viewerPaused, initialAnchor,
    },
    ref,
  ) {
    // Range of chapters currently rendered (contiguous)
    const [firstCh, setFirstCh] = useState(chapter)
    const [lastCh, setLastCh] = useState(chapter)
    // Chapter that is "most visible" (the one the header bar reflects)
    const [visibleCh, setVisibleCh] = useState(chapter)
    const scrollRef = useRef<HTMLDivElement>(null)
    // Open "tag this whole chapter" popover, anchored to the heading's tag button.
    const [chapterTagPick, setChapterTagPick] = useState<{ rect: DOMRect; ch: number } | null>(null)
    // Reserve extra bottom scroll room while the floating Read Aloud player is showing, same
    // fix as BiblePanel.tsx's own chapterViewRef container — without it the player's card sits
    // on top of the last verse with no way to scroll past it.
    const audioPlaybackActive = useAppStore((s) => s.audioPlayback != null)
    // Reserve room for the fixed, body-portaled verse selection action bar (see BiblePanel).
    const verseSelectionBarOpen = useAppStore((s) => s.verseSelectionBarOpen)
    const bibleFontSize = useAppStore((s) => s.bibleFontSize)
    const headingRefs = useRef<Map<number, HTMLDivElement>>(new Map())
    // ── Height-preserving placeholders for evicted chapters ──────────────────────────────
    // Chapters outside [firstCh, lastCh] used to be fully absent from the DOM with nothing
    // substituted for the space they occupied (unlike real virtualization libraries, which keep
    // a measured/estimated-height placeholder so scrollHeight doesn't change out from under the
    // user). Removing a chapter's DOM entirely shrinks scrollHeight; if that happens above the
    // visible viewport during fast scrolling, the browser's own scroll-position math can drift
    // (see the "before"/"after" spacer divs in the render below). chapterWrapperRefs measures
    // each currently-mounted chapter's REAL rendered height (captured right before an eviction
    // in handleScroll below) so the placeholders substituted in its place are sized close to
    // reality, not a guess — falling back to the average of whatever's been measured so far for
    // chapters that have never been rendered yet this session.
    const chapterWrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map())
    const heightCacheRef = useRef<Map<number, number>>(new Map())
    const measureMountedChapterHeights = useCallback(() => {
      chapterWrapperRefs.current.forEach((el, ch) => {
        if (el) heightCacheRef.current.set(ch, el.offsetHeight)
      })
    }, [])
    const initialScrollDoneRef = useRef(false)
    // ── Scroll anchoring when chapters are added/removed ABOVE the reader (T23-003) ─────────
    // WebKit (the iPhone's WKWebView) has no CSS scroll anchoring, so prepending the previous
    // chapter would push the text the user is reading down by a whole chapter. Before any change
    // to the mounted range we record where a chapter that stays mounted sits; after React commits
    // we shift scrollTop by however far it moved. Idempotent where the browser already anchors
    // (Chromium): the measured shift is then ~0.
    const anchorRef = useRef<{ ch: number; top: number } | null>(null)
    const captureRangeAnchor = useCallback((ch: number) => {
      const c = scrollRef.current
      const el = chapterWrapperRefs.current.get(ch)
      if (c && el) anchorRef.current = { ch, top: el.getBoundingClientRect().top - c.getBoundingClientRect().top }
    }, [])
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
      // An external jump (picker, search, edge tap, chapter link) starts a fresh window: heights
      // measured around the OLD position would otherwise become a placeholder above the new
      // chapter while scrollTop keeps its old value — the reader would sit on empty placeholder
      // space (SEP24-004). The new chapter opens at its top (or at initialAnchor / targetVerse).
      heightCacheRef.current.clear()
      resetScrollRef.current = true
      setResetTick((t) => t + 1)
    }, [bookId, chapter])
    const resetScrollRef = useRef(true)
    const [resetTick, setResetTick] = useState(0)

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
            if (window.__bereanPresenterDebug) {
              console.log('[PD chapter-boundary-cross]', {
                from: visibleCh, to: best, bestRatio, bestTop,
                scrollTop: container.scrollTop, clientHeight: container.clientHeight,
              })
            }
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
    // The chapter actually under the viewport's top edge, read from the DOM right now. A fast fling
    // outruns the IntersectionObserver's `visibleCh`, and evicting around that stale value used to
    // unmount the chapter on screen — the reader showed nothing (SEP24-004).
    const liveVisibleChapter = useCallback((): number => {
      const c = scrollRef.current
      if (!c) return visibleCh
      const top = c.getBoundingClientRect().top + 1
      let best = visibleCh
      chapterWrapperRefs.current.forEach((el, ch) => {
        const r = el.getBoundingClientRect()
        if (r.top <= top && r.bottom > top) best = ch
      })
      return best
    }, [visibleCh])
    const lastScrollTopRef = useRef(0)
    const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
      onScroll?.(e)
      const el = e.currentTarget
      const { scrollTop, scrollHeight, clientHeight } = el
      const live = liveVisibleChapter()
      if (!anchorRef.current) captureRangeAnchor(live)
      // Fast scrolling loads further ahead so content keeps up with the fling.
      const speed = Math.abs(scrollTop - lastScrollTopRef.current)
      lastScrollTopRef.current = scrollTop
      const ahead = speed > clientHeight * 0.5 ? 2 : LOAD_AHEAD
      // Near bottom → load next chapter
      if (scrollHeight - scrollTop - clientHeight < clientHeight * 1.2) {
        setLastCh((prev) => Math.min(prev + ahead, totalChapters))
      }
      // Near top → load previous chapter
      if (scrollTop < clientHeight * 0.6) {
        setFirstCh((prev) => Math.max(prev - ahead, 1))
      }
      // Evict chapters that have scrolled far outside the window around visibleCh — without
      // this, firstCh/lastCh only ever grow and every chapter ever visited stays mounted as
      // full non-virtualized DOM for the life of the tab. Skipped during a programmatic jump
      // (scrollToChapter): visibleCh hasn't caught up to the new position yet (its observer
      // updates are suppressed for the duration), so evicting against the stale value here
      // would unmount the chapter we just jumped to.
      if (!programmaticScrollRef.current) {
        // Measure whatever's currently mounted BEFORE potentially evicting any of it, so the
        // placeholder substituted for an evicted chapter is sized from its own last-known real
        // height, not a guess.
        measureMountedChapterHeights()
        setFirstCh((prev) => {
          const minAllowed = Math.min(Math.max(1, live - WINDOW_CHAPTERS), lastCh)
          return minAllowed > prev ? minAllowed : prev
        })
        setLastCh((prev) => {
          const maxAllowed = Math.max(Math.min(totalChapters, live + WINDOW_CHAPTERS), firstCh)
          return maxAllowed < prev ? maxAllowed : prev
        })
      }
    }, [onScroll, totalChapters, firstCh, lastCh, measureMountedChapterHeights, captureRangeAnchor, liveVisibleChapter])

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
            if (el) { scrollVerseIntoView(el, VERSE_JUMP_ANIMATED_CENTER); return }
          }
          const heading = headingRefs.current.get(ch)
          if (heading) {
            scrollVerseIntoView(heading, VERSE_JUMP_ANIMATED_START)
          }
        })
      })
    }, [])

    useLayoutEffect(() => {
      const c = scrollRef.current
      if (resetScrollRef.current && c) {
        // After an external jump: the opening chapter at the top (placeholders were cleared).
        resetScrollRef.current = false
        anchorRef.current = null
        const head = chapterWrapperRefs.current.get(firstCh)
        c.scrollTop = head ? head.offsetTop : 0
        return
      }
      const a = anchorRef.current
      anchorRef.current = null
      if (!a || !c || programmaticScrollRef.current) return
      const el = chapterWrapperRefs.current.get(a.ch)
      if (!el) return
      const shift = el.getBoundingClientRect().top - c.getBoundingClientRect().top - a.top
      if (Math.abs(shift) > 0.5) c.scrollTop += shift
    }, [firstCh, lastCh, resetTick])

    // Initial reading position (T23-003): open at the given verse anchor, instantly. Retried on
    // each verses-loaded until the verse exists (it lives in the chapter this view opened on).
    const initialAnchorRef = useRef(initialAnchor ?? null)
    const applyInitialAnchor = useCallback(() => {
      const a = initialAnchorRef.current
      const c = scrollRef.current
      if (!a || !c) return
      const row = c.querySelector<HTMLElement>(`[data-verse-row][data-chapter="${a.chapter}"][data-verse="${a.verse}"]`)
      if (!row) return
      initialAnchorRef.current = null
      c.scrollTop += row.getBoundingClientRect().top - c.getBoundingClientRect().top - a.offset
    }, [])

    useImperativeHandle(ref, () => ({
      scrollToChapter,
      getScrollEl: () => scrollRef.current,
    }), [scrollToChapter])

    const chapters = Array.from({ length: lastCh - firstCh + 1 }, (_, i) => firstCh + i)

    // Placeholder height for the evicted range BEFORE firstCh and AFTER lastCh — see
    // chapterWrapperRefs' own comment above for why this exists.
    //
    // Only chapters that WERE mounted (and measured) and then evicted get a placeholder. A chapter
    // that has never been rendered reserves nothing: reserving a guessed height for every
    // unvisited chapter above the opening chapter put (chapter − 1) × ~900 px of blank space at
    // scrollTop 0 — opening continuous scroll on any chapter after the first showed an empty
    // page (T23-003). Unmeasured chapters are simply prepended/appended when reached, with the
    // scroll anchoring above keeping the reader in place.
    const measuredHeights = heightCacheRef.current
    let beforeHeight = 0
    for (let ch = 1; ch < firstCh; ch++) beforeHeight += measuredHeights.get(ch) ?? 0
    let afterHeight = 0
    for (let ch = lastCh + 1; ch <= totalChapters; ch++) afterHeight += measuredHeights.get(ch) ?? 0

    return (
      <ScrollContainer ref={scrollRef} className={`flex-1 relative ${audioPlaybackActive ? 'pb-24' : verseSelectionBarOpen ? 'pb-16' : ''}`} onScroll={handleScroll}>
        {/* Presenter visible-region outline — same style layer as BiblePanel's (§62/§63):
            dashed, subtle tint, no in-column text; geometry pipeline unchanged. */}
        {presenterBand && (
          <div
            // Sized like the reading column (same font → same `ch`) so the outline hugs the
            // text, not the whole pane; compact/compare views have no column cap (100%).
            className="absolute pointer-events-none z-raised rounded-card animate-fade-in berean-scripture-text"
            style={{
              top: presenterBand.top,
              height: presenterBand.height,
              left: 0,
              right: 0,
              maxWidth: 'min(calc(var(--reading-max-ch) * 1ch), 100%)',
              fontSize: bibleFontSize,
              border: `1.5px dashed ${viewerPaused ? 'rgb(var(--color-warning) / 0.6)' : 'rgb(var(--color-accent) / 0.55)'}`,
              background: viewerPaused ? 'rgb(var(--color-warning) / 0.035)' : 'rgb(var(--color-accent) / 0.035)',
              transition: 'height var(--motion-fast) var(--motion-ease-out), border-color var(--motion-base), background-color var(--motion-base)',
            }}
          />
        )}

        {/* Placeholder for evicted chapters before firstCh — keeps scrollHeight (and therefore
            scrollTop) roughly continuous across an eviction instead of the scrollable region
            abruptly shrinking. */}
        {beforeHeight > 0 && <div style={{ height: beforeHeight }} aria-hidden="true" />}

        {chapters.map((ch) => (
          <div
            key={`${bookId}-${ch}`}
            data-chapter-wrap={ch}
            ref={(el) => {
              if (el) chapterWrapperRefs.current.set(ch, el)
              else chapterWrapperRefs.current.delete(ch)
            }}
          >
            {/* Chapter heading divider */}
            <div
              ref={(el) => {
                if (el) headingRefs.current.set(ch, el)
                else headingRefs.current.delete(ch)
              }}
              data-chapter={ch}
              className="group sticky top-0 z-raised px-8 py-2 material-bar border-b border-separator flex items-center gap-2"
            >
              <SectionLabel className="select-none">
                {bookName(bookId)} {ch}
              </SectionLabel>
              <IconButton
                icon={TagIcon}
                label={`Tag ${bookName(bookId)} ${displayChapter(bookId, ch)} (whole chapter)`}
                size={20}
                variant="ghost"
                onClick={(e) => setChapterTagPick({ rect: (e.currentTarget as HTMLElement).getBoundingClientRect(), ch })}
                className="text-text-muted hover:text-accent"
              />
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
              onVersesLoaded={ch === chapter ? () => { applyInitialAnchor(); onVersesLoaded?.() } : undefined}
              onTargetVerseConsumed={ch === chapter ? onTargetVerseConsumed : undefined}
              flashAnchor={ch === chapter ? flashAnchor : undefined}
            />
          </div>
        ))}

        {/* Placeholder for evicted chapters after lastCh — same reasoning as the "before" one. */}
        {afterHeight > 0 && <div style={{ height: afterHeight }} aria-hidden="true" />}

        {/* Bottom sentinel — ensures there's enough room to scroll */}
        <div className="h-16" />

        {chapterTagPick && (() => {
          const ranges = chapterRanges(bookId, chapterTagPick.ch)
          return (
            <TagPickPopover
              anchorRect={chapterTagPick.rect}
              ranges={ranges}
              label={rangesLabel(ranges)}
              kind="chapter"
              onClose={() => setChapterTagPick(null)}
            />
          )
        })()}
      </ScrollContainer>
    )
  }
)
