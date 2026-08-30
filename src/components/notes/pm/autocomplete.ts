import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { Fragment } from 'prosemirror-model'
import { parseRef } from '@/lib/parseRef'
import { findVerseRefMatches } from '@/lib/noteTextBlocks'

// ─── Trigger detection ──────────────────────────────────────────────────────
// Ported from NoteEditor.tsx's updateListener-based trigger logic
// (NoteEditor.tsx:3204-3260): inspects the text of the current line up to
// the cursor for an unclosed `[[`, a completed `H1234`/`G567` Strong's
// number, or a completed `Book c:v` verse reference, and reports back via
// callbacks (same stable-ref pattern as refDecorations.ts) rather than
// managing its own React state, since popups are rendered by the consumer.

export interface WikilinkTrigger { query: string; from: number; to: number; coords: { left: number; bottom: number } }
export interface StrongsTrigger { num: string; from: number; to: number; coords: { left: number; bottom: number } }
export interface VerseSuggestTrigger { ref: string; from: number; to: number; coords: { left: number; bottom: number } }
export interface SlashCommandTrigger { query: string; from: number; to: number; coords: { left: number; bottom: number } }
export interface TagTrigger { query: string; from: number; to: number; coords: { left: number; bottom: number } }

export interface AutocompleteCallbacks {
  onWikilinkTrigger?: (t: WikilinkTrigger | null) => void
  onStrongsTrigger?: (t: StrongsTrigger | null) => void
  onVerseSuggestTrigger?: (t: VerseSuggestTrigger | null) => void
  onSlashCommandTrigger?: (t: SlashCommandTrigger | null) => void
  onTagTrigger?: (t: TagTrigger | null) => void
  enableStrongsSuggest?: () => boolean
  enableVerseSuggest?: () => boolean
}

function textBeforeCursor(view: EditorView): { text: string; lineStart: number } {
  const { $from } = view.state.selection
  const parent = $from.parent
  const offset = $from.parentOffset
  let lineStart = 0
  let pos = 0
  for (let i = 0; i < parent.childCount && pos < offset; i++) {
    const child = parent.child(i)
    pos += child.nodeSize
    if (child.type.name === 'hard_break' && pos <= offset) lineStart = pos
  }
  return { text: parent.textBetween(lineStart, offset, undefined, '￼'), lineStart: $from.start() + lineStart }
}

export const autocompleteKey = new PluginKey('berean-autocomplete')

export function createAutocompletePlugin(callbacks: AutocompleteCallbacks) {
  return new Plugin({
    key: autocompleteKey,
    view() {
      return {
        update(view, prevState) {
          // View mode keeps the same live EditorView mounted (just non-
          // editable, see NoteEditorPM.tsx's `editable: () => mode === 'edit'`)
          // rather than swapping to a separate static renderer — this plugin's
          // update() hook fires on any selection change regardless, including
          // cursor movement in a read-only view, so it needs its own
          // editability check rather than relying on `editable` blocking it.
          if (!view.editable) {
            callbacks.onWikilinkTrigger?.(null)
            callbacks.onStrongsTrigger?.(null)
            callbacks.onVerseSuggestTrigger?.(null)
            callbacks.onSlashCommandTrigger?.(null)
            callbacks.onTagTrigger?.(null)
            return
          }
          if (view.state.doc.eq(prevState.doc) && view.state.selection.eq(prevState.selection)) return
          if (!view.state.selection.empty) {
            callbacks.onWikilinkTrigger?.(null)
            callbacks.onStrongsTrigger?.(null)
            callbacks.onVerseSuggestTrigger?.(null)
            callbacks.onSlashCommandTrigger?.(null)
            callbacks.onTagTrigger?.(null)
            return
          }
          const { text, lineStart } = textBeforeCursor(view)
          const cursor = view.state.selection.from
          const { $from } = view.state.selection

          // "/" slash-command trigger — fires after start-of-line OR any
          // whitespace, so it works both on an empty line AND at the end of
          // a line that already has text ("Some notes /" triggers same as
          // "/" alone). `(?<=^|\s)` is a zero-width lookbehind, not a
          // consuming group (same technique as inputRules.ts's mark rules)
          // — it requires start-of-line/whitespace immediately before "/"
          // WITHOUT that character becoming part of the match, so
          // slashMatch.index lands exactly on "/" itself with no offset
          // math needed. This is what keeps "and/or" or a fraction like
          // "1/2" from triggering (the char right before "/" is a letter/
          // digit, not whitespace/start-of-line) while still allowing
          // "/" right after real content. Not offered inside code blocks,
          // where "/" is common as literal text.
          const slashMatch = /(?<=^|\s)\/(\w*)$/.exec(text)
          if (slashMatch && !$from.parent.type.spec.code) {
            const from = lineStart + slashMatch.index
            const coords = view.coordsAtPos(from)
            callbacks.onSlashCommandTrigger?.({ query: slashMatch[1], from, to: cursor, coords: { left: coords.left, bottom: coords.bottom } })
          } else {
            callbacks.onSlashCommandTrigger?.(null)
          }

          // "#tag" trigger — "#" after start-of-line/whitespace, immediately followed by at
          // least one word char (so a bare "# " markdown heading never triggers it), scanning
          // to the cursor. Not offered inside code.
          const tagMatch = /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)$/u.exec(text)
          if (tagMatch && !$from.parent.type.spec.code) {
            const from = lineStart + tagMatch.index + tagMatch[0].indexOf('#')
            const coords = view.coordsAtPos(from)
            callbacks.onTagTrigger?.({ query: tagMatch[1], from, to: cursor, coords: { left: coords.left, bottom: coords.bottom } })
          } else {
            callbacks.onTagTrigger?.(null)
          }

          // [[ wikilink trigger — unclosed "[[" with no "]]" after it yet.
          const bracketIdx = text.lastIndexOf('[[')
          if (bracketIdx !== -1 && !text.slice(bracketIdx + 2).includes(']]')) {
            const query = text.slice(bracketIdx + 2)
            const from = lineStart + bracketIdx
            const coords = view.coordsAtPos(from)
            callbacks.onWikilinkTrigger?.({ query, from, to: cursor, coords: { left: coords.left, bottom: coords.bottom } })
          } else {
            callbacks.onWikilinkTrigger?.(null)
          }

          // Strong's-number block-suggest trigger.
          if (callbacks.enableStrongsSuggest?.() !== false) {
            const m = /([HGhg]\d{1,5})$/.exec(text)
            const nextChar = view.state.doc.textBetween(cursor, Math.min(cursor + 1, view.state.doc.content.size))
            if (m && !/[A-Za-z]/.test(nextChar)) {
              const from = cursor - m[1].length
              const coords = view.coordsAtPos(from)
              callbacks.onStrongsTrigger?.({ num: m[1].toUpperCase(), from, to: cursor, coords: { left: coords.left, bottom: coords.bottom } })
            } else {
              callbacks.onStrongsTrigger?.(null)
            }
          }

          // Verse-reference block-suggest trigger (must resolve to a specific verse).
          // Reuses findVerseRefMatches (noteTextBlocks.ts) — the same scanner
          // findVerseRefMatches/blockDecorations.ts use for inline ref-linking and
          // verse-block detection — instead of a separate, much narrower ad-hoc regex.
          // That old regex only matched a single-word book name directly followed by
          // " chapter:verse" (`\b\w[\w.]*(?: \d+):\d+`), so it never fired for ANY
          // multi-word book ("Song of Songs", "1 Samuel", "Testament of Levi") or a
          // "Book N" subdivision edition (Recognitions of Clement) — confirmed broken
          // for exactly those cases. findVerseRefMatches already handles all of them.
          if (callbacks.enableVerseSuggest?.() !== false) {
            const matches = findVerseRefMatches(text)
            const last = matches[matches.length - 1]
            // Must end at (or within one trailing space of) the cursor — a reference
            // earlier in the line that the user has since typed past shouldn't re-trigger.
            const endsNearCursor = last && last.index + last.length >= text.length - 1
            const parsed = last ? parseRef(last.refText) : null
            if (last && endsNearCursor && parsed?.verse) {
              // findVerseRefMatches already folds a trailing " LXX" marker into refText, so
              // re-appending it here produced "genesis 1:1 LXX LXX" in the suggestion bubble.
              // Strip any existing trailing marker first so the result carries exactly one.
              const candidate = last.lxx ? `${last.refText.replace(/[ \t]+LXX$/i, '')} LXX` : last.refText
              const from = lineStart + last.index
              const coords = view.coordsAtPos(from)
              callbacks.onVerseSuggestTrigger?.({ ref: candidate, from, to: cursor, coords: { left: coords.left, bottom: coords.bottom } })
            } else {
              callbacks.onVerseSuggestTrigger?.(null)
            }
          }
        },
      }
    },
  })
}

// ─── Insertion helpers ──────────────────────────────────────────────────────
// Replace [from,to) with real text and move the cursor to the end — same
// shape as CM6's insertBacklink/insertStrongsBlock/insertVerseBlock.
export function replaceRangeWithText(view: EditorView, from: number, to: number, text: string) {
  const tr = view.state.tr.insertText(text, from, to)
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + text.length)))
  view.dispatch(tr)
  view.focus()
}

// Selecting a note from the `[[` autocomplete popup used to call
// replaceRangeWithText(view, from, to, `[[${title}]]`) — inserting the
// literal bracket TEXT, not a real `wikilink` mark. Marks only get created
// by parsing markdown source (parser.ts, at note-load time) or by an
// explicit mark-creating transaction; typing/inserting raw "[[...]]"
// characters into a live PM doc does neither on its own, so the freshly
// inserted link sat there as plain, unclickable text until the note was
// closed and reopened (forcing a re-parse). This inserts a genuine marked
// text node instead, so the link is live immediately — matching the
// wikilinkInputRule in inputRules.ts, which fixes the OTHER way the same
// gap showed up (typing "[[Title]]" out by hand, no autocomplete involved).
export function replaceRangeWithWikilink(view: EditorView, from: number, to: number, title: string) {
  const { schema } = view.state
  const mark = schema.marks.wikilink.create({ title })
  const tr = view.state.tr.replaceWith(from, to, schema.text(title, [mark]))
  tr.setSelection(TextSelection.near(tr.doc.resolve(from + title.length)))
  view.dispatch(tr)
  view.focus()
}

// Like replaceRangeWithText, but for multi-line verse/lexicon blocks
// (insertVerseBlock/insertStrongsBlock in NoteEditorPM.tsx) — those used to
// build ONE joined string ("Genesis 5:6-7\n6 And...\n7 And...") and pass it
// through insertText, which puts every line into a SINGLE text node
// containing literal '\n' characters. That's not a real line break in
// ProseMirror's document model (only a `hard_break` node or a paragraph
// boundary is): with the editor's default `white-space: normal`, the raw
// '\n's get collapsed by the browser same as any other whitespace, and
// blockDecorations.ts's collectLineRuns — which only recognizes lines via
// actual paragraph siblings or hard_break children — never sees more than
// one line, so the block fails detection entirely. Building real paragraph
// nodes and inserting them as a Fragment lets ProseMirror's own
// replace-and-split logic (the same mechanism that handles pasting a
// multi-paragraph slice mid-paragraph) split the current paragraph at the
// insertion point, so each line lands as its own genuine paragraph —
// exactly what typing the block by hand (pressing Enter per line) already
// produces, making auto-inserted and hand-typed blocks render identically.
export function replaceRangeWithBlock(view: EditorView, from: number, to: number, lines: string[]) {
  const { schema, doc } = view.state
  const paragraphs = lines.map((line) => schema.nodes.paragraph.create(null, line ? schema.text(line) : undefined))
  const fragment = Fragment.fromArray(paragraphs)

  // The common case (typing a ref on its own line, then accepting the
  // block-suggest popup) has [from, to) covering the ENTIRE text of its
  // enclosing paragraph — but from/to still sit strictly INSIDE that
  // paragraph's open/close boundary, so a plain replaceWith(from, to, ...)
  // still treats it as "insert closed block content mid-paragraph" and
  // splits off an empty leading paragraph fragment either side (visible as
  // a stray blank line above the inserted block). When the range exactly
  // spans its parent paragraph's full content, widen it to the paragraph's
  // own start/end so the paragraph itself gets replaced instead of split.
  const $from = doc.resolve(from)
  const $to = doc.resolve(to)
  const spansWholeParagraph =
    $from.parent.type.name === 'paragraph' && $from.sameParent($to) &&
    $from.parentOffset === 0 && $to.parentOffset === $from.parent.content.size
  const rangeFrom = spansWholeParagraph ? $from.before() : from
  const rangeTo = spansWholeParagraph ? $to.after() : to

  const tr = view.state.tr.replaceWith(rangeFrom, rangeTo, fragment)
  tr.setSelection(TextSelection.near(tr.doc.resolve(rangeFrom + fragment.size)))
  view.dispatch(tr)
  view.focus()
}
