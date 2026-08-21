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
  Square, X, Maximize2, Focus as FocusIcon, Check,
} from 'lucide-react'
import { toggleMark } from 'prosemirror-commands'
import { bereanSchema as schema } from './schema'
import { createEditorCommands } from './editorCommands'
import { insertBlockNode, buildEmptyTable } from './slashCommands'
import { pickAndInsertImage } from './imageInsert'
import { VersePickerPopup } from './AutocompletePopups'
import { getTranslationForBook, bookChapterVerseLabel } from '@/lib/parseRef'
import { addRowAfter, deleteRow, deleteColumn } from './tablePlugins'
import { HIGHLIGHT_COLOR_IDS, HIGHLIGHT_LABELS, highlightDotColor } from '@/styles/highlightPalette'
import { useAppStore } from '@/store'
import { useProximityReveal } from '@/hooks/useProximityReveal'
import { computeWordStats, type WordStats } from '@/lib/wordCount'
import { BLOCK_TYPE_META, TEXT_TYPE_LEVELS } from '@/lib/blockTypeIcons'
// Same styled-keycap hover hint the rest of the app uses (ShellHeader, Ribbon, Settings…)
// — this toolbar was one of the last places still on plain native `title="Bold (⌘B)"`
// tooltips, which render in the OS's own delayed grey box with the shortcut as run-together
// parenthesised text instead of real keycaps.
import { HintTooltip } from '@/components/shell/HintTooltip'

// The "Text type" dropdown trigger and the code-block button both take their glyph from
// the shared block-type config rather than picking one locally (see blockTypeIcons.ts).
const PilcrowIcon = BLOCK_TYPE_META.text.icon
const CodeBlockIcon = BLOCK_TYPE_META.code.icon

// Debounce window for the word-count/reading-time footer below — deliberately the same 500ms
// autosave uses (NotesPanel.tsx's handleContentChange/handleTitleChange saveTimer) so the
// footer settles at the same moment the note itself is persisted, rather than adding a second,
// independently-tuned timer for what's conceptually the same "user paused typing" signal.
const WORD_COUNT_DEBOUNCE_MS = 500

// Fluid-feel polish #2.3: how long the "Saved" confirmation stays fully visible before its
// CSS opacity transition (SAVE_FLASH_FADE_MS below) starts fading it out. Long enough to
// register as a real confirmation, short enough to stay quiet/out of the way — same
// "briefly appears and fades" register as the word-count footer's own understated styling.
// Exported (not just a local const) so the fade-timing test can assert against the real
// value instead of a hardcoded magic number that could silently drift out of sync.
export const SAVE_FLASH_HOLD_MS = 1600
// Drives the indicator's inline `transitionDuration` style directly (see the render below),
// not a Tailwind `duration-*` class — keeps this one value the single source of truth
// instead of two numbers that have to be kept in sync by hand.
export const SAVE_FLASH_FADE_MS = 500

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
  view, tabId, inTable, lastSavedAt,
}: { view: EditorView | null; tabId?: string; inTable?: boolean; lastSavedAt?: number | null }) {
  const [openDropdown, setOpenDropdown] = useState<DropdownKind | 'none'>('none')
  const [dropdownPos, setDropdownPos] = useState<{ left: number; top: number } | null>(null)
  const [hovering, setHovering] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)
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

  // Word count / reading time footer. `view` is the live EditorView (already in memory — no
  // markdown round-trip needed), so the doc's own textBetween() is the source of truth rather
  // than re-parsing NotesPanel's serialized markdown string. Debounced on `view.state.doc`
  // identity: ProseMirror gives every transaction a fresh immutable doc, so this effect
  // re-arms its timer on every keystroke and only commits once typing pauses, same cadence as
  // autosave (see WORD_COUNT_DEBOUNCE_MS above).
  //
  // The debounce is right for "user is actively typing," but it was also firing on the FIRST
  // doc this effect ever sees for a given `view` — i.e. every time the toolbar attaches to a
  // newly-opened note/tab, since that's a `view.state.doc` identity change same as any
  // keystroke is. That made the count visibly pop in ~500ms after switching notes, with
  // nothing to actually debounce against (no typing burst in progress). `prevViewRef` tells
  // the two cases apart: a NEW `view` (switched note/tab) computes immediately; the SAME
  // `view` getting a new `doc` (typing within it) still debounces as before.
  const [wordStats, setWordStats] = useState<WordStats>({ words: 0, minutes: 0, characters: 0 })
  // True whenever the footer above is reporting the SELECTION's stats rather than the whole
  // note's — drives the "42 words selected" vs. "42 words" label below.
  const [statsAreSelection, setStatsAreSelection] = useState(false)
  const prevViewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    if (!view) return
    const compute = () => {
      const { doc, selection } = view.state
      const hasSelection = !selection.empty
      const text = hasSelection
        ? doc.textBetween(selection.from, selection.to, '\n', '\n')
        : doc.textBetween(0, doc.content.size, '\n', '\n')
      setStatsAreSelection(hasSelection)
      setWordStats(computeWordStats(text))
    }
    if (prevViewRef.current !== view) {
      prevViewRef.current = view
      compute()
      return
    }
    const timer = setTimeout(compute, WORD_COUNT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // view.state.selection is included so a pure selection change (no doc edit) retriggers this
    // too — previously only view.state.doc was watched, so selecting text never updated the count.
  }, [view, view?.state.doc, view?.state.selection])

  // Fluid-feel polish #2.3: "Saved" confirmation, shown briefly whenever `lastSavedAt`
  // actually changes — which only happens when NotesPanel's autosave IPC call resolves
  // (see NoteEditorPM.tsx's prop comment), never on a raw keystroke. Held fully visible for
  // SAVE_FLASH_HOLD_MS, then flips `visible` false so the CSS opacity transition below fades
  // it out — the element itself stays mounted throughout (no unmount/remount flash) so the
  // fade is a real animated transition, not a pop.
  const [saveFlashVisible, setSaveFlashVisible] = useState(false)
  useEffect(() => {
    if (lastSavedAt == null) return
    setSaveFlashVisible(true)
    const timer = setTimeout(() => setSaveFlashVisible(false), SAVE_FLASH_HOLD_MS)
    return () => clearTimeout(timer)
  }, [lastSavedAt])

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
    setLinkUrl(cmds.currentLinkHref())
    const rect = e.currentTarget.getBoundingClientRect()
    setDropdownPos({ left: rect.left, top: rect.bottom + 4 })
    setOpenDropdown('link')
  }

  function submitLink() {
    const url = linkUrl.trim()
    setOpenDropdown('none')
    if (url) cmds.applyLink(url)
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
    const label = bookChapterVerseLabel(bookId, chapter, verse)
    const { from } = editorView.state.selection
    const fragment = Fragment.fromArray([
      schema.nodes.paragraph.create(null, schema.text(label)),
      schema.nodes.paragraph.create(null, schema.text(`${verse} ${v.text}`)),
    ])
    editorView.dispatch(editorView.state.tr.insert(from, fragment).scrollIntoView())
    editorView.focus()
  }

  const iconBtn = 'p-1.5 cursor-pointer transition-colors rounded-md flex-shrink-0'
  const active = 'bg-[rgb(var(--color-accent))/20] text-[rgb(var(--color-accent))]'
  const inactive = 'text-[rgb(var(--color-text-secondary))] hover:bg-[rgb(var(--color-surface-3))] hover:text-[rgb(var(--color-text-primary))]'
  const cls = (isActive: boolean) => `${iconBtn} ${isActive ? active : inactive}`
  const sep = <div className="w-px h-5 bg-[rgb(var(--color-surface-4))] mx-0.5 flex-shrink-0" />

  // Any dropdown open (portaled to document.body) counts as "in use" even if the
  // cursor has moved off the capsule itself to reach the dropdown — otherwise the
  // capsule would dim/fade out from under an open dropdown mid-interaction.
  const inUse = hovering || openDropdown !== 'none'
  const opacityCls = focusMode
    ? (revealed || inUse ? 'opacity-100' : 'opacity-0 pointer-events-none')
    : (inUse ? 'opacity-100' : 'opacity-65')

  return (
    <>
    <div
      ref={rootRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={`
        absolute top-2 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-1.5rem)]
        flex items-center gap-0.5 px-2 py-1 rounded-full
        bg-[rgb(var(--color-surface-2))]/70 backdrop-blur-md
        border border-[rgb(var(--color-surface-4))]/70 shadow-lg shadow-black/10
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
            <button
              title="Close"
              onMouseDown={() => window.windowControls?.close()}
              className="w-3 h-3 rounded-full bg-[#FF5F57] hover:brightness-90 active:brightness-75 flex items-center justify-center cursor-pointer transition-[filter]"
            >
              <X size={7} strokeWidth={3.5} className="opacity-0 group-hover:opacity-100 text-[#4d0000]/70" />
            </button>
            <button
              title="Minimize"
              onMouseDown={() => window.windowControls?.minimize()}
              className="w-3 h-3 rounded-full bg-[#FFBD2E] hover:brightness-90 active:brightness-75 flex items-center justify-center cursor-pointer transition-[filter]"
            >
              <Minus size={8} strokeWidth={3.5} className="opacity-0 group-hover:opacity-100 text-[#5a3d00]/70" />
            </button>
            <button
              title={isMaximized ? 'Restore' : 'Maximize'}
              onMouseDown={() => window.windowControls?.maximize()}
              className="w-3 h-3 rounded-full bg-[#28C840] hover:brightness-90 active:brightness-75 flex items-center justify-center cursor-pointer transition-[filter]"
            >
              <Maximize2 size={6} strokeWidth={3.5} className="opacity-0 group-hover:opacity-100 text-[#003d0a]/70" />
            </button>
          </div>
          {sep}
        </>
      )}

      {/* Text type */}
      <HintTooltip label="Text type">
        <button
          onMouseDown={(e) => openDropdownAt('type', e)}
          className={`${iconBtn} ${openDropdown === 'type' ? active : inactive} flex items-center gap-0.5 px-2`}
        >
          <PilcrowIcon size={14} /> <ChevronDown size={10} />
        </button>
      </HintTooltip>
      {sep}

      <HintTooltip label="Bold" shortcut="⌘B">
        <button onMouseDown={() => run(toggleMark(schema.marks.strong))} className={cls(isMarkActive('strong'))}><Bold size={14} /></button>
      </HintTooltip>
      <HintTooltip label="Italic" shortcut="⌘I">
        <button onMouseDown={() => run(toggleMark(schema.marks.em))} className={cls(isMarkActive('em'))}><Italic size={14} /></button>
      </HintTooltip>
      <HintTooltip label="Underline" shortcut="⌘U">
        <button onMouseDown={() => run(toggleMark(schema.marks.underline))} className={cls(isMarkActive('underline'))}><Underline size={14} /></button>
      </HintTooltip>
      {/* No shortcut prop — strikethrough has no binding in keymap.ts, unlike the four
          marks around it, so it gets a label-only hint rather than an invented combo. */}
      <HintTooltip label="Strikethrough">
        <button onMouseDown={() => run(toggleMark(schema.marks.strike))} className={cls(isMarkActive('strike'))}><Strikethrough size={14} /></button>
      </HintTooltip>
      <HintTooltip label="Code" shortcut="⌘`">
        <button onMouseDown={() => run(toggleMark(schema.marks.code))} className={cls(isMarkActive('code'))}><Code size={14} /></button>
      </HintTooltip>

      <HintTooltip label="Highlight" shortcut="⌘⇧H">
        <button
          onMouseDown={(e) => openDropdownAt('highlight', e)}
          className={cls(openDropdown === 'highlight' || isMarkActive('highlight'))}
        >
          <Highlighter size={14} />
        </button>
      </HintTooltip>

      {sep}
      <HintTooltip label="Link">
        <button
          onMouseDown={openLinkDropdownAt}
          className={cls(openDropdown === 'link' || isMarkActive('link'))}
        ><Link2 size={14} /></button>
      </HintTooltip>
      {sep}

      <HintTooltip label="List type">
        <button
          onMouseDown={(e) => openDropdownAt('list', e)}
          className={`${iconBtn} ${openDropdown === 'list' ? active : inactive}`}
        >
          <List size={14} />
        </button>
      </HintTooltip>
      <HintTooltip label="Blockquote">
        <button onMouseDown={cmds.toggleBlockquote} className={cls(false)}><Quote size={14} /></button>
      </HintTooltip>
      {/* Code blocks had no button on either toolbar — the only way to make one was the
          /code slash command, which isn't discoverable from the toolbar the rest of the
          block types live on. */}
      <HintTooltip label="Code block">
        <button onMouseDown={cmds.toggleCodeBlock} className={cls(false)}><CodeBlockIcon size={14} /></button>
      </HintTooltip>
      <HintTooltip label="Outdent" shortcut="⇧Tab">
        <button onMouseDown={cmds.outdent} className={cls(false)}><IndentDecrease size={14} /></button>
      </HintTooltip>
      <HintTooltip label="Indent" shortcut="Tab">
        <button onMouseDown={cmds.indent} className={cls(false)}><IndentIncrease size={14} /></button>
      </HintTooltip>

      {sep}
      {/* Insert table: reuses insertBlockNode (slashCommands.ts) rather than the raw
          `replaceSelectionWith` this used before — replaceSelectionWith doesn't split the
          enclosing paragraph the way a block-level table needs, so inserting mid-paragraph
          silently produced a malformed/uneditable result. insertBlockNode already handles
          this correctly (same helper the working /table slash command uses). */}
      <HintTooltip label="Table">
        <button
          onMouseDown={() => {
            const { from, to } = editorView.state.selection
            insertBlockNode(editorView, from, to, buildEmptyTable())
          }}
          className={cls(false)}
        ><Table2 size={14} /></button>
      </HintTooltip>
      {/* Table row/column management — only shown with the cursor inside an existing table;
          addRowAfter/deleteRow/deleteColumn/deleteTable are all real no-ops outside one, but
          a button doing nothing reads as broken, so it's hidden rather than left enabled. */}
      {inTable && (
        <HintTooltip label="Table row/column">
          <button
            onMouseDown={(e) => openDropdownAt('table', e)}
            className={`${iconBtn} ${openDropdown === 'table' ? active : inactive}`}
          >
            <Rows3 size={14} />
          </button>
        </HintTooltip>
      )}
      <HintTooltip label="Divider">
        <button
          onMouseDown={() => {
            const { from, to } = editorView.state.selection
            insertBlockNode(editorView, from, to, schema.nodes.horizontal_rule.create())
          }}
          className={cls(false)}
        ><Minus size={14} /></button>
      </HintTooltip>
      {/* Verse blocks are plain paragraph text auto-detected by blockDecorations.ts, not a
          node this toolbar inserts directly (see slashCommands.ts's startVerseBlock — same
          reasoning) — this button just makes sure the detection setting is on and focuses
          the editor so the user can type a reference. */}
      <HintTooltip label="Insert a scripture verse">
        <button onMouseDown={(e) => openDropdownAt('verse', e)} className={cls(openDropdown === 'verse')}><BookOpen size={14} /></button>
      </HintTooltip>
      <HintTooltip label="Insert image">
        <button onMouseDown={() => pickAndInsertImage(editorView)} className={cls(false)}><ImageIcon size={14} /></button>
      </HintTooltip>

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
          <button title="Minimize" onMouseDown={() => window.windowControls?.minimize()} className={cls(false)}>
            <Minus size={14} />
          </button>
          <button title={isMaximized ? 'Restore' : 'Maximize'} onMouseDown={() => window.windowControls?.maximize()} className={cls(false)}>
            <Square size={12} />
          </button>
          <button
            title="Close"
            onMouseDown={() => window.windowControls?.close()}
            className={`${iconBtn} text-[rgb(var(--color-text-secondary))] hover:bg-red-500/20 hover:text-red-400`}
          >
            <X size={14} />
          </button>
        </>
      )}

      {/* ── Dropdowns — portaled, see the file-level comment above for why ── */}
      {openDropdown !== 'none' && dropdownPos && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', left: dropdownPos.left, top: dropdownPos.top, zIndex: 9999, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {openDropdown === 'type' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
              {/* Icons + labels from the shared block-type config (src/lib/blockTypeIcons.ts)
                  — these were plain-text "H1".."H6"/"¶" labels, a third icon vocabulary on
                  top of the block menu's and slash menu's Lucide glyphs for the same levels. */}
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
            </div>
          )}

          {openDropdown === 'list' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1 flex items-center gap-0.5">
              <button title="Bullet list" onMouseDown={() => { cmds.setBulletList('*'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><List size={14} /></button>
              <button title="Dash list" onMouseDown={() => { cmds.setBulletList('-'); setOpenDropdown('none') }} className={`${iconBtn} ${inactive} text-sm font-mono`}>–</button>
              <button title="Numbered list" onMouseDown={() => { cmds.setOrderedList(); setOpenDropdown('none') }} className={`${iconBtn} ${inactive}`}><ListOrdered size={14} /></button>
              <button title="Task list" onMouseDown={toggleTaskList} className={`${iconBtn} ${inactive}`}><CheckSquare size={14} /></button>
            </div>
          )}

          {openDropdown === 'highlight' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-2 w-[168px]">
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

          {openDropdown === 'table' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1 flex flex-col gap-0.5 min-w-[160px]">
              <button
                onMouseDown={() => { run(addRowAfter); setOpenDropdown('none') }}
                className={`${iconBtn} ${inactive} flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Rows3 size={13} /> Add row below
              </button>
              <button
                onMouseDown={() => { run(deleteRow); setOpenDropdown('none') }}
                className={`${iconBtn} ${inactive} flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Rows3 size={13} /> Delete row
              </button>
              <button
                onMouseDown={() => { run(deleteColumn); setOpenDropdown('none') }}
                className={`${iconBtn} ${inactive} flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Columns3 size={13} /> Delete column
              </button>
              <div className="h-px bg-[rgb(var(--color-surface-4))] my-0.5" />
              <button
                onMouseDown={() => { run(deleteTable); setOpenDropdown('none') }}
                className={`${iconBtn} text-red-400 hover:bg-red-500/15 flex items-center gap-2 text-xs px-2 py-1.5 justify-start`}
              >
                <Trash2 size={13} /> Delete table
              </button>
            </div>
          )}

          {openDropdown === 'link' && (
            <div className="pm-toolbar-solid rounded-lg shadow-2xl p-1.5 flex items-center gap-1 w-[240px]">
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
    {/* Word count / reading time footer — docked to the bottom-right corner of the editor's
        own `relative` wrapper (NoteEditorPM.tsx), not part of the floating capsule above, so
        it stays put (and stays readable) regardless of Focus mode's fade/reveal behavior. */}
    <div className="absolute bottom-2 right-3 z-10 flex items-center gap-2 pointer-events-none select-none">
      {/* Fluid-feel polish #2.3 — quiet autosave confirmation. Always mounted once a save has
          ever completed (so the opacity transition can actually animate out, rather than the
          element popping in/out of existence); `lastSavedAt != null` just gates it from ever
          rendering before the very first save of this session. Same muted register/size as
          the word-count text beside it — a confirmation, not an alert. */}
      {lastSavedAt != null && (
        <span
          className="flex items-center gap-1 text-[11px] text-[rgb(var(--color-text-muted))] transition-opacity ease-out"
          style={{ opacity: saveFlashVisible ? 1 : 0, transitionDuration: `${SAVE_FLASH_FADE_MS}ms` }}
        >
          <Check size={11} strokeWidth={2.5} /> Saved
        </span>
      )}
      <div className="text-[11px] text-[rgb(var(--color-text-muted))]">
        {wordStats.words === 0
          ? (statsAreSelection ? '0 words selected' : '0 words')
          : statsAreSelection
            ? `${wordStats.words} word${wordStats.words === 1 ? '' : 's'} · ${wordStats.characters} char${wordStats.characters === 1 ? '' : 's'} selected`
            : `${wordStats.words} word${wordStats.words === 1 ? '' : 's'} · ${wordStats.characters} char${wordStats.characters === 1 ? '' : 's'} · ${wordStats.minutes} min read`}
      </div>
    </div>
    </>
  )
}
