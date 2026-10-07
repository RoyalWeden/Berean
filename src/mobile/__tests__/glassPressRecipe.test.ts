/**
 * One interactive Liquid Glass recipe (TEST 2026-10-06: "buttons stop looking glassy when pressed").
 * Every :active rule that targets a floating glass control must use the shared glass tokens — never
 * a flat tint, an opaque surface fill or a solid colour — so a press can't turn glass into a grey
 * disc again. Content controls (rows, chips, cells) are not glass and are not checked.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const FLOATING = ['mobile-nav-tabs', 'mobile-nav-caret', 'mobile-nav-plus', 'mobile-back', 'm-float-circle', 'm-tabswitch-button',
  'm-note-insert-fab', 'm-note-fab', 'm-notes-compose', 'm-notes-float-cancel', 'm-audio-float', 'm-pp-history-toggle', 'mobile-sheet-close',
  'mobile-title-button', 'm-notes-textbtn']
const SHARED = /var\(--m-glass-control-pressed\)|var\(--m-glass-group-item-pressed\)|radial-gradient\(farthest-side at 50% 40%/

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith('.css') ? [p] : [] })
}

describe('floating glass press recipe', () => {
  const rules: { file: string; sel: string; body: string }[] = []
  for (const file of cssFiles(join(__dirname, '..'))) {
    const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim()
      if (sel.includes(':active') && FLOATING.some((c) => new RegExp(`\\.${c}(?![\\w-])[^,]*:active`).test(sel))) rules.push({ file, sel, body: m[2] })
    }
  }
  it('finds the recipe', () => { expect(rules.length).toBeGreaterThan(0) })
  it('every floating-glass :active background uses the shared glass tokens', () => {
    const bad = rules.filter((r) => /background\s*:/.test(r.body) && !SHARED.test(r.body)).map((r) => `${r.file.split('src/')[1]}: ${r.sel}`)
    expect(bad).toEqual([])
  })
  it('no floating glass control drops its backdrop when pressed', () => {
    expect(rules.filter((r) => /backdrop-filter\s*:\s*none/.test(r.body)).map((r) => r.sel)).toEqual([])
  })
  it('sheets float below full height (iOS 26 presentation)', () => {
    const sheet = readFileSync(join(__dirname, '../primitives/Sheet.tsx'), 'utf8')
    expect(sheet).toMatch(/const floating = heights\.length > 1 && detentIndex < top/)
    expect(readFileSync(join(__dirname, '../mobile.css'), 'utf8')).toMatch(/\.mobile-sheet\.is-floating\s*\{[^}]*left: 8px/)
  })
})
