import React from 'react'
import { useAppStore } from '@/store'
import { TRANSLATIONS } from '@/lib/bibleTexts'
import { FONT_MAP } from '@/lib/fontFamilies'
import { THEME_PRESETS } from '@/lib/themePresets'
import { customThemeKey, previewColors } from '@/lib/customTheme'
import { ThemePreviewCard } from '@/components/settings/ThemePreviewCard'
import { ChoiceList } from '../primitives/ActionSheet'
import type { SheetApi } from '../primitives/Sheet'
import { haptic } from '../primitives/haptics'
import { useEffectiveScheme, themePresetLabel } from '../settings/ThemePresetPage'
import { requestMore } from '../navigation/shellNav'

/**
 * Sub-views of the Scripture caret (T23-019/020/021): shown INSIDE the caret sheet (Sheet.push),
 * with "‹ Scripture" at the top — never a second sheet.
 */

/** All Translations: every text, the current one checked. Picking switches this tab and returns. */
export function TranslationChoices({ textId, onPick, api }: { textId: string; onPick: (id: string) => void; api: SheetApi }) {
  return (
    <ChoiceList api={api} value={textId}
      options={TRANSLATIONS.map((t) => ({ id: t.id, label: t.label, detail: t.description }))}
      onSelect={onPick} />
  )
}

export function translationShortLabel(textId: string): string {
  return TRANSLATIONS.find((t) => t.id === textId)?.label ?? textId.toUpperCase()
}

export function fontLabel(f: string): string { return f === 'system' ? 'System' : f }

/** Scripture font, each option shown in its own face. */
export function FontChoices({ api }: { api: SheetApi }) {
  const family = useAppStore((s) => s.scriptureFontFamily)
  const setFamily = useAppStore((s) => s.setScriptureFontFamily)
  return (
    <ChoiceList api={api} value={family}
      options={Object.keys(FONT_MAP).map((f) => ({ id: f, label: fontLabel(f), style: { fontFamily: FONT_MAP[f] } }))}
      onSelect={setFamily} />
  )
}

/** Color presets with previews (custom themes first). Tapping applies at once and stays here, so
 *  several can be tried while the Scripture stays visible above the sheet. Creating and editing
 *  custom colors lives in Settings → Color preset. */
export function ColorChoices({ api }: { api: SheetApi }) {
  const scheme = useEffectiveScheme()
  const preset = useAppStore((s) => s.themePreset)
  const setPreset = useAppStore((s) => s.setThemePreset)
  const customThemes = useAppStore((s) => s.customThemes)
  const rows = [
    ...customThemes.map((t) => ({ id: customThemeKey(t.id), label: t.name, family: 'Custom' })),
    ...THEME_PRESETS.map((p) => ({ id: p.id, label: p.label, family: p.family })),
  ]
  return (
    <div className="mobile-color-choices">
      <div className="mobile-choice-list" role="radiogroup" aria-label="Color preset">
        {rows.map((r) => {
          const c = previewColors(r.id, customThemes, scheme)
          const on = r.id === preset
          return (
            <button key={r.id || 'default'} type="button" role="radio" aria-checked={on} className={`mobile-choice-row${on ? ' is-on' : ''}`}
              onClick={() => { void haptic.selection(); setPreset(r.id) }}>
              <ThemePreviewCard background={c.background} text={c.text} accent={c.accent} width={72} height={36} />
              <span className="mobile-choice-label">{r.label}<small>{r.family}</small></span>
            </button>
          )
        })}
      </div>
      <button type="button" className="mobile-button mobile-color-more" onClick={() => { api.close(); requestMore('settings') }}>
        Custom colors in Settings…
      </button>
    </div>
  )
}
