import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import type { EditorView } from 'prosemirror-view'
import { Fragment } from 'prosemirror-model'
import { deleteTable } from 'prosemirror-tables'
import {
  Bold, Italic, Underline, Strikethrough, Code, Highlighter, Link2, Link2Off,
  List, ListOrdered, CheckSquare, Quote, IndentIncrease, IndentDecrease,
  Table2, Minus, BookOpen, Image as ImageIcon, Rows3, Columns3, Trash2, Plus,
  Square, X, Maximize2, Focus as FocusIcon, ListMinus } from 'lucide-react'
import { toggleMark } from 'prosemirror-commands'
import { bereanSchema as schema } from './schema'
import { createEditorCommands } from './editorCommands'
import { insertBlockNode, buildEmptyTable } from './slashCommands'
import { pickAndInsertImage } from './imageInsert'
import { VersePickerPopup } from './AutocompletePopups'
import { toggleSuppressCommand } from './suppressRanges'
import { getTranslationForBook, bookChapterVerseLabel } from '@/lib/parseRef'
import { buildVerseDisplayText } from '@/lib/verseUtils'
import { addRowAfter, deleteRow, deleteColumn } from './tablePlugins'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS } from '@/styles/highlightPalette'
import { useAppStore } from '@/store'
import { useProximityReveal } from '@/hooks/useProximityReveal'
import { BLOCK_TYPE_META, TEXT_TYPE_LEVELS, headingMeta, type BlockTypeMeta } from '@/lib/blockTypeIcons'
import { MenuPositioner } from '@/lib/usePositionedMenu'
import { Toolbar as Bar, ControlGroup, OverflowGroup, OverflowSection, IconButton, Button, MenuSurface, MenuItem, MenuGroup, MenuSeparator, ColorSwatchRow, TextField, cx } from '@/components/ui'

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

type DropdownKind = 'type' | 'list' | 'highlight' | 'insert' | 'link' | 'verse'

// Persistent, always-visible formatting toolbar docked above the note editor —
// complements (doesn't replace) SelectionToolbar.tsx's selection-triggered bubble menu.
// The bubble covers "I selected this text, format it"; this bar covers "I want to change
// formatting without first selecting text" (starting a new heading, inserting a table,
// toggling Focus mode). Shares all command logic with the bubble via editorCommands.ts —
// this file owns only its own dropdown-open UI state, same split as SelectionToolbar.tsx.
//
// A floating M3 `material-elevated` capsule (the TRANSIENT layer — it's not docked chrome,
// it hovers over the content). `ControlGroup`s of square 24px IconButtons carry the actual
// commands; `OverflowGroup` folds whole trailing groups into a "…" popover instead of ever
// scrolling the bar sideways. Every dropdown is a `MenuSurface`/`MenuItem`/`ColorSwatchRow`
// panel anchored to its trigger's own rect via `MenuPositioner` (viewport-clamped, grows from
// the trigger like every other menu in the app).
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
  // cursor comes near its own docked position. Outside Focus mode it's always fully
  // legible — TopBar itself has no reveal mechanism at all in Focus mode (per the
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

  // Anchors a dropdown to an explicit rect (rather than a click event) — needed when a group
  // has folded into the OverflowGroup "More" menu (§40): there's no per-item button rect in
  // that popover, so folded triggers for an anchored dropdown (the verse picker) fall back to
  // the toolbar's own rect via openDropdownAtRect below instead of calling this directly.
  function openDropdownAtRect(kind: DropdownKind, rect: { left: number; bottom: number }) {
    if (openDropdown === kind) { setOpenDropdown('none'); return }
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setOpenDropdown(kind)
  }
  function openDropdownAt(kind: DropdownKind, e: React.MouseEvent<HTMLButtonElement>) {
    openDropdownAtRect(kind, e.currentTarget.getBoundingClientRect())
  }
  // Fallback anchor for a folded overflow-menu item that needs to open its own anchored
  // dropdown (the verse picker) — there's no button rect to read from inside the "More" popover,
  // so it anchors to the toolbar bar itself instead.
  function openDropdownFromToolbar(kind: DropdownKind) {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) openDropdownAtRect(kind, rect)
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

  function openLinkDropdownAtRect(rect: { left: number; bottom: number }) {
    if (openDropdown === 'link') { setOpenDropdown('none'); return }
    const { from, to } = editorView.state.selection
    linkRangeRef.current = { from, to }
    setLinkUrl(cmds.currentLinkHref())
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setOpenDropdown('link')
  }
  function openLinkDropdownAt(e: React.MouseEvent<HTMLButtonElement>) {
    openLinkDropdownAtRect(e.currentTarget.getBoundingClientRect())
  }
  // Fallback for the folded "Links & code" overflow-menu item — no button rect available there.
  function openLinkDropdownFromToolbar() {
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) openLinkDropdownAtRect(rect)
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

  // Any dropdown open (portaled to document.body) counts as "in use" even if the
  // cursor has moved off the capsule itself to reach the dropdown — otherwise the
  // capsule would dim/fade out from under an open dropdown mid-interaction.
  const inUse = hovering || openDropdown !== 'none'
  const opacityCls = focusMode
    ? (revealed || inUse ? 'opacity-100' : 'opacity-0 pointer-events-none')
    : 'opacity-100'

  return (
    <div
      ref={rootRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cx(
        'absolute top-2 left-1/2 -translate-x-1/2 z-raised max-w-[calc(100%-1.5rem)]',
        'flex-shrink-0 transition-opacity duration-200', opacityCls,
      )}
    >
      <Bar size="sm" edge="none" material="none" itemVariant="ghost" className="material-popover rounded-menu">
        <OverflowGroup label="More formatting" fit="offsetParent" inset={48}>
          {/* Focus mode hides the native traffic lights (see the `setButtonsVisible` effect
              above — they're window-frame chrome, not DOM, and can't just be relocated) and
              replaces them with real close/minimize/maximize buttons on the LEFT of this bar,
              styled like actual macOS traffic lights (not the toolbar's own icon-button style)
              since that's the convention this is standing in for. Left OUTSIDE any ControlGroup
              deliberately — their circular, hardcoded-hex look is the one documented exception
              to the square/flat grouped-control recipe, and grouping would fight it. */}
          {focusMode && isMac && (
            <div className="group flex items-center gap-2.5 flex-shrink-0">
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
          )}

          {/* Group 1 — Text: current block type. (Thread lives in the Insert menu.) Never folds. */}
          <OverflowSection priority="never">
            <ControlGroup>
              <Button
                variant="menu"
                size="xs"
                icon={currentBlockTypeMeta(editorView).icon}
                selected={openDropdown === 'type'}
                onMouseDown={(e) => openDropdownAt('type', e)}
                tooltip="Text type"
              />
            </ControlGroup>
          </OverflowSection>

          {/* Group 2 — Emphasis: inline marks, Highlight included (a colour-swatch emphasis,
              not a reference action — moved out of the old "Annotate & reference" group).
              Never folds. */}
          <OverflowSection priority="never">
            <ControlGroup>
              <IconButton icon={Bold} label="Bold" tooltip={{ shortcut: '⌘B' }} size={24} active={isMarkActive('strong')} onMouseDown={() => run(toggleMark(schema.marks.strong))} />
              <IconButton icon={Italic} label="Italic" tooltip={{ shortcut: '⌘I' }} size={24} active={isMarkActive('em')} onMouseDown={() => run(toggleMark(schema.marks.em))} />
              <IconButton icon={Underline} label="Underline" tooltip={{ shortcut: '⌘U' }} size={24} active={isMarkActive('underline')} onMouseDown={() => run(toggleMark(schema.marks.underline))} />
              {/* No shortcut — strikethrough has no binding in keymap.ts, unlike the three marks
                  around it, so it gets a label-only hint rather than an invented combo. */}
              <IconButton icon={Strikethrough} label="Strikethrough" size={24} active={isMarkActive('strike')} onMouseDown={() => run(toggleMark(schema.marks.strike))} />
              <IconButton
                icon={Highlighter}
                label="Highlight"
                tooltip={{ shortcut: '⌘⇧H' }}
                size={24}
                active={openDropdown === 'highlight' || isMarkActive('highlight')}
                onMouseDown={(e) => openDropdownAt('highlight', e)}
              />
            </ControlGroup>
          </OverflowSection>

          {/* Group 3 — Links & code: last of the foldable groups to actually fold (stays
              visible longest among the foldables — see the fold-order comment at Group 6). */}
          <OverflowSection
            label="Links & code"
            items={[
              { key: 'link', label: 'Link', icon: Link2, checked: isMarkActive('link'), onSelect: openLinkDropdownFromToolbar },
              { key: 'code', label: 'Inline code', icon: Code, shortcut: '⌘`', checked: isMarkActive('code'), onSelect: () => run(toggleMark(schema.marks.code)) },
              { key: 'suppress-refs', label: 'Suppress auto-detected refs', icon: Link2Off, shortcut: '⌘⇧R', onSelect: () => run(toggleSuppressCommand) },
            ]}
          >
            <ControlGroup>
              <IconButton
                icon={Link2}
                label="Link"
                size={24}
                active={openDropdown === 'link' || isMarkActive('link')}
                onMouseDown={openLinkDropdownAt}
              />
              <IconButton icon={Code} label="Inline code" tooltip={{ shortcut: '⌘`' }} size={24} active={isMarkActive('code')} onMouseDown={() => run(toggleMark(schema.marks.code))} />
              <IconButton icon={Link2Off} label="Suppress auto-detected refs" tooltip={{ shortcut: '⌘⇧R' }} size={24} onMouseDown={() => run(toggleSuppressCommand)} />
            </ControlGroup>
          </OverflowSection>

          {/* Group 4 — Paragraph: lists, blockquote, indent/outdent. */}
          <OverflowSection
            label="Paragraph"
            items={[
              { key: 'blockquote', label: 'Blockquote', icon: Quote, onSelect: cmds.toggleBlockquote },
              { key: 'outdent', label: 'Outdent', icon: IndentDecrease, shortcut: '⇧Tab', onSelect: cmds.outdent },
              { key: 'indent', label: 'Indent', icon: IndentIncrease, shortcut: 'Tab', onSelect: cmds.indent },
            ]}
          >
            <ControlGroup>
              <Button
                variant="menu"
                size="xs"
                icon={List}
                selected={openDropdown === 'list'}
                onMouseDown={(e) => openDropdownAt('list', e)}
                tooltip="List type"
              />
              <IconButton icon={Quote} label="Blockquote" size={24} onMouseDown={cmds.toggleBlockquote} />
              <IconButton icon={IndentDecrease} label="Outdent" tooltip={{ shortcut: '⇧Tab' }} size={24} onMouseDown={cmds.outdent} />
              <IconButton icon={IndentIncrease} label="Indent" tooltip={{ shortcut: 'Tab' }} size={24} onMouseDown={cmds.indent} />
            </ControlGroup>
          </OverflowSection>

          {/* Group 5 — Focus: folds early alongside Insert (packet §39 hierarchy note) —
              secondary actions recede into the "More" menu, still one click away. */}
          <OverflowSection
            label="Focus"
            items={[
              { key: 'focus', label: focusMode ? 'Exit Focus mode' : 'Focus mode', icon: FocusIcon, checked: focusMode, onSelect: () => toggleFocusMode() },
            ]}
          >
            <ControlGroup>
              <IconButton
                icon={FocusIcon}
                label={focusMode ? 'Exit Focus mode' : 'Focus mode — hide sidebar and chrome while writing'}
                size={24}
                active={focusMode}
                onMouseDown={() => toggleFocusMode()}
              />
            </ControlGroup>
          </OverflowSection>

          {/* Group 6 — Insert: one menu button folding every secondary insert action, per
              packet §39 ("secondary actions recede into a menu; still one click away"). Placed
              last among the foldable groups so it's the first to fold (§40: "Insert first to
              fold → Paragraph → Links & code → never Emphasis/Text") — OverflowGroup folds
              trailing children first. */}
          <OverflowSection
            label="Insert"
            items={[
              { key: 'insert-table', label: 'Table', icon: Table2, onSelect: () => { const { from, to } = editorView.state.selection; insertBlockNode(editorView, from, to, buildEmptyTable()) } },
              { key: 'insert-code-block', label: 'Code block', icon: CodeBlockIcon, onSelect: cmds.toggleCodeBlock },
              { key: 'insert-divider', label: 'Divider', icon: Minus, onSelect: () => { const { from, to } = editorView.state.selection; insertBlockNode(editorView, from, to, schema.nodes.horizontal_rule.create()) } },
              { key: 'insert-verse', label: 'Verse…', icon: BookOpen, onSelect: () => openDropdownFromToolbar('verse') },
              { key: 'insert-image', label: 'Image…', icon: ImageIcon, onSelect: () => pickAndInsertImage(editorView) },
            ]}
          >
            <ControlGroup>
              <Button
                variant="menu"
                size="xs"
                icon={Plus}
                selected={openDropdown === 'insert'}
                onMouseDown={(e) => openDropdownAt('insert', e)}
                tooltip="Insert"
              />
            </ControlGroup>
          </OverflowSection>

          {/* Windows: standard convention is minimize/maximize/close on the RIGHT, matching
              the frameless title bar's own WindowControls.tsx (Fluent-ish hover, red close)
              rather than the Mac traffic-light treatment above. */}
          {focusMode && !isMac && (
            <ControlGroup>
              <IconButton icon={Minus} label="Minimize" size={24} onMouseDown={() => window.windowControls?.minimize()} />
              <IconButton icon={Square} label={isMaximized ? 'Restore' : 'Maximize'} size={24} onMouseDown={() => window.windowControls?.maximize()} />
              <IconButton icon={X} label="Close" size={24} danger onMouseDown={() => window.windowControls?.close()} />
            </ControlGroup>
          )}
        </OverflowGroup>
      </Bar>

      {/* ── Dropdowns — portaled, anchored to their trigger's own rect via MenuPositioner ── */}
      {openDropdown !== 'none' && dropdownPos && createPortal(
        <>
          {openDropdown === 'type' && (
            <MenuPositioner ref={dropdownRef} x={dropdownPos.left} y={dropdownPos.top}>
              <MenuSurface className="min-w-[180px]">
                {TEXT_TYPE_LEVELS.map(({ level, meta }) => (
                  <MenuItem
                    key={level}
                    icon={meta.icon}
                    label={meta.label}
                    onMouseDown={() => { cmds.setHeading(level); setOpenDropdown('none') }}
                  />
                ))}
              </MenuSurface>
            </MenuPositioner>
          )}

          {openDropdown === 'list' && (
            <MenuPositioner ref={dropdownRef} x={dropdownPos.left} y={dropdownPos.top}>
              <MenuSurface className="min-w-[160px]">
                <MenuItem icon={List} label="Bullet list" onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} />
                <MenuItem icon={ListMinus} label="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} />
                <MenuItem icon={ListOrdered} label="Numbered list" onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} />
                <MenuItem icon={CheckSquare} label="Task list" onMouseDown={toggleTaskList} />
              </MenuSurface>
            </MenuPositioner>
          )}

          {openDropdown === 'highlight' && (
            <MenuPositioner ref={dropdownRef} x={dropdownPos.left} y={dropdownPos.top}>
              <MenuSurface className="p-2 w-[184px]">
                <ColorSwatchRow
                  size={16}
                  allowNone
                  value={null}
                  swatches={HIGHLIGHT_COLOR_IDS.map((id) => ({ id, rgb: `var(--highlight-${id})`, label: HIGHLIGHT_LABELS[id] }))}
                  onChange={(id) => (id ? applyHighlight(id) : removeHighlight())}
                />
              </MenuSurface>
            </MenuPositioner>
          )}

          {openDropdown === 'insert' && (
            <MenuPositioner ref={dropdownRef} x={dropdownPos.left} y={dropdownPos.top}>
              <MenuSurface className="min-w-[190px]">
                {/* Table row/column management — only shown with the cursor inside an existing
                    table; addRowAfter/deleteRow/deleteColumn/deleteTable are all real no-ops
                    outside one, but showing them there reads as broken, so they're folded in
                    only when relevant rather than always present-but-disabled. */}
                {inTable && (
                  <>
                    <MenuGroup label="Table">
                      <MenuItem icon={Rows3} label="Add row below" onMouseDown={() => { run(addRowAfter); setOpenDropdown('none') }} />
                      <MenuItem icon={Rows3} label="Delete row" onMouseDown={() => { run(deleteRow); setOpenDropdown('none') }} />
                      <MenuItem icon={Columns3} label="Delete column" onMouseDown={() => { run(deleteColumn); setOpenDropdown('none') }} />
                      <MenuItem icon={Trash2} label="Delete table" danger onMouseDown={() => { run(deleteTable); setOpenDropdown('none') }} />
                    </MenuGroup>
                    <MenuSeparator />
                  </>
                )}
                {/* Reuses insertBlockNode (slashCommands.ts) rather than the raw
                    `replaceSelectionWith` this used before — replaceSelectionWith doesn't split
                    the enclosing paragraph the way a block-level table needs, so inserting
                    mid-paragraph silently produced a malformed/uneditable result.
                    insertBlockNode already handles this correctly (same helper the working
                    /table slash command uses). */}
                <MenuItem icon={ThreadIcon} label="Thread" onMouseDown={() => { cmds.wrapInThread(); setOpenDropdown('none') }} />
                <MenuItem
                  icon={Table2}
                  label="Table"
                  onMouseDown={() => {
                    const { from, to } = editorView.state.selection
                    insertBlockNode(editorView, from, to, buildEmptyTable())
                    setOpenDropdown('none')
                  }}
                />
                <MenuItem icon={CodeBlockIcon} label="Code block" onMouseDown={() => { cmds.toggleCodeBlock(); setOpenDropdown('none') }} />
                <MenuItem
                  icon={Minus}
                  label="Divider"
                  onMouseDown={() => {
                    const { from, to } = editorView.state.selection
                    insertBlockNode(editorView, from, to, schema.nodes.horizontal_rule.create())
                    setOpenDropdown('none')
                  }}
                />
                {/* Verse blocks are plain paragraph text auto-detected by blockDecorations.ts, not
                    a node this menu inserts directly (see slashCommands.ts's startVerseBlock —
                    same reasoning) — this reopens the picker below, anchored to the same spot. */}
                <MenuItem icon={BookOpen} label="Verse…" onMouseDown={() => setOpenDropdown('verse')} />
                <MenuItem icon={ImageIcon} label="Image…" onMouseDown={() => { setOpenDropdown('none'); pickAndInsertImage(editorView) }} />
              </MenuSurface>
            </MenuPositioner>
          )}

          {openDropdown === 'link' && (
            // Link editor (§10.3): URL field + Apply / Remove; Enter applies, Esc closes, invalid
            // URLs are flagged inline (http(s):// or a berean:/mailto: scheme).
            <MenuPositioner ref={dropdownRef} x={dropdownPos.left} y={dropdownPos.top}
              className="material-popover rounded-menu animate-menu-in p-2 flex flex-col gap-2 w-[280px]">
              <TextField
                ref={linkInputRef}
                size="sm"
                type="url"
                value={linkUrl}
                invalid={!!linkUrl.trim() && !/^(https?:\/\/|mailto:|berean:)/i.test(linkUrl.trim())}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); submitLink() }
                  else if (e.key === 'Escape') { e.preventDefault(); setOpenDropdown('none'); editorView.focus() }
                }}
                placeholder="https://…"
                aria-label="Link URL"
                wrapperClassName="w-full"
              />
              <div className="flex items-center justify-end gap-1.5">
                {cmds.currentLinkHref() && (
                  <Button variant="ghost" size="xs" danger onMouseDown={(e) => { e.preventDefault(); cmds.removeLink(linkRangeRef.current ?? undefined); setOpenDropdown('none') }}>Remove</Button>
                )}
                <Button variant="ghost" size="xs" onMouseDown={(e) => { e.preventDefault(); setOpenDropdown('none'); editorView.focus() }}>Cancel</Button>
                <Button variant="primary" size="xs" disabled={!linkUrl.trim()} onMouseDown={(e) => { e.preventDefault(); submitLink() }}>Apply</Button>
              </div>
            </MenuPositioner>
          )}

          {openDropdown === 'verse' && (
            <VersePickerPopup
              x={dropdownPos.left} y={dropdownPos.top} textId="kjva"
              onInsert={insertVerseFromPicker}
              onDismiss={() => setOpenDropdown('none')}
            />
          )}
        </>,
        document.body
      )}
    </div>
  )
}
