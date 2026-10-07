import { blurActiveEditable, scrollOwner } from './sheetGesture'

/**
 * Keyboard dismissal (TEST 2026-09-29: "unable to dismiss the keyboard" in Notes and Search).
 * One shell-wide behaviour, modelled on UIKit's scroll-view keyboard dismiss modes, installed once
 * by MobileApp — never a per-editor trick:
 *
 *  - on drag   A drag that scrolls something that does NOT contain the focused field (search
 *              results under a search field, a settings list) dismisses the keyboard.
 *  - swipe down A downward swipe inside the scroller that DOES contain the focused editor (a note)
 *              dismisses it when the scroller is already at its top or the finger has travelled
 *              down to the keyboard's edge (interactive dismiss).
 *  - tap        A tap on inert background (no control, no text) outside the focused field's
 *              scroller dismisses it.
 * Elements marked `data-keep-keyboard` (formatting bars, the + menu, the Done check) never dismiss.
 */

export type DismissInput = {
  /** Finger travel since touchstart (positive = down). */
  dy: number
  dx: number
  /** The scroller the touch moves contains the focused editable. */
  ownsFocus: boolean
  /** That scroller's scrollTop at touchstart. */
  startScrollTop: number
  /** Finger y and the keyboard's top edge (innerHeight − keyboard height). */
  y: number
  keyboardTop: number
}

const DRAG = 12
const SWIPE = 56
const KEYBOARD_EDGE = 56

export function shouldDismissOnMove(i: DismissInput): boolean {
  if (Math.abs(i.dy) < DRAG || Math.abs(i.dx) > Math.abs(i.dy)) return false
  if (!i.ownsFocus) return true
  if (i.dy < SWIPE) return false
  return i.startScrollTop <= 0 || i.y >= i.keyboardTop - KEYBOARD_EDGE
}

const INTERACTIVE = 'input, textarea, select, button, a, label, [contenteditable="true"], [role="button"], [role="menuitem"], [role="option"], [data-keep-keyboard]'

export function isInertTapTarget(target: Element | null): boolean {
  return !!target && !target.closest(INTERACTIVE)
}

function focusedEditable(): HTMLElement | null {
  const el = document.activeElement as HTMLElement | null
  if (!el || el === document.body) return null
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable ? el : null
}

function hideKeyboard(): void {
  if (!blurActiveEditable()) return
  void import('@capacitor/keyboard').then(({ Keyboard }) => Keyboard.hide()).catch(() => {})
}

export function installKeyboardDismiss(root: HTMLElement): () => void {
  let start: { x: number; y: number; t: number; scroller: HTMLElement; scrollTop: number; ownsFocus: boolean; keep: boolean } | null = null
  let moved = false
  const onStart = (e: TouchEvent) => {
    const field = focusedEditable()
    const target = e.target as Element | null
    if (!field || !target || e.touches.length !== 1) { start = null; return }
    const scroller = scrollOwner(target, root)
    const t = e.touches[0]
    start = { x: t.clientX, y: t.clientY, t: Date.now(), scroller, scrollTop: scroller.scrollTop, ownsFocus: scroller.contains(field), keep: !!target.closest('[data-keep-keyboard]') }
    moved = false
  }
  const onMove = (e: TouchEvent) => {
    if (!start || start.keep || moved) return
    const t = e.touches[0]
    const kb = parseFloat(getComputedStyle(root).getPropertyValue('--m-keyboard-h')) || 0
    if (shouldDismissOnMove({ dy: t.clientY - start.y, dx: t.clientX - start.x, ownsFocus: start.ownsFocus, startScrollTop: start.scrollTop, y: t.clientY, keyboardTop: window.innerHeight - kb })) {
      moved = true
      hideKeyboard()
    } else if (Math.abs(t.clientY - start.y) > DRAG) moved = true
  }
  const onEnd = (e: TouchEvent) => {
    const s = start
    start = null
    if (!s || moved || s.keep || Date.now() - s.t > 500) return
    const target = e.target as Element | null
    if (s.ownsFocus || !isInertTapTarget(target)) return
    hideKeyboard()
  }
  root.addEventListener('touchstart', onStart, { passive: true, capture: true })
  root.addEventListener('touchmove', onMove, { passive: true, capture: true })
  root.addEventListener('touchend', onEnd, { passive: true, capture: true })
  return () => {
    root.removeEventListener('touchstart', onStart, { capture: true } as EventListenerOptions)
    root.removeEventListener('touchmove', onMove, { capture: true } as EventListenerOptions)
    root.removeEventListener('touchend', onEnd, { capture: true } as EventListenerOptions)
  }
}

/** The Done check / programmatic dismissal. */
export function dismissKeyboard(): void { hideKeyboard() }
