// Single source of truth for the ICON + LABEL shown for each note-editor block type.
//
// Before this file existed, three separate icon vocabularies described the same
// handful of concepts and drifted apart from each other:
//   • Toolbar.tsx / SelectionToolbar.tsx — plain-text "H1".."H6" / "¶" labels, each
//     with its own independently-maintained array
//   • BlockMenu.tsx / AutocompletePopups.tsx — Lucide `Heading1/2/3` icons, capped at
//     H3 (so H4-H6 simply had no icon anywhere)
//   • noteTextBlocks.ts's CALLOUT_META — emoji glyphs (ℹ 💡 ⚠ ★ ✕)
// so the same block type looked like three different things depending on which of the
// four menus you reached it from. Everything React-side now reads this map instead.
//
// This file deliberately lives OUTSIDE noteTextBlocks.ts: that module is imported by
// the framework-free DOM renderers (pm/nodeViews.ts, pm/staticRender.ts, pm/parser.ts)
// and its own header comment commits it to having no editor/UI-framework dependency.
// Pulling `lucide-react` (a React package) in there would break that. The callout
// icons' plain-SVG twins for those DOM renderers live in noteTextBlocks.ts's
// CALLOUT_META as `iconSvg` — see the sync note there.
import {
  Pilcrow, Heading1, Heading2, Heading3, Heading4, Heading5, Heading6,
  Quote, List, ListOrdered, CheckSquare, Table2, Minus, SquareCode, BookOpen,
  Image as ImageIcon, Columns3, Info, Lightbulb, AlertTriangle, Star, XCircle,
  MessagesSquare,
  type LucideIcon,
} from 'lucide-react'

export interface BlockTypeMeta {
  icon: LucideIcon
  label: string
}

// Keys are the ids used by the slash-command list (pm/slashCommands.ts) wherever one
// exists, so `BLOCK_TYPE_META[cmd.id]` is a direct lookup with no translation table.
// The extra keys (h4/h5/h6 before their slash commands existed, and the heading levels
// the toolbars offer) follow the same "h" + level convention.
export const BLOCK_TYPE_META: Record<string, BlockTypeMeta> = {
  text:      { icon: Pilcrow,     label: 'Text' },
  // Lucide 0.376 ships distinct glyphs for all six heading levels (heading-1.js …
  // heading-6.js), so H4-H6 need no badge/superscript composition or text fallback —
  // each level gets its own real icon, legible at the 13-14px these menus render at.
  h1:        { icon: Heading1,    label: 'Heading 1' },
  h2:        { icon: Heading2,    label: 'Heading 2' },
  h3:        { icon: Heading3,    label: 'Heading 3' },
  h4:        { icon: Heading4,    label: 'Heading 4' },
  h5:        { icon: Heading5,    label: 'Heading 5' },
  h6:        { icon: Heading6,    label: 'Heading 6' },
  quote:     { icon: Quote,       label: 'Quote' },
  bullet:    { icon: List,        label: 'Bulleted list' },
  numbered:  { icon: ListOrdered, label: 'Numbered list' },
  task:      { icon: CheckSquare, label: 'Task list' },
  table:     { icon: Table2,      label: 'Table' },
  divider:   { icon: Minus,       label: 'Divider' },
  // SquareCode, not plain `Code` — the inline code MARK already uses `Code` in both
  // toolbars, and the two sit in the same button row; one glyph for two different
  // things is exactly the ambiguity this config exists to remove.
  code:      { icon: SquareCode,  label: 'Code block' },
  verse:     { icon: BookOpen,    label: 'Scripture verse' },
  image:     { icon: ImageIcon,   label: 'Image' },
  columns:   { icon: Columns3,    label: 'Columns' },
  thread:    { icon: MessagesSquare, label: 'Thread' },
  // Callout variants — Lucide equivalents of CALLOUT_META's former emoji glyphs,
  // matched semantically: ℹ→Info, 💡→Lightbulb, ⚠→AlertTriangle, ★→Star, ✕→XCircle.
  'callout-note':      { icon: Info,          label: 'Note' },
  'callout-tip':       { icon: Lightbulb,     label: 'Tip' },
  'callout-warning':   { icon: AlertTriangle, label: 'Warning' },
  'callout-important': { icon: Star,          label: 'Important' },
  'callout-caution':   { icon: XCircle,       label: 'Caution' },
}

// Heading level → meta, with level 0 meaning "plain paragraph" (the convention
// editorCommands.ts's `setHeading` already uses: setHeading(0) clears the heading).
export function headingMeta(level: number): BlockTypeMeta {
  return level === 0 ? BLOCK_TYPE_META.text : BLOCK_TYPE_META[`h${level}`] ?? BLOCK_TYPE_META.text
}

// The paragraph + H1-H6 row shown by the two toolbars' "Text type" dropdowns and by
// BlockMenu's "Turn into" section. One array so those three surfaces can't drift in
// which levels they offer (the exact drift this file exists to end: the toolbars had
// H1-H6, BlockMenu had H1-H3).
export const TEXT_TYPE_LEVELS: { level: number; meta: BlockTypeMeta }[] =
  [0, 1, 2, 3, 4, 5, 6].map((level) => ({ level, meta: headingMeta(level) }))

// Callout type key ("NOTE", "TIP", …) → its Lucide icon, for React surfaces that
// render a callout variant directly (the slash menu's Callouts group).
export function calloutIcon(calloutType: string): LucideIcon {
  return BLOCK_TYPE_META[`callout-${calloutType.toLowerCase()}`]?.icon ?? Info
}
