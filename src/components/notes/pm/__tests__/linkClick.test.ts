import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import { createRefClickPlugin } from '../refDecorations'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function mount(md: string, onLinkClick: (href: string, modifier: boolean) => void) {
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, {
    state: EditorState.create({ schema, doc: parseMarkdown(md), plugins: [createRefClickPlugin({ onLinkClick })] }),
  })
}

describe('refClickPlugin — plain markdown links', () => {
  it('clicking an <a> fires onLinkClick with the href and modifier state', () => {
    const hits: Array<[string, boolean]> = []
    const view = mount('see [the docs](https://example.com/x) here', (href, mod) => hits.push([href, mod]))

    const a = view.dom.querySelector('a[href]') as HTMLAnchorElement
    expect(a).toBeTruthy()
    expect(a.getAttribute('href')).toBe('https://example.com/x')

    a.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(hits).toEqual([['https://example.com/x', false]])

    a.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
    expect(hits[1]).toEqual(['https://example.com/x', true])

    view.destroy()
  })

  it('fires for a link inside a blockquote too', () => {
    const hits: string[] = []
    const view = mount('> quoted [words](https://ex.com) here', (href) => hits.push(href))
    const a = view.dom.querySelector('blockquote a[href]') as HTMLAnchorElement
    expect(a).toBeTruthy()
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(hits).toEqual(['https://ex.com'])
    view.destroy()
  })

  it('a click on non-link text does not fire onLinkClick', () => {
    let fired = false
    const view = mount('plain text only', () => { fired = true })
    ;(view.dom.querySelector('p') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(fired).toBe(false)
    view.destroy()
  })
})
