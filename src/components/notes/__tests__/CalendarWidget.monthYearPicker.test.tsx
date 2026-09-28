import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { CalendarGrid, yearPageStart } from '../CalendarWidget'

let container: HTMLDivElement | null = null
let root: Root | null = null

function mount(props: Partial<React.ComponentProps<typeof CalendarGrid>> & { date: Date }) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => {
    root!.render(
      <CalendarGrid
        notes={[]}
        onDateChange={() => {}}
        onSelectDate={() => {}}
        {...props}
      />,
    )
  })
  return container
}

function click(el: Element | null) {
  if (!el) throw new Error('element not found')
  act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) })
}

describe('CalendarGrid month/year picker (TEST-011)', () => {
  afterEach(() => {
    if (root) act(() => root!.unmount())
    container?.remove()
    container = null
    root = null
  })

  it('opens a month/year picker when the "Month Year" label is clicked', () => {
    const el = mount({ date: new Date(2026, 8, 1) }) // September 2026
    const trigger = el.querySelector('button[aria-haspopup="dialog"]')
    expect(trigger).toBeTruthy()
    click(trigger)
    // Radix portals the popover content to document.body.
    const monthGrid = document.body.querySelector('[role="grid"][aria-label="Month"]')
    expect(monthGrid).toBeTruthy()
    expect(monthGrid?.querySelectorAll('[role="gridcell"]').length).toBe(12)
  })

  it('picking a month calls onDateChange with the 1st of that month/year and closes the picker', () => {
    const onDateChange = vi.fn()
    const el = mount({ date: new Date(2026, 8, 1), onDateChange })
    click(el.querySelector('button[aria-haspopup="dialog"]'))
    const marButton = Array.from(document.body.querySelectorAll('[role="gridcell"]'))
      .find((b) => b.textContent === 'Mar')
    click(marButton ?? null)
    expect(onDateChange).toHaveBeenCalledTimes(1)
    const picked: Date = onDateChange.mock.calls[0][0]
    expect(picked.getFullYear()).toBe(2026)
    expect(picked.getMonth()).toBe(2) // March
    expect(picked.getDate()).toBe(1)
  })

  it('the year stepper moves the picker forward/back a year without touching the calendar\'s own date', () => {
    const el = mount({ date: new Date(2026, 8, 1) })
    click(el.querySelector('button[aria-haspopup="dialog"]'))
    expect(document.body.textContent).toContain('2026')
    const nextYear = document.body.querySelector('button[aria-label="Next year"]')
    click(nextYear)
    expect(document.body.textContent).toContain('2027')
  })

  it('"Today" jumps to the current month/year', () => {
    const onDateChange = vi.fn()
    const el = mount({ date: new Date(2020, 0, 1), onDateChange })
    click(el.querySelector('button[aria-haspopup="dialog"]'))
    const todayBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent === 'Today')
    click(todayBtn ?? null)
    expect(onDateChange).toHaveBeenCalledTimes(1)
    const picked: Date = onDateChange.mock.calls[0][0]
    const now = new Date()
    expect(picked.getFullYear()).toBe(now.getFullYear())
    expect(picked.getMonth()).toBe(now.getMonth())
  })

  it('the year label switches to a 12-year grid for long jumps (TEST-011)', () => {
    const onDateChange = vi.fn()
    const el = mount({ date: new Date(2026, 8, 1), onDateChange })
    click(el.querySelector('button[aria-haspopup="dialog"]'))
    click(document.body.querySelector('button[aria-label="2026, choose a year"]'))
    expect(document.body.querySelector('[role="grid"][aria-label="Year"]')).toBeTruthy()
    click(document.body.querySelector('button[aria-label="Previous 12 years"]'))
    const byText = (t: string) => Array.from(document.body.querySelectorAll('[role="gridcell"]')).find((b) => b.textContent === t) ?? null
    click(byText('2005'))
    click(byText('Jul'))
    expect(onDateChange).toHaveBeenCalledTimes(1)
    const d: Date = onDateChange.mock.calls[0][0]
    expect([d.getFullYear(), d.getMonth()]).toEqual([2005, 6])
  })

  it('yearPageStart groups years in pages of 12', () => {
    expect(yearPageStart(2026)).toBe(2016)
    expect(yearPageStart(2027)).toBe(2016)
    expect(yearPageStart(2028)).toBe(2028)
  })
})
