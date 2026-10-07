/**
 * macOS Settings → Display → Scripture margins: compact / standard / spacious. One store field,
 * persisted through the shared settings table (settingsBridge), mapped by global.css onto the
 * reading column's margin / measure tokens. Standard keeps the existing default appearance.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { useAppStore } from '@/store'
import { hydrateSettingsIntoStore, persistSettingsFromStore } from '../settingsBridge'

const css = readFileSync(resolve(__dirname, '../../styles/global.css'), 'utf8')
const block = (sel: string) => new RegExp(`${sel.replace(/[[\]="]/g, (c) => `\\${c}`)} \\{([\\s\\S]*?)\\n\\}`).exec(css)?.[1] ?? ''
const px = (b: string) => /--reading-margin:\s*clamp\((\d+)px,\s*([\d.]+)cqi,\s*(\d+)px\)/.exec(b)!.slice(1).map(Number)

describe('Scripture margins setting', () => {
  beforeEach(() => useAppStore.setState({ scriptureMargins: 'standard' }))

  it('defaults to Standard', () => {
    expect(useAppStore.getState().scriptureMargins).toBe('standard')
  })

  it('hydrates a stored value and ignores an invalid one', () => {
    hydrateSettingsIntoStore({ scriptureMargins: 'spacious' })
    expect(useAppStore.getState().scriptureMargins).toBe('spacious')
    hydrateSettingsIntoStore({ scriptureMargins: 'huge' })
    expect(useAppStore.getState().scriptureMargins).toBe('spacious')
  })

  it('persists through the settings table', async () => {
    const writes: Array<[string, unknown]> = []
    ;(window as unknown as { settings: unknown }).settings = { set: async (k: string, v: unknown) => { writes.push([k, v]) }, setMany: async (o: Record<string, unknown>) => { for (const [k, v] of Object.entries(o)) writes.push([k, v]) } }
    const dispose = persistSettingsFromStore(0)
    useAppStore.getState().setScriptureMargins('compact')
    await new Promise((r) => setTimeout(r, 20))
    dispose()
    expect(writes.some(([k, v]) => k === 'scriptureMargins' && v === 'compact')).toBe(true)
  })

  it('Standard keeps the existing tokens; Compact < Standard < Spacious, all clamped to the pane', () => {
    const std = px(/:root \{\s*\/\*[\s\S]*?--reading-margin:[^;]+;/.exec(css)![0])
    const compact = px(block('html[data-scripture-margins="compact"]'))
    const spacious = px(block('html[data-scripture-margins="spacious"]'))
    expect(std).toEqual([24, 6, 72])
    for (const i of [0, 1, 2]) {
      expect(compact[i]).toBeLessThan(std[i])
      expect(spacious[i]).toBeGreaterThan(std[i])
    }
    // percentage of the PANE → narrows with the side panel; the column cap includes the margins
    expect(css).toMatch(/max-width: min\(\s*calc\(var\(--reading-max-ch\) \* 1ch \+ var\(--reading-margin\) \+ var\(--reading-end-pad\)\),\s*100%,/)
  })
})
