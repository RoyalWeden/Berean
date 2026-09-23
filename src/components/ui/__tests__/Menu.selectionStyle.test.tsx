import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { MenuItem, MenuSurface } from '../Menu'

// ─── TEST-012 / TEST-017 / TEST-018: session menu + Scripture "…" menu should highlight the
// selected/checked row (bg-accent-muted) instead of reserving a leading checkmark column that
// sits empty on every unchecked sibling. `selectionStyle="highlight"` is the opt-in that drops
// the check glyph (and the column it reserves) while keeping aria-checked/role so a11y is
// unaffected. This proves both halves: no check glyph renders, and the selected row's class
// list carries the highlight treatment while an unselected row does not. ────────────────────

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  act(() => { root?.unmount() })
  container?.remove()
  container = null
  root = null
})

function render(children: React.ReactElement) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => { root!.render(children) })
  return container
}

describe('MenuItem selectionStyle="highlight"', () => {
  it('renders no check glyph and highlights the selected row, keeping aria-checked', () => {
    const el = render(
      <MenuSurface>
        <MenuItem label="Selected" active selectionStyle="highlight" />
        <MenuItem label="Not selected" active={false} selectionStyle="highlight" />
      </MenuSurface>,
    )
    const buttons = el.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    // No leading check icon (lucide Check renders an <svg>) on either row.
    buttons.forEach((b) => expect(b.querySelector('svg')).toBeNull())
    // Semantic state is preserved even though nothing is drawn for it.
    expect(buttons[0].getAttribute('role')).toBe('menuitemradio')
    expect(buttons[0].getAttribute('aria-checked')).toBe('true')
    expect(buttons[1].getAttribute('aria-checked')).toBe('false')
    // Visual: the selected row carries the highlight treatment, the other doesn't.
    expect(buttons[0].className).toContain('bg-accent-muted')
    expect(buttons[1].className).not.toContain('bg-accent-muted')
  })

  it('default (check) style still reserves the column and draws a check glyph', () => {
    const el = render(
      <MenuSurface>
        <MenuItem label="Selected" active />
      </MenuSurface>,
    )
    const button = el.querySelector('button')!
    expect(button.querySelector('svg')).not.toBeNull()
    expect(button.className).not.toContain('bg-accent-muted')
  })
})
