import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView, NodeView } from 'prosemirror-view'
import { CALLOUT_META, BULLET_STYLE_DEFS } from '@/lib/noteTextBlocks'
import { useAppStore } from '@/store'

// ─── code_block NodeView ────────────────────────────────────────────────────
// Adds a small non-editable header (language picker + copy button) above the actual
// editable `<pre><code>` — schema.ts's `params` attr already round-trips losslessly
// through the ``` fence markdown (parser.ts/serializer.ts reuse prosemirror-markdown's
// own fence node), so this is purely presentational: no schema/serialization change.
// Syntax highlighting itself is NOT done here — see codeBlockHighlight.ts's own header
// comment for why that's a separate DECORATION plugin instead of DOM work in this
// NodeView. Everything this NodeView itself touches (the header's own select/button DOM)
// is non-content (`contentEditable = 'false'`), mutated only in direct response to a real
// user event (change/click) — never from a plugin's `view().update()` hook — so it can't
// reintroduce the DOMObserver feedback loop blockHandles.ts's header comment warns about.
const CODE_LANGUAGE_PRESETS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Plain text' },
  { value: 'javascript', label: 'JavaScript' },
  { value: 'typescript', label: 'TypeScript' },
  { value: 'json', label: 'JSON' },
  { value: 'python', label: 'Python' },
  { value: 'bash', label: 'Bash' },
  { value: 'sql', label: 'SQL' },
  { value: 'css', label: 'CSS' },
  { value: 'html', label: 'HTML' },
]

export function codeBlockNodeView(getPos: () => number | undefined) {
  return (node: PMNode, view: EditorView): NodeView => {
    let currentNode = node

    const wrap = document.createElement('div')
    wrap.className = 'pm-code-block'

    const header = document.createElement('div')
    header.className = 'pm-code-block-header'
    header.contentEditable = 'false'

    const select = document.createElement('select')
    select.className = 'pm-code-block-lang'
    select.title = 'Code block language'
    for (const preset of CODE_LANGUAGE_PRESETS) {
      const opt = document.createElement('option')
      opt.value = preset.value
      opt.textContent = preset.label
      select.appendChild(opt)
    }
    // A `params` value the user typed by hand (the ``` fence syntax accepts ANY info
    // string, e.g. ```rust — not just the presets above) still round-trips through
    // markdown untouched; add it as its own option so the dropdown reflects that instead
    // of silently snapping to "Plain text" the moment it's opened. Checked against the
    // select's LIVE options (not just the static presets list) so update() below doesn't
    // insert a duplicate entry every time the same custom language is re-synced.
    function syncSelectValue(params: string) {
      const hasOption = Array.from(select.options).some((o) => o.value === params)
      if (!hasOption) {
        const custom = document.createElement('option')
        custom.value = params
        custom.textContent = params
        select.insertBefore(custom, select.firstChild)
      }
      select.value = params
    }
    syncSelectValue(node.attrs.params || '')
    // Stops the native <select> dropdown's own mousedown from being picked up as an
    // editor selection/gesture — same reasoning as the callout header/task checkbox's
    // own mousedown guards above/below.
    select.addEventListener('mousedown', (e) => e.stopPropagation())
    select.addEventListener('change', () => {
      const pos = getPos()
      if (pos === undefined) return
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'params', select.value))
      view.focus()
    })

    const copyBtn = document.createElement('button')
    copyBtn.type = 'button'
    copyBtn.className = 'pm-code-block-copy'
    copyBtn.title = 'Copy code'
    copyBtn.textContent = 'Copy'
    copyBtn.addEventListener('mousedown', (e) => e.preventDefault())
    copyBtn.addEventListener('click', (e) => {
      e.preventDefault()
      navigator.clipboard.writeText(currentNode.textContent).then(() => {
        copyBtn.textContent = 'Copied'
        setTimeout(() => { copyBtn.textContent = 'Copy' }, 1200)
      }).catch(() => {})
    })

    header.appendChild(select)
    header.appendChild(copyBtn)

    const pre = document.createElement('pre')
    const code = document.createElement('code')
    pre.appendChild(code)

    wrap.appendChild(header)
    wrap.appendChild(pre)

    return {
      dom: wrap,
      contentDOM: code,
      update(updatedNode) {
        if (updatedNode.type.name !== 'code_block') return false
        currentNode = updatedNode
        syncSelectValue(updatedNode.attrs.params || '')
        return true
      },
    }
  }
}

// ─── image NodeView ─────────────────────────────────────────────────────────
// Adds a drag-to-resize handle, shown only while the image itself is the current selection
// (a lone atomic inline node is trivially selectable as a NodeSelection — clicking it selects
// the whole node) — matches the "handle appears on selection" convention most editors with
// resizable images use, rather than an always-visible handle competing for attention on every
// image all the time. Only WIDTH is tracked (schema.ts's own comment explains why no separate
// height attr exists) — CSS `height: auto` (pmEditor.css) keeps the aspect ratio as the width
// changes, so the drag math here only ever needs the horizontal delta.
export function imageNodeView(getPos: () => number | undefined) {
  return (node: PMNode, view: EditorView): NodeView => {
    const wrap = document.createElement('span')
    wrap.className = 'pm-image-wrap'

    const img = document.createElement('img')
    function syncImgAttrs(n: PMNode) {
      img.src = n.attrs.src
      if (n.attrs.alt) img.alt = n.attrs.alt; else img.removeAttribute('alt')
      if (n.attrs.title) img.title = n.attrs.title; else img.removeAttribute('title')
      if (n.attrs.width) img.style.width = `${n.attrs.width}px`; else img.style.width = ''
    }
    syncImgAttrs(node)

    const handle = document.createElement('span')
    handle.className = 'pm-image-resize-handle'
    handle.contentEditable = 'false'
    // A ⤡-style diagonal resize-arrows glyph, not a plain colored square — same reveal-on-
    // hover/selection behavior as before, purely a visual swap of what's rendered inside.
    // Rotated 90° via CSS (pmEditor.css) — the path itself draws a NE-SW diagonal, but this
    // handle sits at the wrap's bottom-right corner with an `nwse-resize` cursor (NW-SE), so
    // the un-rotated glyph pointed the wrong way relative to the actual drag direction.
    handle.innerHTML = '<svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 10 L10 2 M5.5 2 H10 V6.5 M6.5 10 H2 V5.5"/></svg>'
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startWidth = img.getBoundingClientRect().width
      wrap.classList.add('pm-image-resizing')
      function onMove(ev: MouseEvent) {
        const newWidth = Math.max(40, Math.round(startWidth + (ev.clientX - startX)))
        img.style.width = `${newWidth}px`
      }
      function onUp() {
        wrap.classList.remove('pm-image-resizing')
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        const pos = getPos()
        if (pos === undefined) return
        const finalWidth = Math.round(img.getBoundingClientRect().width)
        view.dispatch(view.state.tr.setNodeAttribute(pos, 'width', finalWidth))
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    })

    // Delete button — top-right corner, same reveal-on-hover/selection convention as the
    // resize handle. Removes just this image node from the doc; doesn't touch surrounding text.
    const deleteBtn = document.createElement('span')
    deleteBtn.className = 'pm-image-delete-btn'
    deleteBtn.contentEditable = 'false'
    deleteBtn.title = 'Delete image'
    // Trash-can glyph (lucide Trash2 shape, simplified) rather than a plain "×" — reads more
    // clearly as "delete this image" at a glance than a generic close/dismiss cross would.
    deleteBtn.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>'
    deleteBtn.addEventListener('mousedown', (e) => {
      // Prevent this turning into a node selection/drag before the click fires.
      e.preventDefault()
      e.stopPropagation()
    })
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const pos = getPos()
      if (pos === undefined) return
      view.dispatch(view.state.tr.delete(pos, pos + node.nodeSize))
    })

    wrap.appendChild(img)
    wrap.appendChild(handle)
    wrap.appendChild(deleteBtn)

    return {
      dom: wrap,
      selectNode() { wrap.classList.add('pm-image-selected') },
      deselectNode() { wrap.classList.remove('pm-image-selected') },
      update(updatedNode) {
        if (updatedNode.type.name !== 'image') return false
        syncImgAttrs(updatedNode)
        return true
      },
    }
  }
}

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

  // Icon and label are separate children (rather than one interpolated string) now
  // that the icon is inline SVG markup rather than an emoji character — the header
  // row is already display:flex with a 0.35em gap, so they lay out identically.
  const iconEl = document.createElement('span')
  iconEl.style.display = 'inline-flex'
  iconEl.innerHTML = meta.iconSvg
  header.appendChild(iconEl)

  const label = document.createElement('span')
  label.textContent = meta.label
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

// Bullet-glyph NodeViews subscribe directly to the store (below, in the
// bullet_list branch) so a mid-session `noteBulletStyle` change repaints
// every mounted bullet marker immediately, instead of waiting for the next
// edit/note-switch to naturally rebuild them. This is a plain per-instance
// subscription writing to THIS NodeView's own marker span — not a plugin
// `view().update()` hook mutating decorated/observed document DOM, so it
// doesn't reintroduce the dispatch/updateState feedback loop blockHandles.ts's
// header comment warns about (nothing here calls view.dispatch or
// view.updateState in response to the store change).

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
      function computeSymbol(): string {
        if (bulletMarker === '-') return '–'
        const styleName = useAppStore.getState().noteBulletStyle ?? 'classic'
        const styleDef = BULLET_STYLE_DEFS[styleName] ?? BULLET_STYLE_DEFS.classic
        const depth = pos !== undefined ? bulletListDepth(view, pos) : 0
        return styleDef.symbols[Math.min(depth, styleDef.symbols.length - 1)]
      }

      const marker = document.createElement('span')
      marker.className = 'pm-bullet-marker'
      marker.contentEditable = 'false'
      marker.style.userSelect = 'none'
      marker.style.flexShrink = '0'
      marker.style.marginTop = '0'
      marker.style.lineHeight = '1'
      marker.style.fontSize = '1.35em'
      marker.textContent = computeSymbol()

      const contentDOM = document.createElement('div')
      contentDOM.className = 'pm-bullet-content'
      contentDOM.style.flex = '1'
      li.appendChild(marker)
      li.appendChild(contentDOM)

      // Only "*"/"+" bullets actually depend on noteBulletStyle (a literal "-" is always
      // the same dash glyph, checked above) — skip subscribing at all for those, since a
      // setting change can never affect their glyph.
      const unsubscribe = bulletMarker === '-' ? null : useAppStore.subscribe((state, prevState) => {
        if (state.noteBulletStyle === prevState.noteBulletStyle) return
        marker.textContent = computeSymbol()
      })

      return { dom: li, contentDOM, destroy: () => unsubscribe?.() }
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

// ─── study_trail_embed NodeView ─────────────────────────────────────────────
// A leaf card, no contentDOM (schema.ts's study_trail_embed has no `content`) — clicking it
// opens the singleton Study Trail window focused on this session (window.app.openStudyTrail
// Window), never expands inline, same "click → open elsewhere" behavior as a Strong's chip
// opening a lexicon tab. The connection/needs-input counts shown are refreshed on a short
// poll while this card is mounted (no studyTrail:newEvent push channel exists yet — see the
// plan's Phase 2 note on that) purely as a DOM-text update, deliberately NOT dispatched back
// into the document as a node-attr change: doing that on every poll tick would spam the
// editor's undo history for a value that's explicitly cached/display-only (schema.ts's own
// comment on these attrs). The node's stored attrs still update normally the next time the
// note is genuinely re-saved with fresh values from wherever the embed gets (re)inserted.
export function studyTrailEmbedNodeView(node: PMNode): NodeView {
  const dom = document.createElement('div')
  dom.className = 'pm-study-trail-embed'
  dom.contentEditable = 'false'
  dom.style.display = 'flex'
  dom.style.alignItems = 'center'
  dom.style.gap = '8px'
  dom.style.padding = '8px 12px'
  dom.style.margin = '0.6em 0'
  dom.style.border = '1px solid rgb(var(--color-surface-4))'
  dom.style.borderRadius = '10px'
  dom.style.background = 'rgb(var(--color-surface-2))'
  dom.style.cursor = 'pointer'
  dom.style.userSelect = 'none'

  const icon = document.createElement('span')
  icon.textContent = '🔀'
  icon.style.fontSize = '14px'
  dom.appendChild(icon)

  const label = document.createElement('span')
  label.style.fontSize = '0.85em'
  label.style.fontWeight = '600'
  label.style.color = 'rgb(var(--color-text-primary))'
  label.textContent = node.attrs.title || 'Study Trail'
  dom.appendChild(label)

  const stats = document.createElement('span')
  stats.style.fontSize = '0.78em'
  stats.style.color = 'rgb(var(--color-text-muted))'
  dom.appendChild(stats)

  const needsInputBadge = document.createElement('span')
  needsInputBadge.style.fontSize = '0.72em'
  needsInputBadge.style.fontWeight = '700'
  needsInputBadge.style.color = '#e08468'
  needsInputBadge.style.background = 'rgba(224,132,104,0.14)'
  needsInputBadge.style.borderRadius = '999px'
  needsInputBadge.style.padding = '1px 7px'
  needsInputBadge.style.display = 'none'
  dom.appendChild(needsInputBadge)

  function paint(connectionCount: number, needsInputCount: number) {
    stats.textContent = `${connectionCount} connection${connectionCount === 1 ? '' : 's'}`
    needsInputBadge.style.display = needsInputCount > 0 ? '' : 'none'
    needsInputBadge.textContent = `${needsInputCount} needs input`
  }
  paint(node.attrs.connectionCount, node.attrs.needsInputCount)

  const trailSessionId = node.attrs.trailSessionId
  const interval = trailSessionId ? setInterval(() => {
    window.studyTrail?.getSession(trailSessionId).then((detail) => {
      if (!detail) return
      const needsInput = detail.connections.filter((c) => c.clarityTier === 3 && !c.reasonText && !c.dismissedPromptAt).length
      paint(detail.connections.length, needsInput)
    }).catch(() => {})
  }, 5000) : null

  dom.addEventListener('mousedown', (e) => e.preventDefault())
  dom.addEventListener('click', () => {
    if (trailSessionId) window.app.openStudyTrailWindow?.(trailSessionId)
  })

  return { dom, destroy: () => { if (interval) clearInterval(interval) } }
}
