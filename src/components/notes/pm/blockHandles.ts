import { Plugin, PluginKey, NodeSelection, TextSelection } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import { bereanSchema as schema } from './schema'

// ─── Block drag handles + hover insert button (2.3 of the notes-editor plan) ──
//
// Every TOP-LEVEL document child (doc's content model is `block+`, so that's
// simply every direct child — paragraph/heading/list/table/blockquote/
// callout/horizontal_rule/code_block; `image` is an INLINE-only node in this
// schema, schema.ts, so it can never be a direct doc child and never gets a
// handle here) gets a small left-gutter widget: a six-dot drag grip that
// doubles as the block-menu trigger on a plain click.
//
// SELECTING, NOT TEXT (TEST 2026-10-10): clicking the grip selects the BLOCK —
// a NodeSelection painted as a quiet outlined card (`.pm-block-selected` on the
// editor wrapper hides the native text-selection paint, pmEditor.css) — never a
// text selection. The old "+" insert button beside it is gone: inserting lives in
// the block's menu ("Add Block Below", which opens the same / menu), typing "/",
// and the toolbar's Insert menu.
//
// LIST ITEMS: over a bulleted / numbered / task list the grip follows the
// pointer to the ITEM under it (the deepest list item on that row, so a nested
// item is its own target) and selects that one item; "Select Whole List" in its
// menu widens the selection to the list. The grip stays in the left gutter (only
// its vertical position follows the row), so it never covers a bullet.
//
// PHASE-1 SCOPE LIMITS (deliberate, do not "fix" without a product decision):
//  - Only TOP-LEVEL blocks get a handle. Content nested inside a list item,
//    table cell, or blockquote does NOT — reordering there is a materially
//    harder nested-position problem.
//  - A table drags as ONE atomic unit — no row/cell-level dragging.
//  - A multi-paragraph verse/lexicon "block" run (blockDecorations.ts's
//    grouping) is NOT auto-detected as one draggable unit — each paragraph
//    drags independently.
//
// DRAG MECHANICS: this uses ProseMirror's own built-in node-dragging support
// (prosemirror-dropcursor was already a dependency, and the plan called for
// preferring PM's native path when it is) rather than hand-rolled pointer
// tracking. The grip's `mousedown` sets the document selection to a
// `NodeSelection` over this exact block; the grip is `draggable=true`, so the
// browser's native `dragstart` bubbles up to `view.dom`, where PM's own
// dragstart handler (prosemirror-view's `handlers.dragstart`) picks it up:
// since `view.state.selection` is already our NodeSelection, it falls back to
// dragging `view.state.selection.content()` regardless of exactly where
// `posAtCoords` lands on the widget itself. On drop, PM's own `handleDrop`
// does the whole move as ONE transaction — `tr.deleteSelection()` (our
// NodeSelection, i.e. the source block) THEN `tr.replaceRangeWith` at the
// mapped target position — which is exactly the "delete then insert at a
// mapped position, single undo step" shape the plan called for, gotten for
// free from already-correct, already-tested PM internals instead of
// reimplemented by hand. See node_modules/prosemirror-view's `handlers.
// dragstart`/`handleDrop` for the exact mechanics this relies on.

// ─── Why every visual effect here is a DECORATION, never a classList.add ─────
//
// The previous implementation animated a freshly-inserted/moved block by
// calling `dom.classList.add(...)` on `view.nodeDOM(pos)` from inside this
// plugin's `view().update()` hook. That is an infinite loop, and it killed the
// renderer (reported: drag does nothing, the note still scrolls but nothing
// else responds, then the app aborts with exit code 6 — a Blink/Oilpan
// out-of-memory `SIGABRT`, confirmed in the crash report's
// `cppgc::internal::Fatal` stack). The cycle, against prosemirror-view 1.42.2:
//
//   1. `updatePluginViews` runs AFTER `domObserver.start()` (index.js:5598) and
//      runs on EVERY `updateState`, unconditionally — so a plugin's own DOM
//      writes ARE observed.
//   2. PM's MutationObserver watches `attributes: true, subtree: true` with no
//      filter and flushes synchronously in the microtask.
//   3. `registerMutation` does not ignore a `class` change on a paragraph, so
//      it produces a dirty range. (Blink emits a record even when
//      `classList.add` re-adds a class that is already present.)
//   4. `flush()` calls `markDirty`, `readDOMChange` finds no real doc
//      difference and dispatches nothing, so `docView.dirty` is still set and
//      flush ends with `view.updateState(view.state)` — back to step 1, with
//      this plugin's state unchanged, so the same class gets re-added forever.
//
// It never yields to the event loop: the main thread wedges (compositor-thread
// scrolling keeps working, which is exactly what "I can still scroll but that's
// all" means), the drop transaction applies but never paints, and every
// iteration destroys/recreates the block's DOM subtree until Blink's GC heap
// gives up. The `+` insert button and BlockMenu's Duplicate hit the identical
// path — an earlier report of "clicking the plus button freezes the app" was
// misdiagnosed as a stale `pos` and "fixed" with `currentPosForBlockIndex`.
//
// Decorations don't have this problem: ProseMirror applies them itself, from
// inside `updateState`, while its own DOMObserver is stopped. So the entrance
// animation and the drag-source dim below are both plugin STATE plus a class in
// `decorations()`, and this plugin's `update()` hook only ever schedules
// timers — never touches the DOM.

export interface BlockHandlesState {
  // Block that just appeared or moved here — carries `.pm-block-enter` for one
  // beat. `enterGen` increments on every set so `update()` can tell a genuinely
  // new animation from a repeat call with identical state.
  enterPos: number | null
  enterGen: number
  // Block currently being dragged by its grip — carries
  // `.pm-block-dragging-source`.
  dragPos: number | null
}

export const blockHandlesKey = new PluginKey<BlockHandlesState>('berean-block-handles')

// Set on a transaction WE build (insert-button, Duplicate) to mark the
// position of a freshly-created block for the one-shot entrance animation.
// Reused (not duplicated) for PM's OWN drop transaction too — see apply() — so
// all three "a block just appeared/moved here" triggers share one code path.
export const blockEnterAnimMeta = 'berean-block-enter-anim'
// Clears the entrance class again, dispatched on a timer by view().update().
export const blockEnterClearMeta = 'berean-block-enter-clear'
// Sets/clears which block is the drag source (number to set, null to clear).
export const blockDragSourceMeta = 'berean-block-drag-source'
// Marks the NodeSelection the grip stages on mousedown. NoteEditorPM.tsx reads
// this to skip its caret-follow scroll: scrolling the container while a
// mousedown is pending cancels Chromium's native HTML5 drag gesture outright.
export const blockGripSelectMeta = 'berean-block-grip-select'

// Applied to the editor's OUTER wrapper (`.berean-pm-editor`, i.e. view.dom's
// parent) for the duration of a grip press/drag. It lives outside `view.dom`,
// so PM's DOMObserver never sees it — the whole point.
//
// Why it's needed: PM's own `dragstart` picks the dragged content out of
// `view.state.selection`, so the grip MUST stage a NodeSelection on mousedown.
// ProseMirror renders a NodeSelection over a textblock as a full native browser
// selection across that block's text — which is precisely the reported "I don't
// want it to look like the text is selected because I am moving the block."
// This class suppresses the selection paint and restyles
// `.ProseMirror-selectednode` as a lifted card instead (pmEditor.css).
const DRAGGING_WRAPPER_CLASS = 'pm-block-dragging'

export interface BlockMenuTarget { pos: number; rect: DOMRect }

const GRIP_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="14" viewBox="0 0 10 16" fill="currentColor"><circle cx="2" cy="2" r="1.3"/><circle cx="8" cy="2" r="1.3"/><circle cx="2" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="2" cy="14" r="1.3"/><circle cx="8" cy="14" r="1.3"/></svg>'

// How long `.pm-block-enter` stays on a freshly-inserted/moved block before a
// clear transaction removes it. The class only establishes the HIDDEN starting
// point (opacity 0 / translateY); the transition itself lives on every
// top-level block via `.pm-block-hoverable` in pmEditor.css, so REMOVING the
// class is what animates. Must comfortably exceed one paint.
const ENTER_ANIM_MS = 180

// On the editor wrapper while the selection is a whole BLOCK (a NodeSelection over a block node):
// the selected block draws as an outlined card instead of as selected text. Toggled from the
// plugin view's update — outside view.dom, so PM's DOMObserver never sees it.
const BLOCK_SELECTED_WRAPPER_CLASS = 'pm-block-selected'

function setWrapperBlockSelected(view: EditorView, on: boolean) {
  const wrapper = view.dom.parentElement
  if (!wrapper || wrapper.classList.contains(BLOCK_SELECTED_WRAPPER_CLASS) === on) return
  wrapper.classList.toggle(BLOCK_SELECTED_WRAPPER_CLASS, on)
}

function isBlockNodeSelection(view: EditorView): boolean {
  const sel = view.state.selection
  return sel instanceof NodeSelection && sel.node.isBlock
}

/** The list item a DOM `<li>` renders, as a document position (the position BEFORE the item). */
function listItemPosForDom(view: EditorView, li: HTMLElement): number | null {
  if (!li.isConnected || !view.dom.contains(li)) return null
  try {
    const inside = view.posAtDOM(li, 0)
    const $pos = view.state.doc.resolve(inside)
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type === schema.nodes.list_item) return $pos.before(d)
    }
    const after = view.state.doc.nodeAt(inside)
    if (after?.type === schema.nodes.list_item) return inside
  } catch { /* stale DOM — fall back to the whole block */ }
  return null
}

/**
 * "Add Block Below" (the block menu) — an empty paragraph right after the top-level block at
 * `pos` (or an empty item after a list item), with the caret in it. Returns the caret position.
 * Replaces the gutter's old "+" button, with the same stale-position safety: `pos` is re-checked
 * against the live document.
 */
export function insertBlockBelow(view: EditorView, pos: number): number | null {
  try {
    const node = view.state.doc.nodeAt(pos)
    if (!node) return null
    const after = pos + node.nodeSize
    const tr = view.state.tr
    let cursor: number
    if (node.type === schema.nodes.list_item) {
      tr.insert(after, schema.nodes.list_item.create(node.attrs.checked != null ? { checked: false } : null, schema.nodes.paragraph.create()))
      cursor = after + 2
    } else {
      tr.insert(after, schema.nodes.paragraph.create())
      cursor = after + 1
      tr.setMeta(blockEnterAnimMeta, after)
    }
    tr.setSelection(TextSelection.near(tr.doc.resolve(cursor)))
    view.dispatch(tr.scrollIntoView())
    view.focus()
    return cursor
  } catch (err) {
    console.error('[blockHandles] add block below failed:', err)
    return null
  }
}

function setWrapperDragging(view: EditorView, on: boolean) {
  // view.dom.parentElement is the `.berean-pm-editor` scroll container
  // (NoteEditorPM.tsx:699). Outside PM's observed subtree — safe to touch.
  const wrapper = view.dom.parentElement
  if (!wrapper) return
  wrapper.classList.toggle(DRAGGING_WRAPPER_CLASS, on)
}

// Widget DOM (and every closure inside it, including the click handlers below) is REUSED
// across decorations() rebuilds whenever a block's `key` (its sibling INDEX — see the
// Decoration.widget call below) stays the same — that's the entire point of keying on index
// instead of character offset (round 12's fix for the per-keystroke gutter-rebuild bug). But it
// means the FACTORY function that builds this DOM only ever runs ONCE per index: `pos`, captured
// in its closure at that first build, goes stale the instant an edit ANYWHERE EARLIER in the
// document shifts character offsets — which is every keystroke before this block, constantly.
// A click using that stale `pos` could insert content at the wrong spot, or — if the document
// has since shrunk, or the offset now lands somewhere that isn't a valid block boundary anymore
// (mid-node from restructuring elsewhere) — hand ProseMirror's transform code a position it
// can't use at all, which can corrupt the transaction or throw, both of which read as the editor
// hanging (reported: "clicking the plus button in the gutter just freezes the app"). Recomputing
// the CURRENT position from `index` at the moment of the click/mousedown — not trusting the
// closed-over `pos` — is what actually fixes this; `pos` below is only ever used as this widget's
// INITIAL value before the first click, a correct assumption exactly until the first edit
// anywhere earlier in the note.
function currentPosForBlockIndex(view: EditorView, index: number): number | null {
  let i = 0
  let result: number | null = null
  view.state.doc.forEach((_node, offset) => {
    if (i === index) result = offset
    i++
  })
  return result
}

function buildHandleWidget(
  pos: number,
  index: number,
  onOpenMenu: (target: BlockMenuTarget) => void,
) {
  return (view: EditorView) => {
    const wrap = document.createElement('div')
    wrap.className = 'pm-block-handle'
    wrap.contentEditable = 'false'
    // Paired with the SAME block's `data-block-index` (set on its `.pm-block-hoverable` node
    // decoration below) — lets the mousemove-driven hover tracker in view() below find this
    // exact widget for whichever block the cursor's Y-coordinate currently falls within,
    // without depending on DOM adjacency or CSS sibling combinators (see that tracker's own
    // comment for why the previous `:hover`/`:has()` approach was replaced). Deliberately INDEX,
    // not the character position `pos` — this dataset attr, like the rest of this widget's DOM,
    // is only ever set ONCE (widget factory functions aren't re-invoked on reuse, only the
    // matching-key check is), so a position value here would go stale after the very next edit
    // anywhere earlier in the note. Index is exactly what decides whether this DOM gets reused
    // in the first place, so it can never itself go stale relative to what it's labeling.
    wrap.dataset.blockIndex = String(index)

    const inner = document.createElement('div') as HTMLDivElement & { __targetLi?: HTMLElement | null }
    inner.className = 'pm-block-handle-inner'

    // What the grip acts on right now: the list item the hover tracker pointed it at, else the
    // whole top-level block. Read live at press time (see currentPosForBlockIndex).
    const targetPos = (): number | null => {
      const li = inner.__targetLi
      if (li) {
        const p = listItemPosForDom(view, li)
        if (p != null) return p
      }
      return currentPosForBlockIndex(view, index)
    }
    void pos

    // Drag grip — also the block-menu trigger on a plain click (Notion's own
    // handle doubles as both). `draggable=true` lets the browser's native
    // HTML5 drag take over once the mousedown below has already staged the
    // NodeSelection PM's own dragstart handler will pick up (see file header).
    const grip = document.createElement('button')
    grip.type = 'button'
    grip.className = 'pm-block-handle-btn pm-block-handle-grip'
    grip.title = 'Click to select · drag to move'
    grip.setAttribute('aria-label', 'Select block')
    grip.draggable = true
    grip.innerHTML = GRIP_SVG
    // Round-11.15 fix: this used to call `e.preventDefault()` here too, on the theory that it
    // only needed to suppress PM's own default mousedown/selection handling while still letting
    // the event bubble so a later native `dragstart` could fire. That's not how the browser
    // treats it — calling preventDefault() on mousedown for a `draggable=true` element cancels
    // the pending native drag gesture outright (confirmed against prosemirror-view's own
    // `LeftMouseDown` handling, which deliberately does NOT call preventDefault() on a
    // might-drag target for exactly this reason). With no dragstart ever firing, what actually
    // ran instead was the browser's ordinary text-selection-drag over whatever was under the
    // pointer — "it just selects the text," reported after last round's ship.
    //
    // The FIX is just removing that one preventDefault() call — NOT moving the selection-set to
    // `dragstart` (tried that first; it broke the click-to-open-menu path, since BlockMenu.tsx
    // deliberately shares this same mousedown-staged NodeSelection for its own actions, and a
    // plain click with no actual drag motion never fires dragstart at all). Dispatching here on
    // mousedown is safe for the real drag gesture too: mousedown always fires before dragstart
    // in the browser's natural gesture, this transaction's decoration rebuild reuses the SAME
    // widget DOM (matched by its `key` in decorations() below, not recreated), and a <button>
    // element doesn't trigger contenteditable text-selection-on-mousedown the way plain text
    // would — so there's nothing left that needs suppressing via preventDefault() at all.
    grip.addEventListener('mousedown', () => {
      try {
        const $doc = view.state.doc
        const livePos = targetPos()
        if (livePos == null || livePos < 0 || livePos >= $doc.content.size) return
        // Suppress the node-selection paint from the instant the grip goes
        // down, not just once dragging starts — otherwise the block flashes as
        // selected text between mousedown and dragstart.
        setWrapperDragging(view, true)
        view.dispatch(
          view.state.tr
            .setSelection(NodeSelection.create($doc, livePos))
            .setMeta(blockGripSelectMeta, true),
        )
      } catch (err) {
        console.error('[blockHandles] grip mousedown failed:', err)
      }
    })
    // A press that never became a drag (plain click for the menu, or a drag
    // abandoned outside any drop target) must still clear the wrapper class.
    grip.addEventListener('mouseup', () => setWrapperDragging(view, false))
    // Custom drag image + a dimmed source block while dragging — mirrors TabBar.tsx's own tab-
    // reorder drag exactly (clone the real element, style it as a floating card, feed that to
    // setDragImage). Without this, the browser falls back to its default drag-image behavior for
    // a drag originating inside a contentEditable region, which renders like a text-selection
    // being dragged — reported as "I don't want it to look like the text is selected because I
    // am moving the block." Whole-block reordering should read the same way tab reordering
    // already does: a clean floating copy of the thing you're picking up, not a selection ghost.
    let dragGhost: HTMLElement | null = null
    grip.addEventListener('dragstart', (e) => {
      try {
        const livePos = targetPos()
        if (livePos == null) return
        const blockDom = view.nodeDOM(livePos)
        if (!(blockDom instanceof HTMLElement)) return
        e.dataTransfer?.setData('text/plain', blockDom.textContent ?? '')
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'

        const rect = blockDom.getBoundingClientRect()
        const clone = blockDom.cloneNode(true) as HTMLElement
        // The ghost is a self-contained floating card, so it must not inherit
        // the source's "I am being dragged" dimming or its selection paint.
        clone.classList.remove('pm-block-dragging-source', 'ProseMirror-selectednode')
        Object.assign(clone.style, {
          position: 'fixed',
          top: '-9999px',
          left: '0px',
          width: `${rect.width}px`,
          margin: '0',
          pointerEvents: 'none',
          opacity: '1',
          background: getComputedStyle(blockDom).backgroundColor || 'rgb(var(--color-surface-3))',
          borderRadius: '8px',
          boxShadow: '0 8px 24px -6px rgba(0,0,0,0.35)',
          padding: '6px 10px',
        })
        document.body.appendChild(clone)
        dragGhost = clone
        // Grab the card where the cursor actually is, exactly as TabBar.tsx
        // does for tab reordering — a fixed offset makes the card jump out
        // from under the pointer at drag start.
        e.dataTransfer?.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top)
        setTimeout(() => {
          // `remove()` rather than `document.body.removeChild()`: the latter
          // throws if the node was already detached (React re-render, editor
          // teardown mid-drag), and an uncaught throw here would land after
          // dragstart has returned, where the try/catch can't reach it.
          dragGhost?.remove()
          dragGhost = null
        }, 0)

        // Dim the real block for the duration of the drag so it reads as "picked up," not just
        // "still sitting there, unrelated to the ghost following the cursor." Deferred by one
        // macrotask deliberately: this dispatch redraws the block's own DOM (PM re-renders the
        // node to apply the decoration class), and redrawing the drag SOURCE element while
        // dragstart is still on the stack can cancel the native gesture in Chromium. By the
        // time this runs, the browser has taken its drag image and the drag is underway.
        setTimeout(() => {
          const p = currentPosForBlockIndex(view, index)
          // The dim decoration is per top-level block; a dragged list ITEM isn't dimmed.
          if (p != null && !inner.__targetLi) view.dispatch(view.state.tr.setMeta(blockDragSourceMeta, p))
        }, 0)
      } catch (err) {
        console.error('[blockHandles] grip dragstart failed:', err)
      }
    })
    grip.addEventListener('dragend', () => {
      setWrapperDragging(view, false)
      dragGhost?.remove()
      dragGhost = null
      if (blockHandlesKey.getState(view.state)?.dragPos != null) {
        view.dispatch(view.state.tr.setMeta(blockDragSourceMeta, null))
      }
    })
    grip.addEventListener('click', (e) => {
      e.preventDefault()
      try {
        const livePos = targetPos()
        if (livePos == null) return
        // The press already selected the block (mousedown above); make sure it still is — a
        // click that landed after some other selection change re-selects it.
        if (!(view.state.selection instanceof NodeSelection) || view.state.selection.from !== livePos) {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, livePos)).setMeta(blockGripSelectMeta, true))
        }
        onOpenMenu({ pos: livePos, rect: grip.getBoundingClientRect() })
      } catch (err) {
        console.error('[blockHandles] grip click failed:', err)
      }
    })

    inner.appendChild(grip)
    wrap.appendChild(inner)
    return wrap
  }
}

export function createBlockHandlesPlugin(
  onOpenMenu: (target: BlockMenuTarget) => void,
) {
  // Captured via view() the same way blockDecorations.ts's own liveView is —
  // decorations(state) only receives `state`, but this plugin also needs to
  // know whether the view is CURRENTLY editable (view.editable reflects the
  // live `editable` prop, which NoteEditorPM.tsx flips via setProps when
  // `mode` changes, entirely outside of any transaction) to hide handles
  // outright in read-only 'view' mode.
  let liveView: EditorView | null = null

  return new Plugin<BlockHandlesState>({
    key: blockHandlesKey,
    state: {
      init: () => ({ enterPos: null, enterGen: 0, dragPos: null }),
      // Unlike the previous version, this state PERSISTS across transactions
      // (mapped through tr.mapping) instead of being recomputed from the
      // current tr alone. It has to: the entrance class is now removed by an
      // explicit clear transaction a beat later rather than by imperative DOM
      // cleanup, and the drag-source flag has to survive every transaction
      // between dragstart and dragend.
      apply(tr, prev) {
        let next: BlockHandlesState = {
          enterPos: prev.enterPos == null ? null : tr.mapping.map(prev.enterPos, -1),
          enterGen: prev.enterGen,
          dragPos: prev.dragPos == null ? null : tr.mapping.map(prev.dragPos, -1),
        }

        const dragMeta = tr.getMeta(blockDragSourceMeta)
        if (dragMeta !== undefined) next = { ...next, dragPos: typeof dragMeta === 'number' ? dragMeta : null }

        if (tr.getMeta(blockEnterClearMeta)) next = { ...next, enterPos: null }

        const insertedPos = tr.getMeta(blockEnterAnimMeta)
        if (typeof insertedPos === 'number') return { ...next, enterPos: insertedPos, enterGen: next.enterGen + 1 }

        // PM's own native drop handler (prosemirror-view's handleDrop) tags
        // its transaction with `uiEvent: 'drop'` and, for a single-node drag
        // (exactly what a whole-block NodeSelection drag produces), sets the
        // resulting selection to a NodeSelection over the freshly-placed
        // node — reuse that as the animation target rather than
        // recomputing it. A drop also always ends the drag.
        if (tr.getMeta('uiEvent') === 'drop' && tr.selection instanceof NodeSelection) {
          return { enterPos: tr.selection.from, enterGen: next.enterGen + 1, dragPos: null }
        }
        return next
      },
    },
    view(editorView) {
      liveView = editorView
      // `decorations(state)` runs at least once DURING the EditorView constructor itself, to
      // build the very first paint — before any plugin's own `view()` hook has run, so on that
      // very first call `liveView` above is still null and the `!liveView.editable` guard below
      // can't have taken effect yet. If the editor starts out non-editable (mode='view' from
      // first mount, not toggled into later), that first pass would otherwise render handles
      // that then never get cleared, since nothing else forces a redraw for an editor that's
      // never edited. Forcing one redraw here (still inside the same synchronous constructor
      // call, before the browser has painted anything) lets the now-set `liveView` correctly
      // suppress them from the very first thing the user actually sees.
      if (!editorView.editable) editorView.updateState(editorView.state)

      // ── Gutter hover tracking (mousemove-driven, not CSS :hover/:has()) ──────────────────
      // Previous approach relied purely on CSS: widen each block's own hit-box leftward via a
      // padding-left/margin-left pair that cancels out visually (so the block's rendered text
      // never moves), then reveal the preceding widget's button via
      // `.pm-block-handle:has(+ .pm-block-hoverable:hover)`. That geometry has to land EXACTLY
      // within whatever padding the editor's OWN left inset happens to provide (pmEditor.css's
      // `.ProseMirror { padding-left: 28px }`) — overshoot it even by a couple of px and the
      // extra hit-box spills past the scroll container's own edge, where `overflow-y: auto`
      // (which per the CSS overflow spec forces the OTHER axis to a computed 'auto' too) clips
      // it outright: not just visually, but for hit-testing, so the cursor can never actually
      // enter that sliver at all — reported repeatedly as "goes away when my cursor is in the
      // gutter." Any future padding/zoom/font-size change could silently reintroduce the same
      // mismatch. Tracking hover in JS instead removes the coincidence entirely: on every
      // mousemove, find which block's REAL measured row (getBoundingClientRect, not assumed
      // CSS geometry) the cursor's Y-coordinate falls within, and toggle a plain class on that
      // block's own handle widget — accurate regardless of exactly how many px of padding the
      // editor happens to have at any given moment.
      let hoveredIndex: number | null = null
      let hoveredLi: HTMLElement | null = null
      let hoverRAF: number | null = null
      // Puts the (single) grip level with the first line of what it will act on — the block, or
      // the hovered list item — and records that item for the grip's press/click handlers.
      // Writing styles inside a widget is safe: PM ignores DOM mutations inside widget decorations.
      function placeGrip(handle: HTMLElement, block: HTMLElement | null, li: HTMLElement | null) {
        const inner = handle.querySelector<HTMLDivElement & { __targetLi?: HTMLElement | null }>('.pm-block-handle-inner')
        if (!inner) return
        inner.__targetLi = li
        const row = li ?? block
        if (!row) return
        const lineEl = (li?.querySelector<HTMLElement>(':scope > p, :scope > div > p') ?? row)
        const cs = getComputedStyle(lineEl)
        const fontSize = parseFloat(cs.fontSize) || 16
        const lh = parseFloat(cs.lineHeight) || fontSize * 1.5
        const padTop = li ? 0 : parseFloat(getComputedStyle(row).paddingTop) || 0
        const top = row.getBoundingClientRect().top - handle.getBoundingClientRect().top + padTop + (lh - 16) / 2
        inner.style.top = `${Math.round(top)}px`
      }
      function applyHover(index: number | null, block: HTMLElement | null, li: HTMLElement | null) {
        if (index === hoveredIndex && li === hoveredLi) return
        const indexChanged = index !== hoveredIndex
        hoveredIndex = index
        hoveredLi = li
        editorView.dom.querySelectorAll<HTMLElement>(':scope > .pm-block-handle').forEach((el) => {
          const i = Number(el.dataset.blockIndex)
          const on = index !== null && i === index
          if (indexChanged) el.classList.toggle('pm-gutter-active', on)
          if (on) placeGrip(el, block, li)
        })
      }
      // The deepest list item whose box contains this row (nested items come after their parent
      // in document order, so the last match is the innermost).
      function listItemAt(block: HTMLElement, clientY: number): HTMLElement | null {
        if (block.tagName !== 'UL' && block.tagName !== 'OL') return null
        let hit: HTMLElement | null = null
        for (const li of block.querySelectorAll<HTMLElement>('li')) {
          const r = li.getBoundingClientRect()
          if (clientY >= r.top && clientY <= r.bottom) hit = li
        }
        return hit
      }
      function measureAndApply(clientX: number, clientY: number) {
        hoverRAF = null
        if (!editorView.editable) return
        let found: number | null = null
        let blockEl: HTMLElement | null = null
        // Pass 1: the block's own rendered row — covers hovering the block's actual text, and
        // most of the gutter to its left (blocks are full-width, so their rect already spans it).
        for (const el of editorView.dom.querySelectorAll<HTMLElement>(':scope > .pm-block-hoverable')) {
          const r = el.getBoundingClientRect()
          if (clientY >= r.top && clientY <= r.bottom) { found = Number(el.dataset.blockIndex); blockEl = el; break }
        }
        // Pass 2: the grip's OWN rect — between blocks (in a heading's top margin, say) the
        // pointer can be on the grip while outside every block's row. X-bounded so this doesn't
        // light up a block's handle from far off to the right at the same incidental Y.
        if (found === null) {
          for (const el of editorView.dom.querySelectorAll<HTMLElement>(':scope > .pm-block-handle')) {
            const inner = el.querySelector<HTMLElement>('.pm-block-handle-inner')
            if (!inner || !el.classList.contains('pm-gutter-active')) continue
            const r = inner.getBoundingClientRect()
            if (clientY >= r.top - 4 && clientY <= r.bottom + 4 && clientX >= r.left - 8 && clientX <= r.right + 8) {
              found = Number(el.dataset.blockIndex)
              break
            }
          }
          // Keep the item the grip already points at — the pointer is on the grip itself.
          if (found !== null && found === hoveredIndex) { applyHover(found, null, hoveredLi); return }
        }
        applyHover(found, blockEl, blockEl ? listItemAt(blockEl, clientY) : null)
      }
      function onMouseMove(e: MouseEvent) {
        // rAF-coalesced: mousemove fires far faster than layout can usefully change, and this
        // does a DOM query + one getBoundingClientRect() per top-level block on every call.
        if (hoverRAF !== null) cancelAnimationFrame(hoverRAF)
        const x = e.clientX
        const y = e.clientY
        hoverRAF = requestAnimationFrame(() => measureAndApply(x, y))
      }
      function onMouseLeave() {
        if (hoverRAF !== null) { cancelAnimationFrame(hoverRAF); hoverRAF = null }
        applyHover(null, null, null)
      }
      editorView.dom.addEventListener('mousemove', onMouseMove)
      editorView.dom.addEventListener('mouseleave', onMouseLeave)

      let clearTimer: ReturnType<typeof setTimeout> | null = null
      let collapseTimer: ReturnType<typeof setTimeout> | null = null

      return {
        // This hook does NOT touch the DOM — see this file's header for why
        // that once wedged the renderer. It only schedules timers, and only
        // when the plugin state genuinely CHANGED relative to prevState. That
        // second condition is the loop-breaker on its own: a bare
        // `view.updateState(view.state)` (which is exactly what PM's own
        // MutationObserver flush does when it finds no doc difference) passes
        // prevState === state, so `enterGen` is equal and nothing fires.
        update(view, prevState) {
          if (!view.state.selection.eq(prevState.selection)) setWrapperBlockSelected(view, isBlockNodeSelection(view))
          const cur = blockHandlesKey.getState(view.state)
          const prev = blockHandlesKey.getState(prevState)
          if (!cur || !prev || cur.enterGen === prev.enterGen) return

          if (clearTimer !== null) clearTimeout(clearTimer)
          clearTimer = setTimeout(() => {
            clearTimer = null
            if (blockHandlesKey.getState(view.state)?.enterPos == null) return
            view.dispatch(view.state.tr.setMeta(blockEnterClearMeta, true))
          }, ENTER_ANIM_MS)

          // After PM's drop, the moved block is left under a NodeSelection —
          // which paints as fully-selected text, the exact look the user does
          // not want to be left staring at once the block has landed. Collapse
          // it to a caret inside the block instead, which also happens to be
          // where you'd want to keep typing.
          if (view.state.selection instanceof NodeSelection) {
            const pos = cur.enterPos
            if (collapseTimer !== null) clearTimeout(collapseTimer)
            collapseTimer = setTimeout(() => {
              collapseTimer = null
              if (pos == null || !(view.state.selection instanceof NodeSelection)) return
              try {
                const tr = view.state.tr
                const node = tr.doc.nodeAt(pos)
                if (!node || node.isAtom || !node.isTextblock) return
                tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)))
                view.dispatch(tr.setMeta(blockGripSelectMeta, true))
              } catch {
                // A doc that changed shape again before this fired — nothing
                // to collapse, and never worth throwing over.
              }
            }, 0)
          }
        },
        destroy() {
          liveView = null
          if (hoverRAF !== null) cancelAnimationFrame(hoverRAF)
          if (clearTimer !== null) clearTimeout(clearTimer)
          if (collapseTimer !== null) clearTimeout(collapseTimer)
          setWrapperDragging(editorView, false)
          setWrapperBlockSelected(editorView, false)
          editorView.dom.removeEventListener('mousemove', onMouseMove)
          editorView.dom.removeEventListener('mouseleave', onMouseLeave)
        },
      }
    },
    props: {
      decorations(state) {
        if (liveView && !liveView.editable) return null
        const decorations: Decoration[] = []
        const { enterPos, dragPos } = blockHandlesKey.getState(state) ?? { enterPos: null, dragPos: null }
        state.doc.forEach((node, offset, index) => {
          // Both transient visual states ride on the block's own node
          // decoration rather than being written onto its DOM by hand. PM
          // applies these from inside updateState with its DOMObserver
          // stopped, so they can never feed back into a mutation flush.
          const cls = ['pm-block-hoverable']
          if (offset === enterPos) cls.push('pm-block-enter')
          if (offset === dragPos) cls.push('pm-block-dragging-source')
          decorations.push(Decoration.node(offset, offset + node.nodeSize, { class: cls.join(' '), 'data-block-index': String(index) }))
          decorations.push(Decoration.widget(offset, buildHandleWidget(offset, index, onOpenMenu), {
            side: -1,
            // Keyed on the block's INDEX among its top-level siblings, not its character offset.
            // Offset shifts for every block that follows an edit — so typing a single character
            // in block 1 used to change the key of every subsequent block's widget, and PM's
            // decoration diffing (which uses this key to decide "reuse this DOM node" vs "destroy
            // and rebuild it") then tore down and rebuilt ALL of them: one DOM node + one inline
            // SVG parse per remaining block, per keystroke, on every edit anywhere earlier in the
            // note. Index only changes when a whole block is inserted/removed/reordered above this
            // one — genuinely rare actions, unlike "the user is typing".
            key: `pm-block-handle-${index}`,
            ignoreSelection: true,
            // Round-11.15 fix: this was unconditional (`() => true`), which — independently of
            // the mousedown/preventDefault bug above — was ALSO enough on its own to break
            // dragging. `stopEvent` swallowing every event type means `dragstart`/`dragover`/
            // `drop`/`dragend` originating on this widget never reach prosemirror-view's own
            // `eventBelongsToView` check (it walks up from event.target to view.dom, and bails
            // the moment it finds a widget whose own stopEvent() returns true for that event) —
            // so PM's native drop handling, which is what actually performs the move, would
            // silently never run even once the drag itself starts correctly. Narrowed to only
            // the mouse/click events this widget actually needs to own (opening the block menu,
            // preventing a stray click from moving the cursor); every drag-related event type is
            // explicitly let through to PM.
            stopEvent: (event) => event.type === 'mousedown' || event.type === 'click' || event.type === 'mouseup',
          }))
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
