// @vitest-environment jsdom
/** SEP26-VERSE-001…005 — the several-verse sheet belongs to the same family as the one-verse sheet. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SheetHost, useSheets } from '../primitives/Sheet'
import { MultiVerseSheet } from '../study/MultiVerseSheet'
import { useAppStore } from '@/store'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('@capacitor/haptics', () => ({ Haptics: { impact: () => Promise.resolve(), selectionChanged: () => Promise.resolve(), notification: () => Promise.resolve() }, ImpactStyle: { Light: 'LIGHT', Medium: 'MEDIUM', Heavy: 'HEAVY' }, NotificationType: { Success: 'SUCCESS', Warning: 'WARNING' } }))

let root: Root | null = null
let host: HTMLDivElement | null = null
const writeText = vi.fn(async () => {})

beforeEach(() => {
  ;(window as unknown as { notes: unknown }).notes = { getVerseNotes: async () => [] }
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  writeText.mockClear()
  useAppStore.setState({ selectedVersesByTab: { t1: [
    { bookId: 'MAT', chapter: 23, verse: 12, textId: 'kjva' },
    { bookId: 'MAT', chapter: 23, verse: 13, textId: 'kjva' },
  ] } })
})
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove() })

async function openSheet(initialDetent = 0) {
  function Opener() {
    const sheets = useSheets()
    React.useEffect(() => { sheets.open({ id: 'verse', lowDetent: 150, detents: [0.55, 0.92], initialDetent, render: (api) => <MultiVerseSheet tabId="t1" api={api} /> }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
    return null
  }
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(<SheetHost><Opener /></SheetHost>) })
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
}

describe('several-verse sheet', () => {
  it('titles with the Scripture reference, Copy first, no Clear, the same action row as one verse', async () => {
    await openSheet()
    const sheet = document.querySelector('.mobile-verse-sheet')!
    expect(sheet.querySelector('.mobile-verse-actions-ref')?.textContent).toMatch(/Matthew 23:12.13/)
    expect(sheet.textContent).not.toMatch(/2 verses/)
    const actions = [...sheet.querySelectorAll('.mobile-verse-primary .mobile-verse-action')].map((b) => b.textContent?.trim())
    // The same four slots as one verse (SEP27-VERSE-001): Notes, not Copy refs, beside Copy.
    expect(actions).toEqual(['Copy', 'Notes', 'Refs', "Strong's"])
    expect([...sheet.querySelectorAll('button')].some((b) => /^clear$/i.test(b.textContent?.trim() ?? '') || /clear selection/i.test(b.getAttribute('aria-label') ?? ''))).toBe(false)
  })

  it('Copy references (expanded list) copies the shared multi-verse reference format', async () => {
    await openSheet(1)
    const btn = [...document.querySelectorAll('.mobile-action-row')].find((b) => b.textContent?.includes('Copy references')) as HTMLButtonElement
    await act(async () => { btn.click(); await Promise.resolve() })
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/Matthew 23:12.13/))
  })

  it('selecting another verse updates the same sheet', async () => {
    await openSheet()
    act(() => { useAppStore.setState({ selectedVersesByTab: { t1: [...useAppStore.getState().selectedVersesByTab.t1, { bookId: 'MAT', chapter: 23, verse: 14, textId: 'kjva' }] } }) })
    expect(document.querySelectorAll('.mobile-sheet').length).toBe(1)
    expect(document.querySelector('.mobile-verse-actions-ref')?.textContent).toMatch(/Matthew 23:12.14/)
  })
})
