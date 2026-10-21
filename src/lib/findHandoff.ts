import { useAppStore } from '@/store'

/**
 * Enter in the floating search → the Scripture reader, with no keystroke lost in between.
 *
 * Root cause of the lost keys (reproduced over CDP, 2026-10-18): after Enter the floating search
 * was logically closed, but its input stayed `document.activeElement` for the whole exit
 * animation, so every character typed in that window went into the dying input — the global
 * type-to-find handler saw "typing in an input" and left them alone. After the exit, Radix put
 * focus back on whatever was focused before the search opened (possibly another field).
 *
 * The handoff is explicit instead of timed:
 *  1. the closing search gives up focus synchronously (`releaseFocusWithin`), and neither it nor
 *     Radix puts focus back into the field the search was opened from;
 *  2. the reader becomes the active panel, so the first letter typed opens the find bar through
 *     ordinary type-to-find (App.tsx's keydown handler, which reads the store directly — keys that
 *     arrive before the bar's input mounts are appended to its query);
 *  3. the find input focuses in a layout effect with the caret at the end — later keys type
 *     straight into it, each exactly once.
 *
 * The bar itself is NOT opened here: a new Scripture tab shows just the chapter until the user
 * actually types (2026-10-19: "it opens the findbar by default even though I clicked nothing").
 */
export function handOffToScriptureFind(): void {
  useAppStore.getState().setActivePanelId('bible')
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

/**
 * App.tsx's global type-to-find keydown routing (a plain key: no ⌘/⌃/⌥, not composing).
 *
 * - While the floating search is open it owns the keyboard (its field focuses on open): nothing
 *   here may open the Scripture find bar behind it with a letter meant for the search.
 * - A key applied here (seed, append, digit, another panel's seed) is CONSUMED: its default action
 *   is cancelled. Otherwise, when the find field takes focus during this same keydown — React
 *   commits the newly opened bar (whose layout effect focuses the field) before the browser
 *   performs the key's text insertion — the browser types the character into the field a second
 *   time ("g" → "gg", reproduced with real keystrokes 2026-10-19).
 */
export function handleTypeToFindKey(e: KeyboardEvent, hooks: { isTypingTarget: (el: Element | null) => boolean; restartDismiss: () => void }): void {
  const st = useAppStore.getState()
  if (st.searchOpen) return
  const action = typeToFindAction(e.key, {
    typing: hooks.isTypingTarget(document.activeElement),
    findOpen: st.findBarOpen, autoOpen: st.findBarAutoOpen, query: st.findBarQuery, panel: st.activePanelId,
  })
  if (!action) return
  if (action.kind !== 'keep-alive') e.preventDefault()
  switch (action.kind) {
    case 'verse-digit': window.dispatchEvent(new CustomEvent('berean:verseDigit', { detail: { digit: action.digit } })); break
    case 'open': st.openFindBar(true, action.seed); hooks.restartDismiss(); break
    case 'append': st.setFindBarQuery(action.query); hooks.restartDismiss(); break
    case 'keep-alive': hooks.restartDismiss(); break
    case 'panel': window.dispatchEvent(new CustomEvent(action.panel === 'notes' ? 'berean:openNotesFindBar' : 'berean:openLexiconFindBar', { detail: { seedChar: action.seed } })); break
  }
}
