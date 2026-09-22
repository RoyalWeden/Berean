import React from 'react'
import { useAppStore } from '@/store'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { THEME_PRESETS } from '@/lib/themePresets'
import { FONT_MAP } from '@/lib/fontFamilies'
import ICloudSection from '@/components/settings/sections/ICloudSection'
import AboutSection from '@/components/settings/sections/AboutSection'
import { YouTubeSettingsPage } from './YouTubeSettingsPage'
import { NotesSettingsPage } from './NotesSettingsPage'
import { AudioSettingsPage } from './AudioSettingsPage'
import { DataSettingsPage } from './DataSettingsPage'
import { ExperimentalSettingsPage } from './ExperimentalSettingsPage'
import { WordReplacerPage } from './WordReplacerPage'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { BIBLE_FONT_MAX, BIBLE_FONT_MIN } from '../reader/usePinchFontSize'
import { Segmented, Stepper, Toggle } from './SettingsControls'
import './settings.css'

// Re-exported so mobile/reader/ReaderOptionsSheet.tsx's existing `from '../settings/SettingsPage'`
// import keeps working — the real implementations live in SettingsControls.tsx (a leaf module)
// so every new sub-page below can import them without a circular dependency through this file.
export { Segmented, Stepper, Toggle }

/**
 * Settings on the phone (R079/R087): bound to the same store keys as desktop (and persisted
 * either through src/lib/settingsBridge.ts's small "must be in SQLite" list, or — for most of
 * these — through zustand's own localStorage persistence, exactly like desktop; see
 * store/index.ts's partialize block). Heavier sections are pushed as their own pages
 * (Notes/Audio/Data/Experimental/Word replacer) rather than inlined here.
 *
 * Left out entirely (see each page's own doc comment or the lane report for why): Vault sync
 * (desktop-only `window.vault`; iCloud is the phone's sync story), Import — e-Sword/BibleGateway
 * (desktop-only `window.bgImport`/`window.eSwordImport`), Viewer window (desktop-only second
 * window), Shortcuts (no keyboard), Study Trail settings (no phone Study Trail UI exists yet —
 * MobileApp.tsx's More page already says so: "phone page in a later phase").
 */
export function SettingsPage({ onBack }: { onBack?: () => void }) {
  const nav = useNavigation()
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const preset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const systemAccentColor = useAppStore((s) => s.systemAccentColor)
  const glassAppearance = useAppStore((s) => s.glassAppearance)
  const setGlassAppearance = useAppStore((s) => s.setGlassAppearance)
  const backgroundAnimationEnabled = useAppStore((s) => s.backgroundAnimationEnabled)
  const setBackgroundAnimationEnabled = useAppStore((s) => s.setBackgroundAnimationEnabled)
  const backgroundAnimationStyle = useAppStore((s) => s.backgroundAnimationStyle)
  const setBackgroundAnimationStyle = useAppStore((s) => s.setBackgroundAnimationStyle)
  const backgroundAnimationIntensity = useAppStore((s) => s.backgroundAnimationIntensity)
  const setBackgroundAnimationIntensity = useAppStore((s) => s.setBackgroundAnimationIntensity)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const setUiFontFamily = useAppStore((s) => s.setUiFontFamily)
  const notesFontFamily = useAppStore((s) => s.notesFontFamily)
  const setNotesFontFamily = useAppStore((s) => s.setNotesFontFamily)
  const fontSize = useAppStore((s) => s.bibleFontSize)
  const setFontSize = useAppStore((s) => s.setBibleFontSize)
  const lineHeight = useAppStore((s) => s.bibleLineHeight)
  const setLineHeight = useAppStore((s) => s.setBibleLineHeight)
  const family = useAppStore((s) => s.scriptureFontFamily)
  const setFamily = useAppStore((s) => s.setScriptureFontFamily)
  const translation = useAppStore((s) => s.defaultBibleTranslation)
  const setTranslation = useAppStore((s) => s.setDefaultBibleTranslation)
  const hermasTranslation = useAppStore((s) => s.hermasTranslation)
  const setHermasTranslation = useAppStore((s) => s.setHermasTranslation)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  const setShowVerseNumbers = useAppStore((s) => s.setShowVerseNumbers)
  const showRedLetters = useAppStore((s) => s.showRedLetters)
  const setShowRedLetters = useAppStore((s) => s.setShowRedLetters)
  const askJumpReason = useAppStore((s) => s.studyTrailAskChapterJumpReason)
  const setAskJumpReason = useAppStore((s) => s.setStudyTrailAskChapterJumpReason)
  const continuousChapterScroll = useAppStore((s) => s.continuousChapterScroll)
  const setContinuousChapterScroll = useAppStore((s) => s.setContinuousChapterScroll)
  const presetLabel = THEME_PRESETS.find((p) => p.id === preset)?.label ?? (preset === 'system-accent' ? 'System accent' : 'Default')

  // Mirrors SettingsModal.tsx's `activePreset` / `curatedAnimationActive`: some themes carry
  // their own always-on ambient animation, which locks the toggle on (see the note below).
  const activePreset = THEME_PRESETS.find((p) => preset === p.id || preset === `${p.id}-dark` || preset === `${p.id}-light`) ?? THEME_PRESETS[0]
  const curatedAnimationActive = !!activePreset.animationStyle

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
        <Row title="Glass appearance" subtitle="How much shows through menus, panels and sheets" right={
          <Segmented value={glassAppearance} options={[['clear', 'Clear'], ['regular', 'Regular'], ['tinted', 'Tinted']]} onChange={(v) => setGlassAppearance(v as 'clear' | 'regular' | 'tinted')} />
        } />
        {preset === 'system-accent' && !systemAccentColor && (
          <div className="settings-field-hint">"System" accent falls back to the app's default accent — iPhone doesn't expose a live system accent colour to apps the way macOS does.</div>
        )}
      </ListSection>

      <ListSection title="Ambient background animation">
        <Row
          title="Enabled"
          subtitle={curatedAnimationActive ? `${activePreset.label} has its own animation — on and locked` : 'Adds a subtle motion effect using the theme accent colour'}
          right={<Toggle checked={backgroundAnimationEnabled || curatedAnimationActive} onChange={(v) => { if (!curatedAnimationActive) setBackgroundAnimationEnabled(v) }} label="Ambient background animation" />}
        />
        {(backgroundAnimationEnabled || curatedAnimationActive) && (
          <>
            <Row title="Style" right={
              <Segmented
                value={curatedAnimationActive ? 'auto' : backgroundAnimationStyle}
                options={[['auto', 'Auto'], ['drift', 'Drift'], ['pulse', 'Pulse'], ['shimmer', 'Shimmer'], ['particles', 'Particles'], ['flicker', 'Flicker']]}
                onChange={(v) => { if (!curatedAnimationActive) setBackgroundAnimationStyle(v as typeof backgroundAnimationStyle) }}
              />
            } />
            <Row title="Intensity" right={
              <Segmented value={backgroundAnimationIntensity} options={[['subtle', 'Subtle'], ['noticeable', 'Noticeable'], ['bold', 'Bold']]} onChange={(v) => setBackgroundAnimationIntensity(v as typeof backgroundAnimationIntensity)} />
            } />
          </>
        )}
      </ListSection>

      <ListSection title="Fonts">
        <FontPickerRow nav={nav} label="Scripture" value={family} onChange={setFamily} />
        <FontPickerRow nav={nav} label="Notes" value={notesFontFamily} onChange={setNotesFontFamily} />
        <FontPickerRow nav={nav} label="UI chrome" value={uiFontFamily} onChange={setUiFontFamily} />
      </ListSection>

      <ListSection title="Reading">
        <Row title="Default translation" subtitle={TRANSLATIONS.find((t) => t.id === translation)?.label ?? translation} chevron onClick={() => nav.push('settings-translation', (
          <Page title="Default translation" onBack={nav.pop}>
            <ListSection>
              {TRANSLATIONS.map((t) => (
                <Row key={t.id} title={t.label} subtitle={t.description} right={t.id === translation ? '✓' : undefined} onClick={() => { setTranslation(t.id); nav.pop() }} />
              ))}
            </ListSection>
          </Page>
        ))} />
        <Row title="Shepherd of Hermas translation" subtitle={hermasTranslation === 'hermas_taylor' ? 'Charles Taylor (1903)' : 'Roberts-Donaldson (Ante-Nicene Fathers)'} chevron onClick={() => nav.push('settings-hermas', (
          <Page title="Hermas translation" onBack={nav.pop}>
            <ListSection>
              <Row title="Roberts-Donaldson (Ante-Nicene Fathers)" right={hermasTranslation === 'hermas' ? '✓' : undefined} onClick={() => { setHermasTranslation('hermas'); nav.pop() }} />
              <Row title="Charles Taylor (1903)" subtitle="Finer verse divisions, includes Similitude 7 — best-effort OCR ingest" right={hermasTranslation === 'hermas_taylor' ? '✓' : undefined} onClick={() => { setHermasTranslation('hermas_taylor'); nav.pop() }} />
            </ListSection>
          </Page>
        ))} />
        <Row title="Text size" subtitle="Pinch on the reader also changes this" right={
          <Stepper value={fontSize} min={BIBLE_FONT_MIN} max={BIBLE_FONT_MAX} onChange={setFontSize} label="px" />
        } />
        <Row title="Line height" right={
          <Segmented value={lineHeight} options={[['compact', 'Compact'], ['comfortable', 'Normal'], ['spacious', 'Airy']]} onChange={(v) => setLineHeight(v as 'compact' | 'comfortable' | 'spacious')} />
        } />
        <Row title="Verse numbers" right={<Toggle checked={showVerseNumbers} onChange={setShowVerseNumbers} label="Verse numbers" />} />
        <Row title="Red letter text" subtitle="Highlight words of Yeshua in the KJVA text (requires tagged source)" right={<Toggle checked={showRedLetters} onChange={setShowRedLetters} label="Red letter text" />} />
        <Row title="Continuous chapter scroll" subtitle="Load the next/previous chapter automatically as you scroll" right={<Toggle checked={continuousChapterScroll} onChange={setContinuousChapterScroll} label="Continuous chapter scroll" />} />
        <Row title="Word replacer" subtitle="Divine-name and archaic-name substitution" chevron onClick={() => nav.push('settings-word-replacer', <WordReplacerPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="Notes">
        <Row title="Notes" subtitle="Reference detection, editor, print & export" chevron onClick={() => nav.push('settings-notes', <NotesSettingsPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="Audio">
        <Row title="Read Aloud" subtitle="Voice, speed, auto-advance" chevron onClick={() => nav.push('settings-audio', <AudioSettingsPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="iCloud">
        <div className="mobile-embedded-section"><ICloudSection /></div>
      </ListSection>

      <ListSection title="Video">
        <Row title="YouTube" subtitle="Watch history, transcript packs" chevron onClick={() => nav.push('settings-youtube', <YouTubeSettingsPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="Data">
        <Row title="Data" subtitle="History, workspaces, sessions, danger zone" chevron onClick={() => nav.push('settings-data', <DataSettingsPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="Study trail">
        <Row title="Ask why you jumped chapters" subtitle="A small prompt after a chapter jump Study Trail can't explain (search, manual pick, tab switch)" right={<Toggle checked={askJumpReason} onChange={setAskJumpReason} label="Ask why you jumped chapters" />} />
        <Row title="Open Study trail" subtitle="Sessions, map, threads, recap" chevron onClick={() => { void window.app.openStudyTrailWindow?.() }} />
      </ListSection>

      <ListSection title="Experimental">
        <Row title="Experimental" subtitle="Opt-in features off by default" chevron onClick={() => nav.push('settings-experimental', <ExperimentalSettingsPage onBack={nav.pop} />)} />
      </ListSection>

      <ListSection title="About">
        <div className="mobile-embedded-section"><AboutSection /></div>
      </ListSection>
    </Page>
  )
}

function FontPickerRow({ nav, label, value, onChange }: { nav: ReturnType<typeof useNavigation>; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Row title={label} subtitle={value === 'system' ? 'System' : value} chevron onClick={() => nav.push(`settings-font-${label}`, (
      <Page title={label} onBack={nav.pop}>
        <ListSection>
          {Object.keys(FONT_MAP).map((f) => (
            <Row key={f} title={<span style={{ fontFamily: FONT_MAP[f] }}>{f === 'system' ? 'System' : f}</span>} right={f === value ? '✓' : undefined} onClick={() => { onChange(f); nav.pop() }} />
          ))}
        </ListSection>
      </Page>
    ))} />
  )
}
