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

export function headingNodeView(getPos: () => number | undefined) {
  return (node: PMNode, view: EditorView): NodeView => {
    const dom = document.createElement(`h${node.attrs.level}`)
    dom.style.display = 'flex'
    // 'center' rather than 'baseline': baseline-aligned a small arrow glyph against a much
    // taller H1/H2 line noticeably low/off-center. Fixed 13px font-size rather than scaling
    // with HEADING_FONT_SIZES_EM: the arrow scaling up to 1.71em for H1 made it look oversized
    // next to the actual heading text — the arrow is a UI affordance, not part of the heading's
    // own typography, so it reads better as one consistent size across every heading level.
    dom.style.alignItems = 'center'
    dom.style.gap = '4px'

    const arrow = document.createElement('span')
    arrow.className = 'pm-heading-collapse-arrow'
    arrow.contentEditable = 'false'
    arrow.style.cursor = 'pointer'
    arrow.style.userSelect = 'none'
    arrow.style.fontSize = '17px'
    arrow.style.lineHeight = '1'
    arrow.style.display = 'inline-flex'
    arrow.style.alignItems = 'center'
    const updateArrow = () => {
      const pos = getPos()
      const collapsed = pos !== undefined && headingCollapseKey.getState(view.state)?.has(pos)
      arrow.textContent = collapsed ? '▸' : '▾'
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

    const contentDOM = document.createElement('span')
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
