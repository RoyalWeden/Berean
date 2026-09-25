import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'

// MAC-IMG (SEP25): image Copy / Save As / Delete actions + native context menu.

const PNG = 'data:image/png;base64,iVBORw0KGgo='

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

let container: HTMLDivElement | null = null
let root: Root | null = null
const origApp = window.app

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
  ;(window as { app?: unknown }).app = origApp
})

function mount(onChange: (md: string) => void) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM content={`before ![Fig](${PNG}) after`} onChange={onChange} />))
  return container
}

function setBridge(extra: Record<string, unknown>) {
  ;(window as { app?: unknown }).app = { ...(origApp ?? {}), ...extra }
}

describe('image node view actions', () => {
  it('without the desktop bridge only Delete is offered, and it removes the image node', () => {
    setBridge({ copyNoteImage: undefined, saveNoteImageAs: undefined, noteImageMenu: undefined })
    const changes: string[] = []
    const el = mount((md) => changes.push(md))
    const btns = [...el.querySelectorAll('.pm-image-action')].map((b) => b.getAttribute('aria-label'))
    expect(btns).toEqual(['Delete Image'])
    act(() => { (el.querySelector('.pm-image-action') as HTMLButtonElement).click() })
    expect(el.querySelector('.pm-image-wrap')).toBeNull()
    expect(changes.at(-1) ?? '').not.toContain('data:image')
  })

  it('with the bridge: Copy/Save As send the image data URL; right-click opens the native menu', async () => {
    const copyNoteImage = vi.fn(async () => ({ success: true }))
    const saveNoteImageAs = vi.fn(async () => ({ success: true }))
    const noteImageMenu = vi.fn(async () => 'copy' as const)
    setBridge({ copyNoteImage, saveNoteImageAs, noteImageMenu })
    const el = mount(() => {})
    const byLabel = (l: string) => el.querySelector(`.pm-image-action[aria-label="${l}"]`) as HTMLButtonElement
    expect(byLabel('Copy Image')).toBeTruthy()
    expect(byLabel('Save Image As…')).toBeTruthy()

    await act(async () => { byLabel('Save Image As…').click() })
    expect(saveNoteImageAs).toHaveBeenCalledWith(PNG, 'Fig')

    await act(async () => {
      el.querySelector('.pm-image-wrap')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    })
    expect(noteImageMenu).toHaveBeenCalledTimes(1)
    expect(copyNoteImage).toHaveBeenCalledWith(PNG)
  })
})
