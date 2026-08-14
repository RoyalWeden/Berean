import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'
import { useAppStore } from '@/store'

// Closes a named test gap (round 12): nodeViews.ts's bullet-glyph NodeView used to read
// noteBulletStyle ONCE at construction, with no live subscription — this asserts the fix
// (a per-instance store subscription writing straight to the marker span) actually repaints
// already-mounted bullets the instant the setting changes, with ZERO edit/note-switch in
// between.

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

let container: HTMLDivElement | null = null
let root: Root | null = null
const originalBulletStyle = useAppStore.getState().noteBulletStyle

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
  useAppStore.getState().setNoteBulletStyle(originalBulletStyle)
})

function mount(content: string) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM content={content} onChange={() => {}} />))
  return container
}

describe('bullet glyph — live repaint on noteBulletStyle change', () => {
  it('repaints an already-mounted "*" bullet marker immediately when the setting changes, with no edit in between', () => {
    useAppStore.getState().setNoteBulletStyle('classic')
    const el = mount('* one\n* two')
    const marker = el.querySelector('.pm-bullet-marker') as HTMLElement
    expect(marker.textContent).toBe('•') // classic style, depth 0

    act(() => { useAppStore.getState().setNoteBulletStyle('geometric') })
    expect(marker.textContent).toBe('◆')

    act(() => { useAppStore.getState().setNoteBulletStyle('arrows') })
    expect(marker.textContent).toBe('›')
  })

  it('a literal "-" bullet marker is UNCHANGED by the setting — always the same dash glyph', () => {
    useAppStore.getState().setNoteBulletStyle('classic')
    const el = mount('- one\n- two')
    const marker = el.querySelector('.pm-bullet-marker') as HTMLElement
    expect(marker.textContent).toBe('–')
    act(() => { useAppStore.getState().setNoteBulletStyle('star') })
    expect(marker.textContent).toBe('–')
  })

  it('every "*" bullet in a multi-item list repaints together, not just the first', () => {
    useAppStore.getState().setNoteBulletStyle('classic')
    const el = mount('* one\n* two\n* three')
    act(() => { useAppStore.getState().setNoteBulletStyle('star') })
    const glyphs = Array.from(el.querySelectorAll('.pm-bullet-marker')).map((m) => m.textContent)
    expect(glyphs).toEqual(['★', '★', '★'])
  })
})
