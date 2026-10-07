import { describe, it, expect } from 'vitest'
import { inspectorShouldReflow } from '../inspectorLayout'

describe('Scripture inspector yield rule (macOS)', () => {
  it('reflows when Scripture keeps a comfortable width', () => {
    expect(inspectorShouldReflow(1440, 240, 354)).toBe(true)
    expect(inspectorShouldReflow(1050, 0, 354)).toBe(true) // sidebar hidden: room to attach
  })
  it('overlays when attaching would squeeze Scripture', () => {
    expect(inspectorShouldReflow(900, 240, 354)).toBe(false)
    expect(inspectorShouldReflow(1050, 240, 354)).toBe(false)
  })
})

describe('Scripture inspector widths (TEST 2026-10-04)', () => {
  it('snaps magnetically to Compact / Standard / Expanded and clamps the range', async () => {
    const { snapInspectorWidth, clampInspectorWidth, INSPECTOR_STANDARD_WIDTH } = await import('../inspectorLayout')
    expect(snapInspectorWidth(309)).toBe(INSPECTOR_STANDARD_WIDTH)
    expect(snapInspectorWidth(268)).toBe(260)
    expect(snapInspectorWidth(431)).toBe(420)
    expect(snapInspectorWidth(360)).toBe(360) // free between snaps
    expect(clampInspectorWidth(9999)).toBe(520)
    expect(clampInspectorWidth(10)).toBe(260)
  })
  it('the reading margins are pane-relative (cqi) so attaching the panel never shifts the text', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const css = readFileSync(resolve(__dirname, '../../styles/global.css'), 'utf8')
    expect(css).toMatch(/\.berean-scripture-pane \{ container-type: inline-size; \}/)
    expect(css).not.toMatch(/--reading-margin: clamp\([^)]*%/)
    const panel = readFileSync(resolve(__dirname, '../../components/bible/BiblePanel.tsx'), 'utf8')
    expect(panel).toMatch(/className="berean-scripture-pane /)
    expect(panel).not.toMatch(/transition: 'right 0\.18s/)
  })
})

describe('Scripture inspector reserve and drag cap', () => {
  it('reserves the panel width only when the text keeps a full block; caps the drag', async () => {
    const { inspectorReserve, maxInspectorWidth, snapInspectorWidth } = await import('../inspectorLayout')
    expect(inspectorReserve(1171, 314)).toBe(314)
    expect(inspectorReserve(911, 314)).toBe(0)
    // An Expanded panel reserves only the Standard width (the extra re-wraps only while open).
    expect(inspectorReserve(1400, 334)).toBe(334)   // default 320 + divider: no jump
    expect(inspectorReserve(1400, 434)).toBe(374)   // Expanded: only the extra re-wraps
    expect(maxInspectorWidth(911)).toBe(497)
    expect(maxInspectorWidth(600)).toBe(260)
    expect(snapInspectorWidth(540, maxInspectorWidth(911))).toBe(497)
  })
})

describe('BiblePanel hook order (TEST 2026-10-04 crash: "Rendered fewer hooks than expected")', () => {
  it('the reading-anchor hook runs before the search tab\'s early return', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../../components/bible/BiblePanel.tsx'), 'utf8')
    expect(src.indexOf('useReadingAnchor(scriptureHostRef')).toBeGreaterThan(0)
    expect(src.indexOf('useReadingAnchor(scriptureHostRef')).toBeLessThan(src.indexOf('  if (tabState.searchMode) {'))
  })
})
