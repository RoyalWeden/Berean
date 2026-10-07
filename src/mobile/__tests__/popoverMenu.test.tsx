// @vitest-environment jsdom
/** iOS popover menu (TEST 2026-10-03): anchored to its control, dismissible, checks the current choice; sub-views open a sheet. */
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const sheetOpen = vi.fn()
vi.mock('../primitives/Sheet', () => ({ useSheets: () => ({ open: sheetOpen }) }))
vi.mock('../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
import { PopoverMenuHost, usePopoverMenu, _popoverState } from '../primitives/PopoverMenu'

function Opener({ onReady }: { onReady: (open: ReturnType<typeof usePopoverMenu>) => void }) { onReady(usePopoverMenu()); return <button id="anchor" type="button">…</button> }

describe('PopoverMenu', () => {
  it('opens at its anchor, picks a row, dismisses on an outside tap, routes sub-views to a sheet', () => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    let open!: ReturnType<typeof usePopoverMenu>
    act(() => root.render(<><Opener onReady={(o) => { open = o }} /><PopoverMenuHost /></>))
    const picked = vi.fn()
    act(() => open(document.getElementById('anchor'), undefined, [
      { id: 'a', label: 'Best match', checked: true, onSelect: () => {} },
      { id: 'b', label: 'Bible order', onSelect: picked },
      { id: 'c', label: 'Sort…', onSelect: () => {}, view: () => ({ key: 'c', title: 'Sort', render: () => null }) },
    ]))
    const menu = document.querySelector('.m-popover-menu')!
    expect(menu.getAttribute('role')).toBe('menu')
    expect(menu.querySelectorAll('.m-popover-row')).toHaveLength(3)
    expect(menu.querySelector('.m-popover-row .m-popover-check svg')).toBeTruthy() // checked row
    act(() => (menu.querySelectorAll('.m-popover-row')[1] as HTMLButtonElement).click())
    expect(picked).toHaveBeenCalled()
    expect(_popoverState()).toBeNull()
    act(() => open(document.getElementById('anchor'), undefined, [{ id: 'c', label: 'Sort…', onSelect: () => {}, view: () => ({ key: 'c', title: 'Sort', render: () => null }) }]))
    act(() => (document.querySelector('.m-popover-row') as HTMLButtonElement).click())
    expect(sheetOpen).toHaveBeenCalledWith(expect.objectContaining({ title: 'Sort' }))
    act(() => open(document.getElementById('anchor'), undefined, [{ id: 'x', label: 'X', onSelect: () => {} }]))
    const layer = document.querySelector('.m-popover-layer')!
    // Pressing down outside does NOT close yet (the tap must not fall through to the page)…
    act(() => { layer.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(_popoverState()).not.toBeNull()
    // …the tap closes it, and is consumed (never reaches the page behind).
    const pageClick = vi.fn(); document.addEventListener('click', pageClick)
    act(() => { layer.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(_popoverState()).toBeNull()
    expect(pageClick).not.toHaveBeenCalled()
    document.removeEventListener('click', pageClick)
    act(() => root.unmount())
  })
})
