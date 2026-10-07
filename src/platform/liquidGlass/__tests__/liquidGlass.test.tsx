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
    // The placeholder stays visible until the native control has faded in (no empty frame)…
    expect(btn().className).toBe('')
    // …then hides.
    await act(async () => { await new Promise((r) => setTimeout(r, 400)) })
    expect(btn().className).toBe('is-native-glass')
    f.press('plus')
    expect(onPlus).toHaveBeenCalledTimes(1)
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

  it('without an adapter the web control is untouched', async () => {
    await mountBar({ onPlus: () => {} })
    expect(host.querySelector('button')!.className).toBe('')
  })
})
