import { Plugin, PluginKey } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'

// Port of NoteEditor.tsx's collapsible-heading system (collapsedHeadingsField
// + CollapsedHeadingWidget + CollapseArrowWidget + buildCollapsedHeadingDecos,
// NoteEditor.tsx:939-1057). Confirmed finding from the migration research:
// collapse state is PURE EPHEMERAL UI STATE, never persisted to markdown —
// so this is reimplemented as plugin-local state with zero serialization
// concern, exactly mirroring the original's architecture.

export const headingCollapseKey = new PluginKey<Set<number>>('berean-heading-collapse')
const toggleHeadingMeta = 'berean-toggle-heading-collapse'

export function toggleHeadingCollapse(view: EditorView, headingPos: number) {
  view.dispatch(view.state.tr.setMeta(toggleHeadingMeta, headingPos))
}

export function createHeadingCollapsePlugin() {
  return new Plugin<Set<number>>({
    key: headingCollapseKey,
    state: {
      init: () => new Set<number>(),
      apply(tr, collapsed) {
        const togglePos = tr.getMeta(toggleHeadingMeta) as number | undefined
        let next = collapsed
        if (typeof togglePos === 'number') {
          next = new Set(collapsed)
          if (next.has(togglePos)) next.delete(togglePos)
          else next.add(togglePos)
        }
        if (tr.docChanged && next.size > 0) {
          const mapped = new Set<number>()
          for (const pos of next) mapped.add(tr.mapping.map(pos))
          next = mapped
        }
        return next
      },
    },
    props: {
      decorations(state) {
        const collapsed = this.getState(state)
        if (!collapsed || collapsed.size === 0) return null
        const decorations: Decoration[] = []
        const { doc } = state

        // Headings are always top-level block nodes (never nested inside
        // lists/blockquotes/etc in this schema), so a single top-level
        // doc.forEach pass is sufficient to find each collapsed heading's
        // section boundary: the next sibling heading at the same-or-higher
        // level, or a horizontal_rule, or the end of the doc.
        const topLevel: Array<{ node: PMNode; offset: number }> = []
        doc.forEach((node, offset) => topLevel.push({ node, offset }))

        topLevel.forEach(({ node, offset }, i) => {
          if (node.type.name !== 'heading' || !collapsed.has(offset)) return
          const level = node.attrs.level as number
          const sectionStart = offset + node.nodeSize
          let sectionEnd = doc.content.size
          let lineCount = 0
          for (let j = i + 1; j < topLevel.length; j++) {
            const sib = topLevel[j].node
            if (sib.type.name === 'heading' && (sib.attrs.level as number) <= level) { sectionEnd = topLevel[j].offset; break }
            if (sib.type.name === 'horizontal_rule') { sectionEnd = topLevel[j].offset; break }
            lineCount++
          }
          if (sectionEnd <= sectionStart) return

          // PM has no CM6-style block "replace" decoration — hide each
          // sibling block node individually via `Decoration.node` +
          // `display: none` instead of one span-the-range replace.
          for (let j = i + 1; j < topLevel.length; j++) {
            const { node: sib, offset: sibOffset } = topLevel[j]
            if (sibOffset < sectionStart || sibOffset >= sectionEnd) continue
            decorations.push(Decoration.node(sibOffset, sibOffset + sib.nodeSize, { style: 'display: none' }))
          }
          decorations.push(Decoration.widget(sectionStart, () => {
            const el = document.createElement('span')
            el.className = 'pm-collapsed-heading-pill'
            el.textContent = `  ···  ${lineCount} line${lineCount !== 1 ? 's' : ''}`
            return el
          }, { side: 1 }))
        })

        return DecorationSet.create(doc, decorations)
      },
    },
  })
}

// Raw SVG markup for lucide's ChevronRight / ChevronDown, inlined rather than mounting a
// React icon component (this is a plain DOM NodeView, not a React tree) — copied from
// lucide-react's own path data so the collapse affordance matches the icon language used
// everywhere else in the app (History modal, Scripture side panel, top bar) instead of a
// raw Unicode triangle glyph.
const CHEVRON_RIGHT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'
const CHEVRON_DOWN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'

export function headingNodeView(getPos: () => number | undefined) {
  return (node: PMNode, view: EditorView): NodeView => {
    const dom = document.createElement(`h${node.attrs.level}`)
    // Arrow lives in the left gutter (absolutely positioned, out of normal
    // flow — see below) rather than as a flex sibling ahead of the text, so
    // it no longer pushes the heading's own text start to the right of
    // where every other block's text starts (a real, reported indent bug —
    // headings visibly began further right than paragraphs/lists). `dom`
    // just needs to be the positioning anchor for that absolute arrow now.
    dom.style.position = 'relative'
    // Hover-reveal: the arrow used to sit at a constant 50% opacity, always visible before
    // every heading's text — that's the "arrow/triangle thing" cluttering headings. It now
    // stays fully transparent until the pointer is over the heading row (this class, applied
    // to `dom`, is the hover trigger; pmEditor.css's `.pm-heading-collapse-arrow` opacity
    // rules key off it). Reserves the same layout space either way (no reflow on hover).
    dom.className = 'pm-heading-row'

    const arrow = document.createElement('span')
    arrow.className = 'pm-heading-collapse-arrow'
    arrow.contentEditable = 'false'
    arrow.style.cursor = 'pointer'
    arrow.style.userSelect = 'none'
    arrow.style.lineHeight = '1'
    arrow.style.display = 'inline-flex'
    arrow.style.alignItems = 'center'
    // Gutter placement: pulled fully out of flow and into the editor's own
    // left padding (pmEditor.css's `.ProseMirror` has 16px of it), so it sits
    // to the left of wherever this heading's text column actually starts —
    // including nested headings inside a blockquote/list, where that
    // anchor point is this element itself, not the page edge. -19px put the
    // 14px-wide arrow 3px PAST that 16px padding box (touching/overflowing
    // the editor's own outer edge, a reported bug) — -14px keeps it fully
    // inside the padding with a small gap from the edge instead.
    arrow.style.position = 'absolute'
    arrow.style.left = '-14px'
    arrow.style.top = '50%'
    arrow.style.transform = 'translateY(-50%)'
    const updateArrow = () => {
      const pos = getPos()
      const collapsed = pos !== undefined && headingCollapseKey.getState(view.state)?.has(pos)
      arrow.innerHTML = collapsed ? CHEVRON_RIGHT_SVG : CHEVRON_DOWN_SVG
    }
    updateArrow()
    arrow.addEventListener('mousedown', (e) => e.preventDefault())
    arrow.addEventListener('click', () => {
      const pos = getPos()
      if (pos === undefined) return
      // Update the glyph directly rather than relying on PM's NodeView
      // `update()` lifecycle: the toggle transaction only carries plugin
      // meta (no doc steps touching this node), so PM has no reason to
      // call `update()` on this NodeView afterward. `view.dispatch` runs
      // synchronously, so `view.state` already reflects the new collapse
      // state by the time this line runs.
      toggleHeadingCollapse(view, pos)
      updateArrow()
    })
    dom.appendChild(arrow)

    // pm-heading-content: gives the (otherwise bare) content span an explicit
    // min-height/line-height in pmEditor.css. Without it, a genuinely empty
    // heading's content span has no line box for the browser to size — under
    // this element's `display:flex; align-items:center` it can collapse to
    // zero height, so the caret has nothing to render/blink against until
    // the first character is typed (which then establishes a line box).
    const contentDOM = document.createElement('span')
    contentDOM.className = 'pm-heading-content'
    dom.appendChild(contentDOM)

    return {
      dom,
      contentDOM,
      update(updatedNode) {
        if (updatedNode.type.name !== 'heading') return false
        updateArrow()
        return true
      },
    }
  }
}
