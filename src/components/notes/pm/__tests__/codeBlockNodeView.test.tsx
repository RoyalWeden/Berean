import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import NoteEditorPM from '../NoteEditorPM'

// Round 12 item 1: the code_block NodeView's header (language picker + copy button).
// Mirrors blockMenu.test.tsx's own full-mount-through-the-real-DOM approach.

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

let container: HTMLDivElement | null = null
let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  container?.remove()
  container = null
  root = null
})

function mount(props: Parameters<typeof NoteEditorPM>[0]) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root!.render(<NoteEditorPM {...props} />))
  return container
}

describe('codeBlockNodeView', () => {
  it('renders a language select pre-populated with the fence info string, and a Copy button', () => {
    const el = mount({ content: '```js\nconst x = 1;\n```', onChange: () => {} })
    const select = el.querySelector('.pm-code-block-lang') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.value).toBe('js')
    // "js" isn't one of the built-in presets — it's added as its own option so the
    // dropdown doesn't silently show "Plain text" for a language it doesn't recognize.
    expect(Array.from(select.options).some((o) => o.value === 'js')).toBe(true)
    expect(el.querySelector('.pm-code-block-copy')).toBeTruthy()
    expect(el.querySelector('.pm-code-block pre code')?.textContent).toBe('const x = 1;')
  })

  it('changing the language select updates the params attr, which round-trips into the ``` fence', () => {
    let content = ''
    const el = mount({ content: '```\nconst x = 1;\n```', onChange: (c) => { content = c } })
    const select = el.querySelector('.pm-code-block-lang') as HTMLSelectElement
    expect(select.value).toBe('')
    act(() => {
      select.value = 'python'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(content).toBe('```python\nconst x = 1;\n```')
  })

  it('clicking Copy writes the code block\'s plain text to the clipboard', () => {
    let written = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: (text: string) => { written = text; return Promise.resolve() } },
      configurable: true,
    })
    const el = mount({ content: '```\nhello world\n```', onChange: () => {} })
    const copyBtn = el.querySelector('.pm-code-block-copy') as HTMLButtonElement
    act(() => { copyBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(written).toBe('hello world')
  })
})
