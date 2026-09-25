// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { scriptureThemeVars, scriptureThemeCss, applyScriptureTheme, SCRIPTURE_VARS, SCRIPTURE_SCOPE_SELECTOR, contrast } from '../settings/scriptureTheme'
import { CUSTOM_THEME_VARS, parseTriple, type CustomTheme } from '@/lib/customTheme'
import { THEME_PRESETS } from '@/lib/themePresets'

const black: CustomTheme = { id: 'blk', name: 'Black', basedOn: '', text: '#e6e6e6', background: '#000000' }
const sepia = THEME_PRESETS.find((p) => p.id === 'theme-sand')!

describe('scriptureThemeVars', () => {
  it('Default / system accent / unknown custom → nothing (reader follows the app)', () => {
    expect(scriptureThemeVars('', [], 'light')).toEqual({})
    expect(scriptureThemeVars('system-accent', [], 'dark')).toEqual({})
    expect(scriptureThemeVars('custom:missing', [black], 'dark')).toEqual({})
  })

  it('a preset produces ONLY scripture-scoped vars — no app palette token', () => {
    for (const p of THEME_PRESETS.filter((x) => x.id)) {
      for (const scheme of ['light', 'dark'] as const) {
        const keys = Object.keys(scriptureThemeVars(p.id, [], scheme))
        expect(keys.sort()).toEqual([...SCRIPTURE_VARS].sort())
        for (const k of keys) expect(k.startsWith('--scripture-')).toBe(true)
        for (const t of CUSTOM_THEME_VARS) expect(keys).not.toContain(t)
      }
    }
  })

  it('built-in preset uses its palette for the effective scheme (System Dark + Sepia)', () => {
    const v = scriptureThemeVars('theme-sand', [], 'dark')
    expect(v['--scripture-bg-rgb']).toBe(sepia.dark.bg)
    expect(v['--scripture-text-rgb']).toBe(sepia.dark.text)
  })

  it('a custom theme is scheme-independent (System Light + black Scripture) — migrated custom themes keep their colours', () => {
    const light = scriptureThemeVars('custom:blk', [black], 'light')
    const dark = scriptureThemeVars('custom:blk', [black], 'dark')
    expect(light['--scripture-bg-rgb']).toBe('0 0 0')
    expect(light['--scripture-text-rgb']).toBe('230 230 230')
    expect(light['--scripture-bg-rgb']).toBe(dark['--scripture-bg-rgb'])
    // red letters pick the dark-page red on a black page
    expect(light['--scripture-red-letter-rgb']).toBe('255 110 110')
    // full colours for direct use (readerChrome.css status band etc.)
    expect(light['--scripture-bg']).toBe('rgb(0 0 0)')
    expect(light['--scripture-text']).toBe('rgb(230 230 230)')
  })

  it('derives coherent verse-number and Strong\'s colours when unset; honours explicit ones', () => {
    const v = scriptureThemeVars('custom:blk', [black], 'light')
    expect(v['--scripture-verse-num-rgb']).toBe('115 115 115')
    const strongs = parseTriple(v['--scripture-strongs-rgb']!)
    expect(contrast(strongs as [number, number, number], [0, 0, 0])).toBeGreaterThanOrEqual(3)
    const explicit = scriptureThemeVars('custom:blk', [{ ...black, verseNumber: '#ff0000', strongs: '#00ff00' }], 'light')
    expect(explicit['--scripture-verse-num-rgb']).toBe('255 0 0')
    expect(explicit['--scripture-strongs-rgb']).toBe('0 255 0')
  })

  it('Strong\'s fall back to a text tint when the accent would not read on the background', () => {
    // Default light accent (80 100 200) on near-black is low contrast → text tint instead.
    const dim: CustomTheme = { ...black, background: '#101010', accent: '#202040' }
    const v = scriptureThemeVars('custom:blk', [dim], 'light')
    expect(v['--scripture-strongs-rgb']).not.toBe('32 32 64')
  })
})

describe('scriptureThemeCss / applyScriptureTheme', () => {
  beforeEach(() => {
    document.getElementById('berean-scripture-theme')?.remove()
    document.documentElement.removeAttribute('style')
    delete document.documentElement.dataset.scriptureTheme
  })

  it('css is scoped to the reading surfaces, never :root', () => {
    const css = scriptureThemeCss(scriptureThemeVars('custom:blk', [black], 'light'))
    expect(css.startsWith(SCRIPTURE_SCOPE_SELECTOR)).toBe(true)
    for (const sel of ['.mobile-reader', '.m-compare', '.mobile-page.is-reader', '.mobile-page.is-compare']) expect(SCRIPTURE_SCOPE_SELECTOR).toContain(sel)
    expect(css).not.toMatch(/:root|html\s*\{/)
    expect(scriptureThemeCss({})).toBe('')
  })

  it('applying a preset leaves global colour tokens on <html> untouched; Default clears it', () => {
    applyScriptureTheme('custom:blk', [black], 'light')
    const html = document.documentElement
    expect(html.dataset.scriptureTheme).toBe('custom:blk')
    expect(document.getElementById('berean-scripture-theme')?.textContent).toContain('--scripture-bg-rgb: 0 0 0;')
    for (const t of CUSTOM_THEME_VARS) expect(html.style.getPropertyValue(t)).toBe('')
    for (const t of SCRIPTURE_VARS) expect(html.style.getPropertyValue(t)).toBe('')

    applyScriptureTheme('', [black], 'light')
    expect(html.dataset.scriptureTheme).toBeUndefined()
    expect(document.getElementById('berean-scripture-theme')).toBeNull()
  })
})
