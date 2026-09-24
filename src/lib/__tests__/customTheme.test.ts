import { describe, it, expect } from 'vitest'
import { THEME_PRESETS } from '@/lib/themePresets'
import {
  resolveThemeVars, makeCustomThemeFrom, previewColors, hexToRgb, rgbToHex, tripleToHex,
  sanitizeCustomThemes, basePresetFor, effectiveScheme, type CustomTheme,
} from '@/lib/customTheme'

const custom: CustomTheme = { id: 'abc', name: 'Mine', basedOn: 'theme-sand', text: '#102030', background: '#f0e0d0' }

describe('customTheme', () => {
  it('hex <-> rgb round-trips', () => {
    expect(hexToRgb('#102030')).toEqual([16, 32, 48])
    expect(rgbToHex([16, 32, 48])).toBe('#102030')
    expect(tripleToHex('245 245 248')).toBe('#f5f5f8')
    expect(hexToRgb('nope')).toBeNull()
  })

  it('built-in presets produce no inline overrides', () => {
    expect(resolveThemeVars('', [custom], 'dark')).toEqual({})
    expect(resolveThemeVars('theme-sand', [custom], 'light')).toEqual({})
    expect(resolveThemeVars('custom:missing', [custom], 'light')).toEqual({})
  })

  it('custom theme overrides background + text palette vars', () => {
    const v = resolveThemeVars('custom:abc', [custom], 'light')
    expect(v['--color-surface-3']).toBe('240 224 208')
    expect(v['--color-text-primary']).toBe('16 32 48')
    expect(v['--color-surface-1']).toBeDefined()
    expect(v['--color-text-muted']).toBeDefined()
    expect(v['--color-accent']).toBeUndefined()
    const withAccent = resolveThemeVars('custom:abc', [{ ...custom, accent: '#ff0000' }], 'light')
    expect(withAccent['--color-accent']).toBe('255 0 0')
  })

  it('customizing a preset creates a new theme from its scheme-resolved colors and never mutates THEME_PRESETS', () => {
    const snapshot = JSON.stringify(THEME_PRESETS)
    const sand = THEME_PRESETS.find((p) => p.id === 'theme-sand')!
    const light = makeCustomThemeFrom('theme-sand', [], 'light', 'x1')
    expect(light).toMatchObject({ id: 'x1', basedOn: 'theme-sand', background: tripleToHex(sand.light.bg), text: tripleToHex(sand.light.text) })
    const dark = makeCustomThemeFrom('theme-sand-dark', [], 'dark', 'x2')
    expect(dark.background).toBe(tripleToHex(sand.dark.bg))
    light.background = '#000000'
    expect(JSON.stringify(THEME_PRESETS)).toBe(snapshot)
  })

  it('copying a custom theme keeps its colors and base', () => {
    const copy = makeCustomThemeFrom('custom:abc', [custom], 'dark', 'x3')
    expect(copy).toMatchObject({ basedOn: 'theme-sand', background: '#f0e0d0', text: '#102030', name: 'Mine copy' })
  })

  it('preview colors follow scheme and fall back to Default', () => {
    expect(previewColors('', [], 'light').background).toBe(tripleToHex(THEME_PRESETS[0].light.bg))
    expect(previewColors('system-accent', [], 'dark').background).toBe(tripleToHex(THEME_PRESETS[0].dark.bg))
    expect(previewColors('custom:abc', [custom], 'dark')).toMatchObject({ background: '#f0e0d0', text: '#102030' })
    expect(basePresetFor('custom:abc', [custom]).id).toBe('theme-sand')
    expect(effectiveScheme('system', true)).toBe('dark')
    expect(effectiveScheme('light', true)).toBe('light')
  })

  it('sanitizes persisted data', () => {
    expect(sanitizeCustomThemes('x')).toEqual([])
    expect(sanitizeCustomThemes([custom, { id: 1 }, null])).toEqual([custom])
  })
})
