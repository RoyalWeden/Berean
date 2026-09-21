import React from 'react'
import { useAppStore } from '@/store'
import { FONT_MAP } from '@/lib/fontFamilies'
import { Segmented, Stepper, Toggle } from '../settings/SettingsPage'
import { BIBLE_FONT_MAX, BIBLE_FONT_MIN } from './usePinchFontSize'

/** "Aa" sheet on the reader (R079/R089): the same store keys as Settings → Reading, one tap away. */
export function ReaderOptionsSheet() {
  const fontSize = useAppStore((s) => s.bibleFontSize)
  const setFontSize = useAppStore((s) => s.setBibleFontSize)
  const lineHeight = useAppStore((s) => s.bibleLineHeight)
  const setLineHeight = useAppStore((s) => s.setBibleLineHeight)
  const family = useAppStore((s) => s.scriptureFontFamily)
  const setFamily = useAppStore((s) => s.setScriptureFontFamily)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  const setShowVerseNumbers = useAppStore((s) => s.setShowVerseNumbers)
  const continuous = useAppStore((s) => s.continuousChapterScroll)
  const setContinuous = useAppStore((s) => s.setContinuousChapterScroll)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  return (
    <div className="mobile-reader-options">
      <div className="mobile-option-row"><span>Text size</span><Stepper value={fontSize} min={BIBLE_FONT_MIN} max={BIBLE_FONT_MAX} onChange={setFontSize} /></div>
      <div className="mobile-option-row"><span>Line height</span><Segmented value={lineHeight} options={[['compact', 'Compact'], ['comfortable', 'Normal'], ['spacious', 'Airy']]} onChange={(v) => setLineHeight(v as 'compact' | 'comfortable' | 'spacious')} /></div>
      <div className="mobile-option-row"><span>Theme</span><Segmented value={theme} options={[['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => setTheme(v as 'system' | 'light' | 'dark')} /></div>
      <div className="mobile-option-row"><span>Verse numbers</span><Toggle checked={showVerseNumbers} onChange={setShowVerseNumbers} label="Verse numbers" /></div>
      <div className="mobile-option-row"><span>Continuous scroll<small>Chapters flow into one page instead of swiping</small></span><Toggle checked={continuous} onChange={setContinuous} label="Continuous scroll" /></div>
      <div className="mobile-option-label">Scripture font</div>
      <div className="mobile-chip-row">
        {Object.keys(FONT_MAP).map((f) => (
          <button key={f} type="button" className={`mobile-chip${f === family ? ' is-on' : ''}`} style={{ fontFamily: FONT_MAP[f] }} aria-pressed={f === family} onClick={() => setFamily(f)}>{f === 'system' ? 'System' : f}</button>
        ))}
      </div>
    </div>
  )
}
