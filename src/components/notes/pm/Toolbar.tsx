import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import type { EditorView } from 'prosemirror-view'
import { Fragment } from 'prosemirror-model'
import { deleteTable } from 'prosemirror-tables'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2,
  List, ListOrdered, CheckSquare, Quote, IndentIncrease, IndentDecrease, ChevronDown, Ban,
  Table2, Minus, BookOpen, Image as ImageIcon, Heading1, Heading2, Heading3, Rows3, Columns3, Trash2,
  Square, X, Maximize2, Focus as FocusIcon,
} from 'lucide-react'
import { toggleMark } from 'prosemirror-commands'
import { bereanSchema as schema } from './schema'
import { createEditorCommands } from './editorCommands'
import { insertBlockNode, buildEmptyTable } from './slashCommands'
import { pickAndInsertImage } from './imageInsert'
import { VersePickerPopup } from './AutocompletePopups'
import { getTranslationForBook, bookChapterVerseLabel } from '@/lib/parseRef'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { addRowAfter, deleteRow, deleteColumn } from './tablePlugins'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import { useAppStore } from '@/store'
import { useProximityReveal } from '@/hooks/useProximityReveal'
import { BLOCK_TYPE_META, TEXT_TYPE_LEVELS, headingMeta, type BlockTypeMeta } from '@/lib/blockTypeIcons'
// Same styled-keycap hover hint the rest of the app uses (ShellHeader, Ribbon, Settings…)
// — this toolbar was one of the last places still on plain native `title="Bold (⌘B)"`
// tooltips, which render in the OS's own delayed grey box with the shortcut as run-together
// parenthesised text instead of real keycaps.
import { HintTooltip } from '@/components/shell/HintTooltip'
import { IconButton, Button, Divider, MenuItem, MenuSeparator, TextField } from '@/components/ui'

// The code-block button takes its glyph from the shared block-type config rather than picking
// one locally (see blockTypeIcons.ts). The "Text type" dropdown TRIGGER used to do the same
// (a hardcoded PilcrowIcon) — see currentBlockTypeMeta below for why that's now dynamic instead.
const CodeBlockIcon = BLOCK_TYPE_META.code.icon
const ThreadIcon = BLOCK_TYPE_META.thread.icon

// Reported: "I still don't see the thread icon in the top formatting bar" — the "Text type"
// trigger button's icon used to be hardcoded to the plain-text glyph regardless of where the
// cursor actually sat (true for every block type, not just threads — headings/callouts never
// updated it either). Walks from the cursor's innermost containing node outward and returns the
// glyph for the first one that actually has a distinct identity worth showing; falls through to
// plain "Text" for a bare paragraph, list item, etc. Recomputed fresh on every Toolbar render —
// good enough in practice since a meaningful selection/doc change already re-renders this
// component via the sibling selectionToolbarPlugin/tableStatusPlugin state (see their own
// `set...` calls elsewhere in this file's effects), the same reactivity every other "active"
// button state here (Bold, Italic, …) already relies on.
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

// The word-count / reading-time footer + its "Saved" autosave confirmation now live in their
// own component (WordCountFooter.tsx) so they render independently of this formatting toolbar
// — idiom notes hide the toolbar but still want the count. SAVE_FLASH_HOLD_MS et al. moved
// there too.

type DropdownKind = 'type' | 'list' | 'highlight' | 'table' | 'link' | 'verse'

// Persistent, always-visible formatting toolbar docked above the note editor —
// complements (doesn't replace) SelectionToolbar.tsx's selection-triggered bubble menu.
// The bubble covers "I selected this text, format it"; this bar covers "I want to change
// formatting without first selecting text" (starting a new heading, inserting a table,
// toggling Focus mode). Shares all command logic with the bubble via editorCommands.ts —
// this file owns only its own dropdown-open UI state, same split as SelectionToolbar.tsx.
//
// Dropdowns are portaled to document.body with a fixed position computed from the trigger
// button's own rect, NOT position:absolute inside this row — the row itself needs
// overflow-x-auto so a narrow panel doesn't force its buttons off-screen, but CSS couples
// overflow-x:auto to overflow-y:auto/hidden on the same box, which silently clipped any
// absolutely-positioned dropdown child that extended below the row (the dropdowns rendered
// into the DOM but were invisible — looked exactly like "clicking the button does nothing").
export default function Toolbar({
  view, tabId, inTable,
}: { view: EditorView | null; tabId?: string; inTable?: boolean }) {
  const [openDropdown, setOpenDropdown] = useState<DropdownKind | 'none'>('none')
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null)
  const [hovering, setHovering] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
  // Selection as it stood when the link popover opened — focusing the URL input
  // blurs the editor and can collapse the live selection before submit. See
  // editorCommands.ts applyLink.
  const linkRangeRef = useRef<{ from: number; to: number } | null>(null)
  const [linkUrl, setLinkUrl] = useState('')
  const noteFocusModeTabId = useAppStore((s) => s.noteFocusModeTabId)
  const focusMode = tabId != null && noteFocusModeTabId === tabId
  const toggleNoteFocusMode = useAppStore((s) => s.toggleNoteFocusMode)
  const toggleFocusMode = () => { if (tabId != null) toggleNoteFocusMode(tabId) }
  // In Focus mode the capsule fades to fully hidden and reveals only when the
  // cursor comes near its own docked position. Outside Focus mode `revealed`
  // stays true and the bar is just dimmed at rest (via CSS :hover below), not
  // hidden. TopBar itself has no reveal mechanism at all in Focus mode (per the
  // user's request, only this floating bar should show) — its own window
  // min/max/close controls are rendered inside this capsule instead, below.
  const { ref: rootRef, revealed } = useProximityReveal<HTMLDivElement>(focusMode)

  // Native macOS traffic lights (or the Windows frameless title bar's own controls)
  // are OS/window-frame chrome, not DOM content — hiding TopBar can't hide them.
  // In Focus mode, hide them and show this bar's own matching-style close/
  // minimize/maximize buttons instead; restore them on exiting Focus mode or on
  // unmount (in case the toolbar goes away — e.g. switching to 'view' mode —
  // while Focus mode is still on, so they're never left hidden with no way back).
  useEffect(() => {
    window.windowControls?.setButtonsVisible?.(!focusMode)
    return () => { window.windowControls?.setButtonsVisible?.(true) }
  }, [focusMode])

  const [isMaximized, setIsMaximized] = useState(false)
  useEffect(() => {
    window.windowControls?.isMaximized().then(setIsMaximized).catch(() => {})
    window.windowControls?.onMaximizeChange(setIsMaximized)
  }, [])
  const isMac = window.__berean_platform === 'darwin'

  function openDropdownAt(kind: DropdownKind, e: React.MouseEvent<HTMLButtonElement>) {
    if (openDropdown === kind) { setOpenDropdown('none'); return }
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setOpenDropdown(kind)
  }

  useEffect(() => {
    if (openDropdown === 'none') return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (rootRef.current?.contains(t)) return
      if (dropdownRef.current?.contains(t)) return
      setOpenDropdown('none')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openDropdown])

  useEffect(() => {
    if (!inTable && openDropdown === 'table') setOpenDropdown('none')
  }, [inTable, openDropdown])

  // Autofocus the URL field the moment the link popover opens — mirrors what
  // window.prompt() used to give for free (see editorCommands.ts's applyLink
  // for why prompt() itself can't be used here — Electron's renderer throws).
  useEffect(() => {
    if (openDropdown === 'link') linkInputRef.current?.focus()
  }, [openDropdown])

  if (!view) return null
  const editorView = view // narrowed local — TS doesn't carry the null-check narrowing of a
  // parameter into nested function declarations below (insertVerseStarter), so this local
  // const stands in for `view` wherever it's referenced from inside one of those.
  const cmds = createEditorCommands(editorView)
  const { isMarkActive, run } = cmds

  function applyHighlight(color: string) { cmds.applyHighlight(color); setOpenDropdown('none') }
  function removeHighlight() { cmds.removeHighlight(); setOpenDropdown('none') }
  function toggleTaskList() { cmds.toggleTaskList(); setOpenDropdown('none') }

  function openLinkDropdownAt(e: React.MouseEvent<HTMLButtonElement>) {
    if (openDropdown === 'link') { setOpenDropdown('none'); return }
    const { from, to } = editorView.state.selection
    linkRangeRef.current = { from, to }
    setLinkUrl(cmds.currentLinkHref())
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setOpenDropdown('link')
  }

  function submitLink() {
    const url = linkUrl.trim()
    setOpenDropdown('none')
    if (url) cmds.applyLink(url, linkRangeRef.current ?? undefined)
  }
  // Verse blocks are plain paragraph text auto-detected by blockDecorations.ts once it
  // matches a real verse in the DB (see slashCommands.ts's startVerseBlock for the full
  // reasoning). This button used to be unable to insert a finished block itself, for lack
  // of any book/chapter/verse picker UI — it inserted literal placeholder text
  // ("Book chapter:verse") selected, relying entirely on the user typing over it and the
  // verse-suggest autocomplete catching whatever they typed. VersePickerPopup
  // (AutocompletePopups.tsx) is that picker; this now fetches the real verse and inserts a
  // finished two-paragraph block (reference line + text) directly, same shape
  // NoteEditorPM.tsx's insertVerseBlock already produces for the autocomplete-accept path.
  async function insertVerseFromPicker(bookId: string, chapter: number, verse: number) {
    setOpenDropdown('none')
    if (!useAppStore.getState().noteScriptureBlock) useAppStore.getState().setNoteScriptureBlock(true)
    const textId = getTranslationForBook(bookId) ?? 'kjva'
    const v = await window.bible.queryVerse(bookId, chapter, verse, textId).catch(() => null)
    if (!v?.text) { editorView.focus(); return }
    const s = useAppStore.getState()
    const vText = buildVerseDisplayText(v.text, v.text_tagged ?? null, textId, s.wordReplacerEnabled, s.wordReplacerRules)
    const label = bookChapterVerseLabel(bookId, chapter, verse)
    const { from } = editorView.state.selection
    const fragment = Fragment.fromArray([
      schema.nodes.paragraph.create(null, schema.text(label)),
      schema.nodes.paragraph.create(null, schema.text(`${verse} ${vText}`)),
    ])
    editorView.dispatch(editorView.state.tr.insert(from, fragment).scrollIntoView())
    editorView.focus()
  }

  // Kept for the two controls below that can't be plain IconButtons: the dash-list glyph
  // (a text character, not a lucide icon) and the Focus-mode toggle (a `motion.button` with
  // its own whileHover/whileTap spring, which IconButton's own button element can't host).
  const iconBtn = 'p-1.5 cursor-pointer transition-colors rounded-control flex-shrink-0'
  const active = 'bg-accent-muted text-accent'
  const inactive = 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
  const cls = (isActive: boolean) => `${iconBtn} ${isActive ? active : inactive}`
  const sep = <Divider orientation="vertical" className="mx-0.5" />

  // Any dropdown open (portaled to document.body) counts as "in use" even if the
  // cursor has moved off the capsule itself to reach the dropdown — otherwise the
  // capsule would dim/fade out from under an open dropdown mid-interaction.
  const inUse = hovering || openDropdown !== 'none'
  const opacityCls = focusMode
    ? (revealed || inUse ? 'opacity-100' : 'opacity-0 pointer-events-none')
    : (inUse ? 'opacity-100' : 'opacity-65')

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`
        absolute top-2 left-1/2 -translate-x-1/2 z-raised max-w-[calc(100%-1.5rem)]
        flex items-center gap-0.5 px-2 py-1 rounded-control
        material-control
        flex-shrink-0 overflow-x-auto overflow-y-hidden transition-opacity duration-200 ${opacityCls}
      `}
    >
      {/* Focus mode hides the native traffic lights (see the `setButtonsVisible` effect
          above — they're window-frame chrome, not DOM, and can't just be relocated) and
          replaces them with real close/minimize/maximize buttons on the LEFT of this bar,
          styled like actual macOS traffic lights (not the toolbar's own icon-button style)
          since that's the convention this is standing in for. */}
      {focusMode && isMac && (
        <>
          {/* `group` lives on this wrapper (not the individual buttons) so hovering
              ANY one of the three dots reveals all three glyphs at once, matching
              real macOS traffic-light behavior. */}
          <div className="group flex items-center gap-2.5 mr-1 ml-0.5 flex-shrink-0">
            <IconButton
              icon={X}
              label="Close"
              tooltip={false}
              size={20}
              strokeWidth={3.5}
              onMouseDown={() => window.windowControls?.close()}
              className="!w-3 !h-3 rounded-full bg-[#FF5F57] hover:brightness-90 active:brightness-75 transition-[filter]"
              iconClassName="!w-[7px] !h-[7px] opacity-0 group-hover:opacity-100 text-[#4d0000]/70"
            />
            <IconButton
              icon={Minus}
              label="Minimize"
              tooltip={false}
              size={20}
              strokeWidth={3.5}
              onMouseDown={() => window.windowControls?.minimize()}
              className="!w-3 !h-3 rounded-full bg-[#FFBD2E] hover:brightness-90 active:brightness-75 transition-[filter]"
              iconClassName="!w-2 !h-2 opacity-0 group-hover:opacity-100 text-[#5a3d00]/70"
            />
            <IconButton
              icon={Maximize2}
              label={isMaximized ? 'Restore' : 'Maximize'}
              tooltip={false}
              size={20}
              strokeWidth={3.5}
              onMouseDown={() => window.windowControls?.maximize()}
              className="!w-3 !h-3 rounded-full bg-[#28C840] hover:brightness-90 active:brightness-75 transition-[filter]"
              iconClassName="!w-1.5 !h-1.5 opacity-0 group-hover:opacity-100 text-[#003d0a]/70"
            />
          </div>
          {sep}
        </>
      )}

      {/* Text type */}
      <HintTooltip label="Text type">
        <Button
          variant="ghost"
          size="sm"
          icon={currentBlockTypeMeta(editorView).icon}
          selected={openDropdown === 'type'}
          onMouseDown={(e) => openDropdownAt('type', e)}
          className="px-2"
        >
          <ChevronDown size={10} />
        </Button>
      </HintTooltip>

      {/* Thread — its own standalone button, not a "Text type" dropdown entry: a thread isn't
          a text-type variant the way a heading level is (it's a whole collapsible container
          with entries of its own), so it reads better as a distinct insert action, the same
          way Table/Image/Divider each get their own button below rather than living inside
          that dropdown. */}
      <IconButton icon={ThreadIcon} label="Thread" size={24} onMouseDown={() => cmds.wrapInThread()} />
      {sep}

      <IconButton icon={Bold} label="Bold" tooltip={{ shortcut: '⌘B' }} size={24} active={isMarkActive('strong')} onMouseDown={() => run(toggleMark(schema.marks.strong))} />
      <IconButton icon={Italic} label="Italic" tooltip={{ shortcut: '⌘I' }} size={24} active={isMarkActive('em')} onMouseDown={() => run(toggleMark(schema.marks.em))} />
      <IconButton icon={Underline} label="Underline" tooltip={{ shortcut: '⌘U' }} size={24} active={isMarkActive('underline')} onMouseDown={() => run(toggleMark(schema.marks.underline))} />
      {/* No shortcut — strikethrough has no binding in keymap.ts, unlike the four marks
          around it, so it gets a label-only hint rather than an invented combo. */}
      <IconButton icon={Strikethrough} label="Strikethrough" size={24} active={isMarkActive('strike')} onMouseDown={() => run(toggleMark(schema.marks.strike))} />
      <IconButton icon={Code} label="Code" tooltip={{ shortcut: '⌘`' }} size={24} active={isMarkActive('code')} onMouseDown={() => run(toggleMark(schema.marks.code))} />

      <IconButton
        icon={Highlighter}
        label="Highlight"
        tooltip={{ shortcut: '⌘⇧H' }}
        size={24}
        active={openDropdown === 'highlight' || isMarkActive('highlight')}
        onMouseDown={(e) => openDropdownAt('highlight', e)}
      />

      {sep}
      <IconButton
        icon={Link2}
        label="Link"
        size={24}
        active={openDropdown === 'link' || isMarkActive('link')}
        onMouseDown={openLinkDropdownAt}
      />
      {sep}

      <IconButton icon={List} label="List type" size={24} active={openDropdown === 'list'} onMouseDown={(e) => openDropdownAt('list', e)} />
      <IconButton icon={Quote} label="Blockquote" size={24} onMouseDown={cmds.toggleBlockquote} />
      {/* Code blocks had no button on either toolbar — the only way to make one was the
          /code slash command, which isn't discoverable from the toolbar the rest of the
          block types live on. */}
      <IconButton icon={CodeBlockIcon} label="Code block" size={24} onMouseDown={cmds.toggleCodeBlock} />
      <IconButton icon={IndentDecrease} label="Outdent" tooltip={{ shortcut: '⇧Tab' }} size={24} onMouseDown={cmds.outdent} />
      <IconButton icon={IndentIncrease} label="Indent" tooltip={{ shortcut: 'Tab' }} size={24} onMouseDown={cmds.indent} />

      {sep}
      {/* Insert table: reuses insertBlockNode (slashCommands.ts) rather than the raw
          `replaceSelectionWith` this used before — replaceSelectionWith doesn't split the
          enclosing paragraph the way a block-level table needs, so inserting mid-paragraph
          silently produced a malformed/uneditable result. insertBlockNode already handles
          this correctly (same helper the working /table slash command uses). */}
      <IconButton
        icon={Table2}
        label="Table"
        size={24}
        onMouseDown={() => {
          const { from, to } = editorView.state.selection
          insertBlockNode(editorView, from, to, buildEmptyTable())
        }}
      />
      {/* Table row/column management — only shown with the cursor inside an existing table;
          addRowAfter/deleteRow/deleteColumn/deleteTable are all real no-ops outside one, but
          a button doing nothing reads as broken, so it's hidden rather than left enabled. */}
      {inTable && (
        <IconButton icon={Rows3} label="Table row/column" size={24} active={openDropdown === 'table'} onMouseDown={(e) => openDropdownAt('table', e)} />
      )}
      <IconButton
        icon={Minus}
        label="Divider"
        size={24}
        onMouseDown={() => {
          const { from, to } = editorView.state.selection
          insertBlockNode(editorView, from, to, schema.nodes.horizontal_rule.create())
        }}
      />
      {/* Verse blocks are plain paragraph text auto-detected by blockDecorations.ts, not a
          node this toolbar inserts directly (see slashCommands.ts's startVerseBlock — same
          reasoning) — this button just makes sure the detection setting is on and focuses
          the editor so the user can type a reference. */}
      <IconButton icon={BookOpen} label="Insert a scripture verse" size={24} active={openDropdown === 'verse'} onMouseDown={(e) => openDropdownAt('verse', e)} />
      <IconButton icon={ImageIcon} label="Insert image" size={24} onMouseDown={() => pickAndInsertImage(editorView)} />

      {sep}
      {/* `isolate` + `willChange` give this button its own compositing layer —
          without it, animating `rotate` on a child of the capsule's own
          `backdrop-blur-md` background triggers a Chromium repaint glitch where
          a stray solid-color box flashes at the blurred container's corner
          during the transform. */}
      <HintTooltip label={focusMode ? 'Exit Focus mode' : 'Focus mode — hide sidebar and chrome while writing'}>
        <motion.button
          onMouseDown={() => toggleFocusMode()}
          whileHover={{ rotate: 90, scale: 1.12 }}
          whileTap={{ scale: 0.8, rotate: 90 }}
          transition={{ type: 'spring', stiffness: 400, damping: 15 }}
          className={`${cls(focusMode)} isolate`}
          style={{ willChange: 'transform' }}
        >
          <FocusIcon size={14} />
        </motion.button>
      </HintTooltip>

      {/* Windows: standard convention is minimize/maximize/close on the RIGHT, styled
          like the frameless title bar's own WindowControls.tsx (Fluent-ish hover, red
          close) rather than the Mac traffic-light treatment above. */}
      {focusMode && !isMac && (
        <>
          {sep}
          <IconButton icon={Minus} label="Minimize" size={24} onMouseDown={() => window.windowControls?.minimize()} />
          <IconButton icon={Square} label={isMaximized ? 'Restore' : 'Maximize'} size={24} onMouseDown={() => window.windowControls?.maximize()} />
          <IconButton icon={X} label="Close" size={24} danger onMouseDown={() => window.windowControls?.close()} />
        </>
      )}

      {/* ── Dropdowns — portaled, see the file-level comment above for why ── */}
      {openDropdown !== 'none' && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: dropdownPos.left, top: dropdownPos.top, zIndex: 'var(--z-popover)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {openDropdown === 'type' && (
            <div className="pm-toolbar-solid material-popover rounded-menu p-1 flex items-center gap-0.5">
              {/* Icons + labels from the shared block-type config (src/lib/blockTypeIcons.ts)
                  — these were plain-text "H1".."H6"/"¶" labels, a third icon vocabulary on
                  top of the block menu's and slash menu's Lucide glyphs for the same levels. */}
              {TEXT_TYPE_LEVELS.map(({ level, meta }) => (
                <IconButton
                  key={level}
                  icon={meta.icon}
                  label={meta.label}
                  size={24}
                  onMouseDown={() => { cmds.setHeading(level); setOpenDropdown('none') }}
                />
              ))}
            </div>
          )}

          {openDropdown === 'list' && (
            <div className="pm-toolbar-solid material-popover rounded-menu p-1 flex items-center gap-0.5">
              <IconButton icon={List} label="Bullet list" size={24} onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} />
              <Button variant="ghost" size="sm" title="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} className="!w-6 !h-6 !p-0 font-mono">–</Button>
              <IconButton icon={ListOrdered} label="Numbered list" size={24} onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} />
              <IconButton icon={CheckSquare} label="Task list" size={24} onMouseDown={toggleTaskList} />
            </div>
          )}

          {openDropdown === 'highlight' && (
            <div className="pm-toolbar-solid material-popover rounded-menu p-2 w-[168px]">
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

          {openDropdown === 'table' && (
            <div className="pm-toolbar-solid material-popover rounded-menu p-1 flex flex-col gap-0.5 min-w-[160px]">
              <MenuItem icon={Rows3} label="Add row below" onMouseDown={() => { run(addRowAfter); setOpenDropdown('none') }} />
              <MenuItem icon={Rows3} label="Delete row" onMouseDown={() => { run(deleteRow); setOpenDropdown('none') }} />
              <MenuItem icon={Columns3} label="Delete column" onMouseDown={() => { run(deleteColumn); setOpenDropdown('none') }} />
              <MenuSeparator className="my-0.5" />
              <MenuItem icon={Trash2} label="Delete table" danger onMouseDown={() => { run(deleteTable); setOpenDropdown('none') }} />
            </div>
          )}

          {openDropdown === 'link' && (
            <div className="pm-toolbar-solid material-popover rounded-menu p-1.5 flex items-center gap-1 w-[240px]">
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

          {openDropdown === 'verse' && (
            <VersePickerPopup
              x={dropdownPos.left} y={dropdownPos.top} textId="kjva"
              onInsert={insertVerseFromPicker}
              onDismiss={() => setOpenDropdown('none')}
            />
          )}
        </div>,
        document.body
      )}
    </div>
  )
}
