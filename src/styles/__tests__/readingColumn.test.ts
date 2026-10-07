/**
 * TEST 2026-09-29 (macOS Scripture with the side panel open): the reading column's cap must
 * include its own margins once (border-box) — subtracting them again left ~3 margins of empty
 * space on the right of a narrowed pane vs 1 on the left.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve(__dirname, '../global.css'), 'utf8')
const rule = /^\.berean-reading-column \{([\s\S]*?)\n\}/m.exec(css)![1]

describe('reading column', () => {
  it('caps at the measure plus both margins, and never below the pane width', () => {
    // Leading margin + trailing pad (= the margin, or ≤ 28px beside an attached side panel —
    // TEST 2026-10-04), then the pane, then the width the side panel keeps clear.
    expect(rule).toMatch(/max-width: min\(\s*calc\(var\(--reading-max-ch\) \* 1ch \+ var\(--reading-margin\) \+ var\(--reading-end-pad\)\),\s*100%,\s*calc\(100cqi - var\(--inspector-reserve, 0px\)/)
    expect(rule).not.toMatch(/100% - \(2 \* var\(--reading-margin\)\)/)
  })
  it('keeps equal inline margins unless a side panel is attached', () => {
    expect(rule).toMatch(/--reading-end-pad: var\(--reading-margin\);/)
    expect(rule).toMatch(/padding-inline: var\(--reading-margin\) var\(--reading-end-pad\);/)
    expect(css).toMatch(/\.berean-inspector-attached \.berean-reading-column \{ --reading-end-pad: min\(var\(--reading-margin\), 28px\); \}/)
  })
})
