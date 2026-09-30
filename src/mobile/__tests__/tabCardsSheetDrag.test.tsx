// @vitest-environment jsdom
/** TEST 2026-09-29 (Tabs sheet): a drag that begins ON a tab card moves the sheet like any other
 *  drag — only a lifted (long-pressed, reordering) card owns the finger. */
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SheetHost, useSheets } from '../primitives/Sheet'
import { TabCardsSheet } from '../tabs/TabCardsSheet'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

function touch(el: Element, type: string, y: number, x = 100): Event {
  const e = new Event(type, { bubbles: true, cancelable: true }) as Event & { touches: unknown[] }
  Object.defineProperty(e, 'touches', { value: type === 'touchend' ? [] : [{ clientX: x, clientY: y }] })
  act(() => { el.dispatchEvent(e) })
  return e
}
const sheetY = (sheet: HTMLElement) => Number(/translateY\((-?[\d.]+)px\)/.exec(sheet.style.transform)?.[1] ?? NaN)

describe('tabs sheet drag', () => {
  it('the card grid never opts out of the sheet gesture at rest', async () => {
    function Opener() {
      const sheets = useSheets()
      React.useEffect(() => { sheets.open({ id: 'tabs', title: 'Tabs', detents: [0.5, 0.9], render: (api) => <TabCardsSheet api={api} openMore={() => {}} /> }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
      return null
    }
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => { root.render(<SheetHost><Opener /></SheetHost>) })
    await act(async () => { await new Promise((r) => setTimeout(r, 600)) })
    const sheet = document.querySelector('.mobile-sheet[data-sheet-id="tabs"]') as HTMLElement
    const grid = sheet.querySelector('.mobile-tab-cards') as HTMLElement
    expect(grid.hasAttribute('data-no-sheet-drag')).toBe(false)
    const body = sheet.querySelector('.mobile-sheet-body') as HTMLElement
    Object.defineProperty(body, 'scrollHeight', { value: 300, configurable: true })
    Object.defineProperty(body, 'clientHeight', { value: 300, configurable: true })
    const card = grid.querySelector('.mobile-tab-card') ?? grid
    const y0 = sheetY(sheet)
    touch(card, 'touchstart', 400)
    touch(card, 'touchmove', 380)
    const mv = touch(card, 'touchmove', 340)
    await act(async () => { await new Promise((r) => setTimeout(r, 40)) })
    expect(mv.defaultPrevented).toBe(true)
    expect(sheetY(sheet)).toBeLessThan(y0)
    touch(card, 'touchend', 340)
    act(() => root.unmount())
  })
})
