import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

// Collapsible threads (notes editor) — sibling to headingCollapse.ts's collapsible headings,
// but simpler in one specific way: a `thread` node (schema.ts) carries its own generated
// `threadId` attr, stamped once at insertion time (Toolbar.tsx/slashCommands.ts), so THIS
// plugin's collapsed set is keyed directly by that id — never by document position, and never
// by a derived-from-content key the way headingCollapse.ts's computeHeadingKey has to
// approximate for headings (which have no id attr slot at all). That means, unlike
// headingCollapseKey's Set<number>, this Set<string> never needs position remapping on
// `tr.mapping.map` — an id is stable across edits anywhere else in the document by
// construction, so `apply()` below just passes the set through unchanged on any transaction
// that isn't itself a collapse toggle/hydration.
//
// Persistence (round-trip to berean.db) is a layer OUTSIDE this plugin state, exactly
// mirroring headingCollapse.ts's own split: electron/db/berean.ts's note_thread_collapse table
// stores the threadId strings directly (no key-computation step needed on the read side
// either), and NoteEditorPM.tsx's loadCollapsedThreads feeds them in via
// `setCollapsedThreadIds` once per note load — a bulk "replace the whole collapsed-set"
// transaction, used ONLY for that initial hydration, never for an ordinary click (which still
// goes through the original per-id toggle below).

export const threadCollapseKey = new PluginKey<Set<string>>('berean-thread-collapse')
const toggleThreadMeta = 'berean-toggle-thread-collapse'
const setCollapsedThreadIdsMeta = 'berean-set-thread-collapse-ids'

export function toggleThreadCollapse(view: EditorView, threadId: string) {
  view.dispatch(view.state.tr.setMeta(toggleThreadMeta, threadId))
}

// Replaces the ENTIRE collapsed-id set in one shot — used exactly once per note load
// (NoteEditorPM.tsx, right after the async getCollapsedThreads IPC round-trip resolves) to
// hydrate persisted collapse state onto a freshly-opened document. Never used for a live user
// toggle (toggleThreadCollapse above handles that, unchanged).
export function setCollapsedThreadIds(view: EditorView, ids: string[]) {
  view.dispatch(view.state.tr.setMeta(setCollapsedThreadIdsMeta, ids))
}

// Reverse of "does this id still exist" — filters a list of persisted threadIds down to the
// ones actually present in `doc` right now, silently dropping any id that doesn't match (the
// note was edited since the id was saved, the thread was deleted, or this is a stale id from
// before a doc reload) — exactly the "degrade silently if the note or thread no longer exists"
// behavior headingCollapse.ts's headingPositionsForKeys documents for its own analogous case.
export function threadIdsPresentInDoc(doc: PMNode, ids: string[]): string[] {
  if (ids.length === 0) return []
  const wanted = new Set(ids)
  const present: string[] = []
  doc.descendants((node) => {
    if (node.type.name === 'thread' && typeof node.attrs.threadId === 'string' && wanted.has(node.attrs.threadId)) {
      present.push(node.attrs.threadId)
    }
  })
  return present
}

export function createThreadCollapsePlugin() {
  return new Plugin<Set<string>>({
    key: threadCollapseKey,
    state: {
      init: () => new Set<string>(),
      apply(tr, collapsed) {
        const toggleId = tr.getMeta(toggleThreadMeta) as string | undefined
        const setIds = tr.getMeta(setCollapsedThreadIdsMeta) as string[] | undefined
        if (Array.isArray(setIds)) return new Set(setIds)
        if (typeof toggleId === 'string') {
          const next = new Set(collapsed)
          if (next.has(toggleId)) next.delete(toggleId)
          else next.add(toggleId)
          return next
        }
        // No position-remapping step needed here (contrast headingCollapseKey's own apply()) —
        // see this file's header comment for why an id-keyed set never goes stale on an
        // unrelated doc change.
        return collapsed
      },
    },
    props: {
      decorations(state) {
        const collapsed = this.getState(state)
        if (!collapsed || collapsed.size === 0) return null
        const decorations: Decoration[] = []
        const { doc } = state

        // A collapsed thread's own header (title/timestamp/word-char count, threadNodeView.ts)
        // stays visible regardless of collapse state — it already IS the "collapsed view"
        // summary the task brief calls for, so unlike headingCollapseKey's decorations() (which
        // has to synthesize a "··· N lines" pill widget because a bare heading carries no such
        // summary of its own), nothing needs to be added here — collapsing a thread only needs
        // to HIDE its entries, never show anything extra.
        doc.descendants((node, pos) => {
          if (node.type.name !== 'thread') return true
          if (typeof node.attrs.threadId !== 'string' || !collapsed.has(node.attrs.threadId)) return true
          let entryPos = pos + 1
          node.forEach((entry) => {
            decorations.push(Decoration.node(entryPos, entryPos + entry.nodeSize, { style: 'display: none' }))
            entryPos += entry.nodeSize
          })
          return false // a fully-hidden thread's own children never need their own decorations
        })

        return DecorationSet.create(doc, decorations)
      },
    },
  })
}
