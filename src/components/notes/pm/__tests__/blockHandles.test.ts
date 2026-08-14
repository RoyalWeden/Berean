import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, NodeSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history, undo } from 'prosemirror-history'
import { bereanSchema as schema } from '../schema'
import { createBlockHandlesPlugin, blockEnterAnimMeta } from '../blockHandles'

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

function docFromParagraphs(...lines: string[]) {
  return schema.nodes.doc.create(null, lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : undefined)))
}

function makeView(doc: ReturnType<typeof docFromParagraphs>, onOpenMenu: (t: { pos: number; rect: DOMRect }) => void = () => {}) {
  const state = EditorState.create({ schema, doc, plugins: [history(), createBlockHandlesPlugin(onOpenMenu, () => {})] })
  const dom = document.createElement('div')
  document.body.appendChild(dom)
  return new EditorView(dom, { state })
}

describe('createBlockHandlesPlugin — decorations', () => {
  it('renders exactly one handle + hoverable wrapper per TOP-LEVEL block, never for content nested inside a list/blockquote', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('one')),
      schema.nodes.bullet_list.create({ marker: '-' }, [
        schema.nodes.list_item.create(null, [schema.nodes.paragraph.create(null, schema.text('nested'))]),
      ]),
      schema.nodes.blockquote.create(null, [schema.nodes.paragraph.create(null, schema.text('quoted'))]),
    ])
    const view = makeView(doc as unknown as ReturnType<typeof docFromParagraphs>)
    // 3 top-level blocks (paragraph, bullet_list, blockquote) -> exactly 3 handles.
    expect(view.dom.querySelectorAll('.pm-block-handle').length).toBe(3)
    expect(view.dom.querySelectorAll('.pm-block-hoverable').length).toBe(3)
    view.destroy()
  })

  it('renders no handles at all when the view is not editable (read-only "view" mode)', () => {
    const doc = docFromParagraphs('a', 'b')
    const dom = document.createElement('div')
    document.body.appendChild(dom)
    const state = EditorState.create({ schema, doc, plugins: [createBlockHandlesPlugin(() => {}, () => {})] })
    const view = new EditorView(dom, { state, editable: () => false })
    expect(view.dom.querySelectorAll('.pm-block-handle').length).toBe(0)
    view.destroy()
  })
})

describe('createBlockHandlesPlugin — drag-grip mousedown stages a NodeSelection', () => {
  // Round-11.15: the actual bug was the grip's mousedown handler calling `e.preventDefault()`,
  // which cancels the browser's native drag gesture outright for a `draggable=true` element —
  // NOT the fact that mousedown stages a NodeSelection. That staging step stays on `mousedown`
  // (removing only the preventDefault call) deliberately: BlockMenu.tsx's click-to-open-menu
  // path shares this same selection — a plain click with no drag motion never fires `dragstart`
  // at all, so moving the staging there (tried first) broke the menu instead of fixing the drag.
  it('mousedown on the grip sets the document selection to a NodeSelection over exactly that block', () => {
    const doc = docFromParagraphs('first', 'second', 'third')
    const view = makeView(doc)
    const grips = view.dom.querySelectorAll('.pm-block-handle-grip')
    expect(grips.length).toBe(3)
    // Second paragraph's block-start position: doc is [p(first)=0..7, p(second)=7..15, p(third)=15..21]
    const secondParaPos = 7
    grips[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    const sel = view.state.selection
    expect(sel).toBeInstanceOf(NodeSelection)
    expect((sel as NodeSelection).from).toBe(secondParaPos)
    expect((sel as NodeSelection).node.textContent).toBe('second')
    view.destroy()
  })
})

describe('createBlockHandlesPlugin — "+" insert button', () => {
  it('click inserts an empty paragraph at the exact block boundary and places the cursor inside it, as ONE transaction', () => {
    const doc = docFromParagraphs('first', 'second')
    const view = makeView(doc)
    const before = view.state.doc.toString()
    const insertBtns = view.dom.querySelectorAll('.pm-block-handle-insert')
    // Insert button for the SECOND paragraph (boundary right before it).
    insertBtns[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    expect(view.state.doc.childCount).toBe(3)
    expect(view.state.doc.child(0).textContent).toBe('first')
    expect(view.state.doc.child(1).textContent).toBe('') // freshly inserted empty paragraph
    expect(view.state.doc.child(2).textContent).toBe('second')
    // Cursor lands inside the new empty paragraph.
    expect(view.state.selection.empty).toBe(true)
    expect(view.state.selection.from).toBeGreaterThan(0)
    // Single undo step reverts the whole insert.
    undo(view.state, view.dispatch)
    expect(view.state.doc.toString()).toBe(before)
    view.destroy()
  })

  it('still inserts at the CORRECT position after an earlier edit shifted offsets without changing block count or order (round 13 regression)', () => {
    // Widget DOM (and its closures) is reused across redraws whenever a block's INDEX among
    // its siblings doesn't change — the whole point of keying decorations by index instead of
    // offset. But that means the widget factory only runs ONCE per index; if the click handler
    // trusted the `pos` captured at that first build, it would go stale the moment an edit
    // ANYWHERE EARLIER in the doc shifts character offsets (typing in block 0 doesn't change
    // block 1's or block 2's INDEX, but does change their character position) — reported as
    // "clicking the plus button in the gutter just freezes the app" (a stale, now out-of-range
    // or mid-node position handed to a ProseMirror transform can throw/corrupt the transaction).
    const doc = docFromParagraphs('first', 'second', 'third')
    const view = makeView(doc)
    // Grab a reference to block 2's ("third") insert button BEFORE the earlier edit — this is
    // the exact DOM node/closure that will be REUSED (not rebuilt) by the edit below, since
    // "third" stays at index 2 throughout.
    const insertBtns = view.dom.querySelectorAll('.pm-block-handle-insert')
    const thirdInsertBtn = insertBtns[2]

    // Edit block 0 ("first" -> "first EXTRA TEXT") — shifts every later block's character
    // offset without touching block count or order, so blockHandles' decorations() rebuild
    // reuses "third"'s existing widget DOM/closure by key (index 2), unchanged.
    const firstParaEnd = view.state.doc.child(0).nodeSize - 1 // end of "first", inside the paragraph
    view.dispatch(view.state.tr.insertText(' EXTRA TEXT', firstParaEnd))
    expect(view.state.doc.child(0).textContent).toBe('first EXTRA TEXT')

    // Same DOM node as before the edit — proves this is exercising the REUSE path, not a fresh
    // rebuild that would trivially have the right position anyway.
    expect(view.dom.querySelectorAll('.pm-block-handle-insert')[2]).toBe(thirdInsertBtn)

    thirdInsertBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    // Must not throw, and the new empty paragraph must land between "second" and "third" —
    // i.e. at THIRD's current (post-edit) position, not its stale pre-edit one.
    expect(view.state.doc.childCount).toBe(4)
    expect(view.state.doc.child(0).textContent).toBe('first EXTRA TEXT')
    expect(view.state.doc.child(1).textContent).toBe('second')
    expect(view.state.doc.child(2).textContent).toBe('') // freshly inserted, right before "third"
    expect(view.state.doc.child(3).textContent).toBe('third')
    view.destroy()
  })
})

describe('createBlockHandlesPlugin — mousemove-driven gutter hover (round 12 fix)', () => {
  // Regression coverage for "goes away when my cursor is in the gutter" — the mechanism moved
  // from CSS :hover/:has() (fragile: had to land within an exact px budget that overflow-y:auto
  // silently clips) to a JS mousemove tracker that measures REAL rects. jsdom has no real
  // layout engine, so these tests monkeypatch getBoundingClientRect per element to simulate
  // specific measured positions, matching this file's existing Range-rect polyfill pattern.
  it('activates the handle whose BLOCK ROW the cursor Y falls within, keyed by data-block-pos not DOM order', async () => {
    const doc = docFromParagraphs('first', 'second', 'third')
    const view = makeView(doc)
    const hoverables = Array.from(view.dom.querySelectorAll<HTMLElement>('.pm-block-hoverable'))
    const handles = Array.from(view.dom.querySelectorAll<HTMLElement>('.pm-block-handle'))
    expect(hoverables.length).toBe(3)
    hoverables.forEach((el, i) => {
      el.getBoundingClientRect = () =>
        ({ top: i * 30, bottom: i * 30 + 30, left: 0, right: 200, width: 200, height: 30, x: 0, y: i * 30, toJSON: () => ({}) }) as DOMRect
    })

    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 10, clientY: 45, bubbles: true }))
    await new Promise((r) => requestAnimationFrame(r))

    expect(handles[1].classList.contains('pm-gutter-active')).toBe(true)
    expect(handles[0].classList.contains('pm-gutter-active')).toBe(false)
    expect(handles[2].classList.contains('pm-gutter-active')).toBe(false)

    // Leaving the editor entirely clears it (mouseleave doesn't bubble — dispatch on the
    // exact element the listener was attached to, matching how the browser fires it).
    view.dom.dispatchEvent(new MouseEvent('mouseleave'))
    expect(handles[1].classList.contains('pm-gutter-active')).toBe(false)
    view.destroy()
  })

  it('falls back to the handle\'s OWN button-stack rect when the cursor is just outside a short block\'s row', async () => {
    // The real bug this fixes: two 16px buttons + gap render ~33px tall, taller than a short
    // single-line block's own row (~24-28px) — so the lower button (the drag grip) can sit
    // below the paired block's own bottom edge. Simulate exactly that mismatch.
    const doc = docFromParagraphs('short')
    const view = makeView(doc)
    const hoverable = view.dom.querySelector<HTMLElement>('.pm-block-hoverable')!
    const handle = view.dom.querySelector<HTMLElement>('.pm-block-handle')!
    const inner = handle.querySelector<HTMLElement>('.pm-block-handle-inner')!
    hoverable.getBoundingClientRect = () =>
      ({ top: 0, bottom: 24, left: 30, right: 200, width: 170, height: 24, x: 30, y: 0, toJSON: () => ({}) }) as DOMRect
    inner.getBoundingClientRect = () =>
      ({ top: 1, bottom: 34, left: 2, right: 18, width: 16, height: 33, x: 2, y: 1, toJSON: () => ({}) }) as DOMRect

    // Cursor at y=30 — below the block's own row (ends at 24) but within the button stack.
    view.dom.dispatchEvent(new MouseEvent('mousemove', { clientX: 8, clientY: 30, bubbles: true }))
    await new Promise((r) => requestAnimationFrame(r))

    expect(handle.classList.contains('pm-gutter-active')).toBe(true)
    view.destroy()
  })
})

describe('reorder mechanics — the exact transaction shape blockHandles.ts relies on PM\'s native drag/drop to produce', () => {
  // jsdom cannot dispatch real HTML5 drag events (dragstart/dragover/drop with a live
  // DataTransfer), so this doesn't drive the DOM grip directly. Instead it exercises the
  // documented mechanism blockHandles.ts's file header cites verbatim from prosemirror-view's
  // own `handlers.dragstart`/`handleDrop` source: once the document selection is a
  // NodeSelection (exactly what the grip's mousedown handler stages), a drop is a single
  // transaction — `deleteSelection()` (the source range) followed by inserting the dragged
  // node at the drop position REMAPPED through that same transaction's `mapping` (since the
  // delete shifts everything after it) — so this is a direct regression test for "delete then
  // insert at a mapped position, one undo step" without needing to fake native DnD.
  it('moving block 0 to after block 2 deletes the source and inserts at the correctly-mapped target position, in one transaction', () => {
    const doc = docFromParagraphs('AAA', 'BBB', 'CCC')
    const view = makeView(doc)
    const before = view.state.doc.toString()

    // Stage the drag source exactly like the grip's mousedown does.
    const sourcePos = 0 // "AAA"
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, sourcePos)))
    const sel = view.state.selection as NodeSelection
    const node = sel.node

    // Target: drop just after "CCC" (end of doc) — mirrors PM's handleDrop: build ONE
    // transaction, delete the selection, then map the target position through that same
    // transaction's mapping before inserting.
    const targetPos = view.state.doc.content.size // end of doc, before the delete happens
    const tr = view.state.tr
    tr.setMeta(blockEnterAnimMeta, 0) // exercised for coverage of the meta plumbing, not asserted on here
    tr.delete(sel.from, sel.to)
    const mappedTarget = tr.mapping.map(targetPos)
    tr.replaceRangeWith(mappedTarget, mappedTarget, node)
    view.dispatch(tr)

    expect(view.state.doc.childCount).toBe(3)
    expect(view.state.doc.child(0).textContent).toBe('BBB')
    expect(view.state.doc.child(1).textContent).toBe('CCC')
    expect(view.state.doc.child(2).textContent).toBe('AAA')

    // ONE undo step reverts the entire move back to the original order.
    undo(view.state, view.dispatch)
    expect(view.state.doc.toString()).toBe(before)
    expect(view.state.doc.child(0).textContent).toBe('AAA')
    view.destroy()
  })

  it('moving block 2 to before block 0 (target position BEFORE the deleted source) still lands correctly, in one transaction', () => {
    const doc = docFromParagraphs('AAA', 'BBB', 'CCC')
    const view = makeView(doc)

    const sourcePos = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize // "CCC"'s start
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, sourcePos)))
    const sel = view.state.selection as NodeSelection
    const node = sel.node

    const targetPos = 0 // before "AAA" — BEFORE the deleted range, so mapping is a no-op shift
    const tr = view.state.tr
    tr.delete(sel.from, sel.to)
    const mappedTarget = tr.mapping.map(targetPos)
    tr.replaceRangeWith(mappedTarget, mappedTarget, node)
    view.dispatch(tr)

    expect(view.state.doc.child(0).textContent).toBe('CCC')
    expect(view.state.doc.child(1).textContent).toBe('AAA')
    expect(view.state.doc.child(2).textContent).toBe('BBB')
    view.destroy()
  })
})
