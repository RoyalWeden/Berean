import { useState, useRef, useEffect, useLayoutEffect } from 'react'
import type { EditorView } from 'prosemirror-view'
import { toggleMark } from 'prosemirror-commands'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2, Link2Off,
  List, ListOrdered, CheckSquare, Quote, IndentIncrease, IndentDecrease, ChevronDown, Ban,
} from 'lucide-react'
import { bereanSchema as schema } from './schema'
import { BLOCK_TYPE_META, TEXT_TYPE_LEVELS, headingMeta, type BlockTypeMeta } from '@/lib/blockTypeIcons'
// Styled-keycap hover hints, same as the persistent Toolbar and the rest of the app —
// replacing native `title="Bold (⌘B)"` attributes (see Toolbar.tsx's import comment).
import { HintTooltip } from '@/components/shell/HintTooltip'

const ThreadIcon = BLOCK_TYPE_META.thread.icon

// The "Text type" dropdown trigger's icon — same "reflect the cursor's actual containing
// block, not a hardcoded paragraph glyph" fix as Toolbar.tsx's own currentBlockTypeMeta (kept
// as a separate local copy rather than a shared import, matching how BLOCK_TYPE_META lookups
// are already duplicated per-file here rather than centralized). This component only renders
// while there's a live non-empty selection (selectionToolbarPlugin.ts only calls its onChange
// with a non-null state then), so — unlike the persistent Toolbar — this one reliably
// re-renders on every relevant selection change already.
function currentBlockTypeMeta(view: EditorView): BlockTypeMeta {
  const $from = view.state.selection.$from
  for (let d = $from.depth; d >= 0; d--) {
    const node = $from.node(d)
    if (node.type.name === 'thread') return BLOCK_TYPE_META.thread
    if (node.type.name === 'heading') return headingMeta(node.attrs.level as number)
    if (node.type.name === 'callout') {
      const key = `callout-${(node.attrs.calloutType as string || 'NOTE').toLowerCase()}`
      return BLOCK_TYPE_META[key] ?? BLOCK_TYPE_META['callout-note']
    }
  }
  return BLOCK_TYPE_META.text
}
import { toggleSuppressCommand } from './suppressRanges'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import type { SelectionToolbarState } from './selectionToolbarPlugin'
import { createEditorCommands } from './editorCommands'

// The floating "select text to format" toolbar — a from-scratch ProseMirror
// equivalent of NoteEditor.tsx's selToolbar (NoteEditor.tsx:4081-4300+).
// Redesigned around small anchored dropdown popovers (text type, highlight,
// list type) that layer OVER the toolbar without replacing its row — the
// original CM6 version's submenus swapped out the entire button row, which
// feels jarring/modal rather than fluid. Uses `.pm-toolbar-solid`
// (pmEditor.css) rather than the app's `.glass-panel` frosted-chrome
// treatment — an earlier version used `.glass-panel` (72% opacity + blur)
// with a Tailwind arbitrary-value `!bg-[...]/95` override attempting to
// make it more opaque, but that combination (important-modifier +
// arbitrary color + opacity fraction) didn't reliably generate/win against
// glass-panel's own background, leaving the toolbar and its dropdowns
// nearly transparent — the opposite of the intended fix.
// `.pm-toolbar-solid` is a plain, guaranteed-to-apply CSS rule instead.
export default function SelectionToolbar({
  view, toolbarState,
}: { view: EditorView; toolbarState: SelectionToolbarState }) {
  const [openDropdown, setOpenDropdown] = useState<'none' | 'type' | 'list' | 'highlight' | 'link'>('none')
  const rootRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  // Selection as it stood when the link popover opened — focusing the URL input
  // blurs the editor and can collapse the live selection before submit. See
  // editorCommands.ts applyLink.
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const [pos, setPos] = useState<{ left: number; top: number; flipped: boolean } | null>(null)

  // Close any open dropdown when the selection moves to a new spot.
  useEffect(() => { setOpenDropdown('none') }, [toolbarState])

  // Clamp the toolbar within the viewport instead of letting it render
  // off-screen or under other app chrome (the TopBar, the sidebar) — a real
  // bug: a selection near the top of the note (a very common place to
  // select text) put the toolbar's `top - 8, translateY(-100%)` position
  // ABOVE the visible window entirely, or with its left edge under the
  // sidebar, making its buttons genuinely unclickable despite rendering
  // "on top" by z-index (there's simply nothing there to click — the
  // toolbar was off-screen or behind chrome with a higher effective
  // stacking/coverage). Flips to render BELOW the selection when there
  // isn't enough room above, and clamps left/right to stay fully on
  // screen. Measured via the actual rendered element (post-layout), not a
  // guessed height, so this stays correct if the toolbar's content/size
  // changes (e.g. a dropdown open).
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const { left, top, right } = toolbarState.coords
    const centerX = (left + right) / 2
    const rect = el.getBoundingClientRect()
    const margin = 8
    const topBarSafeMargin = 44 // keep clear of the app's TopBar

    let clampedLeft = centerX - rect.width / 2
    clampedLeft = Math.max(margin, Math.min(clampedLeft, window.innerWidth - rect.width - margin))

    const wouldBeTop = top - 8 - rect.height
    const flipped = wouldBeTop < topBarSafeMargin
    const clampedTop = flipped ? top + 22 : wouldBeTop

    setPos({ left: clampedLeft, top: clampedTop, flipped })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolbarState, openDropdown])

  // Dismiss on outside click.
  useEffect(() => {
    if (openDropdown === 'none') return
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenDropdown('none')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDropdown])

  // Autofocus the URL field the moment the link popover opens — mirrors what
  // window.prompt() used to give for free.
  useEffect(() => {
    if (openDropdown === 'link') linkInputRef.current?.focus()
  }, [openDropdown])


  // All command logic lives in editorCommands.ts, shared with the persistent Toolbar.tsx —
  // this component only owns its own dropdown-open UI state and closes it after a command.
  const cmds = createEditorCommands(view)
  const { isMarkActive, run } = cmds

  function applyHighlight(color: string) {
    cmds.applyHighlight(color)
    setOpenDropdown('none')
  }

  function removeHighlight() {
    cmds.removeHighlight()
    setOpenDropdown('none')
  }

  // window.prompt() throws in Electron's renderer ("prompt() is and will not be
  // supported"), so the URL is collected via the small popover below instead —
  // opening it seeds the input with any existing link href on the selection.
  function openLinkPopover() {
    const { from, to } = view.state.selection
    linkRangeRef.current = { from, to }
    setLinkUrl(cmds.currentLinkHref())
    setOpenDropdown('link')
  }

  function submitLink() {
    const url = linkUrl.trim()
    setOpenDropdown('none')
    if (url) cmds.applyLink(url, linkRangeRef.current ?? undefined)
  }

  function toggleTaskList() {
    cmds.toggleTaskList()
    setOpenDropdown('none')
  }

  const iconBtn = 'p-1.5 cursor-pointer transition-colors rounded-md flex-shrink-0'
  // Bumped well past the original 18% — too transparent to read clearly
  // against the toolbar's own already-translucent glass-panel background.
  const active = 'bg-[rgb(var(--color-accent))/35] text-[rgb(var(--color-accent))]'
  const inactive = 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
  const cls = (isActive: boolean) => `${iconBtn} ${isActive ? active : inactive}`
  const sep = <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] mx-0.5 flex-shrink-0" />

  // Before the first layout measurement, render off-screen (never at a
  // guessed on-screen spot) so there's no visible flash-then-jump — the
  // useLayoutEffect above corrects this synchronously before paint.
  const style = pos
    ? { position: 'fixed' as const, left: pos.left, top: pos.top, zIndex: 60 }
    : { position: 'fixed' as const, left: -9999, top: -9999, zIndex: 60 }

  return (
    <div ref={rootRef} style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="pm-toolbar-solid relative flex items-center gap-0.5 rounded-xl px-1 py-1 shadow-2xl">
        {/* Text type */}
        <HintTooltip label="Text type" side="top">
          <button
            onMouseDown={() => setOpenDropdown((v) => (v === 'type' ? 'none' : 'type'))}
            className={`${iconBtn} ${openDropdown === 'type' ? active : inactive} flex items-center gap-0.5 px-2`}
          >
            {(() => { const Icon = currentBlockTypeMeta(view).icon; return <Icon size={14} /> })()}
            <ChevronDown size={10} />
          </button>
        </HintTooltip>

        {/* Thread — its own standalone button, not a "Text type" dropdown entry (same
            reasoning as the persistent Toolbar.tsx's identical button). */}
        <HintTooltip label="Thread" side="top">
          <button onMouseDown={() => cmds.wrapInThread()} className={cls(false)}><ThreadIcon size={14} /></button>
        </HintTooltip>
        {sep}

        {/* Inline marks */}
        <HintTooltip label="Bold" shortcut="⌘B" side="top">
          <button onMouseDown={() => run(toggleMark(schema.marks.strong))} className={cls(isMarkActive('strong'))}><Bold size={14} /></button>
        </HintTooltip>
        <HintTooltip label="Italic" shortcut="⌘I" side="top">
          <button onMouseDown={() => run(toggleMark(schema.marks.em))} className={cls(isMarkActive('em'))}><Italic size={14} /></button>
        </HintTooltip>
        <HintTooltip label="Underline" shortcut="⌘U" side="top">
          <button onMouseDown={() => run(toggleMark(schema.marks.underline))} className={cls(isMarkActive('underline'))}><Underline size={14} /></button>
        </HintTooltip>
        {/* Label-only — strikethrough has no keymap.ts binding, unlike the marks around it. */}
        <HintTooltip label="Strikethrough" side="top">
          <button onMouseDown={() => run(toggleMark(schema.marks.strike))} className={cls(isMarkActive('strike'))}><Strikethrough size={14} /></button>
        </HintTooltip>
        <HintTooltip label="Code" shortcut="⌘`" side="top">
          <button onMouseDown={() => run(toggleMark(schema.marks.code))} className={cls(isMarkActive('code'))}><Code size={14} /></button>
        </HintTooltip>

        {/* Highlight */}
        <HintTooltip label="Highlight" shortcut="⌘⇧H" side="top">
          <button
            onMouseDown={() => setOpenDropdown((v) => (v === 'highlight' ? 'none' : 'highlight'))}
            className={cls(openDropdown === 'highlight' || isMarkActive('highlight'))}
          >
            <Highlighter size={14} />
          </button>
        </HintTooltip>

        {sep}
        <HintTooltip label="Link" side="top">
          <button
            onMouseDown={() => { if (openDropdown === 'link') setOpenDropdown('none'); else openLinkPopover() }}
            className={cls(openDropdown === 'link' || isMarkActive('link'))}
          >
            <Link2 size={14} />
          </button>
        </HintTooltip>
        {sep}

        {/* Lists */}
        <HintTooltip label="List type" side="top">
          <button
            onMouseDown={() => setOpenDropdown((v) => (v === 'list' ? 'none' : 'list'))}
            className={`${iconBtn} ${openDropdown === 'list' ? active : inactive}`}
          >
            <List size={14} />
          </button>
        </HintTooltip>
        <HintTooltip label="Blockquote" side="top">
          <button
            onMouseDown={cmds.toggleBlockquote}
            className={cls(false)}
          >
            <Quote size={14} />
          </button>
        </HintTooltip>
        <HintTooltip label="Outdent" shortcut="⇧Tab" side="top">
          <button onMouseDown={cmds.outdent} className={cls(false)}><IndentDecrease size={14} /></button>
        </HintTooltip>
        <HintTooltip label="Indent" shortcut="Tab" side="top">
          <button
            onMouseDown={cmds.indent}
            className={cls(false)}
          >
            <IndentIncrease size={14} />
          </button>
        </HintTooltip>

        {sep}
        <HintTooltip label="Suppress auto-detected refs" shortcut="⌘⇧R" side="top">
          <button onMouseDown={() => run(toggleSuppressCommand)} className={cls(false)}><Link2Off size={14} /></button>
        </HintTooltip>

        {/* ── Dropdowns: anchored popovers, layered over the toolbar rather
             than replacing its row — this is the "fluid" part: the main
             toolbar stays intact and visible while a focused set of options
             appears just below whichever button was clicked. ── */}
        {openDropdown === 'type' && (
          <div className="absolute top-full left-0 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
            {/* Icons + labels come from the shared block-type config rather than the
                plain-text "H1".."H6" labels this used to duplicate independently of
                Toolbar.tsx's own identical array. */}
            {TEXT_TYPE_LEVELS.map(({ level, meta }) => {
              const Icon = meta.icon
              return (
                <button
                  key={level}
                  title={meta.label}
                  onMouseDown={() => { cmds.setHeading(level); setOpenDropdown('none') }}
                  className={`${iconBtn} ${inactive} px-2 py-1`}
                >
                  <Icon size={14} />
                </button>
              )
            })}
            <div className="w-px h-4 mx-0.5 bg-[rgb(var(--color-surface-4))]" />
            {/* Wraps the selected text's containing block(s) in a new thread — same
                editorCommands.ts wrapInThread() the persistent Toolbar's own "Thread" option
                uses. */}
            <button
              title="Thread"
              onMouseDown={() => { cmds.wrapInThread(); setOpenDropdown('none') }}
              className={`${iconBtn} ${inactive} px-2 py-1`}
            >
              <ThreadIcon size={14} />
            </button>
          </div>
        )}

        {openDropdown === 'list' && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
            <button title="Bullet list" onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><List size={14} /></button>
            <button title="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive} text-sm font-mono`}>–</button>
            <button title="Numbered list" onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><ListOrdered size={14} /></button>
            <button title="Task list" onMouseDown={toggleTaskList} className={`${iconBtn} ${inactive}`}><CheckSquare size={14} /></button>
          </div>
        )}

        {openDropdown === 'highlight' && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-2 w-[168px]">
            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
              {HIGHLIGHT_COLOR_IDS.map((id) => (
                <button
                  key={id}
                  title={HIGHLIGHT_LABELS[id]}
                  onMouseDown={() => applyHighlight(id)}
                  className="w-6 h-6 rounded-full cursor-pointer hover:scale-110 transition-transform border border-white/20 flex-shrink-0"
                  style={{ backgroundColor: highlightDotColor(id) }}
                />
              ))}
            </div>
            <button
              onMouseDown={removeHighlight}
              className="w-full flex items-center justify-center gap-1.5 text-[11px] py-1 rounded-md cursor-pointer text-[rgb(var(--color-text-muted))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))] transition-colors"
            >
              <Ban size={11} /> Remove highlight
            </button>
          </div>
        )}

        {openDropdown === 'link' && (
          <div
            className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 pm-toolbar-solid rounded-lg shadow-2xl p-1.5 flex items-center gap-1 w-[240px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              ref={linkInputRef}
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitLink()
                else if (e.key === 'Escape') setOpenDropdown('none')
              }}
              placeholder="https://…"
              className="flex-1 min-w-0 text-xs px-2 py-1 rounded-md bg-[rgb(var(--color-surface-1))] border border-[rgb(var(--color-surface-4))] text-[rgb(var(--color-text-primary))] placeholder:text-[rgb(var(--color-text-muted))] focus:outline-none focus:border-[rgb(var(--color-accent))]"
            />
            <button
              onMouseDown={submitLink}
              className={`${iconBtn} ${inactive} text-xs px-2 py-1`}
            >
              Apply
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
