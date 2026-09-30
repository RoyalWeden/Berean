// @vitest-environment jsdom
/** TEST 2026-09-29 — every caret can switch the CURRENT tab to History or Settings. */
import { describe, it, expect, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const runExperience = vi.fn()
vi.mock('../navigation/experiences', () => ({ runExperience: (...a: unknown[]) => runExperience(...a) }))
vi.mock('../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
import { CaretSheet } from '../commands/CaretSheet'
import { useAppStore } from '@/store'
import type { SheetApi } from '../primitives/Sheet'

describe('caret History / Settings', () => {
  it('offers both and switches the current tab; hides the entry for the tab’s own type', () => {
    const close = vi.fn()
    const api = { close, depth: 0, push: vi.fn(), pop: vi.fn() } as unknown as SheetApi
    const st = useAppStore.getState()
    useAppStore.setState({ activeSpace: 'scripture', tabs: { ...st.tabs, scripture: [{ id: 't1', spaceId: 'scripture', type: 'bible', title: 'Genesis 1', state: {} } as never] }, activeTabId: { ...st.activeTabId, scripture: 't1' } })
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    act(() => root.render(<CaretSheet scope={() => ({ title: 'Genesis 1', sections: [] })} api={api} />))
    const settings = host.querySelector('[aria-label="Show Settings in this tab"]') as HTMLButtonElement
    expect(host.querySelector('[aria-label="Show History in this tab"]')).toBeTruthy()
    act(() => settings.click())
    expect(close).toHaveBeenCalled()
    expect(runExperience).toHaveBeenCalledWith('settings', 'current-tab')
    useAppStore.setState({ tabs: { ...useAppStore.getState().tabs, scripture: [{ id: 't1', spaceId: 'scripture', type: 'settings', title: 'Settings', state: {} } as never] } })
    act(() => root.render(<CaretSheet scope={() => ({ title: 'Settings', sections: [] })} api={api} />))
    expect(host.querySelector('[aria-label="Show Settings in this tab"]')).toBeNull()
    act(() => root.unmount())
  })
})
