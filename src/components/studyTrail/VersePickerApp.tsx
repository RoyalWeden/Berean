import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import { applyThemeToDocument } from '@/lib/applyTheme'
import { hermasAwareChapterLabel } from '@/lib/hermasMap'
import type { Verse } from '@/types'
import type { VersePickerPayload, VersePickerSide } from '@/types/versePicker'

/** Renders one chapter's verse numbers as a clickable grid — click = toggle, shift-click =
 *  range-select from the last-clicked verse in this same column (per the confirmed picker
 *  interaction model). Chapter is fixed (locked to the connection's origin/destination chapter),
 *  so this never needs its own navigation UI. */
function VersePickerColumn({
  label, side, selected, onChange, accentColor, textColor, muteColor, borderColor,
}: {
  label: string
  side: VersePickerSide
  selected: Set<number>
  onChange: (next: Set<number>) => void
  accentColor: string
  textColor: string
  muteColor: string
  borderColor: string
}) {
  const [verses, setVerses] = useState<Verse[] | null>(null)
  const lastClickedRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setVerses(null)
    window.bible.queryChapter(side.bookId, side.chapter, 'kjva').then((vs) => {
      if (!cancelled) setVerses(vs)
    }).catch(() => { if (!cancelled) setVerses([]) })
    return () => { cancelled = true }
  }, [side.bookId, side.chapter])

  const title = `${hermasAwareChapterLabel(side.bookId, side.chapter)}`

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

  return (
    <div className="flex-1 min-w-0 h-full overflow-y-auto" style={{ borderRight: side.chapter ? undefined : undefined }}>
      <div
        className="sticky top-0 z-10 px-4 py-2"
        style={{
          background: 'rgb(var(--color-surface-2, 24 24 32))',
          borderBottom: `1px solid ${borderColor}`,
        }}
      >
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: accentColor, margin: 0 }}>{label}</p>
        <p style={{ fontSize: 13, fontWeight: 600, color: textColor, margin: '2px 0 0' }}>{title}</p>
      </div>
      <div className="px-3 py-3">
        {verses === null && (
          <p style={{ fontSize: 12, color: muteColor, padding: '8px 4px' }}>Loading…</p>
        )}
        {verses !== null && verses.length === 0 && (
          <p style={{ fontSize: 12, color: muteColor, padding: '8px 4px' }}>No verses found.</p>
        )}
        {verses?.map((v) => {
          const isSelected = selected.has(v.verse_num)
          return (
            <button
              key={v.verse_num}
              onClick={(e) => handleClick(v.verse_num, e.shiftKey)}
              className="flex w-full items-start gap-2 rounded-md text-left transition-colors"
              style={{
                padding: '4px 8px',
                marginBottom: 1,
                background: isSelected ? `${accentColor.replace('rgb(', 'rgba(').replace(')', ', 0.16)')}` : 'transparent',
                border: `1px solid ${isSelected ? accentColor : 'transparent'}`,
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  fontSize: 11, fontWeight: 700, fontFamily: 'ui-monospace, monospace',
                  color: isSelected ? accentColor : muteColor,
                  minWidth: `${Math.max(2, String(v.verse_num).length)}ch`,
                  textAlign: 'right', flexShrink: 0, paddingTop: 1,
                }}
              >
                {v.verse_num}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: textColor }}>{v.text}</span>
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
        style={{ height: 36, WebkitAppRegion: 'drag', paddingLeft: 78 } as React.CSSProperties}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: muteColor }}>
          Click a verse number to tie it — shift-click for a range
        </span>
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
          />
        </div>
      )}
    </div>
  )
}
