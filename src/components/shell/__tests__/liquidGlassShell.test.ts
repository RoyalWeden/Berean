/**
 * macOS main window — native Liquid Glass sidebar pane (docs/liquid-glass.md §macOS). Guards the
 * rules the native glass depends on: Chromium keeps the FIRST page background as its layer colour,
 * so every window's body must be transparent at first paint; the pane is a rounded hole in an
 * opaque ground; toolbar capsule groups carry no internal rules; the bridge ships in Mac builds.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('macOS Liquid Glass shell', () => {
  const css = read('src/styles/global.css')

  it('body is transparent at first paint; opaque windows get their ground only after the window stamp', () => {
    expect(css).toMatch(/body \{\n  background-color: transparent;/)
    expect(css).toMatch(/html\[data-window\]:not\(\[data-vibrant\]\) body \{ background-color: rgb\(var\(--color-surface-1\)\); \}/)
  })

  it('the sidebar pane is a concentric rounded hole in an opaque ground, tracking the live sidebar width', () => {
    expect(css).toMatch(/\.shell-pane-hole \{[\s\S]*?width: calc\(var\(--sidebar-live-w, 260px\) - 2 \* var\(--lg-pane-inset, 8px\)\);[\s\S]*?border-radius: var\(--lg-pane-radius, 18px\);[\s\S]*?box-shadow: 0 0 0 200vmax rgb\(var\(--color-surface-3\)\);/)
    const pane = read('src/components/shell/SidebarGlassPane.tsx')
    expect(pane).toMatch(/role: 'sidebar'/)
    expect(pane).toMatch(/pin: \{ top: true, bottom: true, left: true \}/)
  })

  it('the bridge only targets the transparent main window', () => {
    const caps = read('src/platform/liquidGlass/capabilities.ts')
    expect(caps).toMatch(/dataset\.window !== 'main'/)
  })

  it('capsule control groups have no internal dividers (rows keep them)', () => {
    const g = read('src/components/ui/ControlGroup.tsx')
    expect(g).toMatch(/\(dividers \?\? radius === 'row'\)/)
  })

  it('the native bridge is built by every Mac build and shipped in DMG and MAS', () => {
    const pkg = JSON.parse(read('package.json'))
    expect(pkg.scripts.build).toMatch(/build-native\.mjs glass/)
    expect(JSON.stringify(pkg.build.mac.extraResources)).toMatch(/berean_glass\.node/)
    expect(JSON.stringify(pkg.build.mas.extraResources)).toMatch(/berean_glass\.node/)
    const m = read('native/mac-liquid-glass/berean_glass.m')
    // Public AppKit only, looked up at runtime (deployable to macOS 12).
    expect(m).toMatch(/NSClassFromString\(@"NSGlassEffectView"\)/)
    expect(m).not.toMatch(/_private|objc_msgSend|class_getInstanceVariable/)
  })
})
