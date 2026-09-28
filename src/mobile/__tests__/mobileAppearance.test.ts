// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'

const applied: Array<{ themePreset: string }> = []
vi.mock('@/lib/applyTheme', () => ({ applyThemeToDocument: (o: { themePreset: string }) => { applied.push(o) } }))

import { applyMobileAppearance } from '../settings/scriptureTheme'

describe('applyMobileAppearance', () => {
  it('never passes a colour preset to the global theme — the preset goes to the Scripture scope only', () => {
    const black = { id: 'b', name: 'Black', basedOn: '', text: '#ffffff', background: '#000000' }
    applyMobileAppearance({ theme: 'light', themePreset: 'custom:b', systemIsDark: false, customThemes: [black] })
    applyMobileAppearance({ theme: 'dark', themePreset: 'theme-sand', systemIsDark: true, customThemes: [] })
    expect(applied.map((o) => o.themePreset)).toEqual(['', ''])
    expect(document.documentElement.dataset.scriptureTheme).toBe('theme-sand')
  })
  it('keeps the system accent (an app-wide accent, not a palette)', () => {
    applyMobileAppearance({ theme: 'system', themePreset: 'system-accent', systemIsDark: false, customThemes: [] })
    expect(applied.at(-1)?.themePreset).toBe('system-accent')
    expect(document.documentElement.dataset.scriptureTheme).toBeUndefined()
  })
})
