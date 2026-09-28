import { useEffect, useState } from 'react'
import { Plus, Trash2, Copy } from 'lucide-react'
import { useAppStore } from '@/store'
import { Button, IconButton, ListRow, TextField } from '@/components/ui'
import { THEME_PRESETS } from '@/lib/themePresets'
import { customThemeKey, effectiveScheme, makeCustomThemeFrom, previewColors } from '@/lib/customTheme'
import { ThemePreviewCard } from '../ThemePreviewCard'

function useScheme(): 'dark' | 'light' {
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

/**
 * Settings → Appearance → Custom themes (T23-034, desktop). Built-in presets stay immutable:
 * "New from current" copies the active preset's (light/dark-resolved) colors into a new custom
 * theme. Per device — stored with the other settings, not synced through iCloud.
 */
export default function CustomThemesSection() {
  const scheme = useScheme()
  const themePreset = useAppStore((s) => s.themePreset)
  const setThemePreset = useAppStore((s) => s.setThemePreset)
  const customThemes = useAppStore((s) => s.customThemes)
  const addCustomTheme = useAppStore((s) => s.addCustomTheme)
  const updateCustomTheme = useAppStore((s) => s.updateCustomTheme)
  const deleteCustomTheme = useAppStore((s) => s.deleteCustomTheme)
  const [editingId, setEditingId] = useState<string | null>(null)

  const createFrom = (from: string) => {
    const t = makeCustomThemeFrom(from, useAppStore.getState().customThemes, scheme)
    addCustomTheme(t)
    setThemePreset(customThemeKey(t.id))
    setEditingId(t.id)
  }
  const activeCustom = customThemes.find((t) => customThemeKey(t.id) === themePreset)
  const editing = customThemes.find((t) => t.id === (editingId ?? activeCustom?.id))
  const fromLabel = activeCustom?.name
    ?? THEME_PRESETS.find((p) => p.id === themePreset.replace(/-(?:dark|light)$/, ''))?.label ?? 'Default'

  return (
    <div data-anchor="Custom themes">
      <div className="flex items-center justify-between gap-3 mb-1">
        <p className="text-subhead font-medium text-text-primary">Custom themes</p>
        <Button size="sm" variant="secondary" icon={Plus} onClick={() => createFrom(themePreset)}>New from {fromLabel}</Button>
      </div>
      <p className="s-desc text-caption text-text-muted mb-3">Your own text and background colors on top of a preset. Presets themselves never change.</p>
      {customThemes.length > 0 && (
        <div className="space-y-px mb-3">
          {customThemes.map((t) => {
            const key = customThemeKey(t.id)
            return (
              <ListRow
                key={t.id}
                current={themePreset === key}
                onClick={() => { setThemePreset(key); setEditingId(t.id) }}
                leading={<ThemePreviewCard {...previewColors(key, customThemes, scheme)} width={88} height={32} style={{ fontSize: 9 }} />}
                title={t.name}
                subtitle={`Based on ${THEME_PRESETS.find((p) => p.id === t.basedOn)?.label ?? 'Default'}`}
                trailing={<>
                  <IconButton icon={Copy} label="Duplicate" size={24} onClick={() => createFrom(key)} />
                  <IconButton icon={Trash2} label="Delete" size={24} onClick={() => { deleteCustomTheme(t.id); if (editingId === t.id) setEditingId(null) }} />
                </>}
              />
            )
          })}
        </div>
      )}
      {editing && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <TextField size="sm" value={editing.name} aria-label="Theme name" className="w-44"
            onChange={(e) => updateCustomTheme(editing.id, { name: e.target.value })} />
          <label className="flex items-center gap-2 text-footnote text-text-secondary">
            Text
            <input type="color" value={editing.text} aria-label="Text color" className="w-8 h-6 rounded cursor-pointer bg-transparent"
              onChange={(e) => updateCustomTheme(editing.id, { text: e.target.value })} />
          </label>
          <label className="flex items-center gap-2 text-footnote text-text-secondary">
            Background
            <input type="color" value={editing.background} aria-label="Background color" className="w-8 h-6 rounded cursor-pointer bg-transparent"
              onChange={(e) => updateCustomTheme(editing.id, { background: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  )
}
