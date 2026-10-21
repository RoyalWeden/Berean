/**
 * Enter in the floating search → new Scripture tab → keep typing: no keystroke lost or doubled
 * (2026-10-18 — "the first few keystrokes are sometimes lost"). Reproduced over CDP in the
 * running app before the fix: EVERY key typed in the first ~400ms after Enter went into the
 * closing search's input. These tests rebuild that transition step by step with the real pieces —
 * the store, FindBar, the routing App.tsx's keydown handler applies (typeToFindAction), and a
 * Radix dialog wired the way FloatingSearch is (releaseFocusWithin / shouldRestoreFocus).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act, useLayoutEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import FindBar from '@/components/shell/FindBar'
import { useAppStore } from '@/store'
import { handOffToScriptureFind, handleTypeToFindKey, releaseFocusWithin, shouldRestoreFocus, typeToFindAction } from '../findHandoff'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const isTyping = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)

/** App.tsx's global keydown routing — the very function App calls. */
function onWindowKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
  handleTypeToFindKey(e, { isTypingTarget: isTyping, restartDismiss: () => {} })
}

/** One real keystroke on whatever has focus: keydown, then (unless handled) the character. */
function press(ch: string) {
  const target = (document.activeElement ?? document.body) as HTMLElement
  const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })
  target.dispatchEvent(ev)
  if (!ev.defaultPrevented && target instanceof HTMLInputElement) {
    const at = target.selectionStart ?? target.value.length
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(target, target.value.slice(0, at) + ch + target.value.slice(target.selectionEnd ?? at))
    target.setSelectionRange(at + 1, at + 1)
    target.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/**
 * A keystroke in the browser's real order: keydown is dispatched, React commits whatever the
 * handlers changed (a newly opened find bar focuses its field in that commit), and only THEN does
 * the browser perform the default action — inserting the character into whatever is focused NOW —
 * unless a handler cancelled it. This is the ordering that typed "gg" for one "g".
 */
async function pressRealOrder(ch: string) {
  const target = (document.activeElement ?? document.body) as HTMLElement
  const ev = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })
  await act(async () => { target.dispatchEvent(ev) })
  const now = document.activeElement
  if (!ev.defaultPrevented && now instanceof HTMLInputElement) {
    await act(async () => {
      const at = now.selectionStart ?? now.value.length
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(now, now.value.slice(0, at) + ch + now.value.slice(now.selectionEnd ?? at))
      now.setSelectionRange(at + 1, at + 1)
      now.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }
}

let endExit: () => void = () => {}
/** The floating search's lifecycle, as FloatingSearch wires it — including the exit animation
 *  (AnimatePresence + forceMount): after close the content stays mounted, input and all, until
 *  the test ends the animation with endExit(). That window is where the keys used to vanish. */
function SearchOverlay({ onEnter }: { onEnter: () => void }) {
  const open = useAppStore((s) => s.searchOpen)
  const [exiting, setExiting] = useState(false)
  const wasOpen = useRef(open)
  if (wasOpen.current && !open && !exiting) setExiting(true)
  wasOpen.current = open
  endExit = () => setExiting(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const handedOff = useRef(false)
  if (open) handedOff.current = false
  useLayoutEffect(() => { if (!open) releaseFocusWithin(contentRef.current) }, [open])
  if (!open && !exiting) return null
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal forceMount>
        <Dialog.Content forceMount ref={contentRef} aria-describedby={undefined} onCloseAutoFocus={(e) => { if (handedOff.current || !shouldRestoreFocus(contentRef.current)) e.preventDefault() }}>
          <Dialog.Title>Search</Dialog.Title>
          <input aria-label="search" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handedOff.current = true; onEnter() } }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** The reader: its FindBar mounts only once the (slow) new chapter has rendered. */
function Reader({ ready }: { ready: boolean }) {
  const open = useAppStore((s) => s.findBarOpen)
  const auto = useAppStore((s) => s.findBarAutoOpen)
  const query = useAppStore((s) => s.findBarQuery)
  const panel = useAppStore((s) => s.activePanelId)
  if (!ready) return null
  return (
    <div style={{ position: 'relative' }}>
      <FindBar visible={open && panel === 'bible'} autoOpen={auto} query={query} onQueryChange={(q) => useAppStore.getState().setFindBarQuery(q)} onClose={() => useAppStore.getState().closeFindBar()} matchCount={0} onPrev={() => {}} onNext={() => {}} />
    </div>
  )
}

let root: Root
let host: HTMLDivElement
let setReady: (v: boolean) => void = () => {}
function Harness() {
  const [ready, _setReady] = useState(false)
  setReady = _setReady
  return (
    <>
      <input aria-label="notes editor" />
      <SearchOverlay onEnter={() => { useAppStore.getState().closeSearch(); handOffToScriptureFind() }} />
      <Reader ready={ready} />
    </>
  )
}
const findInput = () => document.querySelector<HTMLInputElement>('[data-find-bar] input')
const flushFrame = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))) })

beforeEach(async () => {
  useAppStore.setState({ searchOpen: false, findBarOpen: false, findBarQuery: '', findBarAutoOpen: false, activePanelId: 'notes' })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(<Harness />) })
  // The search was opened from the notes editor (Radix restores focus there on close).
  ;(document.querySelector('[aria-label="notes editor"]') as HTMLInputElement).focus()
  await act(async () => { useAppStore.setState({ searchOpen: true }) })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })

describe('typeToFindAction (App.tsx routing)', () => {
  const base = { typing: false, findOpen: false, autoOpen: false, query: '', panel: 'bible' as const }
  it('opens the bar on the first letter, appends while it is open and unfocused', () => {
    expect(typeToFindAction('l', base)).toEqual({ kind: 'open', seed: 'l' })
    expect(typeToFindAction('o', { ...base, findOpen: true, autoOpen: true, query: 'l' })).toEqual({ kind: 'append', query: 'lo' })
  })
  it('leaves typing in a field alone, keeps the countdown alive inside the bar', () => {
    expect(typeToFindAction('x', { ...base, typing: true })).toBeNull()
    expect(typeToFindAction('x', { ...base, typing: true, findOpen: true, autoOpen: true })).toEqual({ kind: 'keep-alive' })
  })
  it('ignores Enter / arrows, routes digits to go-to-verse, other panels to their own bars', () => {
    expect(typeToFindAction('Enter', base)).toBeNull()
    expect(typeToFindAction('ArrowDown', { ...base, findOpen: true, autoOpen: true })).toBeNull()
    expect(typeToFindAction('3', base)).toEqual({ kind: 'verse-digit', digit: '3' })
    expect(typeToFindAction('g', { ...base, panel: 'notes' })).toEqual({ kind: 'panel', panel: 'notes', seed: 'g' })
  })
  it('a ⌘F bar (not auto) never swallows global keys', () => {
    expect(typeToFindAction('a', { ...base, findOpen: true, autoOpen: false })).toBeNull()
  })
})

describe('Enter → new Scripture tab → typing', () => {
  it('captures every key typed while the tab is still mounting, exactly once, then types straight in', async () => {
    window.addEventListener('keydown', onWindowKey)
    try {
      const search = document.querySelector<HTMLInputElement>('[aria-label="search"]')!
      expect(document.activeElement).toBe(search)
      await act(async () => { for (const ch of 'John 3') press(ch) })
      await act(async () => { press('Enter') })
      // The search is closed and has given up focus at once: not the dying input, not the notes editor.
      expect(useAppStore.getState().searchOpen).toBe(false)
      expect(document.activeElement).not.toBe(search)
      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('notes editor')
      // The new tab shows just the chapter: no find bar until a key is typed.
      expect(useAppStore.getState().findBarOpen).toBe(false)
      expect(useAppStore.getState().activePanelId).toBe('bible')
      // Keys typed while the new chapter is still rendering (FindBar not mounted yet).
      await act(async () => { for (const ch of 'lov') press(ch) })
      expect(useAppStore.getState().findBarOpen).toBe(true)
      expect(useAppStore.getState().findBarQuery).toBe('lov')
      await act(async () => { endExit() }) // the search's exit animation ends
      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('notes editor')
      // The chapter finishes; the bar mounts and takes focus with the caret after "lov".
      await act(async () => { setReady(true) })
      await flushFrame()
      const input = findInput()!
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('lov')
      expect(input.selectionStart).toBe(3)
      // Later keys go straight into the field — never doubled through the global handler.
      for (const ch of 'ed') await act(async () => { press(ch) })
      expect(useAppStore.getState().findBarQuery).toBe('loved')
      expect(input.value).toBe('loved')
    } finally { window.removeEventListener('keydown', onWindowKey) }
  })

  it('takes focus back on the next frame when a closing overlay dropped it to <body>', async () => {
    await act(async () => { setReady(true) })
    await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
    window.addEventListener('keydown', onWindowKey)
    try { await act(async () => { press('g') }) } finally { window.removeEventListener('keydown', onWindowKey) }
    ;(document.activeElement as HTMLElement | null)?.blur() // what Radix's teardown left behind
    await flushFrame()
    expect(document.activeElement).toBe(findInput())
  })

  it('never steals focus from a field the user chose meanwhile', async () => {
    await act(async () => { setReady(true) })
    const notes = document.querySelector<HTMLInputElement>('[aria-label="notes editor"]')!
    await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
    window.addEventListener('keydown', onWindowKey)
    try { await act(async () => { press('g') }) } finally { window.removeEventListener('keydown', onWindowKey) }
    ;(document.activeElement as HTMLElement | null)?.blur()
    notes.focus() // the user clicks into another field before the next frame
    await flushFrame()
    expect(document.activeElement).toBe(notes)
  })

  it('Escape closes the bar; the next letter opens a fresh one (no stale query)', async () => {
    await act(async () => { setReady(true) })
    window.addEventListener('keydown', onWindowKey)
    try {
      await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
      await flushFrame()
      for (const ch of 'ab') await act(async () => { press(ch) })
      await act(async () => { press('Escape') })
      expect(useAppStore.getState().findBarOpen).toBe(false)
      expect(findInput()).toBeNull()
      ;(document.activeElement as HTMLElement | null)?.blur()
      await act(async () => { press('z') })
      expect(useAppStore.getState().findBarQuery).toBe('z')
    } finally { window.removeEventListener('keydown', onWindowKey) }
  })

  it('a second Enter in the bar moves to the next match instead of typing', async () => {
    await act(async () => { setReady(true) })
    window.addEventListener('keydown', onWindowKey)
    try {
      await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
      await flushFrame()
      await act(async () => { press('a') })
      await act(async () => { press('Enter'); press('Enter') })
      expect(findInput()!.value).toBe('a')
    } finally { window.removeEventListener('keydown', onWindowKey) }
  })

  it('Enter and then nothing typed: the find bar never appears (2026-10-19)', async () => {
    const opens = { n: 0 }
    const unsub = useAppStore.subscribe((st, prev) => { if (st.findBarOpen && !prev.findBarOpen) opens.n++ })
    window.addEventListener('keydown', onWindowKey)
    try {
      await act(async () => { for (const ch of 'John 3') press(ch) })
      await act(async () => { press('Enter') })
      await act(async () => { endExit() })
      await act(async () => { setReady(true) })
      await flushFrame()
      expect(useAppStore.getState().findBarOpen).toBe(false)
      expect(findInput()).toBeNull()
      expect(opens.n).toBe(0)
      // Focus stays with the reader, not the field the search was opened from.
      expect(document.activeElement?.getAttribute('aria-label')).not.toBe('notes editor')
    } finally { window.removeEventListener('keydown', onWindowKey); unsub() }
  })
})

describe('every keystroke exactly once (2026-10-19: "g" → "gg", find bar opening twice)', () => {
  /** How many times the bar went from closed to open. */
  function countOpens() {
    let n = 0
    let prev = useAppStore.getState().findBarOpen
    const unsub = useAppStore.subscribe((st) => { if (st.findBarOpen && !prev) n++; prev = st.findBarOpen })
    return { get n() { return n }, stop: unsub }
  }

  it('type-to-find from the reader: the first letter appears once, then each one once', async () => {
    await act(async () => { useAppStore.getState().closeSearch() })
    await act(async () => { endExit() })
    await act(async () => { setReady(true); useAppStore.setState({ activePanelId: 'bible' }) })
    ;(document.activeElement as HTMLElement | null)?.blur()
    const opens = countOpens()
    window.addEventListener('keydown', onWindowKey)
    try {
      await pressRealOrder('g')
      expect(findInput()!.value).toBe('g')
      expect(document.activeElement).toBe(findInput())
      for (const ch of 'race') await pressRealOrder(ch)
      expect(findInput()!.value).toBe('grace')
      expect(useAppStore.getState().findBarQuery).toBe('grace')
      expect(opens.n).toBe(1)
    } finally { window.removeEventListener('keydown', onWindowKey); opens.stop() }
  })

  it('Enter → the bar opens once; the first key typed as it mounts appears once; rapid typing stays exact', async () => {
    const opens = countOpens()
    window.addEventListener('keydown', onWindowKey)
    try {
      await act(async () => { for (const ch of 'John 3') press(ch) })
      await act(async () => { press('Enter') })
      await act(async () => { endExit() })
      ;(document.activeElement as HTMLElement | null)?.blur()
      // The chapter mounts (and the bar with it) inside the first key's event.
      const target = document.body
      const ev = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true })
      await act(async () => { target.dispatchEvent(ev); setReady(true) })
      expect(ev.defaultPrevented).toBe(true) // the handler applied it: the browser must not type it again
      const input = findInput()!
      expect(document.activeElement).toBe(input)
      expect(input.value).toBe('a')
      for (const ch of 'mazing grace') await pressRealOrder(ch)
      expect(input.value).toBe('amazing grace')
      expect(opens.n).toBe(1)
      expect(input.value.includes('\n')).toBe(false)
    } finally { window.removeEventListener('keydown', onWindowKey); opens.stop() }
  })

  it('while the floating search is open, no letter opens the find bar behind it', async () => {
    await act(async () => { setReady(true); useAppStore.setState({ activePanelId: 'bible' }) })
    ;(document.activeElement as HTMLElement | null)?.blur() // the search field has not taken focus yet
    window.addEventListener('keydown', onWindowKey)
    try {
      const ev = new KeyboardEvent('keydown', { key: 'm', bubbles: true, cancelable: true })
      await act(async () => { document.body.dispatchEvent(ev) })
      expect(useAppStore.getState().findBarOpen).toBe(false)
      expect(ev.defaultPrevented).toBe(false)
    } finally { window.removeEventListener('keydown', onWindowKey) }
  })

  it('typing inside the open bar is left to the field (never applied twice by the global handler)', async () => {
    await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
    await act(async () => { endExit(); setReady(true) })
    await flushFrame()
    window.addEventListener('keydown', onWindowKey)
    try {
      for (const ch of 'love') await pressRealOrder(ch)
      expect(findInput()!.value).toBe('love')
    } finally { window.removeEventListener('keydown', onWindowKey) }
  })
})

