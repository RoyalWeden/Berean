import { TextSelection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { bereanSchema as schema } from './schema'
import { threadCollapseKey, toggleThreadCollapse } from './threadCollapse'
import { computeWordStats } from '@/lib/wordCount'

// Thread NodeView (notes editor) — modeled on headingCollapse.ts's headingNodeView, but a
// thread's collapse mechanic is simpler in one respect: a heading has to hide SIBLING nodes it
// doesn't own (headingCollapse.ts's own decorations() plugin does that), whereas a thread's
// entries are its OWN schema content (`thread_entry+`), fully inside this NodeView's own
// `contentDOM` — threadCollapse.ts's decorations() still does the actual hiding (so hydration,
// which arrives as a later, unrelated transaction, reliably reaches an already-mounted
// NodeView — see that file's header comment), but this NodeView's header chrome (chevron
// direction, title-or-preview text, timestamp, live word/char count) is read straight from
// plugin state on every `update()`, the same "recompute from source of truth, don't trust
// local mutable state" discipline headingNodeView's own `updateArrow` follows.

const CHEVRON_RIGHT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
const CHEVRON_DOWN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
const PLUS_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>'
// Same lucide-react "MessagesSquare" glyph used for the /thread slash-command entry
// (src/lib/blockTypeIcons.ts) — inlined here (this NodeView builds header/footer chrome as
// raw DOM, not JSX) so the "+ Add sub-thread" button visually matches the icon used to create
// a thread in the first place.
const THREAD_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z"/><path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1"/></svg>'

function formatThreadTimestamp(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Fallback collapsed/expanded header text when the user hasn't set an explicit thread title
// (schema.ts's thread.attrs.title === null) — first non-empty line of the first entry's own
// plain text, truncated. Never a literal empty string, even for a brand-new thread whose sole
// entry is still blank.
function firstLinePreview(node: PMNode, max = 80): string {
  const firstEntry = node.firstChild
  const text = (firstEntry?.textContent || '').trim().split('\n')[0] || ''
  if (!text) return '(empty thread)'
  return text.length > max ? text.slice(0, max) + '…' : text
}

function threadLabel(node: PMNode): string {
  return (node.attrs.title as string | null) || firstLinePreview(node)
}

// A sub-thread nests structurally the same way as a top-level one — schema.ts's thread_entry
// content spec is `block+`, which already includes `thread` itself (thread is a `group: block`
// member), so nothing in schema.ts/parser.ts/serializer.ts needed to change to support
// nesting; parser.ts's recursive `parseMarkdown(e.md)` call per entry already handles a nested
// `<!-- berean:thread -->` marker inside an entry transparently. This is purely a NodeView/UI
// addition: a way to CREATE that nesting (the "+ Add sub-thread" footer button) and a way to
// get back out of it (the breadcrumb below).
//
// Walks the ancestor chain of the position just before this thread node, collecting every
// enclosing `thread` node (root-first) so the breadcrumb can render "Main thread > Sub-thread A
// > ...". `pos` is a NodeView's own `getPos()` result — the position immediately before the
// node itself, so `$pos.node(d)` for d = 1..depth walks exactly its ancestors, never the node
// itself. `$pos.before(d)` gives that ancestor's own absolute start position, which is what
// `view.nodeDOM()` needs to find its element for the "jump to" click handler.
function ancestorThreads(view: EditorView, pos: number): Array<{ label: string; pos: number }> {
  const $pos = view.state.doc.resolve(pos)
  const chain: Array<{ label: string; pos: number }> = []
  for (let d = 1; d <= $pos.depth; d++) {
    const anc = $pos.node(d)
    if (anc.type.name === 'thread') chain.push({ label: threadLabel(anc), pos: $pos.before(d) })
  }
  return chain
}

// Briefly flashes the target thread's header so a breadcrumb click has a visible destination,
// same "flash to orient after a jump" idea as ChapterView.tsx's verse-flash-on-navigate.
function flashThreadAt(view: EditorView, pos: number) {
  const dom = view.nodeDOM(pos)
  const el = dom instanceof HTMLElement ? dom.querySelector(':scope > .pm-thread-header') : null
  if (!(el instanceof HTMLElement)) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('pm-thread-header-flash')
  window.setTimeout(() => el.classList.remove('pm-thread-header-flash'), 900)
}

export function threadNodeView(
  getPos: () => number | undefined,
  // Fired right after a real user click toggles collapse — NOT for the bulk hydration path
  // (setCollapsedThreadIds), mirroring headingNodeView's own onToggleCollapse contract exactly.
  // NoteEditorPM.tsx wires this to the notes:setThreadCollapsed IPC call.
  onToggleCollapse?: (view: EditorView, threadId: string, collapsed: boolean) => void,
) {
  return (initialNode: PMNode, view: EditorView): NodeView => {
    let node = initialNode

    const dom = document.createElement('div')
    dom.className = 'pm-thread'

    // Breadcrumb trail back to the main (outermost) thread — only rendered for a sub-thread
    // (ancestorThreads() returns empty for a top-level thread, so this stays empty/hidden
    // there). Lives above the collapse header, not inside it, so it stays visible even while
    // the thread itself is collapsed — the whole point is "how do I get back out of here."
    const breadcrumb = document.createElement('div')
    breadcrumb.className = 'pm-thread-breadcrumb'
    breadcrumb.contentEditable = 'false'
    dom.appendChild(breadcrumb)

    const header = document.createElement('div')
    header.className = 'pm-thread-header'
    header.contentEditable = 'false'

    const arrow = document.createElement('span')
    arrow.className = 'pm-thread-collapse-arrow'
    arrow.style.cursor = 'pointer'
    arrow.style.userSelect = 'none'
    arrow.style.display = 'inline-flex'
    arrow.style.alignItems = 'center'
    header.appendChild(arrow)

    const titleEl = document.createElement('span')
    titleEl.className = 'pm-thread-title'
    titleEl.contentEditable = 'true'
    titleEl.spellcheck = false
    header.appendChild(titleEl)

    const metaEl = document.createElement('span')
    metaEl.className = 'pm-thread-meta'
    header.appendChild(metaEl)

    dom.appendChild(header)

    const contentDOM = document.createElement('div')
    contentDOM.className = 'pm-thread-body'
    dom.appendChild(contentDOM)

    const footer = document.createElement('div')
    footer.className = 'pm-thread-footer'
    footer.contentEditable = 'false'
    const addBtn = document.createElement('button')
    addBtn.type = 'button'
    addBtn.className = 'pm-thread-add-entry'
    addBtn.innerHTML = `${PLUS_SVG}<span>Add entry</span>`
    footer.appendChild(addBtn)
    // "+ Add sub-thread" sits right next to "+ Add entry" on every thread, including a
    // sub-thread itself — nesting is unbounded (task brief), so this control is never hidden
    // based on the current thread's own depth.
    const subBtn = document.createElement('button')
    subBtn.type = 'button'
    subBtn.className = 'pm-thread-add-sub'
    subBtn.innerHTML = `${THREAD_ICON_SVG}<span>Add sub-thread</span>`
    footer.appendChild(subBtn)
    dom.appendChild(footer)

    function isCollapsed(): boolean {
      return typeof node.attrs.threadId === 'string' && !!threadCollapseKey.getState(view.state)?.has(node.attrs.threadId)
    }

    function render() {
      const collapsed = isCollapsed()
      arrow.innerHTML = collapsed ? CHEVRON_RIGHT_SVG : CHEVRON_DOWN_SVG
      // Entries themselves are hidden by threadCollapse.ts's decorations() (so hydration keeps
      // working the way that file's header comment explains) — footer visibility is chrome
      // this NodeView owns outright, so it's simplest to just toggle directly here.
      footer.style.display = collapsed ? 'none' : ''

      // Don't clobber the title text while the user is actively editing it — an unconditional
      // overwrite on every render() would yank the caret out from under their own typing.
      if (document.activeElement !== titleEl) {
        titleEl.textContent = node.attrs.title || firstLinePreview(node)
        titleEl.classList.toggle('pm-thread-title-placeholder', !node.attrs.title)
      }

      const stats = computeWordStats(node.textContent)
      const createdAt = node.firstChild?.attrs.createdAt as string | undefined
      metaEl.textContent = [
        formatThreadTimestamp(createdAt),
        `${stats.words} word${stats.words === 1 ? '' : 's'}`,
        `${stats.characters} char${stats.characters === 1 ? '' : 's'}`,
      ].filter(Boolean).join(' · ')

      // Breadcrumb back to the main thread — empty/hidden for a top-level thread. Rebuilt from
      // the live doc on every render() (position-derived, so it stays correct across edits
      // elsewhere in the note) rather than cached, matching this file's own "recompute from
      // source of truth" rule stated in the header comment above.
      const pos = getPos()
      const chain = pos === undefined ? [] : ancestorThreads(view, pos)
      breadcrumb.style.display = chain.length ? '' : 'none'
      breadcrumb.innerHTML = ''
      chain.forEach((anc, i) => {
        const seg = document.createElement('button')
        seg.type = 'button'
        seg.className = 'pm-thread-breadcrumb-seg'
        seg.textContent = i === 0 ? `↩ ${anc.label}` : anc.label
        seg.addEventListener('mousedown', (e) => e.preventDefault())
        seg.addEventListener('click', () => flashThreadAt(view, anc.pos))
        breadcrumb.appendChild(seg)
        if (i < chain.length - 1) {
          const sep = document.createElement('span')
          sep.className = 'pm-thread-breadcrumb-sep'
          sep.textContent = '›'
          breadcrumb.appendChild(sep)
        }
      })
    }
    render()

    arrow.addEventListener('mousedown', (e) => e.preventDefault())
    arrow.addEventListener('click', () => {
      if (typeof node.attrs.threadId !== 'string') return
      toggleThreadCollapse(view, node.attrs.threadId)
      render()
      onToggleCollapse?.(view, node.attrs.threadId, isCollapsed())
    })

    function commitTitle() {
      const pos = getPos()
      if (pos === undefined) return
      const text = titleEl.textContent?.trim() || null
      if (text === (node.attrs.title || null)) return
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'title', text))
    }
    titleEl.addEventListener('blur', commitTitle)
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); titleEl.blur() }
      else if (e.key === 'Escape') { e.preventDefault(); titleEl.textContent = node.attrs.title || firstLinePreview(node); titleEl.blur() }
    })
    // Starting to edit a placeholder-preview title should begin from a blank field, not force
    // the user to select-all + delete the preview text themselves before typing a real title.
    titleEl.addEventListener('focus', () => {
      if (!node.attrs.title) titleEl.textContent = ''
    })

    addBtn.addEventListener('mousedown', (e) => e.preventDefault())
    addBtn.addEventListener('click', () => {
      const pos = getPos()
      if (pos === undefined) return
      const entry = schema.nodes.thread_entry.create(
        { entryId: crypto.randomUUID(), createdAt: new Date().toISOString() },
        schema.nodes.paragraph.create(),
      )
      const insertAt = pos + node.nodeSize - 1 // just inside the thread's own closing boundary
      const tr = view.state.tr.insert(insertAt, entry)
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)))
      view.dispatch(tr)
      view.focus()
    })

    subBtn.addEventListener('mousedown', (e) => e.preventDefault())
    subBtn.addEventListener('click', () => {
      const pos = getPos()
      if (pos === undefined) return
      // A sub-thread is a whole new `thread` node, wrapped in its own `thread_entry` (a
      // thread's content spec is `thread_entry+`, so a nested thread can't sit directly inside
      // this thread's content the way a plain paragraph entry can) — timestamped the same as
      // any other entry, since "I opened a sub-thread here" is itself a loggable moment in the
      // parent thread's history.
      const nestedThread = schema.nodes.thread.create(
        { threadId: crypto.randomUUID(), title: null },
        schema.nodes.thread_entry.create(
          { entryId: crypto.randomUUID(), createdAt: new Date().toISOString() },
          schema.nodes.paragraph.create(),
        ),
      )
      const wrapperEntry = schema.nodes.thread_entry.create(
        { entryId: crypto.randomUUID(), createdAt: new Date().toISOString() },
        nestedThread,
      )
      const insertAt = pos + node.nodeSize - 1
      const tr = view.state.tr.insert(insertAt, wrapperEntry)
      // TextSelection.near searches forward from this boundary for the nearest real cursor
      // position, which lands inside the nested thread's own first (empty) entry paragraph —
      // same "point at a boundary, let near() dive in" approach addBtn's handler above uses.
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)))
      view.dispatch(tr)
      view.focus()
    })

    return {
      dom,
      contentDOM,
      update(updatedNode) {
        if (updatedNode.type.name !== 'thread') return false
        node = updatedNode
        render()
        return true
      },
      ignoreMutation(mutation) {
        // The title span is chrome outside PM's own content model (same idea as
        // headingNodeView's arrow / calloutNodeView's header) — its DOM mutations (typing,
        // focus/blur) must never be reinterpreted as a document edit.
        return mutation.target === titleEl || (mutation.target instanceof Node && titleEl.contains(mutation.target))
      },
    }
  }
}

// thread_entry NodeView — a lightweight, non-collapsible timestamp badge in front of each
// entry's own real (contentDOM-backed) block content. No custom `update()` needed: `createdAt`
// never changes after an entry is created (schema.ts's thread_entry comment), and content edits
// inside contentDOM are handled by ProseMirror's own default reconciliation — matching
// nodeViews.ts's calloutNodeView, which omits `update()` for the same reason.
export function threadEntryNodeView(node: PMNode): NodeView {
  const dom = document.createElement('div')
  dom.className = 'pm-thread-entry'

  const badge = document.createElement('div')
  badge.className = 'pm-thread-entry-badge'
  badge.contentEditable = 'false'
  badge.textContent = formatThreadTimestamp(node.attrs.createdAt as string | undefined)
  dom.appendChild(badge)

  const contentDOM = document.createElement('div')
  contentDOM.className = 'pm-thread-entry-content'
  dom.appendChild(contentDOM)

  return { dom, contentDOM }
}
