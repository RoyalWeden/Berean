// @vitest-environment jsdom
/**
 * Berean Liquid Glass semantic API (docs/liquid-glass.md): capability detection is central and
 * adapter-driven; native control clusters follow their web placeholders (occlusion, collapse,
 * presses) and clean up; without an adapter nothing native is attempted.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useRef } from 'react'
import { _resetLiquidGlass, loadLiquidGlassCapabilities, liquidGlassCapabilities } from '../capabilities'
import { useLiquidGlassControls } from '../react'
import { roleRadius, liquidGlassTokens } from '../tokens'
import type { LiquidGlassAdapter, LiquidGlassControlsSpec } from '../types'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function fakeAdapter() {
  const sent: LiquidGlassControlsSpec[] = []
  const removed: string[] = []
  let emit: ((e: { cluster: string; item?: string; swipe?: 'next' | 'previous' }) => void) | null = null
  const a: LiquidGlassAdapter = {
    platform: 'ios',
    capabilities: async () => ({ native: true, liquidGlass: true, grouping: true, interactive: true, reduceTransparency: false, increaseContrast: false, reduceMotion: false }),
    surface: async () => false, group: async () => false, destroy: async () => true,
    controls: async (spec) => { sent.push(spec); return true },
    removeControls: async (id) => { removed.push(id); return true },
    onControlEvent: (cb) => { emit = cb; return () => { emit = null } },
  }
  return { a, sent, removed, press: (item: string) => emit?.({ cluster: 'nav', item }), swipe: (d: 'next' | 'previous') => emit?.({ cluster: 'nav', swipe: d }) }
}

let root: Root, host: HTMLDivElement
beforeEach(() => {
  _resetLiquidGlass()
  delete window.__bereanGlass
  ;(window as unknown as { __berean_platform?: string }).__berean_platform = 'ios'
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 1 })
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('capability detection', () => {
  it('no adapter → CSS only', async () => {
    const c = await loadLiquidGlassCapabilities()
    expect(c.native).toBe(false)
    expect(document.documentElement.dataset.nativeGlass).toBeUndefined()
  })
  it('an installed adapter is detected once, centrally, and stamped for CSS', async () => {
    window.__bereanGlass = fakeAdapter().a
    const c = await loadLiquidGlassCapabilities()
    expect(c).toMatchObject({ platform: 'ios', native: true, liquidGlass: true, grouping: true })
    expect(document.documentElement.dataset.nativeGlass).toBe('glass')
  })
  it('accessibility flags are live (turning Reduce Transparency OFF is seen)', async () => {
    window.__bereanGlass = fakeAdapter().a
    await loadLiquidGlassCapabilities()
    document.documentElement.dataset.reduceTransparency = ''
    expect(liquidGlassCapabilities().reduceTransparency).toBe(true)
    delete document.documentElement.dataset.reduceTransparency
    expect(liquidGlassCapabilities().reduceTransparency).toBe(false)
  })
})

describe('semantic geometry', () => {
  it('controls are capsules from their height; panes are concentric with the window', () => {
    const mac = liquidGlassTokens('macos')
    expect(roleRadius('navigation', mac, 48)).toBe(24)
    expect(roleRadius('sidebar', mac, 600)).toBe(mac.containerRadius - mac.paneInset)
    expect(liquidGlassTokens('ios').controlSize).toBe(44)
  })
})

function Bar({ onPlus, collapsed = false }: { onPlus: () => void; collapsed?: boolean }) {
  const plus = useRef<HTMLButtonElement>(null)
  const { isNative } = useLiquidGlassControls('nav', [
    { id: 'plus', ref: plus, symbol: 'plus', label: 'New tab', prominent: true, onPress: onPlus },
  ], { role: 'navigation', collapsed, onSwipe: () => {} })
  return <button ref={plus} className={isNative('plus') ? 'is-native-glass' : ''}>+</button>
}

async function mountBar(props: { onPlus: () => void; collapsed?: boolean }) {
  await act(async () => { root.render(<Bar {...props} />); await Promise.resolve() })
  await act(async () => { await loadLiquidGlassCapabilities(); await new Promise((r) => setTimeout(r, 5)) })
}

describe('native control clusters', () => {
  const rect = { left: 140, top: 780, width: 112, height: 48, right: 252, bottom: 828, x: 140, y: 780, toJSON() {} }
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 402, configurable: true })
    Object.defineProperty(window, 'innerHeight', { value: 874, configurable: true })
    HTMLElement.prototype.getBoundingClientRect = function () { return rect as DOMRect }
  })

  it('sends the placeholder rect; the placeholder hides only while native draws it; presses run the web handler', async () => {
    const f = fakeAdapter(); window.__bereanGlass = f.a
    const btn = () => host.querySelector('button')!
    document.elementFromPoint = () => btn()
    const onPlus = vi.fn()
    await mountBar({ onPlus })
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) }) // first-paint gate
    const last = f.sent[f.sent.length - 1]
    expect(last.items[0]).toMatchObject({ id: 'plus', symbol: 'plus', hidden: false, rect: { x: 140, y: 780, width: 112, height: 48 } })
    // First appearance: the web placeholder is never shown while native is about to draw it — no
    // web control replaced by a different-looking native one on launch (G-03)…
    expect(btn().className).toBe('is-native-glass')
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(btn().className).toBe('is-native-glass')
    f.press('plus')
    expect(onPlus).toHaveBeenCalledTimes(1)
  })

  it('first appearance: the placeholder is hidden even before capabilities have loaded', async () => {
    const f = fakeAdapter()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => { release = r })
    const caps = f.a.capabilities
    f.a.capabilities = async () => { await gate; return caps() }
    window.__bereanGlass = f.a
    document.elementFromPoint = () => host.querySelector('button')
    // Render WITHOUT waiting for capabilities (they're held back by `gate`).
    await act(async () => { root.render(<Bar onPlus={() => {}} />); await Promise.resolve() })
    expect(host.querySelector('button')!.className).toBe('is-native-glass')
    await act(async () => { release(); await loadLiquidGlassCapabilities(); await new Promise((r) => setTimeout(r, 150)) })
    expect(host.querySelector('button')!.className).toBe('is-native-glass')
  })

  it('first appearance: a failed native call shows the web placeholder (never left missing)', async () => {
    const f = fakeAdapter()
    f.a.controls = async () => { throw new Error('no host view') }
    window.__bereanGlass = f.a
    document.elementFromPoint = () => host.querySelector('button')
    await mountBar({ onPlus: () => {} })
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    expect(host.querySelector('button')!.className).toBe('')
  })

  it('after the first draw, uncovering keeps the placeholder visible until native has faded in', async () => {
    // Real (async) frames: the hook's re-sync scheduling needs a frame to complete.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (h: number) => clearTimeout(h))
    // Real (asynchronous) frames: the shared synchronous stub would leave a frame "pending" forever.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (h: number) => clearTimeout(h))
    const f = fakeAdapter(); window.__bereanGlass = f.a
    const btn = () => host.querySelector('button')!
    const sheet = document.createElement('div'); document.body.appendChild(sheet)
    let covered = false
    document.elementFromPoint = () => (covered ? sheet : btn())
    await mountBar({ onPlus: () => {} })
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    expect(btn().className).toBe('is-native-glass')
    // A sheet covers it → the web placeholder shows at once (the native one fades out on top)…
    covered = true
    await act(async () => { window.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 20)) })
    expect(btn().className).toBe('')
    // …uncovered → it stays until the native control is back on screen, then hides.
    covered = false
    await act(async () => { window.dispatchEvent(new Event('resize')); await new Promise((r) => setTimeout(r, 20)) })
    expect(btn().className).toBe('')
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(btn().className).toBe('is-native-glass')
    sheet.remove()
  })

  it('a sheet covering the placeholder hides the native control and reveals the web one', async () => {
    const f = fakeAdapter(); window.__bereanGlass = f.a
    const sheet = document.createElement('div'); document.body.appendChild(sheet)
    document.elementFromPoint = () => sheet
    await mountBar({ onPlus: () => {} })
    const last = f.sent[f.sent.length - 1]
    expect(last.items[0].hidden).toBe(true)
    expect(last.visible).toBe(false)
    expect(host.querySelector('button')!.className).toBe('')
    sheet.remove()
  })

  it('idle: the safety-net re-check does no hit-testing while nothing changes, and still catches an attribute-only overlay (perf audit 2026-10-19)', async () => {
    // Real (asynchronous) frames: the shared synchronous stub would leave a frame "pending" forever.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (h: number) => clearTimeout(h))
    const f = fakeAdapter(); window.__bereanGlass = f.a
    const btn = () => host.querySelector('button')!
    const sheet = document.createElement('div'); document.body.appendChild(sheet)
    let covered = false
    const hits = vi.fn(() => (covered ? sheet : btn()))
    document.elementFromPoint = hits
    await mountBar({ onPlus: () => {} })
    await act(async () => { await new Promise((r) => setTimeout(r, 900)) }) // first paint + the first (dirty) tick
    hits.mockClear()
    await act(async () => { await new Promise((r) => setTimeout(r, 1100)) }) // three idle ticks
    expect(hits).not.toHaveBeenCalled()
    // An overlay shown only by an attribute the targeted observers ignore (not style/class):
    covered = true
    act(() => { sheet.setAttribute('data-state', 'open') })
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    expect(hits).toHaveBeenCalled()
    expect(f.sent[f.sent.length - 1].items[0].hidden).toBe(true)
    sheet.remove()
  })

  it('collapsed: keeps the resting rect and lets the native cluster slide itself', async () => {
    const f = fakeAdapter(); window.__bereanGlass = f.a
    document.elementFromPoint = () => host.querySelector('button')
    await mountBar({ onPlus: () => {}, collapsed: true })
    const last = f.sent[f.sent.length - 1]
    expect(last.collapsed).toBe(true)
    expect(last.visible).toBe(true)
  })

  it('unmount removes the native cluster', async () => {
    const f = fakeAdapter(); window.__bereanGlass = f.a
    document.elementFromPoint = () => host.querySelector('button')
    await mountBar({ onPlus: () => {} })
    act(() => root.unmount())
    expect(f.removed).toContain('nav')
    root = createRoot(host)
  })

  it('a remount (same cluster id) is never hidden or removed by the old instance (TEST 2026-10-17)', async () => {
    const f = fakeAdapter(); window.__bereanGlass = f.a
    document.elementFromPoint = (() => host.querySelector('button')) as typeof document.elementFromPoint
    await mountBar({ onPlus: () => {} })
    await act(async () => { await new Promise((r) => setTimeout(r, 150)) })
    // The page remounts (tab switch): new instance, same id, while the old one's timers are pending.
    await act(async () => { root.render(<Bar key="b" onPlus={() => {}} />); await new Promise((r) => setTimeout(r, 20)) })
    const before = f.sent.length
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    const late = f.sent.slice(before).filter((s) => s.id === 'nav')
    // Nothing sent after the remount hides the cluster (the old instance's refs are gone).
    expect(late.every((s) => s.visible && s.items.every((i) => !i.hidden))).toBe(true)
    expect(f.sent[f.sent.length - 1]).toMatchObject({ id: 'nav', visible: true })
  })

  it('an invisible tap-catcher layer (popover outside-tap layer) does not take the glass away (TEST 2026-10-17)', async () => {
    const f = fakeAdapter(); window.__bereanGlass = f.a
    const btn = () => host.querySelector('button')!
    const layer = document.createElement('div'); layer.setAttribute('data-glass-passthrough', ''); document.body.appendChild(layer)
    ;(document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = () => [layer, btn()]
    await mountBar({ onPlus: () => {} })
    await act(async () => { await new Promise((r) => setTimeout(r, 450)) })
    expect(f.sent[f.sent.length - 1].items[0].hidden).toBe(false)
    expect(btn().className).toBe('is-native-glass')
    // (A real cover still hands the control to the web — 'a sheet covering the placeholder…' below.)
    layer.remove()
    delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint
  })

  it('without an adapter the web control is untouched', async () => {
    await mountBar({ onPlus: () => {} })
    expect(host.querySelector('button')!.className).toBe('')
  })
})
