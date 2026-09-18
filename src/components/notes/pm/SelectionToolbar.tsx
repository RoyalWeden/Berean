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
import { IconButton, Button, Divider, MenuItem, TextField } from '@/components/ui'

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

  const sep = <Divider orientation="vertical" className="mx-0.5" />

  // Before the first layout measurement, render off-screen (never at a
  // guessed on-screen spot) so there's no visible flash-then-jump — the
  // useLayoutEffect above corrects this synchronously before paint.
  const style = pos
    ? { position: 'fixed' as const, left: pos.left, top: pos.top, zIndex: 'var(--z-popover)' as const }
    : { position: 'fixed' as const, left: -9999, top: -9999, zIndex: 'var(--z-popover)' as const }

  return (
    <div ref={rootRef} style={style} onMouseDown={(e) => e.preventDefault()}>
      <div className="pm-toolbar-solid material-popover relative flex items-center gap-0.5 rounded-menu px-1 py-1">
        {/* Text type */}
        <HintTooltip label="Text type" side="top">
          <Button
            variant="ghost"
            size="sm"
            icon={currentBlockTypeMeta(view).icon}
            selected={openDropdown === 'type'}
            onMouseDown={() => setOpenDropdown((v) => (v === 'type' ? 'none' : 'type'))}
            className="px-2"
          >
            <ChevronDown size={10} />
          </Button>
        </HintTooltip>

        {/* Thread — its own standalone button, not a "Text type" dropdown entry (same
            reasoning as the persistent Toolbar.tsx's identical button). */}
        <IconButton icon={ThreadIcon} label="Thread" size={24} tooltip={{ side: 'top' }} onMouseDown={() => cmds.wrapInThread()} />
        {sep}

        {/* Inline marks */}
        <IconButton icon={Bold} label="Bold" size={24} tooltip={{ shortcut: '⌘B', side: 'top' }} active={isMarkActive('strong')} onMouseDown={() => run(toggleMark(schema.marks.strong))} />
        <IconButton icon={Italic} label="Italic" size={24} tooltip={{ shortcut: '⌘I', side: 'top' }} active={isMarkActive('em')} onMouseDown={() => run(toggleMark(schema.marks.em))} />
        <IconButton icon={Underline} label="Underline" size={24} tooltip={{ shortcut: '⌘U', side: 'top' }} active={isMarkActive('underline')} onMouseDown={() => run(toggleMark(schema.marks.underline))} />
        {/* Label-only — strikethrough has no keymap.ts binding, unlike the marks around it. */}
        <IconButton icon={Strikethrough} label="Strikethrough" size={24} tooltip={{ side: 'top' }} active={isMarkActive('strike')} onMouseDown={() => run(toggleMark(schema.marks.strike))} />
        <IconButton icon={Code} label="Code" size={24} tooltip={{ shortcut: '⌘`', side: 'top' }} active={isMarkActive('code')} onMouseDown={() => run(toggleMark(schema.marks.code))} />

        {/* Highlight */}
        <IconButton
          icon={Highlighter}
          label="Highlight"
          size={24}
          tooltip={{ shortcut: '⌘⇧H', side: 'top' }}
          active={openDropdown === 'highlight' || isMarkActive('highlight')}
          onMouseDown={() => setOpenDropdown((v) => (v === 'highlight' ? 'none' : 'highlight'))}
        />

        {sep}
        <IconButton
          icon={Link2}
          label="Link"
          size={24}
          tooltip={{ side: 'top' }}
          active={openDropdown === 'link' || isMarkActive('link')}
          onMouseDown={() => { if (openDropdown === 'link') setOpenDropdown('none'); else openLinkPopover() }}
        />
        {sep}

        {/* Lists */}
        <IconButton icon={List} label="List type" size={24} tooltip={{ side: 'top' }} active={openDropdown === 'list'} onMouseDown={() => setOpenDropdown((v) => (v === 'list' ? 'none' : 'list'))} />
        <IconButton icon={Quote} label="Blockquote" size={24} tooltip={{ side: 'top' }} onMouseDown={cmds.toggleBlockquote} />
        <IconButton icon={IndentDecrease} label="Outdent" size={24} tooltip={{ shortcut: '⇧Tab', side: 'top' }} onMouseDown={cmds.outdent} />
        <IconButton icon={IndentIncrease} label="Indent" size={24} tooltip={{ shortcut: 'Tab', side: 'top' }} onMouseDown={cmds.indent} />

        {sep}
        <IconButton icon={Link2Off} label="Suppress auto-detected refs" size={24} tooltip={{ shortcut: '⌘⇧R', side: 'top' }} onMouseDown={() => run(toggleSuppressCommand)} />

        {/* ── Dropdowns: anchored popovers, layered over the toolbar rather
             than replacing its row — this is the "fluid" part: the main
             toolbar stays intact and visible while a focused set of options
             appears just below whichever button was clicked. ── */}
        {openDropdown === 'type' && (
          <div className="pm-toolbar-solid absolute top-full left-0 mt-1.5 material-popover rounded-menu p-1 flex items-center gap-0.5">
            {/* Icons + labels come from the shared block-type config rather than the
                plain-text "H1".."H6" labels this used to duplicate independently of
                Toolbar.tsx's own identical array. */}
            {TEXT_TYPE_LEVELS.map(({ level, meta }) => (
              <IconButton
                key={level}
                icon={meta.icon}
                label={meta.label}
                size={24}
                onMouseDown={() => { cmds.setHeading(level); setOpenDropdown('none') }}
              />
            ))}
            <Divider orientation="vertical" className="mx-0.5" />
            {/* Wraps the selected text's containing block(s) in a new thread — same
                editorCommands.ts wrapInThread() the persistent Toolbar's own "Thread" option
                uses. */}
            <IconButton icon={ThreadIcon} label="Thread" size={24} onMouseDown={() => { cmds.wrapInThread(); setOpenDropdown('none') }} />
          </div>
        )}

        {openDropdown === 'list' && (
          <div className="pm-toolbar-solid absolute top-full left-1/2 -translate-x-1/2 mt-1.5 material-popover rounded-menu p-1 flex items-center gap-0.5">
            <IconButton icon={List} label="Bullet list" size={24} onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} />
            <Button variant="ghost" size="sm" title="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} className="!w-6 !h-6 !p-0 font-mono">–</Button>
            <IconButton icon={ListOrdered} label="Numbered list" size={24} onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} />
            <IconButton icon={CheckSquare} label="Task list" size={24} onMouseDown={toggleTaskList} />
          </div>
        )}

        {openDropdown === 'highlight' && (
          <div className="pm-toolbar-solid absolute top-full left-1/2 -translate-x-1/2 mt-1.5 material-popover rounded-menu p-2 w-[168px]">
            <div className="grid grid-cols-5 gap-1.5 mb-1.5">
              {HIGHLIGHT_COLOR_IDS.map((id) => (
                <Button
                  key={id}
                  variant="ghost"
                  title={HIGHLIGHT_LABELS[id]}
                  aria-label={HIGHLIGHT_LABELS[id]}
                  onMouseDown={() => applyHighlight(id)}
                  className="!w-6 !h-6 !p-0 rounded-full hover:scale-110 transition-transform border border-white/20 flex-shrink-0"
                  style={{ backgroundColor: highlightDotColor(id) }}
                />
              ))}
            </div>
            <MenuItem icon={Ban} label="Remove highlight" onMouseDown={removeHighlight} />
          </div>
        )}

        {openDropdown === 'link' && (
          <div
            className="pm-toolbar-solid absolute top-full left-1/2 -translate-x-1/2 mt-1.5 material-popover rounded-menu p-1.5 flex items-center gap-1 w-[240px]"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <TextField
              ref={linkInputRef}
              size="sm"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitLink()
                else if (e.key === 'Escape') setOpenDropdown('none')
              }}
              placeholder="https://…"
              wrapperClassName="flex-1 min-w-0"
            />
            <Button variant="ghost" size="sm" onMouseDown={submitLink}>Apply</Button>
          </div>
        )}
      </div>
    </div>
  )
}
