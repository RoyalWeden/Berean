import React, { useCallback, useEffect, useRef } from 'react'
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
import { ThemePresetPage, themePresetLabel } from './ThemePresetPage'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { BIBLE_FONT_MAX, BIBLE_FONT_MIN } from '../reader/usePinchFontSize'
import { Segmented, Stepper, Toggle } from './SettingsControls'
import { settingsRouteOf, settingsStep, SETTINGS_ROUTE_TITLES, type SettingsRoute } from './settingsRoutes'
import { recordTabStep } from '../search/searchHistory'
import type { SettingsTabState, Tab } from '@/types'
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
/** The page a Settings subsection route opens. `back` returns to the Settings root. */
function routeElement(route: SettingsRoute, back: () => void): React.ReactNode {
  switch (route) {
    case 'preset': return <ThemePresetPage onBack={back} />
    case 'translation': return <DefaultTranslationPage onBack={back} />
    case 'hermas': return <HermasTranslationPage onBack={back} />
    case 'font-scripture': return <FontPickerPage label="Scripture" field="scriptureFontFamily" onBack={back} />
    case 'font-notes': return <FontPickerPage label="Notes" field="notesFontFamily" onBack={back} />
    case 'font-ui': return <FontPickerPage label="UI chrome" field="uiFontFamily" onBack={back} />
    case 'word-replacer': return <WordReplacerPage onBack={back} />
    case 'notes': return <NotesSettingsPage onBack={back} />
    case 'audio': return <AudioSettingsPage onBack={back} />
    case 'youtube': return <YouTubeSettingsPage onBack={back} />
    case 'data': return <DataSettingsPage onBack={back} />
    case 'experimental': return <ExperimentalSettingsPage onBack={back} />
  }
}

/**
 * Subsection routing (SEP25 per-tab history). In a Settings TAB the open subsection lives in the
 * tab state (`settingsRoute`): opening one or going back to the root is a history step, and a
 * back / forward restore that changes `settingsRoute` opens that page (or pops to the root)
 * through this stack. An edge-swipe pop counts as going back. Outside a Settings tab (no tab),
 * rows simply push their pages as before.
 */
function useSettingsRoutes(tab: Tab | null) {
  const nav = useNavigation()
  const tabId = tab?.id ?? null
  const route = tab ? settingsRouteOf(tab.state as SettingsTabState) : null
  const shown = useRef<SettingsRoute | null>(null)
  const go = useCallback((next: SettingsRoute | null) => {
    if (!tabId) return
    const s = useAppStore.getState()
    const cur = settingsRouteOf(s.tabs.search.find((t) => t.id === tabId)?.state as SettingsTabState | undefined)
    if (cur === next) return
    recordTabStep(tabId, settingsStep(cur), settingsStep(next))
    s.updateTabState('search', tabId, { settingsRoute: next } as Partial<SettingsTabState>)
  }, [tabId])
  const back = useCallback(() => (tabId ? go(null) : nav.pop()), [tabId, go, nav])
  const open = useCallback((r: SettingsRoute) => (tabId ? go(r) : nav.push(`settings-${r}`, routeElement(r, nav.pop))), [tabId, go, nav])
  // Tab state → stack (a row tap, a restore, or the persisted route on remount).
  useEffect(() => {
    if (!tabId || route === shown.current) return
    if (route == null) nav.popToRoot()
    else if (shown.current == null) nav.push(`settings-${route}`, routeElement(route, back))
    else { nav.popToRoot(); nav.push(`settings-${route}`, routeElement(route, back)) }
    shown.current = route
  }, [tabId, route]) // eslint-disable-line react-hooks/exhaustive-deps
  // Stack → tab state: an edge-swipe pop back to the root.
  useEffect(() => {
    if (tabId && nav.depth === 0 && shown.current != null) { shown.current = null; go(null) }
  }, [nav.depth]) // eslint-disable-line react-hooks/exhaustive-deps
  return { open }
}

export function SettingsPage({ onBack, tab }: { onBack?: () => void; tab?: Tab }) {
  // The Settings tab this page belongs to (the shell renders it without props today).
  const activeSettingsTab = useAppStore((s) => {
    const t = s.tabs.search.find((x) => x.id === s.activeTabId.search)
    return t?.type === 'settings' ? t : null
  })
  const routes = useSettingsRoutes(tab ?? (onBack ? null : activeSettingsTab))
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const preset = useAppStore((s) => s.themePreset)
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
  const notesFontFamily = useAppStore((s) => s.notesFontFamily)
  const fontSize = useAppStore((s) => s.bibleFontSize)
  const setFontSize = useAppStore((s) => s.setBibleFontSize)
  const lineHeight = useAppStore((s) => s.bibleLineHeight)
  const setLineHeight = useAppStore((s) => s.setBibleLineHeight)
  const family = useAppStore((s) => s.scriptureFontFamily)
  const translation = useAppStore((s) => s.defaultBibleTranslation)
  const hermasTranslation = useAppStore((s) => s.hermasTranslation)
  const showVerseNumbers = useAppStore((s) => s.showVerseNumbers)
  const setShowVerseNumbers = useAppStore((s) => s.setShowVerseNumbers)
  const showRedLetters = useAppStore((s) => s.showRedLetters)
  const setShowRedLetters = useAppStore((s) => s.setShowRedLetters)
  const continuousChapterScroll = useAppStore((s) => s.continuousChapterScroll)
  const setContinuousChapterScroll = useAppStore((s) => s.setContinuousChapterScroll)
  const customThemes = useAppStore((s) => s.customThemes)
  const presetLabel = themePresetLabel(preset, customThemes)

  // On iPhone the colour preset is a Scripture-only theme (SEP25, scriptureTheme.ts): it never
  // reaches the app chrome, so no preset's curated ambient animation runs or locks the toggle
  // (desktop's SettingsModal still does that). Kept as values so the rows below read the same.
  const activePreset = THEME_PRESETS[0]
  const curatedAnimationActive = false

  return (
    <Page title="Settings" onBack={onBack}>
      <ListSection title="Appearance">
        <Row title="Theme" right={
          <Segmented value={theme} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => setTheme(v as 'system' | 'light' | 'dark')} />
        } />
        <Row title="Color preset" subtitle={`${presetLabel} · Scripture only`} chevron onClick={() => routes.open('preset')} />
        <Row title="Glass appearance" subtitle="How much shows through menus, panels and sheets" right={
          <Segmented value={glassAppearance} options={[['clear', 'Clear'], ['regular', 'Regular'], ['tinted', 'Tinted']]} onChange={(v) => setGlassAppearance(v as 'clear' | 'regular' | 'tinted')} />
        } />
        {preset === 'system-accent' && !systemAccentColor && (
          <div className="settings-field-hint">"System" accent falls back to the app's default accent — iPhone doesn't expose a live system accent color to apps the way macOS does.</div>
        )}
      </ListSection>

      <ListSection title="Ambient background animation">
        <Row
          title="Enabled"
          subtitle={curatedAnimationActive ? `${activePreset.label} has its own animation — on and locked` : 'Adds a subtle motion effect using the theme accent color'}
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
        <Row title="Scripture" subtitle={fontLabel(family)} chevron onClick={() => routes.open('font-scripture')} />
        <Row title="Notes" subtitle={fontLabel(notesFontFamily)} chevron onClick={() => routes.open('font-notes')} />
        <Row title="UI chrome" subtitle={fontLabel(uiFontFamily)} chevron onClick={() => routes.open('font-ui')} />
      </ListSection>

      <ListSection title="Reading">
        <Row title="Default translation" subtitle={TRANSLATIONS.find((t) => t.id === translation)?.label ?? translation} chevron onClick={() => routes.open('translation')} />
        <Row title="Shepherd of Hermas translation" subtitle={hermasTranslation === 'hermas_taylor' ? 'Charles Taylor (1903)' : 'Roberts-Donaldson (Ante-Nicene Fathers)'} chevron onClick={() => routes.open('hermas')} />
        <Row title="Text size" subtitle="Pinch on the reader also changes this" right={
          <Stepper value={fontSize} min={BIBLE_FONT_MIN} max={BIBLE_FONT_MAX} onChange={setFontSize} label="px" />
        } />
        <Row title="Line height" right={
          <Segmented value={lineHeight} options={[['compact', 'Compact'], ['comfortable', 'Normal'], ['spacious', 'Airy']]} onChange={(v) => setLineHeight(v as 'compact' | 'comfortable' | 'spacious')} />
        } />
        <Row title="Verse numbers" right={<Toggle checked={showVerseNumbers} onChange={setShowVerseNumbers} label="Verse numbers" />} />
        <Row title="Red letter text" subtitle="Highlight words of Yeshua in the KJVA text (requires tagged source)" right={<Toggle checked={showRedLetters} onChange={setShowRedLetters} label="Red letter text" />} />
        <Row title="Continuous chapter scroll" subtitle="Load the next/previous chapter automatically as you scroll" right={<Toggle checked={continuousChapterScroll} onChange={setContinuousChapterScroll} label="Continuous chapter scroll" />} />
        <Row title="Word replacer" subtitle="Divine-name and archaic-name substitution" chevron onClick={() => routes.open('word-replacer')} />
      </ListSection>

      <ListSection title="Notes">
        <Row title="Notes" subtitle="Reference detection, editor, print & export" chevron onClick={() => routes.open('notes')} />
      </ListSection>

      <ListSection title="Audio">
        <Row title="Read Aloud" subtitle="Voice, speed, auto-advance" chevron onClick={() => routes.open('audio')} />
      </ListSection>

      <ListSection title="iCloud">
        <div className="mobile-embedded-section"><ICloudSection /></div>
        <Row title="Export all notes" subtitle="Every note as a Markdown file, to Files or AirDrop — your own copy, independent of iCloud" chevron
          onClick={() => { void import('@/platform/ios/exportNotes').then((m) => m.exportAllNotesAsMarkdown()).catch((err) => alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`)) }} />
      </ListSection>

      <ListSection title="Video">
        <Row title="YouTube" subtitle="Watch history, transcript packs" chevron onClick={() => routes.open('youtube')} />
      </ListSection>

      <ListSection title="Data">
        <Row title="Data" subtitle="History, saved sessions, danger zone" chevron onClick={() => routes.open('data')} />
      </ListSection>

      <ListSection title="Study trail">
        <Row title="Open Study trail" subtitle="Sessions, map, threads, recap" chevron onClick={() => { void window.app.openStudyTrailWindow?.() }} />
      </ListSection>

      <ListSection title="Experimental">
        <Row title="Experimental" subtitle="Opt-in features off by default" chevron onClick={() => routes.open('experimental')} />
      </ListSection>

      <ListSection title="About">
        <div className="mobile-embedded-section"><AboutSection /></div>
      </ListSection>
    </Page>
  )
}

const fontLabel = (v: string) => (v === 'system' ? 'System' : v)

function FontPickerPage({ label, field, onBack }: { label: string; field: 'scriptureFontFamily' | 'notesFontFamily' | 'uiFontFamily'; onBack: () => void }) {
  const value = useAppStore((s) => s[field])
  const set = (f: string) => {
    const s = useAppStore.getState()
    if (field === 'scriptureFontFamily') s.setScriptureFontFamily(f)
    else if (field === 'notesFontFamily') s.setNotesFontFamily(f)
    else s.setUiFontFamily(f)
  }
  return (
    <Page title={label} onBack={onBack}>
      <ListSection>
        {Object.keys(FONT_MAP).map((f) => (
          <Row key={f} title={<span style={{ fontFamily: FONT_MAP[f] }}>{fontLabel(f)}</span>} right={f === value ? '✓' : undefined} onClick={() => { set(f); onBack() }} />
        ))}
      </ListSection>
    </Page>
  )
}

function DefaultTranslationPage({ onBack }: { onBack: () => void }) {
  const translation = useAppStore((s) => s.defaultBibleTranslation)
  const setTranslation = useAppStore((s) => s.setDefaultBibleTranslation)
  return (
    <Page title="Default translation" onBack={onBack}>
      <ListSection>
        {TRANSLATIONS.map((t) => (
          <Row key={t.id} title={t.label} subtitle={t.description} right={t.id === translation ? '✓' : undefined} onClick={() => { setTranslation(t.id); onBack() }} />
        ))}
      </ListSection>
    </Page>
  )
}

function HermasTranslationPage({ onBack }: { onBack: () => void }) {
  const hermasTranslation = useAppStore((s) => s.hermasTranslation)
  const setHermasTranslation = useAppStore((s) => s.setHermasTranslation)
  return (
    <Page title="Hermas translation" onBack={onBack}>
      <ListSection>
        <Row title="Roberts-Donaldson (Ante-Nicene Fathers)" right={hermasTranslation === 'hermas' ? '✓' : undefined} onClick={() => { setHermasTranslation('hermas'); onBack() }} />
        <Row title="Charles Taylor (1903)" subtitle="Finer verse divisions, includes Similitude 7 — best-effort OCR ingest" right={hermasTranslation === 'hermas_taylor' ? '✓' : undefined} onClick={() => { setHermasTranslation('hermas_taylor'); onBack() }} />
      </ListSection>
    </Page>
  )
}

export { SETTINGS_ROUTE_TITLES }
