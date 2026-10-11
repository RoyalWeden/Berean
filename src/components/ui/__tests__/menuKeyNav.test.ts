// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { KeyboardEvent } from 'react'
import { menuKeyNav } from '../menuKeyNav'

function menu(labels: string[]) {
  const root = document.createElement('div')
  root.setAttribute('role', 'menu')
  for (const l of labels) {
    const b = document.createElement('button')
    b.setAttribute('role', 'menuitem')
    b.textContent = l
    root.appendChild(b)
  }
  document.body.appendChild(root)
  return root
}
function press(root: HTMLElement, key: string) {
  let prevented = false
  menuKeyNav({ key, currentTarget: root, defaultPrevented: false, metaKey: false, ctrlKey: false, altKey: false, preventDefault: () => { prevented = true } } as unknown as KeyboardEvent<HTMLElement>)
  return prevented
}

describe('menuKeyNav (MenuSurface + PopoverSurface role="menu")', () => {
  it('↓/↑ move between items and wrap', () => {
    const root = menu(['All Words', 'Any Word', 'Exact Phrase'])
    ;(root.children[0] as HTMLElement).focus()
    expect(press(root, 'ArrowDown')).toBe(true)
    expect(document.activeElement?.textContent).toBe('Any Word')
    press(root, 'ArrowDown'); press(root, 'ArrowDown')
    expect(document.activeElement?.textContent).toBe('All Words')
    press(root, 'ArrowUp')
    expect(document.activeElement?.textContent).toBe('Exact Phrase')
  })
  it('Home/End and typeahead', () => {
    const root = menu(['All Words', 'Any Word', 'Exact Phrase'])
    ;(root.children[1] as HTMLElement).focus()
    press(root, 'End'); expect(document.activeElement?.textContent).toBe('Exact Phrase')
    press(root, 'Home'); expect(document.activeElement?.textContent).toBe('All Words')
    press(root, 'e'); expect(document.activeElement?.textContent).toBe('Exact Phrase')
  })
  it('leaves Enter to the focused item', () => {
    const root = menu(['All Words'])
    expect(press(root, 'Enter')).toBe(false)
  })
})
