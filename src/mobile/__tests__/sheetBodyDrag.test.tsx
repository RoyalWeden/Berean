// @vitest-environment jsdom
/** SEP25 SHEET-GESTURE wiring: native touchmove on the sheet body hands off at the scroll boundary. */
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SheetHost, useSheets } from '../primitives/Sheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

function touch(el: Element, type: string, y: number, x = 100): Event {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[] }
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  act(() => { el.dispatchEvent(e) })
  return e
}
const frame = () => act(async () => { await new Promise((r) => setTimeout(r, 40)) })
const sheetY = (sheet: HTMLElement) => Number(/translateY\((-?[\d.]+)px\)/.exec(sheet.style.transform)?.[1] ?? NaN)

describe('sheet body drag', () => {
  it('scrolled mid-content: a downward drag scrolls; at the top the sheet follows the finger and the keyboard is dismissed', async () => {
    function Opener() {
      const sheets = useSheets()
      React.useEffect(() => { sheets.open({ id: 't', title: 'T', detents: [0.5, 0.9], initialDetent: 1, render: () => <div><input id="q" /><div style={{ height: 3000 }} /></div> }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return null
    }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(<SheetHost><Opener /></SheetHost>) })
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    const sheet = document.querySelector('.mobile-sheet') as HTMLElement
    const body = sheet.querySelector('.mobile-sheet-body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    body.scrollTop = 40
    const input = document.getElementById('q') as HTMLInputElement
    input.focus()
    const y0 = sheetY(sheet)
    touch(body, 'touchstart', 300)
    const m1 = touch(body, 'touchmove', 320)          // content not at top → content scrolls
    expect(m1.defaultPrevented).toBe(false)
    await frame()
    expect(sheetY(sheet)).toBe(y0)
    expect(document.activeElement).toBe(input)
    body.scrollTop = 0                                 // the native scroll reached the top
    touch(body, 'touchmove', 330)                      // from here the sheet follows (+10, no jump)
    await frame()
    expect(sheetY(sheet)).toBeCloseTo(y0 + 10)
    expect(document.activeElement).not.toBe(input)
    touch(body, 'touchmove', 380)
    await frame()
    expect(sheetY(sheet)).toBeCloseTo(y0 + 60)
    touch(body, 'touchend', 380)
    act(() => root.unmount())
  })

  it('nothing to scroll below the top detent: dragging up raises the sheet; data-no-sheet-drag rows opt out', async () => {
    function Opener() {
      const sheets = useSheets()
      React.useEffect(() => { sheets.open({ id: 'u', title: 'U', detents: [0.5, 0.9], render: () => <div><div id="row" data-no-sheet-drag style={{ height: 40 }} /></div> }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return null
    }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(<SheetHost><Opener /></SheetHost>) })
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    const sheet = document.querySelector('.mobile-sheet[data-sheet-id="u"]') as HTMLElement
    const body = sheet.querySelector('.mobile-sheet-body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 300, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 300, configurable: true })
    const y0 = sheetY(sheet)
    const row = document.getElementById('row')!
    touch(row, 'touchstart', 400)
    const opted = touch(row, 'touchmove', 360)
    await frame()
    expect(opted.defaultPrevented).toBe(false)
    expect(sheetY(sheet)).toBe(y0)
    touch(row, 'touchend', 360)
    touch(body, 'touchstart', 400)
    const up = touch(body, 'touchmove', 380)
    touch(body, 'touchmove', 340)
    await frame()
    expect(up.defaultPrevented).toBe(true)
    expect(sheetY(sheet)).toBeCloseTo(y0 - 60)
    touch(body, 'touchend', 340)
    act(() => root.unmount())
  })

  it('reversing direction mid-drag keeps moving the sheet until release (TEST25-SHEET-001)', async () => {
    function Opener() {
      const sheets = useSheets()
      React.useEffect(() => { sheets.open({ id: 'r', title: 'R', detents: [0.4, 0.7, 0.9], initialDetent: 1, render: () => <div style={{ height: 3000 }} /> }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return null
    }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(<SheetHost><Opener /></SheetHost>) })
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    const sheet = document.querySelector('.mobile-sheet[data-sheet-id="r"]') as HTMLElement
    const body = sheet.querySelector('.mobile-sheet-body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 3000, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 600, configurable: true })
    body.scrollTop = 0
    const y0 = sheetY(sheet)
    touch(body, 'touchstart', 300)
    touch(body, 'touchmove', 310)           // down at the top → the sheet takes the touch
    touch(body, 'touchmove', 360)
    await frame()
    expect(sheetY(sheet)).toBeCloseTo(y0 + 60)  // 1:1 from the touch start
    const back = touch(body, 'touchmove', 250) // reverse upward past the start: still the sheet
    await frame()
    expect(back.defaultPrevented).toBe(true)
    expect(sheetY(sheet)).toBeCloseTo(y0 - 50)
    expect(body.scrollTop).toBe(0)           // the content never scrolled
    touch(body, 'touchend', 250)
    act(() => root.unmount())
  })
})
