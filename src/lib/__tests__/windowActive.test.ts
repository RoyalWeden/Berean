// @vitest-environment jsdom
/** Inactive-window stamp: event-driven from IPC and DOM focus/blur, never sticky, cleans up. */
import { describe, it, expect } from 'vitest'
import { installWindowActiveStamp } from '../windowActive'

function setup(initiallyFocused: boolean) {
  const html = document.createElement('html')
  const win = new EventTarget() as unknown as Window
  let visibility: DocumentVisibilityState = 'visible'
  let focused = initiallyFocused
  const docTarget = new EventTarget()
  const doc = {
    hasFocus: () => focused,
    get visibilityState() { return visibility },
    addEventListener: docTarget.addEventListener.bind(docTarget),
    removeEventListener: docTarget.removeEventListener.bind(docTarget),
  } as unknown as Document
  let ipc: ((a: boolean) => void) | null = null
  let unsubscribed = false
  const dispose = installWindowActiveStamp({ html, win, doc, onWindowActive: (cb) => { ipc = cb; return () => { unsubscribed = true } } })
  return {
    html, dispose,
    focus: (v: boolean) => { focused = v; win.dispatchEvent(new Event(v ? 'focus' : 'blur')) },
    ipc: (a: boolean) => ipc!(a),
    hide: () => { visibility = 'hidden'; docTarget.dispatchEvent(new Event('visibilitychange')) },
    show: (f: boolean) => { visibility = 'visible'; focused = f; docTarget.dispatchEvent(new Event('visibilitychange')) },
    unsubscribed: () => unsubscribed,
  }
}
const inactive = (h: HTMLElement) => 'inactive' in h.dataset

describe('window active stamp', () => {
  it('starts from document.hasFocus()', () => {
    expect(inactive(setup(false).html)).toBe(true)
    expect(inactive(setup(true).html)).toBe(false)
  })
  it('DOM focus restores the active state even if the IPC focus message never came', () => {
    const t = setup(true)
    t.ipc(false)
    expect(inactive(t.html)).toBe(true)
    t.focus(true)
    expect(inactive(t.html)).toBe(false)
  })
  it('IPC restore/show/minimize updates apply; hide → inactive; show with focus → active', () => {
    const t = setup(true)
    t.hide()
    expect(inactive(t.html)).toBe(true)
    t.show(true)
    expect(inactive(t.html)).toBe(false)
    t.ipc(false)
    expect(inactive(t.html)).toBe(true)
    t.ipc(true)
    expect(inactive(t.html)).toBe(false)
  })
  it('dispose removes the DOM listeners and the IPC subscription', () => {
    const t = setup(true)
    t.dispose()
    expect(t.unsubscribed()).toBe(true)
    t.focus(false)
    expect(inactive(t.html)).toBe(false)
  })
})
