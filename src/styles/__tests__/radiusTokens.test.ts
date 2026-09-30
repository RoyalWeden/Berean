/**
 * TEST 2026-09-29 — "something happened to the roundness of all buttons". glass.css (loaded after
 * global.css) redefined the unprefixed --radius-control / --radius-card / --radius-sheet names, so
 * every desktop capsule became a 12px rounded rectangle. The shape scale has one owner per name.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const global = readFileSync(resolve(__dirname, '../global.css'), 'utf8')
const glass = readFileSync(resolve(__dirname, '../glass.css'), 'utf8')
const read = (file: string) => readFileSync(resolve(__dirname, '../../components/ui', file), 'utf8')

describe('radius tokens', () => {
  it('glass.css never redefines the global --radius-* scale', () => {
    expect(glass).not.toMatch(/^\s*--radius-[a-z-]+\s*:/m)
  })
  it('--radius-control is the capsule', () => {
    expect(global).toMatch(/--radius-control:\s*9999px/)
  })
  it('bar controls are circles / capsules', () => {
    expect(read('IconButton.tsx')).toMatch(/const BAR = \{[^}]*radius: 'rounded-control' \}/)
    expect(read('Button.tsx')).toMatch(/const BAR:[^=]*= \{[^}]*radius: 'rounded-control' \}/)
    expect(read('ControlGroup.tsx')).toMatch(/radius = 'capsule'/)
  })
})
