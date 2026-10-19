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
import { handOffToScriptureFind, releaseFocusWithin, shouldRestoreFocus, typeToFindAction } from '../findHandoff'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const isTyping = (el: Element | null) => !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || (el as HTMLElement).isContentEditable)

/** App.tsx's global keydown routing, applied exactly as App applies it. */
function onWindowKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
  const st = useAppStore.getState()
  const a = typeToFindAction(e.key, { typing: isTyping(document.activeElement), findOpen: st.findBarOpen, autoOpen: st.findBarAutoOpen, query: st.findBarQuery, panel: st.activePanelId })
  if (a?.kind === 'open') st.openFindBar(true, a.seed)
  else if (a?.kind === 'append') st.setFindBarQuery(a.query)
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
  useLayoutEffect(() => { if (!open) releaseFocusWithin(contentRef.current) }, [open])
  if (!open && !exiting) return null
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal forceMount>
        <Dialog.Content forceMount ref={contentRef} aria-describedby={undefined} onCloseAutoFocus={(e) => { if (!shouldRestoreFocus(contentRef.current)) e.preventDefault() }}>
          <Dialog.Title>Search</Dialog.Title>
          <input aria-label="search" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onEnter() } }} />
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
      expect(useAppStore.getState().findBarOpen).toBe(true)
      expect(useAppStore.getState().activePanelId).toBe('bible')
      // Keys typed while the new chapter is still rendering (FindBar not mounted yet).
      await act(async () => { for (const ch of 'lov') press(ch) })
      expect(useAppStore.getState().findBarQuery).toBe('lov')
      await act(async () => { endExit() }) // the search's exit animation ends
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
    ;(document.activeElement as HTMLElement | null)?.blur() // what Radix's teardown left behind
    await flushFrame()
    expect(document.activeElement).toBe(findInput())
  })

  it('never steals focus from a field the user chose meanwhile', async () => {
    await act(async () => { setReady(true) })
    const notes = document.querySelector<HTMLInputElement>('[aria-label="notes editor"]')!
    await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
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
    await act(async () => { useAppStore.getState().closeSearch(); handOffToScriptureFind() })
    await flushFrame()
    await act(async () => { press('a'); press('Enter'); press('Enter') })
    expect(findInput()!.value).toBe('a')
  })
})
