import { describe, it, expect, beforeAll } from 'vitest'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { history } from 'prosemirror-history'
import { bereanSchema as schema } from '../schema'
import { createBlockHandlesPlugin, blockEnterAnimMeta, blockDragSourceMeta } from '../blockHandles'

// ─── Regression suite for the renderer-killing animation loop ────────────────
//
// The block gutter's entrance animation used to run `dom.classList.add(...)` on
// `view.nodeDOM(pos)` from inside the plugin's `view().update()` hook. Because
// prosemirror-view runs `updatePluginViews` AFTER re-arming its MutationObserver,
// and that observer watches `attributes: true, subtree: true` and flushes
// synchronously in the microtask, and a no-op flush ends with
// `view.updateState(view.state)`, that single `classList.add` was an infinite
// microtask loop: main thread wedged (scrolling still worked, nothing else did),
// the drop transaction applied but never painted, and Blink's GC heap grew until
// the renderer aborted — SIGABRT / exit code 6.
//
// jsdom implements MutationObserver, so this reproduces here. Every test below
// hard-caps `updateState` and THROWS on overrun, so a reintroduced loop fails
// the suite instead of hanging it forever.
//
// The existing blockHandles.test.ts reorder tests hand-build the transaction and
// never touch the animation path at all, which is exactly why this shipped.

beforeAll(() => {
  const zeroRect = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  // @ts-expect-error jsdom polyfill for a test-only environment gap
  Range.prototype.getClientRects = () => [zeroRect]
  Range.prototype.getBoundingClientRect = () => zeroRect
})

const UPDATE_STATE_CAP = 40

function docFromParagraphs(...lines: string[]) {
  return schema.nodes.doc.create(null, lines.map((l) => schema.nodes.paragraph.create(null, l ? schema.text(l) : undefined)))
}

/** Builds a live view whose `updateState` is counted and hard-capped. */
function makeCountedView(doc: ReturnType<typeof docFromParagraphs>) {
  const state = EditorState.create({ schema, doc, plugins: [history(), createBlockHandlesPlugin(() => {}, () => {})] })
  const host = document.createElement('div')
  // The plugin toggles its no-text-selection class on view.dom's PARENT
  // (`.berean-pm-editor` in the real app), so the view needs a real parent here.
  host.className = 'berean-pm-editor'
  document.body.appendChild(host)
  const view = new EditorView(host, { state })

  const counter = { calls: 0 }
  const original = view.updateState.bind(view)
  view.updateState = (s) => {
    counter.calls += 1
    if (counter.calls > UPDATE_STATE_CAP) {
      throw new Error(
        `updateState called ${counter.calls} times — the MutationObserver→updateState loop is back. ` +
        'Something in blockHandles.ts is writing to PM-owned DOM outside a decoration.',
      )
    }
    return original(s)
  }
  return { view, host, counter }
}

/** Lets every pending microtask (i.e. any MutationObserver flush) drain. */
async function drainMicrotasks() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('blockHandles — entrance animation cannot loop', () => {
  it('an insert-with-enter-animation transaction settles in a bounded number of updateState calls', async () => {
    const { view, counter } = makeCountedView(docFromParagraphs('AAA', 'BBB', 'CCC'))
    const baseline = counter.calls

    const tr = view.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('NEW')))
    tr.setSelection(TextSelection.near(tr.doc.resolve(1)))
    tr.setMeta(blockEnterAnimMeta, 0)
    view.dispatch(tr)

    await drainMicrotasks()
    // One dispatch + at most the clear transaction. The old code produced an
    // unbounded run here and never yielded at all.
    expect(counter.calls - baseline).toBeLessThan(5)
    view.destroy()
  })

  it('a drop-shaped transaction (uiEvent:drop + NodeSelection) settles in a bounded number of updateState calls', async () => {
    const { view, counter } = makeCountedView(docFromParagraphs('AAA', 'BBB', 'CCC'))

    // Reproduce exactly what prosemirror-view's own handleDrop dispatches for a
    // whole-block NodeSelection drag: delete the source, insert at the mapped
    // target, select the result as a node, tag it `uiEvent: 'drop'`.
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
    const sel = view.state.selection as NodeSelection
    const node = sel.node
    const targetPos = view.state.doc.content.size
    const tr = view.state.tr
    tr.delete(sel.from, sel.to)
    const mapped = tr.mapping.map(targetPos)
    tr.replaceRangeWith(mapped, mapped, node)
    tr.setSelection(NodeSelection.create(tr.doc, mapped))
    view.dispatch(tr.setMeta('uiEvent', 'drop'))

    const afterDrop = counter.calls
    await drainMicrotasks()
    expect(counter.calls - afterDrop).toBeLessThan(5)

    // And the move itself actually happened.
    expect(view.state.doc.child(2).textContent).toBe('AAA')
    view.destroy()
  })

  it('holds the enter class as a decoration, then drops it — without ever mutating PM-owned DOM by hand', async () => {
    const { view, counter } = makeCountedView(docFromParagraphs('AAA', 'BBB'))

    const tr = view.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('NEW')))
    tr.setMeta(blockEnterAnimMeta, 0)
    view.dispatch(tr)

    expect(view.dom.querySelectorAll('.pm-block-enter').length).toBe(1)
    // The class must live on a block that ALSO carries the permanent
    // `.pm-block-hoverable` decoration — that's where pmEditor.css puts the
    // transition, so removal is what animates.
    expect(view.dom.querySelector('.pm-block-enter')?.classList.contains('pm-block-hoverable')).toBe(true)

    await wait(400)
    expect(view.dom.querySelectorAll('.pm-block-enter').length).toBe(0)
    expect(counter.calls).toBeLessThan(UPDATE_STATE_CAP)
    view.destroy()
  })

  it('cleans up its pending timers on destroy without dispatching into a torn-down view', async () => {
    const { view } = makeCountedView(docFromParagraphs('AAA'))
    view.dispatch(view.state.tr.insert(0, schema.nodes.paragraph.create(null, schema.text('NEW'))).setMeta(blockEnterAnimMeta, 0))
    view.destroy()
    // If the clear/collapse timers survived destroy, this wait would throw
    // inside a timer callback operating on a destroyed view.
    await wait(400)
  })
})

describe('blockHandles — drag source dim is a decoration', () => {
  it('applies and removes .pm-block-dragging-source via plugin state, bounded', async () => {
    const { view, counter } = makeCountedView(docFromParagraphs('AAA', 'BBB', 'CCC'))

    view.dispatch(view.state.tr.setMeta(blockDragSourceMeta, 0))
    expect(view.dom.querySelectorAll('.pm-block-dragging-source').length).toBe(1)
    expect(view.dom.querySelector('.pm-block-dragging-source')?.textContent).toBe('AAA')

    await drainMicrotasks()

    view.dispatch(view.state.tr.setMeta(blockDragSourceMeta, null))
    expect(view.dom.querySelectorAll('.pm-block-dragging-source').length).toBe(0)
    expect(counter.calls).toBeLessThan(UPDATE_STATE_CAP)
    view.destroy()
  })

  it('follows the block when an edit earlier in the doc shifts its position', () => {
    const { view } = makeCountedView(docFromParagraphs('AAA', 'BBB', 'CCC'))
    const secondPos = view.state.doc.child(0).nodeSize

    view.dispatch(view.state.tr.setMeta(blockDragSourceMeta, secondPos))
    expect(view.dom.querySelector('.pm-block-dragging-source')?.textContent).toBe('BBB')

    // Typing into the FIRST block shifts every later offset — the flag has to be
    // mapped forward, or the dim silently jumps to the wrong block mid-drag.
    view.dispatch(view.state.tr.insertText('XXXX', 1))
    expect(view.dom.querySelector('.pm-block-dragging-source')?.textContent).toBe('BBB')
    view.destroy()
  })
})
