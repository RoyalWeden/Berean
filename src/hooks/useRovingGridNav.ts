import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

interface RovingGridNavOptions {
  itemCount: number
  /** 1 for a vertical list or a single-row chip strip. */
  columns: number
}

/**
 * Roving-tabindex arrow-key navigation for a group of same-purpose buttons (a chip row,
 * a checkbox grid, a dropdown's option list). Exactly one item in the group is ever a
 * native Tab stop (`tabIndex: 0`); arrow keys move focus within the group and clamp at
 * the edges rather than wrapping. Enter/Space are left untouched — each button's own
 * native activation and existing `onClick` keep working with no extra code here.
 */
export function useRovingGridNav({ itemCount, columns }: RovingGridNavOptions) {
  const [focusedIndex, setFocusedIndex] = useState(0)
  const refs = useRef<(HTMLElement | null)[]>([])

  function moveTo(index: number) {
    const clamped = Math.max(0, Math.min(itemCount - 1, index))
    setFocusedIndex(clamped)
    refs.current[clamped]?.focus()
  }

  function getItemProps(index: number) {
    return {
      tabIndex: index === focusedIndex ? 0 : -1,
      ref: (el: HTMLElement | null) => { refs.current[index] = el },
      onKeyDown: (e: KeyboardEvent) => {
        switch (e.key) {
          case 'ArrowDown': e.preventDefault(); moveTo(index + columns); break
          case 'ArrowUp': e.preventDefault(); moveTo(index - columns); break
          case 'ArrowRight': e.preventDefault(); moveTo(index + 1); break
          case 'ArrowLeft': e.preventDefault(); moveTo(index - 1); break
        }
      },
    }
  }

  /** Focus the current roving-tabindex item (e.g. when handing off focus from an external search input). */
  function focusCurrent() {
    moveTo(focusedIndex)
  }

  return { getItemProps, focusedIndex, setFocusedIndex, focusCurrent }
}
