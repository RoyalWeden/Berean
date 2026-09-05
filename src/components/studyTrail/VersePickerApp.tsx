import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useAppStore } from '@/store'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { hermasAwareChapterLabel } from '@/lib/hermasMap'
import { applyWordReplacer } from '@/lib/wordReplacer'
import { mapChapterOnTranslationSwitch } from '@/lib/translationChapterMap'
import type { Verse } from '@/types'
import type { VersePickerPayload, VersePickerSide } from '@/types/versePicker'

const FONT_SCALE_KEY = 'berean-verse-picker-font-scale'
function readStoredFontScale(): number {
  try {
    const raw = localStorage.getItem(FONT_SCALE_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : 1
  } catch { return 1 }
}

/** Renders one chapter's verse numbers as a clickable grid — click = toggle, shift-click =
 *  range-select from the last-clicked verse in this same column (per the confirmed picker
 *  interaction model). The chapter is fixed (locked to the connection's origin/destination
 *  chapter) — this never needs its own chapter-navigation UI — but the EDITION shown (KJV vs
 *  Brenton LXX) can be flipped when the book has an LXX counterpart, since seeing the Greek
 *  wording side by side is often exactly why a tie is being made in the first place. */
function VersePickerColumn({
  label, side, selected, onChange, accentColor, textColor, muteColor, borderColor,
  fontScale, lxxAvailable, findQuery, findActive, onRequestFind, onCloseFind, onFindQueryChange,
}: {
  label: string
  side: VersePickerSide
  selected: Set<number>
  onChange: (next: Set<number>) => void
  accentColor: string
  textColor: string
  muteColor: string
  borderColor: string
  fontScale: number
  lxxAvailable: boolean
  findQuery: string
  findActive: boolean
  onRequestFind: () => void
  onCloseFind: () => void
  onFindQueryChange: (q: string) => void
}) {
  // Which edition is currently displayed. side.chapter/side.bookId are whatever numbering the
  // trail node itself recorded (almost always KJV, since that's the default reading mode) — the
  // LXX chapter number is derived from it via the same bidirectional map BiblePanel's own
  // KJV/LXX switch button uses, so Psalms/Jeremiah/Joel/Malachi's divergent numbering still
  // lands on the right chapter here too.
  const [textId, setTextId] = useState<'kjva' | 'lxx'>('kjva')
  const displayChapter = textId === 'lxx'
    ? mapChapterOnTranslationSwitch(side.bookId, side.chapter, 'kjva', 'lxx')
    : side.chapter
  const [verses, setVerses] = useState<Verse[] | null>(null)
  const lastClickedRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const wordReplacerEnabled = useAppStore((s) => s.wordReplacerEnabled)
  const wordReplacerRules = useAppStore((s) => s.wordReplacerRules)
  const wr = (t: string) => (wordReplacerEnabled && wordReplacerRules.length > 0 ? applyWordReplacer(t, wordReplacerRules) : t)

  useEffect(() => {
    let cancelled = false
    setVerses(null)
    window.bible.queryChapter(side.bookId, displayChapter, textId).then((vs) => {
      if (!cancelled) setVerses(vs)
    }).catch(() => { if (!cancelled) setVerses([]) })
    return () => { cancelled = true }
  }, [side.bookId, displayChapter, textId])

  const title = `${hermasAwareChapterLabel(side.bookId, displayChapter)}${textId === 'lxx' ? ' (LXX)' : ''}`

  const handleClick = (verseNum: number, shiftKey: boolean) => {
    const next = new Set(selected)
    if (shiftKey && lastClickedRef.current !== null) {
      const lo = Math.min(lastClickedRef.current, verseNum)
      const hi = Math.max(lastClickedRef.current, verseNum)
      for (let v = lo; v <= hi; v++) next.add(v)
    } else {
      if (next.has(verseNum)) next.delete(verseNum)
      else next.add(verseNum)
    }
    lastClickedRef.current = verseNum
    onChange(next)
  }

  const q = findQuery.trim().toLowerCase()
  const matchedVerseNums = useMemo(() => {
    if (!q || !verses) return null
    const set = new Set<number>()
    for (const v of verses) {
      if (wr(v.text).toLowerCase().includes(q)) set.add(v.verse_num)
    }
    return set
  }, [q, verses, wordReplacerEnabled, wordReplacerRules]) // eslint-disable-line react-hooks/exhaustive-deps
  const matchedList = useMemo(() => (matchedVerseNums ? [...matchedVerseNums].sort((a, b) => a - b) : []), [matchedVerseNums])

  // Enter / Shift+Enter cycle through occurrences — a plain filtered list with no way to step
  // through matches one at a time wasn't enough ("i can go through the occurrences"). Resets to
  // the first match whenever the query (or the chapter/edition it's searching) changes.
  const [matchIndex, setMatchIndex] = useState(0)
  useEffect(() => { setMatchIndex(0) }, [q, side.bookId, displayChapter, textId])
  const currentMatchVerse = matchedList.length > 0 ? matchedList[matchIndex % matchedList.length] : null

  // Scroll the CURRENT match into view whenever it changes (query edit, or Enter/Shift+Enter).
  useEffect(() => {
    if (currentMatchVerse == null) return
    const el = containerRef.current?.querySelector<HTMLElement>(`[data-verse-num="${currentMatchVerse}"]`)
    el?.scrollIntoView({ block: 'center' })
  }, [currentMatchVerse])

  function cycleMatch(dir: 1 | -1) {
    if (matchedList.length === 0) return
    setMatchIndex((i) => (i + dir + matchedList.length) % matchedList.length)
  }

  return (
    <div
      className="flex-1 min-w-0 h-full overflow-y-auto"
      ref={containerRef}
      onMouseEnter={onRequestFind /* only ARMS this side as the Cmd+F target — doesn't open the bar itself */}
    >
      <div
        className="sticky top-0 z-10 px-4 py-2"
        style={{
          background: 'rgb(var(--color-surface-2, 24 24 32))',
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accentColor, margin: 0 }}>{label}</p>
            <p style={{ fontSize: 13 * fontScale, fontWeight: 600, color: textColor, margin: '2px 0 0' }}>{title}</p>
          </div>
          {lxxAvailable && (
            <button
              onClick={() => setTextId((t) => (t === 'lxx' ? 'kjva' : 'lxx'))}
              title={textId === 'lxx' ? 'Switch to KJV' : 'Switch to Brenton LXX'}
              style={{
                flexShrink: 0, fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999,
                cursor: 'pointer', border: `1px solid ${borderColor}`,
                background: textId === 'lxx' ? 'rgb(var(--color-accent) / 0.16)' : 'transparent',
                color: textId === 'lxx' ? accentColor : muteColor,
              }}
            >{textId === 'lxx' ? 'LXX' : 'KJV'}</button>
          )}
        </div>
        {findActive && (
          <div className="flex items-center gap-2 mt-2">
            <Search size={12} style={{ color: muteColor, flexShrink: 0 }} />
            <input
              autoFocus
              value={findQuery}
              onChange={(e) => onFindQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { onCloseFind(); return }
                if (e.key === 'Enter') { e.preventDefault(); cycleMatch(e.shiftKey ? -1 : 1) }
              }}
              placeholder="Find in this chapter…"
              style={{
                flex: 1, minWidth: 0, fontSize: 12, background: 'rgb(var(--color-surface-1))',
                border: `1px solid ${borderColor}`, borderRadius: 6, padding: '3px 7px', color: textColor, outline: 'none',
              }}
            />
            {matchedList.length > 0 && (
              <>
                <span style={{ fontSize: 10.5, color: muteColor, flexShrink: 0, whiteSpace: 'nowrap' }}>{(matchIndex % matchedList.length) + 1}/{matchedList.length}</span>
                <button onClick={() => cycleMatch(-1)} title="Previous match (Shift+Enter)" style={{ flexShrink: 0, background: 'transparent', border: 'none', color: muteColor, cursor: 'pointer', display: 'flex', padding: '0 2px' }}>‹</button>
                <button onClick={() => cycleMatch(1)} title="Next match (Enter)" style={{ flexShrink: 0, background: 'transparent', border: 'none', color: muteColor, cursor: 'pointer', display: 'flex', padding: '0 2px' }}>›</button>
              </>
            )}
            {q && matchedList.length === 0 && (
              <span style={{ fontSize: 10.5, color: muteColor, flexShrink: 0 }}>0</span>
            )}
            <button onClick={onCloseFind} style={{ flexShrink: 0, background: 'transparent', border: 'none', color: muteColor, cursor: 'pointer', display: 'flex' }}><X size={13} /></button>
          </div>
        )}
      </div>
      <div className="px-3 py-3">
        {verses === null && (
          <p style={{ fontSize: 12 * fontScale, color: muteColor, padding: '8px 4px' }}>Loading…</p>
        )}
        {verses !== null && verses.length === 0 && (
          <p style={{ fontSize: 12 * fontScale, color: muteColor, padding: '8px 4px' }}>No verses found.</p>
        )}
        {verses?.map((v) => {
          const isSelected = selected.has(v.verse_num)
          const isMatch = matchedVerseNums?.has(v.verse_num) ?? false
          const isCurrentMatch = isMatch && v.verse_num === currentMatchVerse
          const dimmedByFind = matchedVerseNums != null && !isMatch
          return (
            <button
              key={v.verse_num}
              data-verse-num={v.verse_num}
              onClick={(e) => handleClick(v.verse_num, e.shiftKey)}
              className="flex w-full items-start gap-2 rounded-md text-left transition-colors"
              style={{
                padding: '4px 8px',
                marginBottom: 1,
                // Selection is conveyed by the border + a LOW-opacity accent wash — kept subtle
                // enough (0.1, not the earlier 0.16) that the verse-number column (below) still
                // reads clearly against it in dark mode; number contrast no longer rides on the
                // same accent hue as the fill (see the number span's color, split out from the
                // background). Built with the `rgb(var(...) / alpha)` form (not string-replace
                // hackery on the already-composed accentColor) — that replace chain quietly
                // produced INVALID rgba() output (a stray extra comma landed inside the var()
                // fallback instead of becoming the alpha channel), which browsers resolve as
                // fully OPAQUE — exactly why selected rows (and the LXX/KJV toggle below) read
                // as solid/too-bright instead of a subtle tint.
                background: isSelected ? 'rgb(var(--color-accent) / 0.1)' : isCurrentMatch ? 'rgb(var(--color-accent) / 0.18)' : isMatch ? 'rgb(var(--color-accent) / 0.08)' : 'transparent',
                border: `1px solid ${isSelected ? accentColor : isCurrentMatch ? accentColor : 'transparent'}`,
                cursor: 'pointer',
                opacity: dimmedByFind ? 0.45 : 1,
              }}
            >
              <span
                style={{
                  fontSize: 11 * fontScale, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
                  // Always the theme's normal high-contrast text color (never the accent hue) so
                  // the number stays legible against the accent-tinted selected background in
                  // BOTH light and dark mode — a selected number rendered IN accent color on top
                  // of an accent-tinted fill was exactly the low-contrast combination that made
                  // it unreadable in dark mode.
                  color: isSelected ? textColor : muteColor,
                  minWidth: `${Math.max(2, String(v.verse_num).length)}ch`,
                  textAlign: 'right', flexShrink: 0, paddingTop: 1,
                }}
              >
                {v.verse_num}
              </span>
              <span style={{ fontSize: 13 * fontScale, lineHeight: 1.5, color: textColor }}>{wr(v.text)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function VersePickerApp() {
  const [payload, setPayload] = useState<VersePickerPayload | null>(null)
  const [fromSelected, setFromSelected] = useState<Set<number>>(new Set())
  const [toSelected, setToSelected] = useState<Set<number>>(new Set())
  const [lxxBookIds, setLxxBookIds] = useState<Set<string>>(new Set())
  const [fontScale, setFontScale] = useState(readStoredFontScale)
  // Which side Cmd+F should target — whichever column the mouse most recently entered.
  const [findSide, setFindSide] = useState<'from' | 'to'>('from')
  const [findOpenSide, setFindOpenSide] = useState<'from' | 'to' | null>(null)
  const [fromFindQuery, setFromFindQuery] = useState('')
  const [toFindQuery, setToFindQuery] = useState('')

  const theme = useAppStore((s) => s.theme)
  const themePreset = useAppStore((s) => s.themePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const [systemIsDark, setSystemIsDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  useEffect(() => {
    applyThemeToDocument({
      theme, themePreset, systemIsDark, systemAccentColor,
      backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity,
    })
  }, [theme, themePreset, systemIsDark, systemAccentColor, backgroundAnimationEnabled, backgroundAnimationStyle, backgroundAnimationIntensity])

  useEffect(() => {
    window.app.onVersePickerInit((p) => {
      setPayload(p)
      setFromSelected(new Set(p.from.selected))
      setToSelected(new Set(p.to.selected))
    })
    window.app.signalVersePickerReady()
  }, [])

  // Which books exist in the LXX edition at all — same lookup BiblePanel's own KJV/LXX switch
  // button uses to decide whether that button applies to the current book.
  useEffect(() => {
    window.bible.getBooks('lxx').then((bks) => setLxxBookIds(new Set(bks.map((b) => b.id)))).catch(() => {})
  }, [])

  // Cmd+F / Ctrl+F opens a find bar in whichever column the mouse is currently over (tracked via
  // each column's onMouseEnter below); Escape (when neither input already grabbed it) closes it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpenSide(findSide)
      } else if (e.key === 'Escape') {
        setFindOpenSide(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [findSide])

  const zoom = (delta: number) => {
    setFontScale((prev) => {
      const next = Math.max(0.7, Math.min(2, Math.round((prev + delta) * 20) / 20))
      try { localStorage.setItem(FONT_SCALE_KEY, String(next)) } catch { /* storage disabled */ }
      return next
    })
  }
  // Cmd+= / Cmd+- also zoom, matching the rest of the app's zoom shortcuts.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoom(0.05) }
      else if (e.key === '-') { e.preventDefault(); zoom(-0.05) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Live-apply — every click pushes the change straight back to the opener window, no Done step.
  const pushChange = (side: 'from' | 'to', next: Set<number>) => {
    if (!payload) return
    window.app.pushVersePickerSelectionChange({ connectionId: payload.connectionId, side, selected: [...next].sort((a, b) => a - b) })
  }

  const textColor = 'rgb(var(--color-text-primary, 220 220 230))'
  const muteColor = 'rgb(var(--color-text-muted, 120 120 140))'
  const accentColor = 'rgb(var(--color-accent, 100 130 200))'
  const borderColor = 'rgb(var(--color-surface-3, 50 50 70))'

  const bothEmpty = payload === null

  return (
    <div
      className="h-screen w-screen flex flex-col overflow-hidden"
      style={{ background: 'rgb(var(--color-surface-1))' }}
    >
      <div
        className="flex items-center justify-center flex-shrink-0"
        style={{ height: 36, WebkitAppRegion: 'drag', paddingLeft: 78, position: 'relative' } as React.CSSProperties}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: muteColor }}>
          Click a verse number to tie it — shift-click for a range
        </span>
        <div
          className="flex items-center gap-1"
          style={{ position: 'absolute', right: 12, top: 0, bottom: 0, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button onClick={() => zoom(-0.05)} title="Zoom out" style={{ background: 'transparent', border: 'none', color: muteColor, cursor: 'pointer', display: 'flex', padding: 4 }}><ZoomOut size={14} /></button>
          <span style={{ fontSize: 10.5, color: muteColor, minWidth: 30, textAlign: 'center' }}>{Math.round(fontScale * 100)}%</span>
          <button onClick={() => zoom(0.05)} title="Zoom in" style={{ background: 'transparent', border: 'none', color: muteColor, cursor: 'pointer', display: 'flex', padding: 4 }}><ZoomIn size={14} /></button>
        </div>
      </div>
      {bothEmpty ? (
        <div className="flex-1 flex items-center justify-center">
          <p style={{ fontSize: 13, color: muteColor }}>Loading…</p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex" style={{ borderTop: `1px solid ${borderColor}` }}>
          <VersePickerColumn
            label="From"
            side={payload.from}
            selected={fromSelected}
            onChange={(next) => { setFromSelected(next); pushChange('from', next) }}
            accentColor={accentColor}
            textColor={textColor}
            muteColor={muteColor}
            borderColor={borderColor}
            fontScale={fontScale}
            lxxAvailable={lxxBookIds.has(payload.from.bookId)}
            findQuery={fromFindQuery}
            findActive={findOpenSide === 'from'}
            onRequestFind={() => setFindSide('from')}
            onCloseFind={() => { setFindOpenSide(null); setFromFindQuery('') }}
            onFindQueryChange={setFromFindQuery}
          />
          <div style={{ width: 1, background: borderColor, flexShrink: 0 }} />
          <VersePickerColumn
            label="To"
            side={payload.to}
            selected={toSelected}
            onChange={(next) => { setToSelected(next); pushChange('to', next) }}
            accentColor={accentColor}
            textColor={textColor}
            muteColor={muteColor}
            borderColor={borderColor}
            fontScale={fontScale}
            lxxAvailable={lxxBookIds.has(payload.to.bookId)}
            findQuery={toFindQuery}
            findActive={findOpenSide === 'to'}
            onRequestFind={() => setFindSide('to')}
            onCloseFind={() => { setFindOpenSide(null); setToFindQuery('') }}
            onFindQueryChange={setToFindQuery}
          />
        </div>
      )}
    </div>
  )
}
