import { useEffect, useState, useRef, useCallback, Fragment } from 'react'
import { hermasAwareChapterLabel } from '@/lib/hermasMap'
import { useAppStore } from '@/store'
import { buildVerseDisplayTokens, mapOriginalOffsetToDisplay } from '@/lib/verseUtils'
import { stripAnnotations } from '@/lib/annotationFilters'
import { laserToPoint } from '@/lib/presenterOverlay'
import { measureContentHeight } from '@/lib/presenterBand'
import type { OverlayLaser } from '@/lib/presenterOverlay'
import type { DisplayToken } from '@/lib/verseUtils'
import type { ViewerOverlay } from '@/types/electron'
import type { Verse } from '@/types'

const RED_LETTER_COLOR = 'rgb(248 113 113)' // text-red-400 — words of Yeshua

const WORD_HIGHLIGHT_BG: Record<string, string> = {
  yellow: 'rgba(234,179,8,0.5)',   orange: 'rgba(251,146,60,0.5)',  amber:  'rgba(251,191,36,0.5)',
  red:    'rgba(248,113,113,0.5)', rose:   'rgba(251,113,133,0.5)', pink:   'rgba(244,114,182,0.5)',
  violet: 'rgba(167,139,250,0.5)', purple: 'rgba(192,132,252,0.5)', indigo: 'rgba(129,140,248,0.5)',
  blue:   'rgba(96,165,250,0.5)',  sky:    'rgba(56,189,248,0.5)',  cyan:   'rgba(34,211,238,0.5)',
  teal:   'rgba(45,212,191,0.5)',  green:  'rgba(74,222,128,0.5)',  lime:   'rgba(163,230,53,0.5)',
}
const COLOR_IDS = Object.keys(WORD_HIGHLIGHT_BG)

export interface DBHighlight {
  id: string
  color: string
  startWord: number | null
  endWord: number | null
  startChar: number | null
  endChar: number | null
}
// Viewer-only highlights are stored in DISPLAY-text char coordinates (what the audience sees).
export interface ViewerHighlight { startChar: number; endChar: number; color: string }
interface SelectionState { x: number; y: number; verseNum: number; startChar: number; endChar: number }

/**
 * Render a verse from its display `tokens` (carrying red-letter / italic flags), overlaying
 * char-level highlights. Builds per-character style (background + red-letter + italic) over
 * the joined display string, then groups consecutive same-styled chars into spans — so
 * Yeshua's words render in red, KJV-italic words slanted, and highlights tint underneath.
 *
 * DB highlights are stored against the ORIGINAL verse text, so their offsets are mapped onto
 * the display text; viewer-only highlights are already in display coords.
 */
const SELECTION_BG = 'rgba(120,170,255,0.55)' // mirrors the user's text selection

export function renderVerseText(
  originalText: string,
  tokens: DisplayToken[],
  dbHls: DBHighlight[],
  viewerHls: ViewerHighlight[] = [],
  selRanges: { startChar: number; endChar: number }[] = []
): React.ReactNode {
  const displayText = tokens.map(t => t.word).join(' ')
  const n = displayText.length
  if (n === 0) return displayText

  // Per-character red-letter / italic flags, walked from the tokens.
  const red = new Array<boolean>(n).fill(false)
  const ital = new Array<boolean>(n).fill(false)
  let pos = 0
  tokens.forEach((t, ti) => {
    for (let i = 0; i < t.word.length && pos + i < n; i++) {
      red[pos + i] = t.isRedLetter
      ital[pos + i] = t.isItalic
    }
    pos += t.word.length
    // The joining space: red only when both sides are red (keeps red phrases continuous).
    if (ti < tokens.length - 1 && pos < n) {
      red[pos] = t.isRedLetter && tokens[ti + 1].isRedLetter
      pos += 1
    }
  })

  // Per-character highlight background.
  const bg = new Array<string | undefined>(n).fill(undefined)
  const fill = (s: number, e: number, color: string) => {
    const a = Math.max(0, Math.min(s, n)), b = Math.max(0, Math.min(e, n))
    const css = WORD_HIGHLIGHT_BG[color] ?? WORD_HIGHLIGHT_BG.yellow
    for (let i = a; i < b; i++) bg[i] = css
  }
  const origWords = originalText.split(' ')
  let cp = 0
  const origWordStarts = origWords.map(w => { const s = cp; cp += w.length + 1; return s })
  for (const h of dbHls) {
    if (h.startChar !== null && h.endChar !== null) {
      fill(mapOriginalOffsetToDisplay(displayText, originalText, h.startChar),
           mapOriginalOffsetToDisplay(displayText, originalText, h.endChar), h.color)
    } else if (h.startWord !== null) {
      const si = h.startWord
      const ei = Math.min(h.endWord ?? si, origWords.length - 1)
      const oc = origWordStarts[si] ?? 0
      const oe = (origWordStarts[ei] ?? 0) + (origWords[ei]?.length ?? 0)
      fill(mapOriginalOffsetToDisplay(displayText, originalText, oc),
           mapOriginalOffsetToDisplay(displayText, originalText, oe), h.color)
    }
  }
  for (const h of viewerHls) fill(h.startChar, h.endChar, h.color)
  // The mirrored selection paints last so it reads as a selection over any highlights.
  for (const sr of selRanges) {
    const a = Math.max(0, Math.min(sr.startChar, n)), b = Math.max(0, Math.min(sr.endChar, n))
    for (let i = a; i < b; i++) bg[i] = SELECTION_BG
  }

  // Group consecutive chars sharing the same (bg, red, italic) into spans.
  const out: React.ReactNode[] = []
  let i = 0
  while (i < n) {
    let j = i + 1
    while (j < n && bg[j] === bg[i] && red[j] === red[i] && ital[j] === ital[i]) j++
    const chunk = displayText.slice(i, j)
    if (!bg[i] && !red[i] && !ital[i]) {
      out.push(<Fragment key={i}>{chunk}</Fragment>)
    } else {
      out.push(
        <span
          key={i}
          style={{
            background: bg[i],
            borderRadius: bg[i] ? '2px' : undefined,
            color: red[i] ? RED_LETTER_COLOR : undefined,
            fontStyle: ital[i] ? 'italic' : undefined,
            opacity: ital[i] ? 0.85 : undefined,
          }}
        >{chunk}</span>
      )
    }
    i = j
  }
  return <>{out}</>
}

interface Props {
  bookId: string
  chapter: number
  verse?: number
  textId: string
  fontScale: number
  scrollPercent?: number
  /** Annotation categories hidden in the main window (kjva_italics, lxx_supply,
   *  enoch_supply/uncertain/restored, jubilees_date/bracket/etc.) — mirrored here so the
   *  presenter matches. */
  hiddenAnnotations?: string[]
  // Viewer-only highlights for THIS chapter, owned by ViewerApp so they survive chapter switches.
  viewerHighlights: Record<number, ViewerHighlight[]>
  onAddViewerHighlight: (verseNum: number, hl: ViewerHighlight) => void
  onRemoveViewerHighlight: (verseNum: number, startChar: number, endChar: number) => void
}

export default function ViewerBiblePage({ bookId, chapter, verse, textId, fontScale, scrollPercent, hiddenAnnotations = [], viewerHighlights, onAddViewerHighlight, onRemoveViewerHighlight }: Props) {
  const [verses, setVerses] = useState<Verse[]>([])
  const [loading, setLoading] = useState(true)
  const [dbHighlights, setDbHighlights] = useState<Record<number, DBHighlight[]>>({})
  const [selTb, setSelTb] = useState<SelectionState | null>(null)
  // Mirrored from the main window: the user's selection and laser-pointer position.
  const [mirrorSel, setMirrorSel] = useState<{ verseNum: number; startChar: number; endChar: number }[] | null>(null)
  const [mirrorLaser, setMirrorLaser] = useState<OverlayLaser | null>(null)
  const [laserPos, setLaserPos] = useState<{ top: number; left: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const activeRef = useRef<HTMLDivElement>(null)
  const scrollPercentRAFRef = useRef<number | null>(null)
  const reportRAFRef = useRef<number | null>(null)
  // Find-bar "scroll to verse" support: briefly ignore proportional sync so the centering sticks.
  const scrollLockUntilRef = useRef(0)
  const lastScrollToNonceRef = useRef(0)

  // Word replacer (synced from the main window via viewer:settings)
  const wrEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wrRules = useAppStore((s) => s.wordReplacerRules)
  // Display tokens carry red-letter / italic flags so Yeshua's words render in red.
  // Bracket/parenthetical annotations (LXX supply, Enoch, Jubilees) are stripped from the
  // plain text first, same as VerseRow's stripAnnotations; KJV italics come through as
  // per-token flags on text_tagged instead, so those are filtered out after the fact.
  const displayTokens = (v: Verse) => {
    const strippedText = hiddenAnnotations.length ? stripAnnotations(v.text, textId, hiddenAnnotations) : v.text
    const tokens = buildVerseDisplayTokens(strippedText, v.text_tagged, textId, wrEnabled, wrRules)
    return hiddenAnnotations.includes('kjva_italics') ? tokens.filter((t) => !t.isItalic) : tokens
  }

  // Report the fraction of the chapter visible in the presenter. The main window combines
  // this with its own live scroll position to draw the outline band — so the band tracks
  // scrolling instantly (no IPC round-trip per frame) and covers exactly the visible pixels
  // (partial verses included). This fraction only changes on load / zoom / resize.
  const reportVisible = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (reportRAFRef.current) cancelAnimationFrame(reportRAFRef.current)
    reportRAFRef.current = requestAnimationFrame(() => {
      reportRAFRef.current = null
      const c = containerRef.current
      if (!c || c.scrollHeight <= 0) return
      const cTop = c.getBoundingClientRect().top
      // Measure verse positions AND the actual content bottom (last verse's bottom).
      const verseNodes = Array.from(c.querySelectorAll('[data-verse]')) as HTMLElement[]
      let contentBottom = 0
      const verseTops: Record<number, number> = {}
      for (const elx of verseNodes) {
        const n = Number(elx.dataset.verse)
        if (!Number.isFinite(n)) continue
        const r = elx.getBoundingClientRect()
        verseTops[n] = r.top - cTop + c.scrollTop
        const bottom = r.bottom - cTop + c.scrollTop
        if (bottom > contentBottom) contentBottom = bottom
      }
      // Use the content height (bottom of the last verse), not scrollHeight — otherwise the
      // empty space below the last verse on a short chapter inflates the scrollable region,
      // so the presenter outline / virtual scroll runs PAST the last verse. Shared with the
      // main window's own measurement (measureContentHeight) so the two windows can't drift
      // out of sync over independent copies of the same padding constant.
      const H = measureContentHeight(c.scrollHeight, contentBottom)
      const visibleFraction = Math.min(1, c.clientHeight / H)
      const verseFracs: Record<number, number> = {}
      for (const [n, top] of Object.entries(verseTops)) verseFracs[Number(n)] = Math.min(1, top / H)
      if (typeof window.viewer?.reportVisibleRegion !== 'function') {
        console.warn('[ViewerBiblePage] reportVisibleRegion missing from preload — restart the app')
        return
      }
      // Debug logging for the "outline shows different verses than the presenter" report —
      // logs the ACTUAL currently on-screen verse range in THIS window (ground truth, derived
      // directly from getBoundingClientRect against the viewport, not from the fraction math
      // below), alongside the fraction-based payload being sent to the main window. Compare
      // this against the [PresenterDebug band] log in BiblePanel.tsx for the same tick — a
      // real mismatch will show up as a different verse range here vs. what the main window's
      // outline band computes from this same payload.
      if (window.__bereanPresenterDebug) {
        const viewportTop = 0, viewportBottom = c.clientHeight
        let onScreenFirst: number | null = null, onScreenLast: number | null = null
        for (const elx of verseNodes) {
          const n = Number(elx.dataset.verse)
          if (!Number.isFinite(n)) continue
          const r = elx.getBoundingClientRect()
          const top = r.top - cTop, bottom = r.bottom - cTop
          if (bottom > viewportTop && top < viewportBottom) {
            if (onScreenFirst === null || n < onScreenFirst) onScreenFirst = n
            if (onScreenLast === null || n > onScreenLast) onScreenLast = n
          }
        }
        console.log('[PresenterDebug viewer]', {
          bookId, chapter, scrollTop: c.scrollTop, clientHeight: c.clientHeight, contentHeight: H,
          visibleFraction, onScreenVerses: [onScreenFirst, onScreenLast],
        })
      }
      window.viewer.reportVisibleRegion({ bookId, chapter, visibleFraction, verseFracs, clientHeight: c.clientHeight })
    })
  }, [bookId, chapter])

  // Fetch chapter verses
  useEffect(() => {
    setLoading(true)
    window.bible.queryChapter(bookId, chapter, textId).then((vs) => {
      setVerses(vs)
      setLoading(false)
    }).catch((err) => {
      console.error('[ViewerBiblePage] queryChapter failed:', err)
      setLoading(false)
    })
  }, [bookId, chapter, textId])

  // Fetch DB highlights (refetched when the main window bumps highlightChangeToken).
  const highlightChangeToken = useAppStore((s) => s.highlightChangeToken)
  useEffect(() => {
    window.highlights.getChapter(bookId, chapter, textId)
      .then((raw) => setDbHighlights(raw as Record<number, DBHighlight[]>))
      .catch(() => {})
  }, [bookId, chapter, textId, highlightChangeToken])

  // Scroll to active verse — only when no proportional scroll position is supplied. THIS is
  // the fallback path most likely to diverge from the main window: `verse` can be stale (a
  // leftover targetVerse/lastBibleVerse from an earlier navigation — see useViewerSync.ts's
  // computeViewerPayload doc comment) and centering on it has NOTHING to do with wherever the
  // main window's own native scroll position actually is right now.
  useEffect(() => {
    if (scrollPercent !== undefined && scrollPercent !== null) {
      if (window.__bereanPresenterDebug) console.log('[PD viewer-center-effect] SKIPPED — scrollPercent is defined', { scrollPercent })
      return
    }
    if (verse && activeRef.current) {
      if (window.__bereanPresenterDebug) {
        const r = activeRef.current.getBoundingClientRect()
        console.log('[PD viewer-center-effect] CENTERING on verse (scrollPercent undefined)', {
          bookId, chapter, verse, activeRefRectTop: r.top, activeRefRectBottom: r.bottom,
        })
      }
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else if (window.__bereanPresenterDebug) {
      console.log('[PD viewer-center-effect] scrollPercent undefined but nothing to center on', { verse, hasActiveRef: !!activeRef.current })
    }
  }, [verse, verses, scrollPercent])

  // Apply proportional scroll percentage from main window (re-applies once verses render).
  useEffect(() => {
    if (scrollPercent === undefined || scrollPercent === null) return
    if (scrollPercentRAFRef.current) cancelAnimationFrame(scrollPercentRAFRef.current)
    scrollPercentRAFRef.current = requestAnimationFrame(() => {
      scrollPercentRAFRef.current = null
      if (Date.now() < scrollLockUntilRef.current) {
        if (window.__bereanPresenterDebug) console.log('[PD viewer-percent-effect] SKIPPED — find-bar scroll lock active')
        return
      }
      const el = containerRef.current
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      const appliedScrollTop = max > 0 ? scrollPercent * max : el.scrollTop
      if (max > 0) el.scrollTop = scrollPercent * max
      if (window.__bereanPresenterDebug) {
        console.log('[PD viewer-percent-effect] APPLIED', {
          bookId, chapter, scrollPercent, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight,
          max, appliedScrollTop, actualScrollTopAfter: el.scrollTop,
        })
      }
    })
  }, [scrollPercent, verses])

  // Report visible region after verses render and on window resize. Word-
  // replacer settings are included here too — they change verse text length
  // (and therefore line-wrapping/verse heights) without touching `verses`
  // itself, so toggling/editing them while the viewer is open used to leave
  // the reported region (and the main window's outline band) silently stale
  // until the next chapter navigation.
  useEffect(() => {
    if (!loading) reportVisible()
  }, [loading, verses, fontScale, wrEnabled, wrRules, hiddenAnnotations, reportVisible])
  useEffect(() => {
    const onResize = () => reportVisible()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [reportVisible])
  // A raw window `resize` alone misses content reflows that don't come with
  // an OS-level window resize (webview layout settling, DPI changes, any
  // other content-affecting change not already covered by the effect
  // above) — the main window's own band computation already guards against
  // this with a ResizeObserver on its scroll container (BiblePanel.tsx);
  // the viewer had no equivalent, so its reported region/verseFracs could
  // silently drift out of date relative to what's actually on screen,
  // surfacing as the main window's outline claiming a different verse
  // range than what the presenter is really showing.
  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => reportVisible())
    ro.observe(el)
    return () => ro.disconnect()
  }, [reportVisible])
  // Track the viewer's OWN live scroll position, not just load/resize/reflow.
  // Without this, reportVisible() only ever reported the region as of the
  // instant chapter data loaded — before either of this component's own
  // scroll-adjustment effects (verse-centering smooth-scroll above, or the
  // proportional scrollPercent jump) had actually taken effect. That's most
  // visible right after a search navigation: the main window's auto-sync
  // pushes `scrollPercent: 0` the moment tab state changes (well before this
  // component's own async chapter fetch and scroll settle), so the outline
  // band in the main window ends up drawn for a stale top-of-chapter region
  // that doesn't match where the presenter content actually ends up.
  // `reportVisible` is already internally rAF-throttled (`reportRAFRef`), so
  // this can subscribe directly without its own extra debounce.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('scroll', reportVisible, { passive: true })
    return () => el.removeEventListener('scroll', reportVisible)
  }, [reportVisible])
  // Main window can explicitly ask for a fresh report (after unpausing / "Re-sync now") even
  // when our content hasn't changed — see requestViewerVisibleRegion for why this is needed.
  useEffect(() => {
    window.viewer?.onRequestVisibleRegion?.(() => reportVisible())
  }, [reportVisible])

  // Receive the mirrored selection + laser pointer + find-bar scroll from the main window.
  useEffect(() => {
    window.viewer?.onOverlay?.((raw) => {
      const o = raw as ViewerOverlay
      if (o.bookId !== bookId || o.chapter !== chapter) return
      if (o.selection !== undefined) setMirrorSel(o.selection)
      if (o.laser !== undefined) setMirrorLaser(o.laser)
      // Find-bar: center the targeted verse in the presenter (briefly overriding scroll sync).
      if (o.scrollTo && o.scrollTo.nonce !== lastScrollToNonceRef.current) {
        lastScrollToNonceRef.current = o.scrollTo.nonce
        const c = containerRef.current
        const ve = c?.querySelector(`[data-verse="${o.scrollTo.verseNum}"]`) as HTMLElement | null
        if (c && ve) {
          scrollLockUntilRef.current = Date.now() + 800
          // Jump instantly (not smooth): a gliding presenter is still moving when the main
          // panel computes the outline band, which left the band landing mid-verse on some
          // matches. Settling immediately makes the band deterministic.
          ve.scrollIntoView({ behavior: 'auto', block: 'center' })
        }
      }
    })
  }, [bookId, chapter])

  // Clear stale overlays when the chapter changes.
  useEffect(() => { setMirrorSel(null); setMirrorLaser(null) }, [bookId, chapter, textId])

  // Resolve the laser anchor (char offset or fraction) to a pixel point that scrolls with content.
  useEffect(() => {
    if (!mirrorLaser) { setLaserPos(null); return }
    const c = containerRef.current
    if (!c) return
    setLaserPos(laserToPoint(c, mirrorLaser))
  }, [mirrorLaser, verses, fontScale])

  // "Focused" = the laser has settled (no movement briefly) → gently pulse to draw the eye.
  const [laserFocused, setLaserFocused] = useState(false)
  useEffect(() => {
    if (!laserPos) { setLaserFocused(false); return }
    setLaserFocused(false)
    const t = setTimeout(() => setLaserFocused(true), 260)
    return () => clearTimeout(t)
  }, [laserPos])

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelTb(null); return }
    const range = sel.getRangeAt(0)

    let node: Node | null = range.startContainer
    let verseEl: HTMLElement | null = null
    while (node) {
      if (node instanceof HTMLElement && node.dataset.verse) { verseEl = node; break }
      node = node.parentElement
    }
    if (!verseEl) { setSelTb(null); return }
    const verseNum = Number(verseEl.dataset.verse)

    const textEl = verseEl.querySelector('[data-verse-text]') as HTMLElement | null
    if (!textEl) { setSelTb(null); return }

    function charOffset(target: Node, offset: number): number {
      let pos = 0
      const walker = document.createTreeWalker(textEl!, NodeFilter.SHOW_TEXT)
      let curr: Text | null
      while ((curr = walker.nextNode() as Text) !== null) {
        if (curr === target) return pos + offset
        pos += curr.length
      }
      return -1
    }

    const startChar = charOffset(range.startContainer, range.startOffset)
    const endChar = charOffset(range.endContainer, range.endOffset)
    if (startChar < 0 || endChar <= startChar) { setSelTb(null); return }

    const rect = range.getBoundingClientRect()
    setSelTb({ x: rect.left + rect.width / 2, y: rect.top - 4, verseNum, startChar, endChar })
  }, [])

  const applyHighlight = useCallback((color: string) => {
    if (!selTb) return
    const { verseNum, startChar, endChar } = selTb
    onAddViewerHighlight(verseNum, { startChar, endChar, color })
    setSelTb(null)
    window.getSelection()?.removeAllRanges()
  }, [selTb, onAddViewerHighlight])

  // Remove any viewer highlights overlapping the current selection (the toolbar's eraser).
  const removeHighlight = useCallback(() => {
    if (selTb) onRemoveViewerHighlight(selTb.verseNum, selTb.startChar, selTb.endChar)
    setSelTb(null)
    window.getSelection()?.removeAllRanges()
  }, [selTb, onRemoveViewerHighlight])

  const baseFontSize = Math.round(16 * fontScale)
  const muteColor = 'rgb(var(--color-text-muted, 120 120 140))'
  const textColor = 'rgb(var(--color-text-primary, 220 220 230))'
  const accentBg  = 'rgba(var(--color-accent, 100 130 200) / 0.12)'

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ fontSize: baseFontSize, color: muteColor }}>
        Loading…
      </div>
    )
  }

  // Gutter width reserves room, inside the container's own left padding, for the verse-number
  // span to hang to the left of the text column (classic "hanging verse number in the margin"
  // layout) rather than taking inline horizontal space from the text row itself.
  const gutterWidth = Math.round(baseFontSize * 1.5)

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-6 pb-6 pt-12 relative" onMouseUp={handleMouseUp}>
      {/* Chapter header */}
      <div
        className="text-center select-none mb-8"
        style={{ fontSize: Math.round(baseFontSize * 0.75), color: muteColor, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}
      >
        {hermasAwareChapterLabel(bookId, chapter, textId)}{textId === 'lxx' ? ' LXX' : ''}
      </div>

      {/* line-height and per-verse margin-bottom deliberately match
          VerseRow.tsx's own non-Strong's-mode values (mb-3 + var(--line-
          height-comfortable), 1.75) — the viewer never renders Strong's, so
          that's always the right main-window state to mirror. These two
          renderers are independently maintained (no shared component), and
          presenterBand.ts's whole geometry model assumes both windows'
          verse-to-verse spacing is proportionally equivalent; a previous
          hardcoded 1.9/mb-0.5 here (vs. main's 1.75/12px) diverged enough
          to misplace the outline band by several verses, worst in
          short-verse books like Song of Solomon where the per-verse error
          compounds fastest. Only the HORIZONTAL layout below (verse number
          moved into a hanging gutter) changed from that main-window model —
          vertical spacing is untouched, so presenterBand.ts's DOM-measured
          geometry stays correct. */}
      <div
        style={{ fontSize: baseFontSize, lineHeight: 'var(--line-height-comfortable)', color: textColor, marginLeft: `${gutterWidth + 8}px` }}
      >
        {verses.map((v) => {
          const isActive = verse === v.verse_num
          return (
            <div
              key={v.verse_num}
              data-verse={v.verse_num}
              ref={isActive ? (activeRef as React.RefObject<HTMLDivElement>) : undefined}
              className="relative mb-3"
              style={isActive ? { background: accentBg, borderRadius: '6px', paddingLeft: '8px', paddingRight: '4px', marginLeft: '-8px' } : undefined}
            >
              <span
                className="select-none absolute tabular-nums text-right"
                style={{
                  fontSize: Math.round(baseFontSize * 0.55),
                  color: muteColor,
                  width: `${gutterWidth}px`,
                  right: 'calc(100% + 8px)',
                  top: '0.3em',
                }}
              >
                {v.verse_num}
              </span>
              <span data-verse-text style={{ userSelect: 'text' }}>
                {renderVerseText(
                  v.text,
                  displayTokens(v),
                  dbHighlights[v.verse_num] ?? [],
                  viewerHighlights[v.verse_num] ?? [],
                  mirrorSel?.filter((r) => r.verseNum === v.verse_num) ?? [],
                )}
              </span>
            </div>
          )
        })}
      </div>

      {/* Laser pointer mirroring the presenter's cursor in the main window */}
      {laserPos && (
        <>
          <style>{`@keyframes berean-laser-pulse {
            0%,100% { box-shadow: 0 0 9px 2px rgba(255,0,0,0.55); }
            50% { box-shadow: 0 0 16px 6px rgba(255,0,0,0.85); }
          }`}</style>
          <div
            className="pointer-events-none"
            style={{
              position: 'absolute',
              left: laserPos.left,
              top: laserPos.top,
              width: 15,
              height: 15,
              transform: 'translate(-50%, -50%)',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,40,40,0.95) 0%, rgba(255,0,0,0.7) 40%, rgba(255,0,0,0) 72%)',
              boxShadow: '0 0 10px 3px rgba(255,0,0,0.6)',
              zIndex: 40,
              // Horizontal eases quickly (within-word glide); vertical eases a bit longer so
              // jumping to a new line feels smooth rather than snappy.
              transition: 'left 55ms ease-out, top 120ms ease-out',
              willChange: 'left, top',
              animation: laserFocused ? 'berean-laser-pulse 1.3s ease-in-out infinite' : undefined,
            }}
          />
        </>
      )}

      {/* Viewer-only highlight color picker */}
      {selTb && (
        <div
          className="fixed z-50 flex items-center gap-1 p-1.5 rounded-xl shadow-2xl"
          style={{
            left: selTb.x,
            top: selTb.y,
            transform: 'translate(-50%, -100%)',
            background: 'rgb(var(--color-surface-2, 30 30 40))',
            border: '1px solid rgb(var(--color-surface-4, 60 60 80))',
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {COLOR_IDS.map((id) => (
            <button
              key={id}
              onClick={() => applyHighlight(id)}
              className="w-4 h-4 rounded-full hover:scale-125 transition-transform flex-shrink-0"
              style={{ background: WORD_HIGHLIGHT_BG[id], border: '1.5px solid rgba(255,255,255,0.25)' }}
            />
          ))}
          {/* Eraser — removes any highlight under the selection */}
          <button
            onClick={removeHighlight}
            title="Remove highlight"
            className="ml-1 w-4 h-4 rounded-full flex items-center justify-center hover:scale-125 transition-transform flex-shrink-0"
            style={{ background: 'transparent', border: '1.5px dashed rgba(255,255,255,0.5)', color: textColor, fontSize: 9, lineHeight: 1 }}
          >
            ⌫
          </button>
          <button
            onClick={removeHighlight}
            title="Remove highlight / close"
            className="ml-0.5 text-xs px-1 rounded opacity-50 hover:opacity-100 transition-opacity"
            style={{ color: textColor }}
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
