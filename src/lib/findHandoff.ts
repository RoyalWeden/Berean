import { useAppStore } from '@/store'

/**
 * Enter in the floating search → the Scripture find bar, with no keystroke lost in between.
 *
 * Root cause of the lost keys (reproduced over CDP, 2026-10-18): after Enter the floating search
 * was logically closed, but its input stayed `document.activeElement` for the whole exit
 * animation, so every character typed in that window went into the dying input — the global
 * type-to-find handler saw "typing in an input" and left them alone. After the exit, Radix put
 * focus back on whatever was focused before the search opened (possibly another field).
 *
 * The handoff is explicit instead of timed:
 *  1. the closing search gives up focus synchronously (`releaseFocusWithin`), and never restores
 *     focus over an element that already took it (`shouldRestoreFocus`);
 *  2. the find bar opens in its type-to-find (auto-dismissing) mode right away, so keys that
 *     arrive before its input mounts are appended to the query by App.tsx's keydown handler,
 *     which reads the store directly (never effect-synced refs that lag a heavy chapter render);
 *  3. the find input focuses in a layout effect with the caret at the end — later keys type
 *     straight into it, each exactly once.
 */
export function handOffToScriptureFind(): void {
  const s = useAppStore.getState()
  s.setActivePanelId('bible')
  s.openFindBar(true, '')
  // Starts the auto-dismiss countdown: the bar quietly closes if nothing is typed.
  window.dispatchEvent(new Event('berean:findBarResetTimer'))
}

/** Blur whatever is focused inside `container` (an overlay that has just closed). */
export function releaseFocusWithin(container: Element | null): void {
  const a = typeof document !== 'undefined' ? document.activeElement : null
  if (a instanceof HTMLElement && container && container.contains(a)) a.blur()
}

/** A closing overlay may restore focus only when nothing else has claimed it meanwhile. */
export function shouldRestoreFocus(overlay: Element | null): boolean {
  const a = document.activeElement
  return !a || a === document.body || (!!overlay && overlay.contains(a))
}

export type TypeToFindAction =
  | { kind: 'open'; seed: string }          // open the Scripture find bar seeded with this key
  | { kind: 'append'; query: string }       // the bar is open, its input not focused yet
  | { kind: 'verse-digit'; digit: string }  // digits in the reader go to go-to-verse
  | { kind: 'panel'; panel: 'notes' | 'lexicon'; seed: string }
  | { kind: 'keep-alive' }                  // typing inside the open bar: restart its countdown
  | null

/**
 * What a plain keystroke (no ⌘/⌃/⌥, not composing) does for type-to-find. Pure: App.tsx's global
 * keydown handler applies the result. `typing` = focus is in a text field. Reads the find bar's
 * CURRENT state (from the store, at the moment of the key) — see the module comment.
 */
export function typeToFindAction(key: string, st: { typing: boolean; findOpen: boolean; autoOpen: boolean; query: string; panel: 'bible' | 'notes' | 'lexicon' }): TypeToFindAction {
  if (key.length !== 1) return null
  if (!st.typing && !st.findOpen) {
    if (st.panel === 'bible') return key >= '0' && key <= '9' ? { kind: 'verse-digit', digit: key } : { kind: 'open', seed: key }
    return { kind: 'panel', panel: st.panel, seed: key }
  }
  if (st.findOpen && st.autoOpen) return st.typing ? { kind: 'keep-alive' } : { kind: 'append', query: st.query + key }
  return null
}
