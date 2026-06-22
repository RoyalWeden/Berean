import { useEffect, useState, useRef, useCallback, Fragment } from 'react'
import { bookChapterLabel } from '@/lib/parseRef'
import { useAppStore } from '@/store'
import { buildVerseDisplayTokens, mapOriginalOffsetToDisplay } from '@/lib/verseUtils'
import { laserToPoint } from '@/lib/presenterOverlay'
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
  // Viewer-only highlights for THIS chapter, owned by ViewerApp so they survive chapter switches.
  viewerHighlights: Record<number, ViewerHighlight[]>
  onAddViewerHighlight: (verseNum: number, hl: ViewerHighlight) => void
  onRemoveViewerHighlight: (verseNum: number, startChar: number, endChar: number) => void
}

export default function ViewerBiblePage({ bookId, chapter, verse, textId, fontScale, scrollPercent, viewerHighlights, onAddViewerHighlight, onRemoveViewerHighlight }: Props) {
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
  const displayTokens = (v: Verse) =>
    buildVerseDisplayTokens(v.text, v.text_tagged, textId, wrEnabled, wrRules)

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
      // so the presenter outline / virtual scroll runs PAST the last verse.
      const H = contentBottom > 0 ? Math.min(c.scrollHeight, contentBottom + 4) : c.scrollHeight
      const visibleFraction = Math.min(1, c.clientHeight / H)
      const verseFracs: Record<number, number> = {}
      for (const [n, top] of Object.entries(verseTops)) verseFracs[Number(n)] = Math.min(1, top / H)
      if (typeof window.viewer?.reportVisibleRegion !== 'function') {
        console.warn('[ViewerBiblePage] reportVisibleRegion missing from preload — restart the app')
        return
      }
      window.viewer.reportVisibleRegion({ bookId, chapter, visibleFraction, verseFracs })
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

  // Scroll to active verse — only when no proportional scroll position is supplied.
  useEffect(() => {
    if (scrollPercent !== undefined && scrollPercent !== null) return
    if (verse && activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [verse, verses, scrollPercent])

  // Apply proportional scroll percentage from main window (re-applies once verses render).
  useEffect(() => {
    if (scrollPercent === undefined || scrollPercent === null) return
    if (scrollPercentRAFRef.current) cancelAnimationFrame(scrollPercentRAFRef.current)
    scrollPercentRAFRef.current = requestAnimationFrame(() => {
      scrollPercentRAFRef.current = null
      if (Date.now() < scrollLockUntilRef.current) return // a find-bar centering is in progress
      const el = containerRef.current
      if (!el) return
      const max = el.scrollHeight - el.clientHeight
      if (max > 0) el.scrollTop = scrollPercent * max
    })
  }, [scrollPercent, verses])

  // Report visible region after verses render and on window resize
  useEffect(() => {
    if (!loading) reportVisible()
  }, [loading, verses, fontScale, reportVisible])
  useEffect(() => {
    const onResize = () => reportVisible()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
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
          ve.scrollIntoView({ behavior: 'smooth', block: 'center' })
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

  return (
    <div ref={containerRef} className="h-full overflow-y-auto px-10 pb-6 pt-12 relative" onMouseUp={handleMouseUp}>
      {/* Chapter header */}
      <div
        className="text-center select-none mb-8"
        style={{ fontSize: Math.round(baseFontSize * 0.75), color: muteColor, letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 500 }}
      >
        {bookChapterLabel(bookId, chapter)}{textId === 'lxx' ? ' LXX' : ''}
      </div>

      <div style={{ fontSize: baseFontSize, lineHeight: 1.9, color: textColor }}>
        {verses.map((v) => {
          const isActive = verse === v.verse_num
          return (
            <div
              key={v.verse_num}
              data-verse={v.verse_num}
              ref={isActive ? (activeRef as React.RefObject<HTMLDivElement>) : undefined}
              className="flex gap-3 mb-0.5"
              style={isActive ? { background: accentBg, borderRadius: '6px', marginLeft: '-8px', paddingLeft: '8px', paddingRight: '4px' } : undefined}
            >
              <span
                className="select-none flex-shrink-0 tabular-nums text-right"
                style={{
                  fontSize: Math.round(baseFontSize * 0.55),
                  color: muteColor,
                  width: `${Math.round(baseFontSize * 1.5)}px`,
                  paddingTop: '0.3em',
                }}
              >
                {v.verse_num}
              </span>
              <span className="flex-1" data-verse-text style={{ userSelect: 'text' }}>
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
