import { describe, it, expect } from 'vitest'
import { DOMSerializer, DOMParser as PMDOMParser } from 'prosemirror-model'
import { bereanSchema as schema } from '../schema'

// Regression coverage for the print/PDF image-bleed bug: a resized image's `width` attr used
// to round-trip as a literal HTML `width="NNN"` attribute with no clamp, which every non-
// live-editor consumer of this raw toDOM output (staticRender.ts's fallback for print/PDF/
// version-history/daily-scroll/Presenter, and clipboard/paste) rendered unclamped, letting a
// resized image bleed straight off the page. It's now an inline
// `style="width:NNNpx;max-width:100%;height:auto"` instead — this tests the raw DOM
// serialize/parse path directly (NOT via markdown, which has its own separate |wNNN
// convention already covered by roundtrip.test.ts).
describe('image node — raw DOM toDOM/parseDOM (not markdown)', () => {
  const serializer = DOMSerializer.fromSchema(schema)
  const domParser = PMDOMParser.fromSchema(schema)

  it('toDOM emits width via an inline style with a max-width:100% safety net, not a bare width attribute', () => {
    const node = schema.nodes.image.create({ src: 'x.png', alt: 'a', width: 1800 })
    const dom = serializer.serializeNode(node) as HTMLElement
    expect(dom.getAttribute('width')).toBeNull()
    expect(dom.style.width).toBe('1800px')
    expect(dom.style.maxWidth).toBe('100%')
    expect(dom.style.height).toBe('auto')
  })

  it('an unresized image has no width style at all', () => {
    const node = schema.nodes.image.create({ src: 'x.png', alt: 'a' })
    const dom = serializer.serializeNode(node) as HTMLElement
    expect(dom.getAttribute('width')).toBeNull()
    expect(dom.style.width).toBe('')
  })

  it('parseDOM recovers width from the inline style (round trip through raw DOM)', () => {
    const el = document.createElement('img')
    el.setAttribute('src', 'x.png')
    el.style.width = '640px'
    el.style.maxWidth = '100%'
    const doc = domParser.parse(el.ownerDocument.body.appendChild(
      (() => { const p = document.createElement('div'); p.appendChild(el); return p })()
    ))
    let found: number | null = null
    doc.descendants((n) => { if (n.type.name === 'image') found = n.attrs.width })
    expect(found).toBe(640)
  })

  it('parseDOM still recovers width from a legacy literal width="NNN" attribute (backward compat with content produced before this fix)', () => {
    const el = document.createElement('img')
    el.setAttribute('src', 'x.png')
    el.setAttribute('width', '500')
    const wrap = document.createElement('div')
    wrap.appendChild(el)
    const doc = domParser.parse(wrap)
    let found: number | null = null
    doc.descendants((n) => { if (n.type.name === 'image') found = n.attrs.width })
    expect(found).toBe(500)
  })
})
