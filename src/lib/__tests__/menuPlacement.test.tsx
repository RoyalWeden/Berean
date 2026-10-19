import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { computeMenuPosition, MenuPositioner, MENU_EDGE_PAD } from '../usePositionedMenu'

// TEST 2026-10-17: context menus opened away from the cursor / clipped at the window bottom.
const VP = { width: 1000, height: 800 }
const SIZE = { width: 220, height: 300 }

describe('computeMenuPosition', () => {
  it('opens with its top-left corner exactly on the cursor when there is room', () => {
    expect(computeMenuPosition({ x: 100, y: 120 }, SIZE, VP)).toEqual({ left: 100, top: 120, flippedX: false, flippedY: false })
  })

  it('flips left at the right edge (right edge lands on the cursor)', () => {
    const p = computeMenuPosition({ x: 900, y: 100 }, SIZE, VP)
    expect(p).toMatchObject({ left: 900 - 220, top: 100, flippedX: true, flippedY: false })
  })

  it('flips up at the bottom edge (bottom edge lands on the cursor)', () => {
    const p = computeMenuPosition({ x: 100, y: 700 }, SIZE, VP)
    expect(p).toMatchObject({ left: 100, top: 700 - 300, flippedX: false, flippedY: true })
  })

  it('flips both ways in the bottom-right corner', () => {
    expect(computeMenuPosition({ x: 900, y: 700 }, SIZE, VP)).toEqual({ left: 680, top: 400, flippedX: true, flippedY: true })
    // Cursor inside the edge margin itself: flipped, then clamped to keep the margin.
    expect(computeMenuPosition({ x: 995, y: 795 }, SIZE, VP)).toEqual({ left: 772, top: 492, flippedX: true, flippedY: true })
  })

  it('top-left corner: no flip, clamped to the edge margin', () => {
    expect(computeMenuPosition({ x: 0, y: 2 }, SIZE, VP)).toEqual({ left: MENU_EDGE_PAD, top: MENU_EDGE_PAD, flippedX: false, flippedY: false })
  })

  it('treats the edge margin as overflow (a menu touching the pad flips)', () => {
    // 1000 - 8 - 220 = 772 is the last left that fits.
    expect(computeMenuPosition({ x: 772, y: 0 }, SIZE, VP).left).toBe(772)
    expect(computeMenuPosition({ x: 773, y: 0 }, SIZE, VP).left).toBe(773 - 220)
  })

  it('clamps when the flipped position would still leave the window', () => {
    // A tall menu near the bottom of a short window: flipping up would go above the top.
    const p = computeMenuPosition({ x: 100, y: 250 }, { width: 220, height: 280 }, { width: 1000, height: 300 })
    expect(p.top).toBe(MENU_EDGE_PAD)
    expect(p.top + 280).toBeLessThanOrEqual(300)
  })

  it('a menu larger than the viewport pins to the margin instead of going negative', () => {
    const p = computeMenuPosition({ x: 50, y: 50 }, { width: 1200, height: 900 }, VP)
    expect(p.left).toBe(MENU_EDGE_PAD)
    expect(p.top).toBe(MENU_EDGE_PAD)
  })

  it("align 'right' hugs the anchor with the menu's right edge", () => {
    expect(computeMenuPosition({ x: 600, y: 40 }, SIZE, VP, { align: 'right' })).toMatchObject({ left: 380, top: 40, flippedX: true })
    // …and still clamps at the left edge.
    expect(computeMenuPosition({ x: 100, y: 40 }, SIZE, VP, { align: 'right' }).left).toBe(MENU_EDGE_PAD)
  })
})

describe('MenuPositioner', () => {
  let host: HTMLDivElement, root: Root
  afterEach(() => { act(() => root.unmount()); host.remove() })

  function mount(el: React.ReactElement) {
    host = document.createElement('div')
    // Simulate the reader: a zoomed, view-transition-named ancestor the menu must escape.
    host.style.setProperty('zoom', '1.25')
    host.style.setProperty('view-transition-name', 'chapter-x')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root.render(el))
  }

  it('portals to document.body (not inside its React parent) and places from the measured size', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    const offW = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')
    const offH = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-menu-positioner') ? 220 : 0 } })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get() { return (this as HTMLElement).hasAttribute('data-menu-positioner') ? 300 : 0 } })
    try {
      mount(<MenuPositioner x={950} y={780}><div role="menu">items</div></MenuPositioner>)
      const el = document.querySelector<HTMLElement>('[data-menu-positioner]')!
      expect(el).toBeTruthy()
      expect(host.contains(el)).toBe(false)
      expect(el.parentElement).toBe(document.body)
      expect(el.style.position).toBe('fixed')
      expect(el.style.left).toBe('730px')
      expect(el.style.top).toBe('480px')
      expect(el.style.getPropertyValue('--menu-origin')).toBe('bottom right')
    } finally {
      if (offW) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offW)
      if (offH) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offH)
    }
  })

  it('portal={false} renders in place', () => {
    mount(<MenuPositioner x={10} y={10} portal={false}>x</MenuPositioner>)
    expect(host.querySelector('[data-menu-positioner]')).toBeTruthy()
  })
})
