// @vitest-environment jsdom
/** UI-MENU-001 — anchored menus are never cropped by the keyboard, the safe areas or the screen. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { layoutAnchoredMenu } from '../primitives/anchoredMenu'
import { NoteInsertButton } from '../notes/NoteInsertButton'
import { NOTE_INSERT_ITEMS } from '../notes/noteInsertCommands'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

// iPhone 17 Pro-ish: 874 pt tall, 62 pt Dynamic Island inset, 34 pt home indicator, 336 pt keyboard.
const base = { viewportHeight: 874, safeTop: 62, safeBottom: 34 }

describe('layoutAnchoredMenu', () => {
  it('keyboard closed: the menu fits above the + and does not scroll', () => {
    const l = layoutAnchoredMenu({ ...base, keyboard: 0, anchor: { top: 790, bottom: 838 }, content: 480 })
    expect(l).toEqual({ placement: 'above', maxHeight: 790 - 10 - 70, scroll: false })
  })

  it('keyboard open: the room above the + stops at the safe area — the menu shrinks and scrolls instead of being cropped', () => {
    // + sits 12 pt above the keyboard: its top is 874 - 336 - 12 - 48 = 478
    const l = layoutAnchoredMenu({ ...base, keyboard: 336, anchor: { top: 478, bottom: 526 }, content: 480 })
    expect(l.placement).toBe('above')
    expect(l.maxHeight).toBe(478 - 10 - (62 + 8))   // 398: from the + up to just below the Island
    expect(l.scroll).toBe(true)
    // the menu's top edge (anchor − gap − maxHeight) is never above the safe area
    expect(478 - 10 - l.maxHeight).toBeGreaterThanOrEqual(62)
  })

  it('never places a menu over the keyboard: below is used only when it has more room', () => {
    const nearTop = layoutAnchoredMenu({ ...base, keyboard: 336, anchor: { top: 100, bottom: 148 }, content: 300 })
    expect(nearTop.placement).toBe('below')
    expect(148 + 10 + nearTop.maxHeight).toBeLessThanOrEqual(874 - 336 - 8)
  })

  it('small iPhone + large Dynamic Type: still fully reachable (scrolls)', () => {
    const l = layoutAnchoredMenu({ viewportHeight: 667, safeTop: 20, safeBottom: 0, keyboard: 260, anchor: { top: 347, bottom: 395 }, content: 900 })
    expect(l).toMatchObject({ placement: 'above', scroll: true })
    expect(l.maxHeight).toBe(347 - 10 - 28)
  })
})

let root: Root | null = null
let host: HTMLDivElement | null = null
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; document.documentElement.style.removeProperty('--m-keyboard-h') })

describe('Note + menu with the keyboard open', () => {
  it('shows every option, height-limited to the space above the + (scrollable), editor focus kept', () => {
    document.documentElement.style.setProperty('--m-keyboard-h', '336px')
    Object.defineProperty(window, 'innerHeight', { value: 874, configurable: true })
    host = document.createElement('div'); document.body.appendChild(host)
    root = createRoot(host)
    const view = { state: {}, dispatch: () => {}, focus: () => {} } as never
    act(() => root!.render(<NoteInsertButton view={view} placement="viewport" />))
    const fab = document.querySelector('.m-note-insert-fab') as HTMLButtonElement
    fab.getBoundingClientRect = () => ({ top: 478, bottom: 526, left: 16, right: 64, width: 48, height: 48, x: 16, y: 478, toJSON: () => ({}) })
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    fab.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)            // the editor keeps focus → keyboard stays
    act(() => fab.click())
    const menu = document.querySelector('.m-note-insert-menu') as HTMLDivElement
    expect(menu).toBeTruthy()
    // every option is rendered (reachable by scrolling when it does not fit)
    expect(menu.querySelectorAll('.m-note-insert-row')).toHaveLength(NOTE_INSERT_ITEMS.length)
    const max = parseFloat(menu.style.maxHeight)
    expect(max).toBeGreaterThan(0)
    expect(478 - 10 - max).toBeGreaterThanOrEqual(0)    // top edge inside the screen
    expect(menu.style.visibility).toBe('')
  })
})
