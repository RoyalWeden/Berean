// @vitest-environment jsdom
/** TEST 2026-10-18 — the caret's Go-to row is three icon-only buttons side by side: History,
 *  Settings (turn THIS tab into that page) and Berean Chat (opens over the tab). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const openChatOverlay = vi.fn()
const runExperience = vi.fn()
vi.mock('../navigation/chatOverlay', () => ({ openChatOverlay: (...a: unknown[]) => openChatOverlay(...a) }))
vi.mock('../navigation/experiences', () => ({ runExperience: (...a: unknown[]) => runExperience(...a) }))
vi.mock('../primitives/haptics', () => ({ haptic: new Proxy({}, { get: () => () => Promise.resolve() }) }))
import { CaretSheet } from '../commands/CaretSheet'
import { useAppStore } from '@/store'
import type { SheetApi } from '../primitives/Sheet'

function mount(type: string) {
  const close = vi.fn()
  const api = { close, depth: 0, push: vi.fn(), pop: vi.fn() } as unknown as SheetApi
  const st = useAppStore.getState()
  useAppStore.setState({ activeSpace: 'scripture', tabs: { ...st.tabs, scripture: [{ id: 't1', spaceId: 'scripture', type, title: 'Tab', state: {} } as never] }, activeTabId: { ...st.activeTabId, scripture: 't1' } })
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  act(() => root.render(<CaretSheet scope={() => ({ title: 'Tab', sections: [{ id: 'reading', title: 'Reading', commands: [{ kind: 'action', id: 'x', label: 'Read aloud', run: () => {} }] }] })} api={api} />))
  return { host, root, close }
}

describe('caret Go-to row', () => {
  beforeEach(() => { openChatOverlay.mockClear(); runExperience.mockClear() })

  it('is the last group: History, Settings, Chat — icons only', () => {
    const { host, root, close } = mount('bible')
    const row = host.querySelector('.mobile-caret')!.lastElementChild!
    expect(row.classList.contains('mobile-caret-goto')).toBe(true)
    const buttons = [...row.querySelectorAll('button')]
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Show History in this tab', 'Show Settings in this tab', 'Open Berean Chat'])
    expect(buttons.every((b) => b.textContent === '')).toBe(true)
    act(() => buttons[0].click())
    expect(runExperience).toHaveBeenCalledWith('history', 'current-tab')
    act(() => buttons[2].click())
    expect(openChatOverlay).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(2)
    act(() => root.unmount())
  })

  it('marks the tab\'s own type as current', () => {
    const { host, root } = mount('settings')
    const settings = host.querySelector<HTMLButtonElement>('[aria-label="Show Settings in this tab"]')!
    expect(settings.disabled).toBe(true)
    expect(settings.getAttribute('aria-current')).toBe('page')
    act(() => root.unmount())
  })
})
