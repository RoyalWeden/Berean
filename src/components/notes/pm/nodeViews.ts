import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { CALLOUT_META, BULLET_STYLE_DEFS } from '@/lib/noteTextBlocks'
import { useAppStore } from '@/store'

// ─── Callout NodeView ───────────────────────────────────────────────────────
// Obsidian-style callout: colored left border + tinted background + an
// icon/label header row that toggles collapse — replacing the earlier,
// looser box (0.65em/0.9em padding, no collapse at all). Padding and
// internal paragraph spacing are both tightened here; the same tightened
// (but non-collapsible — collapse is a live-editing affordance, not
// meaningful in a read-only render) look is mirrored in staticRender.ts's
// renderCallout for print/version-history/daily-scroll/Presenter parity.
export function calloutNodeView(node: PMNode): NodeView {
  const meta = CALLOUT_META[node.attrs.calloutType] ?? CALLOUT_META.NOTE
  const dom = document.createElement('div')
  dom.className = `pm-callout pm-callout-${String(node.attrs.calloutType).toLowerCase()}`
  dom.style.borderLeft = `3px solid ${meta.border}`
  dom.style.backgroundColor = meta.bg
  dom.style.borderRadius = '0 6px 6px 0'
  dom.style.padding = '0.4em 0.7em'
  dom.style.margin = '0.6em 0'
  dom.style.boxShadow = '0 1px 3px rgb(0 0 0 / 0.06)'

  let collapsed = false

  const header = document.createElement('div')
  header.className = 'pm-callout-header'
  header.style.color = meta.color
  header.style.fontWeight = '700'
  header.style.fontSize = '0.78em'
  header.style.textTransform = 'uppercase'
  header.style.letterSpacing = '0.04em'
  header.style.userSelect = 'none'
  header.style.display = 'flex'
  header.style.alignItems = 'center'
  header.style.gap = '0.35em'
  header.style.cursor = 'pointer'
  header.contentEditable = 'false'

  const label = document.createElement('span')
  label.textContent = `${meta.icon} ${meta.label}`
  header.appendChild(label)

  const chevron = document.createElement('span')
  chevron.textContent = '▾'
  chevron.style.marginLeft = 'auto'
  chevron.style.fontSize = '0.85em'
  chevron.style.opacity = '0.6'
  chevron.style.transition = 'transform 0.12s ease'
  header.appendChild(chevron)

  const contentDOM = document.createElement('div')
  contentDOM.className = 'pm-callout-content'
  contentDOM.style.fontSize = '0.92em'
  contentDOM.style.marginTop = '0.3em'

  header.addEventListener('mousedown', (e) => {
    // Only the collapse toggle itself should intercept the click — letting
    // it reach the editor as a normal mousedown (instead of preventDefault
    // always) would otherwise fight cursor placement if the header row
    // grows to wrap contentEditable text in some theme; contentEditable is
    // already 'false' here so this is purely a visual toggle.
    e.preventDefault()
    collapsed = !collapsed
    contentDOM.style.display = collapsed ? 'none' : ''
    chevron.style.transform = collapsed ? 'rotate(-90deg)' : ''
  })

  dom.appendChild(header)
  dom.appendChild(contentDOM)

  return { dom, contentDOM }
}

// Count ancestor bullet_list nodes at `pos` — used to pick the bullet symbol
// for the current nesting depth, mirroring CM6's
// `Math.min(Math.floor(leadingSpaces/4), 4)` indent-level calculation
// (NoteEditor.tsx:1396-1401), just derived from real node nesting instead of
// leading-whitespace counting.
function bulletListDepth(view: EditorView, pos: number): number {
  const $pos = view.state.doc.resolve(pos)
  let depth = 0
  for (let d = $pos.depth; d >= 0; d--) {
    if ($pos.node(d).type.name === 'bullet_list') depth++
  }
  return Math.max(0, depth - 1)
}

// KNOWN GAP: bullet-glyph NodeViews read `noteBulletStyle` once, at the
// moment each list_item is (re)constructed — there's no live subscription
// that rebuilds already-mounted bullet NodeViews the instant the user
// changes the setting mid-session (CM6's version re-ran via a store
// subscription driving `refreshDecorationsEffect`). Acceptable for now: the
// style still applies correctly on next edit/note-switch; revisit if this
// needs to be instant.

// ─── list_item NodeView ─────────────────────────────────────────────────────
// Handles all three list_item flavors in one place:
//  - checked !== null → task checkbox (real, clickable — see note below)
//  - checked === null, inside bullet_list → custom bullet glyph per the
//    global noteBulletStyle setting (BULLET_STYLE_DEFS) — purely a render
//    preference; markdown always serializes as plain "- " regardless
//    (schema.ts/serializer.ts never touch the bullet character itself)
//  - checked === null, inside ordered_list → plain <li>, browser numbering
//
// Task checkboxes are REAL and clickable here — a deliberate UX upgrade over
// CM6's disabled-checkbox widget (toggle only via editing raw text,
// NoteEditor.tsx:1159-1173), enabled by PM's real node/attr model. Flagged
// in the migration plan as a call-out, not an accidental behavior change.
export function listItemNodeView(getPos: () => number | undefined) {
  return (node: PMNode, view: EditorView): NodeView => {
    const li = document.createElement('li')

    if (node.attrs.checked !== null) {
      li.className = 'pm-task-item'
      li.style.listStyle = 'none'
      li.style.display = 'flex'
      li.style.alignItems = 'flex-start'
      // gap comes from the .pm-task-item CSS rule (pmEditor.css) — the single source of truth

      const checkbox = document.createElement('input')
      checkbox.type = 'checkbox'
      checkbox.checked = !!node.attrs.checked
      checkbox.contentEditable = 'false'
      checkbox.className = 'pm-task-checkbox'
      checkbox.style.marginTop = '0.3em'
      checkbox.style.accentColor = 'rgb(var(--color-accent))'
      checkbox.style.width = '15px'
      checkbox.style.height = '15px'
      checkbox.style.cursor = 'pointer'
      checkbox.addEventListener('mousedown', (e) => e.preventDefault())
      checkbox.addEventListener('change', () => {
        const pos = getPos()
        if (pos === undefined) return
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'checked', checkbox.checked))
      })

      const contentDOM = document.createElement('div')
      contentDOM.className = 'pm-task-content'
      contentDOM.style.flex = '1'
      if (node.attrs.checked) {
        contentDOM.style.textDecoration = 'line-through'
        contentDOM.style.opacity = '0.7'
      }
      li.appendChild(checkbox)
      li.appendChild(contentDOM)
      return { dom: li, contentDOM }
    }

    const pos = getPos()
    const parentNode = pos !== undefined ? view.state.doc.resolve(pos).parent : null
    if (parentNode?.type.name === 'bullet_list') {
      li.className = 'pm-bullet-item'
      li.style.listStyle = 'none'
      li.style.display = 'flex'
      li.style.alignItems = 'flex-start'
      // gap comes from the .pm-bullet-item CSS rule (pmEditor.css) — the single source of truth

      // A literal "-" always renders as a dash, regardless of the global
      // noteBulletStyle setting — "*"/"+" use that setting's chosen glyph
      // instead. Previously BOTH markers produced the exact same glyph
      // with no memory of which character was typed, so there was no way
      // to visually tell a "-" list apart from a "*" one.
      const bulletMarker = (parentNode.attrs.marker as string) || '-'
      let symbol: string
      if (bulletMarker === '-') {
        symbol = '–'
      } else {
        const styleName = useAppStore.getState().noteBulletStyle ?? 'classic'
        const styleDef = BULLET_STYLE_DEFS[styleName] ?? BULLET_STYLE_DEFS.classic
        const depth = pos !== undefined ? bulletListDepth(view, pos) : 0
        symbol = styleDef.symbols[Math.min(depth, styleDef.symbols.length - 1)]
      }

      const marker = document.createElement('span')
      marker.className = 'pm-bullet-marker'
      marker.contentEditable = 'false'
      marker.style.userSelect = 'none'
      marker.style.flexShrink = '0'
      marker.style.marginTop = '0'
      marker.style.lineHeight = '1'
      marker.style.fontSize = '1.35em'
      marker.textContent = symbol

      const contentDOM = document.createElement('div')
      contentDOM.className = 'pm-bullet-content'
      contentDOM.style.flex = '1'
      li.appendChild(marker)
      li.appendChild(contentDOM)
      return { dom: li, contentDOM }
    }

    // Ordered list — numbered via CSS counter (pmEditor.css). Needs the same
    // wrapping content div as bullet/task items above: li is `display:flex`
    // (for the counter + content to sit in a row), so without a div any
    // nested block content — most visibly a nested ordered/bullet sub-list —
    // becomes a flex-ROW sibling of the paragraph instead of stacking below
    // it, which read as a huge indent shoving the sub-list off to the right.
    const contentDOM = document.createElement('div')
    contentDOM.className = 'pm-ol-content'
    contentDOM.style.flex = '1'
    li.appendChild(contentDOM)
    return { dom: li, contentDOM }
  }
}
