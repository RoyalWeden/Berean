/**
 * TEST 2026-09-29 (macOS Scripture with the side panel open): the reading column's cap must
 * include its own margins once (border-box) — subtracting them again left ~3 margins of empty
 * space on the right of a narrowed pane vs 1 on the left.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../global.css'), 'utf8')
const rule = /\.berean-reading-column \{([\s\S]*?)\n\}/.exec(css)![1]

describe('reading column', () => {
  it('caps at the measure plus both margins, and never below the pane width', () => {
    expect(rule).toMatch(/max-width:\s*min\(calc\(var\(--reading-max-ch\) \* 1ch \+ 2 \* var\(--reading-margin\)\), 100%\)/)
    expect(rule).not.toMatch(/100% - \(2 \* var\(--reading-margin\)\)/)
  })
  it('keeps equal inline margins', () => {
    expect(rule).toMatch(/padding-inline:\s*var\(--reading-margin\)/)
  })
})
