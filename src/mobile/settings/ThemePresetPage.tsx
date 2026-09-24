import React, { useEffect, useState } from 'react'
import { SlidersHorizontal, Plus } from 'lucide-react'
import { useAppStore } from '@/store'
import { THEME_PRESETS } from '@/lib/themePresets'
import {
  customThemeKey, effectiveScheme, makeCustomThemeFrom, previewColors, type CustomTheme,
} from '@/lib/customTheme'
import { ThemePreviewCard } from '@/components/settings/ThemePreviewCard'
import { Page, ListSection, Row } from '../primitives/Page'
import { useNavigation } from '../navigation/NavigationStack'
import { haptic } from '../primitives/haptics'

/** The light/dark scheme applyThemeToDocument is currently using (theme setting + iOS appearance). */
export function useEffectiveScheme(): 'dark' | 'light' {
  const theme = useAppStore((s) => s.theme)
  const [systemIsDark, setSystemIsDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const h = (e: MediaQueryListEvent) => setSystemIsDark(e.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])
  return effectiveScheme(theme, systemIsDark)
}

/** Label for the current themePreset (built-in, custom, or system accent). */
export function themePresetLabel(preset: string, customThemes: readonly CustomTheme[]): string {
  if (preset.startsWith('custom:')) return customThemes.find((t) => customThemeKey(t.id) === preset)?.name ?? 'Default'
  if (preset === 'system-accent') return 'System accent'
  return THEME_PRESETS.find((p) => p.id === preset)?.label ?? 'Default'
}

/**
 * Settings → Color preset (T23-033/034): every built-in preset with a live preview card drawn
 * from its own palette, plus a Custom section (user themes are per device, never iCloud-synced).
 * Built-in presets are immutable — "Customize" makes a new custom copy and opens its editor.
 */
export function ThemePresetPage({ onBack }: { onBack: () => void }) {
  const nav = useNavigation()
  const scheme = useEffectiveScheme()
  const preset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const customThemes = useAppStore((s) => s.customThemes)
  const addCustomTheme = useAppStore((s) => s.addCustomTheme)

  const openEditor = (id: string) => nav.push(`settings-custom-theme-${id}`, <CustomThemeEditorPage id={id} onBack={nav.pop} />)
  const customizeFrom = (fromPreset: string) => {
    const t = makeCustomThemeFrom(fromPreset, useAppStore.getState().customThemes, scheme)
    addCustomTheme(t)
    setThemePreset(customThemeKey(t.id))
    void haptic.light()
    openEditor(t.id)
  }

  return (
    <Page title="Color preset" onBack={onBack}>
      <ListSection title="Custom">
        {customThemes.map((t) => {
          const key = customThemeKey(t.id)
          const c = previewColors(key, customThemes, scheme)
          return (
            <PresetRow
              key={t.id} label={t.name} subtitle="Custom" colors={c} selected={preset === key}
              onSelect={() => { setThemePreset(key); onBack() }}
              actionLabel={`Edit ${t.name}`} onAction={() => openEditor(t.id)}
            />
          )
        })}
        <Row leading={<Plus size={18} aria-hidden />} title="New custom theme" subtitle="Starts from the current preset" onClick={() => customizeFrom(preset)} />
      </ListSection>
      <ListSection title="Presets">
        {THEME_PRESETS.map((p) => (
          <PresetRow
            key={p.id || 'default'} label={p.label} subtitle={p.family}
            colors={previewColors(p.id, undefined, scheme)} selected={p.id === preset}
            onSelect={() => { setThemePreset(p.id); onBack() }}
            actionLabel={`Customize ${p.label}`} onAction={() => customizeFrom(p.id)}
          />
        ))}
      </ListSection>
    </Page>
  )
}

function PresetRow({ label, subtitle, colors, selected, onSelect, actionLabel, onAction }: {
  label: string; subtitle: string; colors: { background: string; text: string; accent: string }
  selected: boolean; onSelect: () => void; actionLabel: string; onAction: () => void
}) {
  return (
    <div className="mobile-row theme-preset-row">
      <button type="button" className="theme-preset-main" onClick={onSelect} aria-pressed={selected}>
        <ThemePreviewCard {...colors} />
        <span className="mobile-row-text">
          <span className="mobile-row-title">{label}</span>
          <span className="mobile-row-subtitle">{subtitle}</span>
        </span>
        {selected && <span className="mobile-row-right" aria-label="Selected">✓</span>}
      </button>
      <button type="button" className="theme-preset-action" aria-label={actionLabel} onClick={onAction}>
        <SlidersHorizontal size={18} aria-hidden />
      </button>
    </div>
  )
}

/** Edit one custom theme: name, text color, background color (native iOS color picker via
 *  <input type="color">), live preview, delete. Edits apply live when the theme is active. */
export function CustomThemeEditorPage({ id, onBack }: { id: string; onBack: () => void }) {
  const theme = useAppStore((s) => s.customThemes.find((t) => t.id === id))
  const preset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const updateCustomTheme = useAppStore((s) => s.updateCustomTheme)
  const deleteCustomTheme = useAppStore((s) => s.deleteCustomTheme)
  const key = customThemeKey(id)

  if (!theme) {
    return <Page title="Custom theme" onBack={onBack}><div className="mobile-empty">This theme was deleted.</div></Page>
  }
  const base = THEME_PRESETS.find((p) => p.id === theme.basedOn) ?? THEME_PRESETS[0]
  const accent = previewColors(key, [theme], 'dark').accent

  return (
    <Page title={theme.name || 'Custom theme'} onBack={onBack}>
      <div className="theme-editor-preview">
        <ThemePreviewCard background={theme.background} text={theme.text} accent={accent} width="100%" height={72} style={{ fontSize: 15, padding: '0 16px', borderRadius: 12 }} />
      </div>
      <ListSection>
        <Row title="Name" right={
          <input className="theme-editor-name" type="text" value={theme.name} aria-label="Theme name"
            onChange={(e) => updateCustomTheme(id, { name: e.target.value })} />
        } />
        <Row title="Text color" subtitle={theme.text.toUpperCase()} right={
          <input className="theme-editor-color" type="color" value={theme.text} aria-label="Text color"
            onChange={(e) => updateCustomTheme(id, { text: e.target.value })} />
        } />
        <Row title="Background color" subtitle={theme.background.toUpperCase()} right={
          <input className="theme-editor-color" type="color" value={theme.background} aria-label="Background color"
            onChange={(e) => updateCustomTheme(id, { background: e.target.value })} />
        } />
        <Row title="Based on" subtitle="Accent and other colors come from this preset" right={base.label} />
      </ListSection>
      <ListSection>
        {preset !== key && <Row title="Use this theme" onClick={() => { setThemePreset(key); void haptic.success() }} />}
        <Row title="Delete theme" destructive onClick={() => { deleteCustomTheme(id); void haptic.medium(); onBack() }} />
      </ListSection>
    </Page>
  )
}
