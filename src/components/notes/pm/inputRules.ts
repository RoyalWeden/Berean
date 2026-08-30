import {
  InputRule, inputRules as buildInputRulesPlugin, wrappingInputRule, textblockTypeInputRule,
} from 'prosemirror-inputrules'
import type { EditorState, Transaction } from 'prosemirror-state'
import type { MarkType, Attrs } from 'prosemirror-model'
import { useAppStore } from '@/store'
import { bereanSchema as schema } from './schema'

// Text of the current visual "line" up to the cursor, i.e. since the start of
// the enclosing textblock OR the last hard_break — the closest available
// equivalent to CM6's `line.text` now that a single paragraph can span
// multiple hard-broken lines (see markdownIt.ts's `breaks: true` note).
function currentLineTextBefore(state: EditorState): string {
  const { $from } = state.selection
  const parent = $from.parent
  const offset = $from.parentOffset
  let lineStart = 0
  let pos = 0
  for (let i = 0; i < parent.childCount && pos < offset; i++) {
    const child = parent.child(i)
    pos += child.nodeSize
    if (child.type.name === 'hard_break' && pos <= offset) lineStart = pos
  }
  return parent.textBetween(lineStart, offset, undefined, '￼')
}

// ─── Auto em dash ───────────────────────────────────────────────────────────
// Port of NoteEditor.tsx's autoEmDashHandler: converts the 2nd of two
// consecutive '-' keystrokes into '—', guarded against inline code.
const emDashRule = new InputRule(/-$/, (state, _match, start, end) => {
  if (!useAppStore.getState().autoEmDash) return null
  // `state` here is the PRE-insertion state — prosemirror-inputrules matches
  // the rule's regex against a simulated "text so far + the character about
  // to be typed" string, but only passes the ORIGINAL state (without that
  // character yet) into the handler. currentLineTextBefore(state) therefore
  // does NOT actually include the just-typed '-' despite what this used to
  // assume — every guard below was silently checking one character short
  // (e.g. for "hello--", it saw "hello-" and compared the wrong index),
  // so the rule could never actually fire. Appending the character here
  // makes `lineBefore` match what's really on screen.
  const lineBefore = currentLineTextBefore(state) + '-'
  if (lineBefore.length < 2 || lineBefore[lineBefore.length - 2] !== '-') return null
  // No "line is only dashes so far, might become ---" guard here (an earlier
  // version bailed out in exactly that case, which also meant a bare "--"
  // typed alone on its own line — reported: "all I typed ... is '--'" —
  // could NEVER convert, since there was no later keystroke to retroactively
  // trigger it). Converting immediately and unconditionally on the 2nd dash
  // is safe: horizontalRuleRule below now also recognizes "—-" (an
  // auto-converted em dash immediately followed by one more literal dash) as
  // equivalent to "---", so typing a 3rd dash right after still produces a
  // horizontal rule — the em dash conversion is a transient, self-correcting
  // step in that sequence rather than something that has to be avoided.
  const tr: Transaction = state.tr.replaceWith(start - 1, end, state.schema.text('—'))
  return tr
}, { inCodeMark: false })

// ─── Markdown-shortcut input rules ──────────────────────────────────────────
// The standard ProseMirror pattern for "typing markdown syntax converts it
// live" — the same approach used by prosemirror-example-setup's own
// buildInputRules and, downstream, by editors built on it (e.g. Tiptap's
// StarterKit). Two building blocks from prosemirror-inputrules cover block
// types directly (wrappingInputRule for list/blockquote wraps,
// textblockTypeInputRule for headings/code fences); there's no equivalent
// built-in helper for MARKS (bold/italic/etc), so `markInputRule` below is
// the well-established custom-rule pattern from ProseMirror's own docs/
// examples for that case.
//
// Before this, markdown shortcuts only took effect at PARSE time (i.e. only
// after saving and reopening the note) — headingSpaceRule below just
// auto-inserted the space after "##" but never actually converted the line
// into a real heading node while editing live, which is why typing "## "
// visually did nothing more than insert a space.
function markInputRule(regexp: RegExp, markType: MarkType, getAttrs?: (match: RegExpMatchArray) => Attrs | null) {
  return new InputRule(regexp, (state, match, start, end) => {
    const attrs = getAttrs?.(match) ?? null
    const tr = state.tr
    if (match[1]) {
      const textStart = start + match[0].indexOf(match[1])
      const textEnd = textStart + match[1].length
      if (textEnd < end) tr.delete(textEnd, end)
      if (textStart > start) tr.delete(start, textStart)
      end = start + match[1].length
    }
    tr.addMark(start, end, markType.create(attrs ?? undefined))
    tr.removeStoredMark(markType) // don't keep applying the mark to further typing
    return tr
  })
}

// `(?<=^|\s)` is a zero-width lookbehind, NOT a capturing prefix — it
// requires a space or line-start immediately before the opening delimiter
// without consuming that character into the match. Using a normal
// `(?:^|\s)` group here (an earlier, wrong version of this) was a real
// bug: markInputRule's delimiter-stripping logic deletes everything from
// the match start up to where the captured inner text begins, and since
// that consuming group included the leading space as part of the match,
// the space got deleted right along with the "**" delimiters — turning
// "hello **world**" into "hello**world**".
const boldRule = markInputRule(/(?<=^|\s)\*\*([^*]+)\*\*$/, schema.marks.strong)
const boldUnderscoreRule = markInputRule(/(?<=^|\s)__([^_]+)__$/, schema.marks.strong)
const italicRule = markInputRule(/(?<=^|\s)\*([^*]+)\*$/, schema.marks.em)
const italicUnderscoreRule = markInputRule(/(?<=^|\s)_([^_]+)_$/, schema.marks.em)
const strikeRule = markInputRule(/(?<=^|\s)~~([^~]+)~~$/, schema.marks.strike)
const codeRule = markInputRule(/(?<=^|\s)`([^`]+)`$/, schema.marks.code)
const highlightRule = markInputRule(/(?<=^|\s)==([^=]+)==$/, schema.marks.highlight, () => ({ color: null }))

// Typing "[[Title]]" out by hand (no autocomplete popup involved — that
// path is fixed separately in autocomplete.ts's replaceRangeWithWikilink)
// needs its own live-conversion rule same as bold/italic/etc above: without
// this, a real `wikilink` mark was only ever created by parseMarkdown at
// note-LOAD time, so freshly hand-typed "[[...]]" sat as inert plain text
// (visibly the raw brackets, not clickable) until the note was closed and
// reopened. No leading-whitespace lookbehind needed here (unlike the mark
// rules above) — "[[" isn't a character that legitimately starts other
// syntax, so there's no ambiguous-prefix case to guard against.
const wikilinkRule = markInputRule(/\[\[([^[\]]+)\]\]$/, schema.marks.wikilink, (match) => ({ title: match[1] }))

const headingRule = textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({ level: match[1].length }))
const codeFenceRule = textblockTypeInputRule(/^```$/, schema.nodes.code_block)
const blockquoteRule = wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)
const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list, (match) => ({ marker: match[1] }))
const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  schema.nodes.ordered_list,
  (match) => ({ order: +match[1] }),
  (match, node) => node.childCount + node.attrs.order === +match[1],
)

// ─── Horizontal rule ─────────────────────────────────────────────────────────
// Was entirely missing — nothing converted a typed "---" into a real
// horizontal_rule node, so it just sat as literal dashes until save/reopen
// ran it through parseMarkdown. horizontal_rule isn't a textblock (no
// content to hold text), so this can't use textblockTypeInputRule like
// headingRule/codeFenceRule — it replaces the whole paragraph the same way the
// "Divider" slash command does (slashCommands.ts's insertBlockNode).
//
// The `—-` branch handles typing "---" fast: emDashRule now converts the
// FIRST two dashes into an em dash immediately and unconditionally (no more
// "might become ---" guard — see its own comment), so by the time the 3rd
// dash arrives, the line reads "—-" (em dash + one literal dash) rather than
// "---". Recognizing that combination here too means the em-dash step is a
// transient, self-correcting part of typing a horizontal rule rather than
// something that has to be avoided.
const horizontalRuleRule = new InputRule(/^(?:-{3}|\*{3}|_{3}|—-)$/, (state, _match, start) => {
  const $start = state.doc.resolve(start)
  if ($start.parent.type.name !== 'paragraph') return null
  const paraStart = $start.before()
  const paraEnd = $start.after()
  return state.tr.replaceWith(paraStart, paraEnd, schema.nodes.horizontal_rule.create())
})

// Task list items are a TWO-STAGE conversion, not a single atomic one — a
// real bug in an earlier version tried to match the whole "- [ ] " string
// in one InputRule, but bulletListRule (above) ALREADY fires as soon as
// "- " is typed (its own pattern is satisfied at that exact keystroke,
// before "[ ] " exists yet), converting the line into a plain bullet
// list_item first and consuming the "- " prefix — so by the time "[ ] "
// finishes being typed, there's no "- [ ] " text left for a single
// whole-string rule to ever match against. The standard fix (matching how
// real editors handle this) is a second rule that fires on JUST "[ ] "/
// "[x] ", and only takes effect when the current paragraph's parent is
// ALREADY a (bulletListRule-created) list_item — turning that existing
// plain item into a checked task item, rather than trying to detect and
// convert the whole compound pattern atomically.
const taskCheckboxRule = new InputRule(/^\[([ xX])\]\s$/, (state, match, start, end) => {
  const checked = match[1].toLowerCase() === 'x'
  const $start = state.doc.resolve(start)
  const listItem = $start.node(-1)
  if (!listItem || listItem.type.name !== 'list_item' || listItem.attrs.checked !== null) return null
  const listItemPos = $start.before(-1)
  return state.tr.delete(start, end).setNodeAttribute(listItemPos, 'checked', checked)
})

// ─── Auto heading space ─────────────────────────────────────────────────────
// Kept alongside headingRule (which handles the common "type the space and
// it becomes a real heading" case): this only fires for the "type ANY
// other character right after a bare '#' run" case, auto-inserting the
// missing space first so headingRule's own space-triggered pattern applies
// on the VERY NEXT keystroke instead of needing the user to notice and
// press space themselves.
//
// The negated class must be `[^\s#]`, not the old `[^ #]` (only ASCII 0x20)
// — a real reported bug: a NON-BREAKING space (U+00A0, e.g. from a stray
// Option+Space on macOS, or some OS/keyboard-level substitution) typed right
// after "#" satisfied `[^ #]` (it isn't a literal ASCII space, so it read as
// "some other character"), so this rule "helpfully" inserted a SECOND,
// regular space ahead of it — leaving "# " + NBSP instead of a clean "# ",
// which broke headingRule's own `^#+\s$` prefix match on the next keystroke
// and left the line as permanent plain text (with the leading "#" escaped
// on save, since it's genuinely no longer heading syntax at that point).
// `\s` matches NBSP already (confirmed: /\s/.test(' ') === true in
// V8/JS), so excluding by `\s` instead of a literal space correctly treats
// NBSP as "already a space" and leaves it to headingRule to convert directly.
// NOTE: the old "auto-insert a space after a bare '#' run" rule (rewrote "#s" -> "# s")
// was removed — it made a start-of-line "#tag" impossible to type (it always became a
// heading). A heading now forms only when the user types the space (headingRule below);
// "#word" with no space stays literal so the #tag autocomplete can claim it.

export const bereanInputRules = buildInputRulesPlugin({
  rules: [
    emDashRule,
    headingRule, codeFenceRule, blockquoteRule, bulletListRule, orderedListRule, taskCheckboxRule, horizontalRuleRule,
    boldRule, boldUnderscoreRule, italicRule, italicUnderscoreRule, strikeRule, codeRule, highlightRule,
    wikilinkRule,
  ],
})
