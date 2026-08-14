import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from '../schema'
import { parseMarkdown } from '../parser'
import {
  createHeadingCollapsePlugin, headingCollapseKey, headingNodeView,
  computeHeadingKey, headingPositionsForKeys, setCollapsedHeadingPositions,
} from '../headingCollapse'

// Round 12 item 6: persisted heading-collapse state. headingCollapseKey's plugin state
// itself stays exactly what it always was (an ephemeral Set<number> of live positions,
// see this file's own header comment) — these tests cover the NEW pieces added on top:
// the stable heading_key derivation, resolving persisted keys back to live positions,
// and the bulk-hydration meta, all independent of any actual IPC/DB round-trip (that
// lives in electron/ipc/notes.ts, outside this renderer-only test's reach).

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function makeView(content: string, onToggleCollapse?: (view: EditorView, pos: number, collapsed: boolean) => void) {
  const state = EditorState.create({ schema, doc: parseMarkdown(content), plugins: [createHeadingCollapsePlugin()] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, {
    state,
    nodeViews: { heading: (node, editorView, getPos) => headingNodeView(getPos, onToggleCollapse)(node, editorView) },
  })
}

describe('computeHeadingKey', () => {
  it('derives a level+text key for a heading', () => {
    const view = makeView('# Intro\n\nSome text.')
    const key = computeHeadingKey(view.state.doc, 0)
    expect(key).toBe('1:Intro#0')
    view.destroy()
  })

  it('returns null for a non-heading position', () => {
    const view = makeView('Just a paragraph.')
    expect(computeHeadingKey(view.state.doc, 0)).toBeNull()
    view.destroy()
  })

  it('disambiguates two headings with the identical level+text via an ordinal', () => {
    const view = makeView('## Repeat\n\nFirst.\n\n## Repeat\n\nSecond.')
    let firstPos = -1
    let secondPos = -1
    let seen = 0
    view.state.doc.forEach((node, offset) => {
      if (node.type.name === 'heading') { if (seen === 0) firstPos = offset; else secondPos = offset; seen++ }
    })
    expect(computeHeadingKey(view.state.doc, firstPos)).toBe('2:Repeat#0')
    expect(computeHeadingKey(view.state.doc, secondPos)).toBe('2:Repeat#1')
    view.destroy()
  })
})

describe('headingPositionsForKeys', () => {
  it('resolves persisted keys back to their live positions', () => {
    const view = makeView('# One\n\nA.\n\n# Two\n\nB.')
    const positions: number[] = []
    view.state.doc.forEach((node, offset) => { if (node.type.name === 'heading') positions.push(offset) })
    const resolved = headingPositionsForKeys(view.state.doc, ['1:Two#0'])
    expect(resolved).toEqual([positions[1]])
    view.destroy()
  })

  it('silently drops a key with no matching heading — degrades instead of throwing', () => {
    const view = makeView('# Only heading\n\nBody.')
    expect(headingPositionsForKeys(view.state.doc, ['9:Nonexistent#0'])).toEqual([])
    view.destroy()
  })

  it('an empty key list resolves to no positions with no document walk needed', () => {
    const view = makeView('# Heading\n\nBody.')
    expect(headingPositionsForKeys(view.state.doc, [])).toEqual([])
    view.destroy()
  })
})

describe('setCollapsedHeadingPositions — bulk hydration', () => {
  it('replaces the whole collapsed set in one transaction, distinct from a per-click toggle', () => {
    const view = makeView('# One\n\nA.\n\n# Two\n\nB.')
    const headingPositions: number[] = []
    view.state.doc.forEach((node, offset) => { if (node.type.name === 'heading') headingPositions.push(offset) })

    setCollapsedHeadingPositions(view, [headingPositions[1]])
    const collapsed = headingCollapseKey.getState(view.state)
    expect(collapsed?.has(headingPositions[1])).toBe(true)
    expect(collapsed?.has(headingPositions[0])).toBe(false)
    expect(collapsed?.size).toBe(1)
    view.destroy()
  })

  it('hydration does NOT fire the onToggleCollapse persistence callback (only a real click does)', () => {
    let toggled = false
    const view = makeView('# Heading\n\nBody.', () => { toggled = true })
    setCollapsedHeadingPositions(view, [0])
    expect(toggled).toBe(false)
    view.destroy()
  })
})

describe('headingNodeView — persist callback on a real click', () => {
  it('fires onToggleCollapse with the current position and the NEW collapsed state', () => {
    const calls: Array<{ pos: number; collapsed: boolean }> = []
    const view = makeView('# Heading\n\nBody.', (_view, pos, collapsed) => calls.push({ pos, collapsed }))
    const arrow = view.dom.querySelector('.pm-heading-collapse-arrow') as HTMLElement
    arrow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toEqual([{ pos: 0, collapsed: true }])

    arrow.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(calls).toEqual([{ pos: 0, collapsed: true }, { pos: 0, collapsed: false }])
    view.destroy()
  })
})
