import React from 'react'
import { useAppStore } from '@/store'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { THEME_PRESETS } from '@/lib/themePresets'
import { FONT_MAP } from '@/lib/fontFamilies'
import ICloudSection from '@/components/settings/sections/ICloudSection'
import AboutSection from '@/components/settings/sections/AboutSection'
import { YouTubeSettingsPage } from './YouTubeSettingsPage'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { BIBLE_FONT_MAX, BIBLE_FONT_MIN } from '../reader/usePinchFontSize'

/**
 * Settings on the phone (R079/R087): bound to the same store keys as desktop (and persisted to
 * the same `settings` rows by src/lib/settingsBridge.ts). Reading + appearance + iCloud + about
 * here; the remaining desktop sections are added page by page in the settings phase.
 */
export function SettingsPage({ onBack }: { onBack?: () => void }) {
  const nav = useNavigation()
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const preset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const fontSize = useAppStore((s) => s.bibleFontSize)
  const setFontSize = useAppStore((s) => s.setBibleFontSize)
  const lineHeight = useAppStore((s) => s.bibleLineHeight)
  const setLineHeight = useAppStore((s) => s.setBibleLineHeight)
  const family = useAppStore((s) => s.scriptureFontFamily)
  const setFamily = useAppStore((s) => s.setScriptureFontFamily)
  const translation = useAppStore((s) => s.defaultBibleTranslation)
  const setTranslation = useAppStore((s) => s.setDefaultBibleTranslation)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  const setShowVerseNumbers = useAppStore((s) => s.setShowVerseNumbers)
  const presetLabel = THEME_PRESETS.find((p) => p.id === preset)?.label ?? (preset === 'system-accent' ? 'System accent' : 'Default')

  return (
    <Page title="Settings" onBack={onBack}>
      <ListSection title="Appearance">
        <Row title="Theme" right={
          <Segmented value={theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => setTheme(v as 'system' | 'light' | 'dark')} />
        } />
        <Row title="Colour preset" subtitle={presetLabel} chevron onClick={() => nav.push('settings-preset', (
          <Page title="Colour preset" onBack={nav.pop}>
            <ListSection>
              {THEME_PRESETS.map((p) => (
                <Row key={p.id || 'default'} title={p.label} subtitle={p.family} right={p.id === preset ? '✓' : undefined} onClick={() => { setThemePreset(p.id); nav.pop() }} />
              ))}
            </ListSection>
          </Page>
        ))} />
      </ListSection>
      <ListSection title="Reading">
        <Row title="Text size" subtitle="Pinch on the reader also changes this" right={
          <Stepper value={fontSize} min={BIBLE_FONT_MIN} max={BIBLE_FONT_MAX} onChange={setFontSize} label="px" />
        } />
        <Row title="Line height" right={
          <Segmented value={lineHeight} options={[['compact', 'Compact'], ['comfortable', 'Normal'], ['spacious', 'Airy']]} onChange={(v) => setLineHeight(v as 'compact' | 'comfortable' | 'spacious')} />
        } />
        <Row title="Scripture font" subtitle={family} chevron onClick={() => nav.push('settings-font', (
          <Page title="Scripture font" onBack={nav.pop}>
            <ListSection>
              {Object.keys(FONT_MAP).map((f) => (
                <Row key={f} title={<span style={{ fontFamily: FONT_MAP[f] }}>{f === 'system' ? 'System' : f}</span>} right={f === family ? '✓' : undefined} onClick={() => { setFamily(f); nav.pop() }} />
              ))}
            </ListSection>
          </Page>
        ))} />
        <Row title="Default translation" subtitle={TRANSLATIONS.find((t) => t.id === translation)?.label ?? translation} chevron onClick={() => nav.push('settings-translation', (
          <Page title="Default translation" onBack={nav.pop}>
            <ListSection>
              {TRANSLATIONS.map((t) => (
                <Row key={t.id} title={t.label} subtitle={t.description} right={t.id === translation ? '✓' : undefined} onClick={() => { setTranslation(t.id); nav.pop() }} />
              ))}
            </ListSection>
          </Page>
        ))} />
        <Row title="Verse numbers" right={<Toggle checked={showVerseNumbers} onChange={setShowVerseNumbers} label="Verse numbers" />} />
      </ListSection>
      <ListSection title="iCloud">
        <div className="mobile-embedded-section"><ICloudSection /></div>
      </ListSection>
      <ListSection title="Video">
        <Row title="YouTube" subtitle="Watch history, transcript packs" chevron onClick={() => nav.push('settings-youtube', <YouTubeSettingsPage onBack={nav.pop} />)} />
      </ListSection>
      <ListSection title="About">
        <div className="mobile-embedded-section"><AboutSection /></div>
      </ListSection>
    </Page>
  )
}

export function Segmented({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (
    <div className="mobile-segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} type="button" role="radio" aria-checked={v === value} className={v === value ? 'is-on' : ''} onClick={() => onChange(v)}>{label}</button>
      ))}
    </div>
  )
}

export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label?: string }) {
  return (
    <div className="mobile-stepper">
      <button type="button" aria-label="Smaller" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <span aria-live="polite">{value}{label ? ` ${label}` : ''}</span>
      <button type="button" aria-label="Larger" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </div>
  )
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`mobile-toggle${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="mobile-toggle-knob" />
    </button>
  )
}
